/**
 * Worker Runner
 *
 * Agent-based iteration with configurable intervals using an Observer -> Researcher -> Analyzer -> Adviser pipeline.
 *
 * For each active agent:
 * 1. Observer phase: scan graph, produce plan with queries (knowledge gaps) and insights (patterns)
 * 2. Researcher phase: for each query, run knowledge acquisition + graph construction
 * 3. Rebuild graph context after all queries are processed
 * 4. Analyzer phase: for each insight, run analysis generation
 * 5. Adviser phase: if analyses were produced, run advice generation
 */

import {
  streamLLMResponseWithTools,
  generateLLMObject,
} from "@/lib/llm/providers";
import {
  buildGraphContextBlock,
  ensureGraphTypesInitialized,
} from "@/lib/llm/knowledge-graph";
import {
  getAnalysisGenerationTools,
  getAdviceGenerationTools,
  getKnowledgeAcquisitionTools,
  getGraphConstructionTools,
  type ToolContext,
} from "@/lib/llm/tools";
import { z } from "zod";
import { getActiveAgents } from "@/lib/db/queries/agents";
import { getNodesByAgent } from "@/lib/db/queries/graph-data";
import {
  createLLMInteraction,
  updateLLMInteraction,
} from "@/lib/db/queries/llm-interactions";
import {
  createWorkerIteration,
  updateWorkerIteration,
  getLastCompletedIteration,
} from "@/lib/db/queries/worker-iterations";
import { normalizeObserverPlanRelevantNodeIds } from "./observer-plan-normalization";
import type { Agent } from "@/lib/types";

// ============================================================================
// Configuration
// ============================================================================

// How often to check if any agent needs processing
const POLL_INTERVAL_MS = 10 * 1000; // 10 seconds

// Shutdown flag
let isShuttingDown = false;

export function stopRunner(): void {
  isShuttingDown = true;
}

// ============================================================================
// Types & Schemas
// ============================================================================

const ObserverQuerySchema = z.object({
  objective: z
    .string()
    .describe(
      "A specific research objective describing what knowledge to gather",
    ),
  reasoning: z
    .string()
    .describe(
      "Why this knowledge gap matters and how it advances the agent's mission",
    ),
  searchHints: z
    .array(z.string())
    .describe(
      "Suggested search queries or keywords to guide the research",
    ),
});

const ObserverInsightSchema = z.object({
  observation: z
    .string()
    .describe(
      "A pattern, trend, or connection spotted in the existing graph knowledge",
    ),
  relevantNodeIds: z
    .array(z.string())
    .describe(
      "UUIDs of graph nodes that are relevant to this observation",
    ),
  synthesisDirection: z
    .string()
    .describe(
      "Guidance for the Analyzer on what angle to analyze this from",
    ),
});

const ObserverPlanSchema = z.object({
  queries: z
    .array(ObserverQuerySchema)
    .describe(
      "Knowledge gaps to fill via web research. Each query becomes a Knowledge Acquisition + Graph Construction cycle.",
    ),
  insights: z
    .array(ObserverInsightSchema)
    .describe(
      "Patterns worth analyzing from existing graph knowledge. Each insight becomes an Analysis Generation call.",
    ),
});

type ObserverPlan = z.infer<typeof ObserverPlanSchema>;
type ObserverQuery = z.infer<typeof ObserverQuerySchema>;
type ObserverInsight = z.infer<typeof ObserverInsightSchema>;

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

/**
 * Check if an agent is due for its next iteration based on its interval.
 * Returns true if the agent has never been processed or if enough time has passed.
 */
async function isAgentDueForIteration(agent: Agent): Promise<boolean> {
  if (!agent.isActive) {
    return false;
  }

  const lastIteration = await getLastCompletedIteration(agent.id);

  // Never processed - due immediately
  if (!lastIteration) {
    return true;
  }

  // Skip if we are still running
  if (lastIteration.status === "running") {
    return false;
  }

  // Never finished running successfully last time
  if (!lastIteration.completedAt) {
    return true;
  }

  const timeSinceLastIteration =
    Date.now() - lastIteration.completedAt.getTime();
  return timeSinceLastIteration >= agent.iterationIntervalMs;
}

