/**
 * Worker Runner
 *
 * Entity-based iteration with 5-minute intervals using two-step classification -> action flow.
 *
 * For each active entity:
 * 1. Run classification phase to decide: "synthesize" or "populate"
 * 2. Run the appropriate action phase based on classification result
 *
 * This implements the KGoT-inspired INSERT/RETRIEVE loop:
 * - "populate" = INSERT branch: gather external knowledge via Tavily tools
 * - "synthesize" = RETRIEVE branch: create Insight nodes from existing knowledge
 */

import { streamLLMResponseWithTools } from "@/lib/llm/providers";
import {
  buildGraphContextBlock,
  ensureGraphTypesInitialized,
} from "@/lib/llm/knowledge-graph";
import {
  getClassificationTools,
  getInsightSynthesisTools,
  getGraphConstructionTools,
  type ToolContext,
} from "@/lib/llm/tools";
import { getActiveEntities } from "@/lib/db/queries/entities";
import {
  createLLMInteraction,
  updateLLMInteraction,
} from "@/lib/db/queries/llm-interactions";
import type { Entity } from "@/lib/types";

// ============================================================================
// Configuration
// ============================================================================

const ITERATION_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Shutdown flag
let isShuttingDown = false;

export function stopRunner(): void {
  isShuttingDown = true;
}

// ============================================================================
// Types
// ============================================================================

interface ClassificationResult {
  action: "synthesize" | "populate";
  reasoning: string;
}

// ============================================================================
// Utility Functions
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message: string, ...args: unknown[]): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [Worker] ${message}`, ...args);
}

function logError(message: string, error: unknown): void {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [Worker] ${message}`, error);
}

// ============================================================================
// Classification Phase
// ============================================================================

/**
 * Parse the LLM response to extract classification action and reasoning.
 * Expects the LLM to return structured text with action and reasoning.
 */
function parseClassificationResponse(text: string): ClassificationResult {
  // Try to find action in the response
  const lowerText = text.toLowerCase();

  // Default to populate if we can't determine the action
  let action: "synthesize" | "populate" = "populate";

  // Look for explicit action indicators
  if (
    lowerText.includes("action: synthesize") ||
    lowerText.includes("action:synthesize") ||
    lowerText.includes('"action": "synthesize"') ||
    lowerText.includes("'action': 'synthesize'") ||
    lowerText.includes("decision: synthesize") ||
    lowerText.includes("i choose to synthesize") ||
    lowerText.includes("i will synthesize") ||
    lowerText.includes("proceed with synthesis") ||
    lowerText.includes("ready to synthesize")
  ) {
    action = "synthesize";
  } else if (
    lowerText.includes("action: populate") ||
    lowerText.includes("action:populate") ||
    lowerText.includes('"action": "populate"') ||
    lowerText.includes("'action': 'populate'") ||
    lowerText.includes("decision: populate") ||
    lowerText.includes("i choose to populate") ||
    lowerText.includes("i will populate") ||
    lowerText.includes("need more data") ||
    lowerText.includes("need to gather") ||
    lowerText.includes("need to research")
  ) {
    action = "populate";
  }

  // Use the full text as reasoning
  const reasoning = text.trim() || "No reasoning provided";

  return { action, reasoning };
}

/**
 * Run the classification phase to decide whether to synthesize or populate.
 */
async function runClassificationPhase(
  entity: Entity,
  graphContext: string,
): Promise<ClassificationResult> {
  log(`[Classification] Starting for entity: ${entity.name}`);

  const systemPrompt = entity.classificationSystemPrompt;
  if (!systemPrompt) {
    throw new Error("Entity missing classificationSystemPrompt");
  }

  const requestMessages = [
    {
      role: "user" as const,
      content: `Review your current knowledge graph state and decide your next action.

${graphContext}

Based on the graph state above, decide:
- "synthesize" if you have enough knowledge to derive meaningful insights
- "populate" if you need to gather more external knowledge

Respond with your decision and detailed reasoning about what specific work to do.`,
    },
  ];

  // Create llm_interaction record for classification
  const interaction = await createLLMInteraction({
    entityId: entity.id,
    systemPrompt: systemPrompt,
    request: { messages: requestMessages },
    phase: "classification",
  });

  // Get classification tools (queryGraph only)
  const toolContext: ToolContext = { entityId: entity.id };
  const tools = getClassificationTools();

  log(
    `[Classification] Calling LLM with ${tools.length} tools for entity ${entity.name}`,
  );

  const { fullResponse } = await streamLLMResponseWithTools(
    requestMessages,
    systemPrompt,
    {
      tools,
      toolContext,
      entityId: entity.id,
      maxSteps: 5, // Classification shouldn't need many steps
    },
  );

  const result = await fullResponse;

  await updateLLMInteraction(interaction.id, {
    response: {
      text: result.text,
      toolCalls: result.toolCalls,
      toolResults: result.toolResults,
    },
    completedAt: new Date(),
  });

  // Parse the classification result
  const classification = parseClassificationResponse(result.text);

  log(
    `[Classification] Entity ${entity.name} decided: ${classification.action}`,
  );
  log(
    `[Classification] Reasoning preview: ${classification.reasoning.substring(0, 200)}...`,
  );

  return classification;
}

