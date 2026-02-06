/**
 * Worker Runner
 *
 * Agent-based iteration with configurable intervals using a
 * Query Identification -> Researcher -> Insight Identification -> Analyzer -> Adviser pipeline.
 *
 * For each active agent:
 * 1. Query Identification phase: scan graph, identify knowledge gaps (queries)
 * 2. Researcher phase: for each query, run knowledge acquisition + graph construction
 * 3. Rebuild graph context after all queries are processed (now enriched)
 * 4. Insight Identification phase: scan enriched graph, identify patterns (insights)
 * 5. Analyzer phase: for each insight, run analysis generation
 * 6. Adviser phase: if analyses were produced, run advice generation
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
import { normalizeInsightIdentificationOutput } from "./normalization";
import { validateKnowledgeAcquisitionOutput } from "./validation";
import type {
  QueryIdentificationOutput,
  InsightIdentificationOutput,
  ObserverQuery,
  ObserverInsight,
} from "./types";
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
    .describe("Suggested search queries or keywords to guide the research"),
});

const ObserverInsightSchema = z.object({
  observation: z
    .string()
    .describe(
      "A pattern, trend, or connection spotted in the existing graph knowledge",
    ),
  relevantNodeIds: z
    .array(z.string())
    .describe("UUIDs of graph nodes that are relevant to this observation"),
  synthesisDirection: z
    .string()
    .describe("Guidance for the Analyzer on what angle to analyze this from"),
});

const QueryIdentificationOutputSchema = z.object({
  queries: z
    .array(ObserverQuerySchema)
    .describe(
      "Knowledge gaps to fill via web research. Each query becomes a Knowledge Acquisition + Graph Construction cycle.",
    ),
});

const InsightIdentificationOutputSchema = z.object({
  insights: z
    .array(ObserverInsightSchema)
    .describe(
      "Patterns worth analyzing from existing graph knowledge. Each insight becomes an Analysis Generation call.",
    ),
});

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

function logWarning(message: string, ...args: unknown[]): void {
  const timestamp = new Date().toISOString();
  console.warn(`[${timestamp}] [Worker] ${message}`, ...args);
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
// Query Identification Phase
// ============================================================================

/**
 * Run the query identification phase to scan the graph and identify knowledge gaps.
 * Uses structured output (generateLLMObject) to get a JSON response.
 */
async function runQueryIdentificationPhase(
  agent: Agent,
  graphContext: string,
  workerIterationId: string,
): Promise<QueryIdentificationOutput> {
  log(`[QueryIdentification] Starting for agent: ${agent.name}`);

  const requestMessages = [
    {
      role: "user" as const,
      content: `Review your current knowledge graph and identify knowledge gaps that need to be filled via web research.

${graphContext}

Based on the graph state above, produce output with:
- **queries**: Knowledge gaps to fill via web research. Each becomes a Knowledge Acquisition + Graph Construction cycle.

Focus only on identifying what information is missing or outdated. Do not identify patterns or insights — that will happen in a later phase after research enriches the graph.`,
    },
  ];

  const interaction = await createLLMInteraction({
    agentId: agent.id,
    workerIterationId,
    systemPrompt: agent.queryIdentificationSystemPrompt,
    request: { messages: requestMessages },
    phase: "query_identification",
  });

  const output = await generateLLMObject(
    requestMessages,
    QueryIdentificationOutputSchema,
    agent.queryIdentificationSystemPrompt,
    { agentId: agent.id },
  );

  await updateLLMInteraction(interaction.id, {
    response: output,
    completedAt: new Date(),
  });

  log(
    `[QueryIdentification] Agent ${agent.name} produced ${output.queries.length} queries`,
  );

  return output;
}

// ============================================================================
// Insight Identification Phase
// ============================================================================

/**
 * Run the insight identification phase to scan the (enriched) graph and identify patterns.
 * Uses structured output (generateLLMObject) to get a JSON response.
 * Normalizes relevantNodeIds to strict UUIDs since the model may emit names.
 */