// ============================================================================
// Observer Phase
// ============================================================================

/**
 * Run the observer phase to scan the graph and produce a structured plan.
 * Uses structured output (generateLLMObject) to get a JSON response.
 */
async function runObserverPhase(
  agent: Agent,
  graphContext: string,
  workerIterationId: string,
): Promise<ObserverPlan> {
  log(`[Observer] Starting for agent: ${agent.name}`);

  const systemPrompt = agent.observerSystemPrompt;
  if (!systemPrompt) {
    throw new Error("Agent missing observerSystemPrompt");
  }

  const requestMessages = [
    {
      role: "user" as const,
      content: `Review your current knowledge graph and plan your next actions.

${graphContext}

Based on the graph state above, produce a plan with:
- **queries**: Knowledge gaps to fill via web research. Each becomes a research cycle.
- **insights**: Patterns worth analyzing from existing knowledge. Each becomes an analysis.

You may produce any combination: queries only, insights only, both, or neither (if there is nothing worth doing right now).`,
    },
  ];

  const interaction = await createLLMInteraction({
    agentId: agent.id,
    workerIterationId,
    systemPrompt: systemPrompt,
    request: { messages: requestMessages },
    phase: "observer",
  });

  const plan = await generateLLMObject(
    requestMessages,
    ObserverPlanSchema,
    systemPrompt,
    { agentId: agent.id },
  );

  // Post-validate and normalize observer node references to strict UUIDs.
  // The model may still emit names despite prompt/schema guidance.
  const graphNodes = await getNodesByAgent(agent.id);
  const normalization = normalizeObserverPlanRelevantNodeIds(
    plan,
    graphNodes.map((node) => ({ id: node.id, type: node.type, name: node.name })),
  );
  const normalizedPlan = normalization.normalizedPlan;

  await updateLLMInteraction(interaction.id, {
    response: normalizedPlan,
    completedAt: new Date(),
  });

  if (normalization.droppedReferences.length > 0) {
    log(
      `[Observer] Normalized relevantNodeIds for agent ${agent.name}. ` +
        `resolvedByUuid=${normalization.resolvedByUuid}, ` +
        `resolvedByName=${normalization.resolvedByName}, ` +
        `dropped=${normalization.droppedReferences.length}`,
    );
  }

  log(
    `[Observer] Agent ${agent.name} planned: ${normalizedPlan.queries.length} queries, ${normalizedPlan.insights.length} insights`,
  );

  return normalizedPlan;
}

// ============================================================================
// Action Phases
// ============================================================================

/**
 * Run the analysis generation phase.
 * Uses existing graph knowledge to create Analysis nodes based on an Observer insight.
 * Returns true if any AgentAnalysis nodes were created, false otherwise.
 */