// ============================================================================
// Action Phases
// ============================================================================

/**
 * Run the insight synthesis phase.
 * Uses existing graph knowledge to create Insight nodes.
 */
async function runInsightSynthesisPhase(
  entity: Entity,
  classificationReasoning: string,
  graphContext: string,
): Promise<void> {
  log(`[InsightSynthesis] Starting for entity: ${entity.name}`);

  const systemPrompt = entity.insightSynthesisSystemPrompt;
  if (!systemPrompt) {
    throw new Error("Entity missing insightSynthesisSystemPrompt");
  }

  const requestMessages = [
    {
      role: "user" as const,
      content: `Execute insight synthesis based on the classification decision.

## Classification Decision
${classificationReasoning}

## Current Knowledge Graph
${graphContext}

Analyze the existing knowledge in your graph and create Insight nodes that capture signals, observations, or patterns. Use the addInsightNode tool to create insights and addGraphEdge to connect them to relevant nodes.`,
    },
  ];

  // Create llm_interaction record
  const interaction = await createLLMInteraction({
    entityId: entity.id,
    systemPrompt: systemPrompt,
    request: { messages: requestMessages },
    phase: "insight_synthesis",
  });

  // Get insight synthesis tools
  const toolContext: ToolContext = { entityId: entity.id };
  const tools = getInsightSynthesisTools();

  log(
    `[InsightSynthesis] Calling LLM with ${tools.length} tools for entity ${entity.name}`,
  );

  const { fullResponse } = await streamLLMResponseWithTools(
    requestMessages,
    systemPrompt,
    {
      tools,
      toolContext,
      entityId: entity.id,
      maxSteps: 10,
    },
  );

  const result = await fullResponse;

  await updateLLMInteraction(interaction.id, {
    response: {
      text: result.text,
      toolCalls: result.toolCalls,
      toolResults: result.toolResults,
    },
    completedAt: new Date(),
  });

  log(
    `[InsightSynthesis] Completed for entity ${entity.name}. ` +
      `Tool calls: ${result.toolCalls.length}, Response length: ${result.text.length}`,
  );
}

/**
 * Run the graph construction phase.
 * Gathers external knowledge via Tavily tools and populates the graph.
 */
async function runGraphConstructionPhase(
  entity: Entity,
  classificationReasoning: string,
  graphContext: string,
): Promise<void> {
  log(`[GraphConstruction] Starting for entity: ${entity.name}`);

  const systemPrompt = entity.graphConstructionSystemPrompt;
  if (!systemPrompt) {
    throw new Error("Entity missing graphConstructionSystemPrompt");
  }

  const requestMessages = [
    {
      role: "user" as const,
      content: `Execute graph population based on the classification decision.

## Classification Decision
${classificationReasoning}

## Current Knowledge Graph
${graphContext}

Research and gather external information to fill knowledge gaps. Use Tavily tools (tavilySearch, tavilyExtract, tavilyResearch) to find information, then use addGraphNode and addGraphEdge to add the knowledge to your graph.`,
    },
  ];

  // Create llm_interaction record
  const interaction = await createLLMInteraction({
    entityId: entity.id,
    systemPrompt: systemPrompt,
    request: { messages: requestMessages },
    phase: "graph_construction",
  });

  // Get graph construction tools
  const toolContext: ToolContext = { entityId: entity.id };
  const tools = getGraphConstructionTools();

  log(
    `[GraphConstruction] Calling LLM with ${tools.length} tools for entity ${entity.name}`,
  );

  const { fullResponse } = await streamLLMResponseWithTools(
    requestMessages,
    systemPrompt,
    {
      tools,
      toolContext,
      entityId: entity.id,
      maxSteps: 10,
    },
  );

  const result = await fullResponse;

  await updateLLMInteraction(interaction.id, {
    response: {
      text: result.text,
      toolCalls: result.toolCalls,
      toolResults: result.toolResults,
    },
    completedAt: new Date(),
  });

  log(
    `[GraphConstruction] Completed for entity ${entity.name}. ` +
      `Tool calls: ${result.toolCalls.length}, Response length: ${result.text.length}`,
  );
}


