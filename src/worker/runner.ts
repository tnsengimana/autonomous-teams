/**
 * Worker Runner
 *
 * Entity-based iteration with 5-minute intervals.
 *
 * For each active entity:
 * 1. Create an llm_interaction record
 * 2. Build user message with graph context
 * 3. Call LLM with tools (no maxSteps limit - let it work until done)
 * 4. Save response to llm_interaction
 */

import { streamLLMResponseWithTools } from "@/lib/llm/providers";
import {
  buildGraphContextBlock,
  ensureGraphTypesInitialized,
} from "@/lib/llm/knowledge-graph";
import { getBackgroundTools, type ToolContext } from "@/lib/llm/tools";
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
// Entity Iteration Processing
// ============================================================================

/**
 * Process one entity's iteration.
 *
 * This calls the LLM with the entity's system prompt and a user message
 * containing graph context. The LLM can call tools to augment the knowledge
 * graph and gather information.
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

    // 1. Build context with graph information
    const graphContext = await buildGraphContextBlock(entity.id);
    const systemPrompt = entity.systemPrompt;

    // 2. Create the request message with graph context
    const requestMessages = [
      {
        role: "user" as const,
        content: `
<request>
Continue your work. Review your knowledge graph state below and decide what to do next to further your mission. You can:
- Use queryGraph to search for existing knowledge
- Use tavilySearch, tavilyExtract, or tavilyResearch to gather new information from the web
- Use addGraphNode to add new knowledge to your graph
- Use addGraphEdge to create relationships between nodes
- Use createNodeType or createEdgeType if you need new types
- Use requestUserInput if you need clarification or input from the user

Think about what would be most valuable to research or learn about right now, then take action.
<request>


${graphContext}
`,
      },
    ];

    // 3. Create llm_interaction record
    const interaction = await createLLMInteraction({
      entityId: entity.id,
      systemPrompt: systemPrompt,
      request: { messages: requestMessages },
    });

    // 4. Get tools with context
    const toolContext: ToolContext = { entityId: entity.id };
    const tools = getBackgroundTools();

    log(`Calling LLM for entity ${entity.name} with ${tools.length} tools`);

    // 5. Call LLM using existing abstraction
    // No maxSteps limit specified - uses default
    const { fullResponse } = await streamLLMResponseWithTools(
      requestMessages,
      systemPrompt,
      {
        tools,
        toolContext,
        entityId: entity.id,
      },
    );

    // 6. Wait for completion and record response
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
      `Completed iteration for entity ${entity.name}. ` +
        `Tool calls: ${result.toolCalls.length}, Response length: ${result.text.length}`,
    );
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
  log("Worker runner started (entity-based iteration, 5-minute interval)");

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