async function runAnalysisGenerationPhase(
  agent: Agent,
  insight: ObserverInsight,
  graphContext: string,
  workerIterationId: string,
): Promise<boolean> {
  log(`[Analyzer] Analysis generation for: "${insight.observation.length > 50 ? insight.observation.substring(0, 50) + "..." : insight.observation}"`);

  const systemPrompt = agent.analysisGenerationSystemPrompt;
  if (!systemPrompt) {
    throw new Error("Agent missing analysisGenerationSystemPrompt");
  }

  const requestMessages = [
    {
      role: "user" as const,
      content: `Analyze the following pattern observed in the knowledge graph.

## Observation
${insight.observation}

## Relevant Nodes
${insight.relevantNodeIds.map((id) => `- ${id}`).join("\n")}

## Synthesis Direction
${insight.synthesisDirection}

## Current Knowledge Graph
${graphContext}

Analyze this pattern using the graph data. Create AgentAnalysis nodes that capture your findings. Use the addAgentAnalysisNode tool to create analyses and addGraphEdge to connect them to relevant nodes.

If you find that the available knowledge is insufficient to properly analyze this pattern, explain what additional data would be needed. Do NOT create a low-quality analysis just to produce output.`,
    },
  ];

  // Create llm_interaction record
  const interaction = await createLLMInteraction({
    agentId: agent.id,
    workerIterationId,
    systemPrompt: systemPrompt,
    request: { messages: requestMessages },
    phase: "analysis_generation",
  });

  // Get analysis generation tools
  const toolContext: ToolContext = { agentId: agent.id };
  const tools = getAnalysisGenerationTools();

  log(
    `[Analyzer] Calling LLM with ${tools.length} tools for agent ${agent.name}`,
  );

  const { fullResponse } = await streamLLMResponseWithTools(
    requestMessages,
    systemPrompt,
    {
      tools,
      toolContext,
      agentId: agent.id,
      maxSteps: 10,
      // Incremental save: update database after each step completes
      onStepFinish: async (events) => {
        await updateLLMInteraction(interaction.id, {
          response: { events },
        });
        log(`[Analyzer] Step saved. Events: ${events.length}`);
      },
    },
  );

  const result = await fullResponse;

  // Count tool calls from events for logging
  const toolCallCount = result.events
    .filter(
      (
        e,
      ): e is {
        toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
      } => "toolCalls" in e,
    )
    .reduce((sum, e) => sum + e.toolCalls.length, 0);

  // Get total text length from llmOutput events
  const textLength = result.events
    .filter((e): e is { llmOutput: string } => "llmOutput" in e)
    .reduce((sum, e) => sum + e.llmOutput.length, 0);

  // Final save with completedAt timestamp
  await updateLLMInteraction(interaction.id, {
    response: { events: result.events },
    completedAt: new Date(),
  });

  log(
    `[Analyzer] Completed for agent ${agent.name}. ` +
      `Tool calls: ${toolCallCount}, Response length: ${textLength}`,
  );

  // Check if any AgentAnalysis nodes were created
  const analysesProduced = result.events
    .filter((e): e is { toolCalls: Array<{ toolName: string; args: Record<string, unknown> }> } => "toolCalls" in e)
    .some((e) => e.toolCalls.some((tc) => tc.toolName === "addAgentAnalysisNode"));

  return analysesProduced;
}

/**
 * Run the advice generation phase.
 * Reviews AgentAnalysis nodes and may create AgentAdvice recommendations.
 * This phase is deliberately conservative - default is to create nothing.
 */