async function runInsightIdentificationPhase(
  agent: Agent,
  graphContext: string,
  workerIterationId: string,
): Promise<InsightIdentificationOutput> {
  log(`[InsightIdentification] Starting for agent: ${agent.name}`);

  const requestMessages = [
    {
      role: "user" as const,
      content: `Review your current knowledge graph and identify patterns, trends, or connections worth analyzing.

${graphContext}

Based on the graph state above, produce output with:
- **insights**: Patterns worth analyzing from existing graph knowledge. Each becomes an Analysis Generation call.

Focus only on identifying patterns and connections in the existing knowledge. Reference relevant graph nodes by their UUIDs in relevantNodeIds.`,
    },
  ];

  const interaction = await createLLMInteraction({
    agentId: agent.id,
    workerIterationId,
    systemPrompt: agent.insightIdentificationSystemPrompt,
    request: { messages: requestMessages },
    phase: "insight_identification",
  });

  const output = await generateLLMObject(
    requestMessages,
    InsightIdentificationOutputSchema,
    agent.insightIdentificationSystemPrompt,
    { agentId: agent.id },
  );

  // Post-validate and normalize insight node references to strict UUIDs.
  // The model may still emit names despite prompt/schema guidance.
  const graphNodes = await getNodesByAgent(agent.id);
  const normalizedOutput = normalizeInsightIdentificationOutput(
    output,
    graphNodes.map((node) => ({
      id: node.id,
      type: node.type,
      name: node.name,
    })),
  );

  await updateLLMInteraction(interaction.id, {
    response: normalizedOutput,
    completedAt: new Date(),
  });

  log(
    `[InsightIdentification] Agent ${agent.name} produced ${normalizedOutput.insights.length} insights`,
  );

  return normalizedOutput;
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
  log(
    `[Analyzer] Analysis generation for: "${insight.observation.length > 50 ? insight.observation.substring(0, 50) + "..." : insight.observation}"`,
  );

  const requestMessages = [
    {
      role: "user" as const,
      content: `Analyze the following observation in the knowledge graph.

## Observation
${insight.observation}

## Relevant Nodes
${insight.relevantNodeIds.map((id) => `- ${id}`).join("\n")}

## Synthesis Direction
${insight.synthesisDirection}

## Current Knowledge Graph
${graphContext}

Analyze the observation using the graph data. Create AgentAnalysis nodes that capture your findings. Use the addAgentAnalysisNode tool to create analyses.

Edge linkage is REQUIRED: every AgentAnalysis you create must be connected to relevant evidence nodes with addGraphEdge.
Use listEdgeTypes before adding edges so you pick existing edge types.
If addGraphEdge fails because an edge type is unavailable, call listEdgeTypes and retry ONCE with an available edge type.
Citations are REQUIRED in analysis content: use only [node:uuid] or [edge:uuid] markers with real IDs from the graph.
Never cite by name (for example, do not use [node:NVIDIA Corporation]).

If you find that the available knowledge is insufficient to properly analyze this pattern, explain what additional data would be needed. Do NOT create a low-quality analysis just to produce output.`,
    },
  ];

  // Create llm_interaction record
  const interaction = await createLLMInteraction({
    agentId: agent.id,
    workerIterationId,
    systemPrompt: agent.analysisGenerationSystemPrompt,
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
    agent.analysisGenerationSystemPrompt,
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

  const malformedToolCallFragments = result.events
    .filter((e): e is { llmOutput: string } => "llmOutput" in e)
    .map((e) => e.llmOutput)
    .filter((output) => output.includes("[TOOL_CALLS]"));

  if (malformedToolCallFragments.length > 0) {
    logWarning(
      `[Analyzer] Detected malformed tool-call text in LLM output for agent ${agent.name}`,
      {
        fragments: malformedToolCallFragments.map((fragment) =>
          fragment.slice(0, 200),
        ),
      },
    );
  }

  const addGraphEdgeCalls = result.events
    .filter(
      (
        e,
      ): e is {
        toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
      } => "toolCalls" in e,
    )
    .flatMap((e) => e.toolCalls.filter((tc) => tc.toolName === "addGraphEdge"));

  if (addGraphEdgeCalls.length > 0) {
    const edgeDescriptions = addGraphEdgeCalls.map((call) => {
      const args = call.args as Record<string, string>;
      const type = args.type ?? "<unknown-type>";
      const sourceType = args.sourceType ?? "<unknown-source-type>";
      const sourceName = args.sourceName ?? "<unknown-source>";
      const targetType = args.targetType ?? "<unknown-target-type>";
      const targetName = args.targetName ?? "<unknown-target>";
      return `${sourceType}:${sourceName} -[${type}]-> ${targetType}:${targetName}`;
    });

    logWarning(
      `[Analyzer] addGraphEdge calls attempted for agent ${agent.name}: ${edgeDescriptions.length}`,
      { edges: edgeDescriptions },
    );

    const edgeCounts = new Map<string, number>();
    for (const edgeDescription of edgeDescriptions) {
      edgeCounts.set(
        edgeDescription,
        (edgeCounts.get(edgeDescription) ?? 0) + 1,
      );
    }
    const repeatedEdgeAttempts = Array.from(edgeCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([edge, count]) => ({ edge, attempts: count }));

    if (repeatedEdgeAttempts.length > 0) {
      logWarning(
        `[Analyzer] Repeated addGraphEdge attempts detected for agent ${agent.name}`,
        { repeatedEdgeAttempts },
      );
    }
  }

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

  // Check if any AgentAnalysis nodes were successfully created
  const analysesProduced = result.events
    .filter(
      (
        e,
      ): e is {
        toolResults: Array<{ toolName: string; result: unknown }>;
      } => "toolResults" in e,
    )
    .some((e) =>
      e.toolResults.some((tr) => tr.toolName === "addAgentAnalysisNode"),
    );

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

  const requestMessages = [
    {
      role: "user" as const,
      content: `Review recent AgentAnalysis nodes and determine if an actionable recommendation is warranted.

## Current Knowledge Graph
${graphContext}

Review the AgentAnalysis nodes in your knowledge graph. Only create AgentAdvice if you have comprehensive AgentAnalysis coverage that addresses every aspect of the recommendation. The default action is to create NOTHING - only proceed if you have absolute conviction supported by thorough AgentAnalysis analysis.

If you create AgentAdvice, also create "based_on" edges from that AgentAdvice node to each supporting AgentAnalysis node you cite.`,
    },
  ];

  // Create llm_interaction record
  const interaction = await createLLMInteraction({
    agentId: agent.id,
    workerIterationId,
    systemPrompt: agent.adviceGenerationSystemPrompt,
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
    agent.adviceGenerationSystemPrompt,
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
  log(
    `[Researcher] Knowledge acquisition for: "${query.objective.length > 50 ? query.objective.substring(0, 50) + "..." : query.objective}"`,
  );

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

Use a shortlist-first workflow:
1. Start with 1-2 focused webSearch calls.
2. Build a shortlist of the best 2-4 URLs.
3. Use webExtract only on the highest-value shortlisted URLs.
4. If extraction fails or returns no content for a URL, continue with other URLs and avoid retries on the same URL.

Output requirements (MANDATORY):
1. Return markdown with exactly two top-level sections, in this order:
   - ## Findings
   - ## Source Ledger
2. In Findings, every factual claim must include inline source citations like [S1], [S2].
3. In Source Ledger, each source must be its own subsection in this format:
   ### [S1]
   url: <source url>
   title: <source title>
   published_at: <ISO date or unknown>
4. Every [S#] used in Findings must exist in Source Ledger.
5. Every source listed in Source Ledger must be cited at least once in Findings.

Return a focused markdown document with high-value findings and strict source traceability.`,
    },
  ];

  // Create llm_interaction record
  const interaction = await createLLMInteraction({
    agentId: agent.id,
    workerIterationId,
    systemPrompt: agent.knowledgeAcquisitionSystemPrompt,
    request: { messages: requestMessages },
    phase: "knowledge_acquisition",
  });

  // Get knowledge acquisition tools (web search and extraction only)
  const toolContext: ToolContext = { agentId: agent.id };
  const tools = getKnowledgeAcquisitionTools();

  log(
    `[Researcher] Calling LLM with ${tools.length} tools for agent ${agent.name}`,
  );

  const { fullResponse } = await streamLLMResponseWithTools(
    requestMessages,
    agent.knowledgeAcquisitionSystemPrompt,
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

  // TODO: Validating markdown is painful because it's just a string. Alternatively,
  // TODO: we can return a structured output from the LLM, which would make validation
  // TODO: here a joy.
  const validation = validateKnowledgeAcquisitionOutput(markdownOutput);

  if (!validation.isValid) {
    // Only log these validation errors avoid throwin an error. We will pipe
    // this markdownOutput to the LLM anyway so it will do the actual parsing
    // to update the graph.
    logWarning("[Researcher] Citation validation failed", {
      agentId: agent.id,
      workerIterationId,
      errors: validation.errors,
      citedSourceIds: validation.citedSourceIds,
      ledgerSourceIds: validation.ledgerSourceIds,
    });
  }

  // Final save with completedAt timestamp
  await updateLLMInteraction(interaction.id, {
    response: { events: result.events, validation },
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

  const requestMessages = [
    {
      role: "user" as const,
      content: `Structure the following acquired knowledge into your knowledge graph.

## Acquired Knowledge (from research)
${acquiredKnowledge}

## Current Knowledge Graph
${graphContext}

Transform the research findings above into structured graph nodes and edges. Use queryGraph to check for existing nodes, addGraphNode to create new nodes, and addGraphEdge to create relationships.

For type discovery, use listNodeTypes/listEdgeTypes before creating any new type.
If no existing type fits, you may use createNodeType/createEdgeType, but only after checking existing types first. Keep type creation minimal (typically 0-2 new node types and 0-2 new edge types in this run).

Modeling guardrails:
- Do not overload broad entity/profile types (for example, "Company") with quote/event/time-series facts.
- For quantitative facts, store machine-typed numbers (not formatted strings like "$171.88" or "206.31M").
- Keep units/currency in separate fields (for example, currency="USD", volume_unit="shares").
- If you need to preserve original human formatting, keep it in an optional raw_text field.`,
    },
  ];

  // Create llm_interaction record
  const interaction = await createLLMInteraction({
    agentId: agent.id,
    workerIterationId,
    systemPrompt: agent.graphConstructionSystemPrompt,
    request: { messages: requestMessages },
    phase: "graph_construction",
  });

  // Get graph construction tools (graph tools only, no web research tools)
  const toolContext: ToolContext = { agentId: agent.id };
  const tools = getGraphConstructionTools();

  log(
    `[GraphConstruction] Calling LLM with ${tools.length} tools for agent ${agent.name}`,
  );

  const { fullResponse } = await streamLLMResponseWithTools(
    requestMessages,
    agent.graphConstructionSystemPrompt,
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
 * Process one agent's iteration using the
 * Query Identification -> Researcher -> Insight Identification -> Analyzer -> Adviser pipeline.
 *
 * Step 1: Query Identification - scan graph and identify knowledge gaps (queries)
 * Step 2: Researcher - for each query, run knowledge acquisition + graph construction
 * Step 3: Rebuild graph context (now enriched)
 * Step 4: Insight Identification - scan enriched graph and identify patterns (insights)
 * Step 5: Analyzer - for each insight, run analysis generation
 * Step 6: Adviser - if analyses were produced, run advice generation
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

    // -- Step 1: QUERY IDENTIFICATION --
    const queryOutput = await runQueryIdentificationPhase(
      agent,
      graphContext,
      workerIteration.id,
    );

    // -- Step 2: RESEARCHER (for each query) --
    if (queryOutput.queries.length > 0) {
      log(`[Researcher] Processing ${queryOutput.queries.length} queries`);
      for (const query of queryOutput.queries) {
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

    // -- Step 4: INSIGHT IDENTIFICATION (on enriched graph) --
    const insightOutput = await runInsightIdentificationPhase(
      agent,
      graphContext,
      workerIteration.id,
    );

    // -- Step 5: ANALYZER (for each insight) --
    let analysesProduced = false;
    if (insightOutput.insights.length > 0) {
      log(`[Analyzer] Processing ${insightOutput.insights.length} insights`);
      for (const insight of insightOutput.insights) {
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

    // -- Step 6: ADVISER (if analyses were produced) --
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
    "Worker runner started (Query Identification -> Researcher -> Insight Identification -> Analyzer -> Adviser pipeline, per-agent intervals)",
  );

  // Register all tools before starting
  const { registerWebTools } = await import("@/lib/llm/tools/web-tools");
  const { registerGraphTools } = await import("@/lib/llm/tools/graph-tools");
  const { registerInboxTools } = await import("@/lib/llm/tools/inbox-tools");

  registerWebTools();
  registerGraphTools();
  registerInboxTools();
  log("Tools registered: Web, Graph, and Inbox tools");

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
  const { registerWebTools } = await import("@/lib/llm/tools/web-tools");
  const { registerGraphTools } = await import("@/lib/llm/tools/graph-tools");
  const { registerInboxTools } = await import("@/lib/llm/tools/inbox-tools");

  registerWebTools();
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