// ============================================================================
// Entity Iteration Processing
// ============================================================================

/**
 * Process one entity's iteration using the two-step classification -> action flow.
 *
 * Step 1: Classification - decide "synthesize" or "populate"
 * Step 2: Execute the appropriate action phase
 */
async function processEntityIteration(entity: Entity): Promise<void> {
  log(`Processing iteration for entity: ${entity.name} (${entity.id})`);

  try {
    // Ensure graph types are initialized for this entity
    await ensureGraphTypesInitialized(
      entity.id,
      {
        name: entity.name,
        type: "entity", // Legacy field, can be anything
        purpose: entity.purpose,
      },
      { userId: entity.userId },
    );

    // Validate that entity has all required multi-phase prompts
    if (
      !entity.classificationSystemPrompt ||
      !entity.insightSynthesisSystemPrompt ||
      !entity.graphConstructionSystemPrompt
    ) {
      logError(
        `Entity ${entity.name} missing required multi-phase prompts, skipping`,
        new Error("Missing required prompts"),
      );
      return;
    }

    // Build graph context once (reused across phases)
    const graphContext = await buildGraphContextBlock(entity.id);

    // Step 1: CLASSIFICATION
    const classification = await runClassificationPhase(entity, graphContext);

    // Step 2: EXECUTE ACTION based on classification
    if (classification.action === "synthesize") {
      await runInsightSynthesisPhase(
        entity,
        classification.reasoning,
        graphContext,
      );
    } else {
      await runGraphConstructionPhase(
        entity,
        classification.reasoning,
        graphContext,
      );
    }

    log(`Completed two-step iteration for entity ${entity.name}`);
  } catch (error) {
    logError(`Error in iteration for entity ${entity.name}:`, error);
  }
}

// ============================================================================
// Main Runner Loop
// ============================================================================

/**
 * The main runner loop
 *
 * Iterates through all active entities and processes each one.
 * Sleeps for 5 minutes between iterations.
 */
export async function startRunner(): Promise<void> {
  log("Worker runner started (two-step classification -> action flow, 5-minute interval)");

  // Register all tools before starting
  const { registerTavilyTools } = await import("@/lib/llm/tools/tavily-tools");
  const { registerGraphTools } = await import("@/lib/llm/tools/graph-tools");
  const { registerInboxTools } = await import("@/lib/llm/tools/inbox-tools");

  registerTavilyTools();
  registerGraphTools();
  registerInboxTools();
  log("Tools registered: Tavily, Graph, and Inbox tools");

  while (!isShuttingDown) {
    try {
      // Get all active entities
      const entities = await getActiveEntities();

      if (entities.length > 0) {
        log(`Found ${entities.length} active entity(ies) to process`);

        // Process each entity's iteration
        for (const entity of entities) {
          if (isShuttingDown) break;
          await processEntityIteration(entity);
        }
      } else {
        log("No active entities found");
      }
    } catch (error) {
      logError("Runner error:", error);
    }

    // Wait before next iteration (unless shutting down)
    if (!isShuttingDown) {
      log(`Sleeping for ${ITERATION_INTERVAL_MS / 1000} seconds...`);
      await sleep(ITERATION_INTERVAL_MS);
    }
  }

  log("Runner loop stopped");
}

/**
 * Run a single cycle (useful for testing)
 */
export async function runSingleCycle(): Promise<void> {
  log("Running single cycle");

  // Register tools if not already registered
  const { registerTavilyTools } = await import("@/lib/llm/tools/tavily-tools");
  const { registerGraphTools } = await import("@/lib/llm/tools/graph-tools");
  const { registerInboxTools } = await import("@/lib/llm/tools/inbox-tools");

  registerTavilyTools();
  registerGraphTools();
  registerInboxTools();

  try {
    const entities = await getActiveEntities();

    for (const entity of entities) {
      await processEntityIteration(entity);
    }

    log("Single cycle complete");
  } catch (error) {
    logError("Single cycle error:", error);
  }
}