async function runAdviceGenerationPhase(
  agent: Agent,
  graphContext: string,
  workerIterationId: string,
): Promise<void> {
  log(`[AdviceGeneration] Starting for agent: ${agent.name}`);

  const systemPrompt = agent.adviceGenerationSystemPrompt;
  if (!systemPrompt) {
    throw new Error("Agent missing adviceGenerationSystemPrompt");
  }

  const requestMessages = [
    {
      role: "user" as const,
      content: `Review recent AgentAnalysis nodes and determine if an actionable recommendation is warranted.

## Current Knowledge Graph
${graphContext}

Review the AgentAnalysis nodes in your knowledge graph. Only create AgentAdvice if you have comprehensive AgentAnalysis coverage that addresses every aspect of the recommendation. The default action is to create NOTHING - only proceed if you have absolute conviction supported by thorough AgentAnalysis analysis.`,
    },
  ];

  // Create llm_interaction record
  const interaction = await createLLMInteraction({
    agentId: agent.id,
    workerIterationId,
    systemPrompt: systemPrompt,
    request: { messages: requestMessages },
    phase: "advice_generation",
  });

  // Get advice generation tools
  const toolContext: ToolContext = { agentId: agent.id };
  const tools = getAdviceGenerationTools();

  log(
    `[AdviceGeneration] Calling LLM with ${tools.length} tools for agent ${agent.name}`,
  );

  const { fullResponse } = await streamLLMResponseWithTools(
    requestMessages,
    systemPrompt,
    {
      tools,
      toolContext,
      agentId: agent.id,
      maxSteps: 10,
      // Incremental save: update database after each step completes
      onStepFinish: async (events) => {
        await updateLLMInteraction(interaction.id, {
          response: { events },
        });
        log(`[AdviceGeneration] Step saved. Events: ${events.length}`);
      },
    },
  );

  const result = await fullResponse;

  // Count tool calls from events for logging
  const toolCallCount = result.events
    .filter(
      (
        e,
      ): e is {
        toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
      } => "toolCalls" in e,
    )
    .reduce((sum, e) => sum + e.toolCalls.length, 0);

  // Get total text length from llmOutput events
  const textLength = result.events
    .filter((e): e is { llmOutput: string } => "llmOutput" in e)
    .reduce((sum, e) => sum + e.llmOutput.length, 0);

  // Final save with completedAt timestamp
  await updateLLMInteraction(interaction.id, {
    response: { events: result.events },
    completedAt: new Date(),
  });

  log(
    `[AdviceGeneration] Completed for agent ${agent.name}. ` +
      `Tool calls: ${toolCallCount}, Response length: ${textLength}`,
  );
}

/**
 * Run the knowledge acquisition phase.
 * Gathers raw information using web search tools for a specific query from the Observer.
 * Returns a markdown document with the findings.
 */
async function runKnowledgeAcquisitionPhase(
  agent: Agent,
  query: ObserverQuery,
  graphContext: string,
  workerIterationId: string,
): Promise<string> {
  log(`[Researcher] Knowledge acquisition for: "${query.objective.length > 50 ? query.objective.substring(0, 50) + "..." : query.objective}"`);

  const systemPrompt = agent.knowledgeAcquisitionSystemPrompt;
  if (!systemPrompt) {
    throw new Error("Agent missing knowledgeAcquisitionSystemPrompt");
  }

  const requestMessages = [
    {
      role: "user" as const,
      content: `Research the following knowledge gap and return a comprehensive markdown document with your findings.

## Research Objective
${query.objective}

## Why This Matters
${query.reasoning}

## Suggested Search Queries
${query.searchHints.map((h) => `- ${h}`).join("\n")}

## Current Knowledge Graph (for context)
${graphContext}

Use the available web search tools to gather comprehensive information. Return a well-organized markdown document with all findings, including source URLs and publication dates.`,
    },
  ];

  // Create llm_interaction record
  const interaction = await createLLMInteraction({
    agentId: agent.id,
    workerIterationId,
    systemPrompt: systemPrompt,
    request: { messages: requestMessages },
    phase: "knowledge_acquisition",
  });

  // Get knowledge acquisition tools (tavily tools only)
  const toolContext: ToolContext = { agentId: agent.id };
  const tools = getKnowledgeAcquisitionTools();

  log(
    `[Researcher] Calling LLM with ${tools.length} tools for agent ${agent.name}`,
  );

  const { fullResponse } = await streamLLMResponseWithTools(
    requestMessages,
    systemPrompt,
    {
      tools,
      toolContext,
      agentId: agent.id,
      maxSteps: 10,
      // Incremental save: update database after each step completes
      onStepFinish: async (events) => {
        await updateLLMInteraction(interaction.id, {
          response: { events },
        });
        log(`[Researcher] Step saved. Events: ${events.length}`);
      },
    },
  );

  const result = await fullResponse;

  // Count tool calls from events for logging
  const toolCallCount = result.events
    .filter(
      (
        e,
      ): e is {
        toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
      } => "toolCalls" in e,
    )
    .reduce((sum, e) => sum + e.toolCalls.length, 0);

  // Get the final text output (markdown document)
  const markdownOutput = result.events
    .filter((e): e is { llmOutput: string } => "llmOutput" in e)
    .map((e) => e.llmOutput)
    .join("");

  // Final save with completedAt timestamp
  await updateLLMInteraction(interaction.id, {
    response: { events: result.events },
    completedAt: new Date(),
  });

  log(
    `[Researcher] Completed for agent ${agent.name}. ` +
      `Tool calls: ${toolCallCount}, Output length: ${markdownOutput.length}`,
  );

  return markdownOutput;
}

/**
 * Run the graph construction phase.
 * Structures acquired knowledge (from markdown) into the graph.
 */
async function runGraphConstructionPhase(
  agent: Agent,
  acquiredKnowledge: string,
  graphContext: string,
  workerIterationId: string,
): Promise<void> {
  log(`[GraphConstruction] Starting for agent: ${agent.name}`);

  const systemPrompt = agent.graphConstructionSystemPrompt;
  if (!systemPrompt) {
    throw new Error("Agent missing graphConstructionSystemPrompt");
  }

  const requestMessages = [
    {
      role: "user" as const,
      content: `Structure the following acquired knowledge into your knowledge graph.

## Acquired Knowledge (from research)
${acquiredKnowledge}

## Current Knowledge Graph
${graphContext}

Transform the research findings above into structured graph nodes and edges. Use queryGraph to check for existing nodes, addGraphNode to create new nodes, and addGraphEdge to create relationships.`,
    },
  ];

  // Create llm_interaction record
  const interaction = await createLLMInteraction({
    agentId: agent.id,
    workerIterationId,
    systemPrompt: systemPrompt,
    request: { messages: requestMessages },
    phase: "graph_construction",
  });

  // Get graph construction tools (graph tools only, no tavily)
  const toolContext: ToolContext = { agentId: agent.id };
  const tools = getGraphConstructionTools();

  log(
    `[GraphConstruction] Calling LLM with ${tools.length} tools for agent ${agent.name}`,
  );

  const { fullResponse } = await streamLLMResponseWithTools(
    requestMessages,
    systemPrompt,
    {
      tools,
      toolContext,
      agentId: agent.id,
      maxSteps: 10,
      // Incremental save: update database after each step completes
      onStepFinish: async (events) => {
        await updateLLMInteraction(interaction.id, {
          response: { events },
        });
        log(`[GraphConstruction] Step saved. Events: ${events.length}`);
      },
    },
  );

  const result = await fullResponse;

  // Count tool calls from events for logging
  const toolCallCount = result.events
    .filter(
      (
        e,
      ): e is {
        toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
      } => "toolCalls" in e,
    )
    .reduce((sum, e) => sum + e.toolCalls.length, 0);

  // Get total text length from llmOutput events
  const textLength = result.events
    .filter((e): e is { llmOutput: string } => "llmOutput" in e)
    .reduce((sum, e) => sum + e.llmOutput.length, 0);

  // Final save with completedAt timestamp
  await updateLLMInteraction(interaction.id, {
    response: { events: result.events },
    completedAt: new Date(),
  });

  log(
    `[GraphConstruction] Completed for agent ${agent.name}. ` +
      `Tool calls: ${toolCallCount}, Response length: ${textLength}`,
  );
}

// ============================================================================
// Agent Iteration Processing
// ============================================================================

/**
 * Process one agent's iteration using the Observer -> Researcher -> Analyzer -> Adviser pipeline.
 *
 * Step 1: Observer - scan graph and produce plan with queries and insights
 * Step 2: Researcher - for each query, run knowledge acquisition + graph construction
 * Step 3: Rebuild graph context (now enriched)
 * Step 4: Analyzer - for each insight, run analysis generation
 * Step 5: Adviser - if analyses were produced, run advice generation
 */
async function processAgentIteration(agent: Agent): Promise<void> {
  log(`Processing iteration for agent: ${agent.name} (${agent.id})`);

  const workerIteration = await createWorkerIteration({
    agentId: agent.id,
  });
  log(`Created worker iteration: ${workerIteration.id}`);

  try {
    // Ensure graph types are initialized
    await ensureGraphTypesInitialized(
      agent.id,
      { name: agent.name, type: "agent", purpose: agent.purpose },
      { userId: agent.userId },
    );

    // Build initial graph context
    let graphContext = await buildGraphContextBlock(agent.id);

    // -- Step 1: OBSERVER --
    const plan = await runObserverPhase(agent, graphContext, workerIteration.id);

    // Store the observer plan on the worker iteration
    await updateWorkerIteration(workerIteration.id, {
      observerPlan: plan,
    });

    // -- Step 2: RESEARCHER (for each query) --
    if (plan.queries.length > 0) {
      log(`[Researcher] Processing ${plan.queries.length} queries`);
      for (const query of plan.queries) {
        const markdown = await runKnowledgeAcquisitionPhase(
          agent,
          query,
          graphContext,
          workerIteration.id,
        );
        await runGraphConstructionPhase(
          agent,
          markdown,
          graphContext,
          workerIteration.id,
        );
      }

      // -- Step 3: Rebuild graph context (now enriched) --
      graphContext = await buildGraphContextBlock(agent.id);
    }

    // -- Step 4: ANALYZER (for each insight) --
    let analysesProduced = false;
    if (plan.insights.length > 0) {
      log(`[Analyzer] Processing ${plan.insights.length} insights`);
      for (const insight of plan.insights) {
        const produced = await runAnalysisGenerationPhase(
          agent,
          insight,
          graphContext,
          workerIteration.id,
        );
        if (produced) {
          analysesProduced = true;
        }
      }
    }

    // -- Step 5: ADVISER (if analyses were produced) --
    if (analysesProduced) {
      // Rebuild graph context so adviser sees new AgentAnalysis nodes
      const adviserGraphContext = await buildGraphContextBlock(agent.id);
      await runAdviceGenerationPhase(
        agent,
        adviserGraphContext,
        workerIteration.id,
      );
    }

    // Mark iteration as completed
    await updateWorkerIteration(workerIteration.id, {
      status: "completed",
      completedAt: new Date(),
    });

    log(`Completed iteration for agent ${agent.name}`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logError(`Error in iteration for agent ${agent.name}:`, error);

    await updateWorkerIteration(workerIteration.id, {
      status: "failed",
      errorMessage: errorMsg,
      completedAt: new Date(),
    });
  }
}

// ============================================================================
// Main Runner Loop
// ============================================================================

/**
 * The main runner loop
 *
 * Polls for active agents and processes those that are due based on their
 * individual iteration intervals.
 */
export async function startRunner(): Promise<void> {
  log(
    "Worker runner started (Observer -> Researcher -> Analyzer -> Adviser pipeline, per-agent intervals)",
  );

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
      // Get all active agents
      const agents = await getActiveAgents();

      if (agents.length > 0) {
        // Check each agent to see if it's due for processing
        for (const agent of agents) {
          if (isShuttingDown) break;

          const isDue = await isAgentDueForIteration(agent);
          if (isDue) {
            log(
              `Agent ${agent.name} is due (interval: ${agent.iterationIntervalMs / 1000}s)`,
            );
            await processAgentIteration(agent);
          }
        }
      }
    } catch (error) {
      logError("Runner error:", error);
    }

    // Poll again after a short interval (unless shutting down)
    if (!isShuttingDown) {
      await sleep(POLL_INTERVAL_MS);
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
    const agents = await getActiveAgents();

    for (const agent of agents) {
      await processAgentIteration(agent);
    }

    log("Single cycle complete");
  } catch (error) {
    logError("Single cycle error:", error);
  }
}
