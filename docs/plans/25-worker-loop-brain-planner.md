# 25 - Worker Loop: Observer as Planner

## Overview

This plan replaces the binary classification phase in the worker loop with an **Observer** that produces structured work plans. Conceptually the Observer is the agent's "brain" -- it scans the knowledge graph and produces **queries** (knowledge gaps to fill) and **insights** (patterns to analyze). All phases can execute within a single iteration, eliminating the ping-pong oscillation between populate and synthesize cycles.

The four named actors in the new pipeline are: **Observer**, **Researcher**, **Analyzer**, **Adviser**.

**Prerequisite:** Plan 24 (rename insight to analysis) has already been applied. This plan uses the post-plan-24 terminology: `AgentAnalysis`, `analysisGenerationSystemPrompt`, `addAgentAnalysisNode`, `getAnalysisGenerationTools`, `runAnalysisGenerationPhase`, `ANALYSIS_GENERATION_META_PROMPT`.

## Research Reference

See `docs/research/2-worker-loop-brain-planner.md` for the full design discussion including problem statement, proposed solution, and Q&A. In particular, Q3 establishes the Observer terminology: the code-level name is "Observer" while the conceptual metaphor of "brain" stays in prose.

## Current State

The following describes the codebase as it exists today (after plan 24).

- **Binary classification**: The worker loop starts each iteration with a classification phase (`runClassificationPhase`) that picks between `"synthesize"` or `"populate"` using `ClassificationResultSchema`
- **Either/or execution**: Only one branch runs per iteration -- either analysis generation + advice generation, OR knowledge acquisition + graph construction
- **Ping-pong problem**: If an agent populates data, it must wait for the next iteration to synthesize, then another iteration if synthesis reveals missing data
- **Classification schema**: `ClassificationResultSchema` produces `{ action: "synthesize" | "populate", reasoning: string, knowledge_gaps?: string[] }`
- **Agent column**: `classificationSystemPrompt` on the `agents` table (`src/lib/db/schema.ts`)
- **Worker iteration columns**: `classificationResult` (text) and `classificationReasoning` (text) on the `workerIterations` table
- **Phase values used in `llmInteractions.phase`**: `'classification'`, `'analysis_generation'`, `'advice_generation'`, `'knowledge_acquisition'`, `'graph_construction'`
- **Tools index**: `getClassificationTools()` exists in `src/lib/llm/tools/index.ts` and returns `[queryGraph]`
- **Meta-prompt**: `getClassificationMetaPrompt(interval)` in `src/lib/llm/agents.ts` generates the classification system prompt
- **Agent config schema**: `AgentConfigurationSchema` in `src/lib/llm/agents.ts` has a `classificationSystemPrompt` field
- **Unified meta-prompt**: `getUnifiedMetaPrompt(interval)` references `classificationMetaPrompt` and describes "six distinct phases"
- **Mock LLM**: `generateLLMObject` in `src/lib/llm/providers.ts` has a mock value `{ action: "populate", reasoning: "Mock mode..." }` for the classification schema

## Target State

- **Observer as planner**: The Observer scans the graph and produces a structured plan with queries and insights
- **Full pipeline per iteration**: Observer -> Researcher (for each query) -> rebuild graph context -> Analyzer (for each insight) -> Adviser (if analyses were produced)
- **No binary choice**: The Observer can produce any combination of queries and insights (including none of either)
- **Named actors**: Observer, Researcher, Analyzer, Adviser
- **Agent column**: `observerSystemPrompt` (replaces `classificationSystemPrompt`)
- **Worker iteration column**: `observerPlan` JSONB (replaces `classificationResult` + `classificationReasoning`)
- **Phase values**: `'observer'`, `'knowledge_acquisition'`, `'graph_construction'`, `'analysis_generation'`, `'advice_generation'`

### New Iteration Pipeline

```
+---------------------------------------------------+
|                    ITERATION                       |
|                                                    |
|  1. OBSERVER (planner / the agent's "brain")       |
|     Input: graph context + agent mission           |
|     Output: { queries[], insights[] }              |
|                                                    |
|  2. RESEARCHER (for each query)                    |
|     Knowledge Acquisition -> Graph Construction    |
|     (enriches the graph)                           |
|                                                    |
|  3. Rebuild graph context (now enriched)           |
|                                                    |
|  4. ANALYZER (for each insight, on enriched        |
|     graph context)                                 |
|     Analysis Generation                            |
|                                                    |
|  5. ADVISER (if analyses were produced)            |
|     Advice Generation                              |
|                                                    |
+---------------------------------------------------+
```

## Changes Required

### Phase 1: Schema Changes

> Note: The `Agent` type in `src/lib/types.ts` is defined as `InferSelectModel<typeof agents>` and will automatically pick up the renamed column -- no changes needed in that file.

#### 1.1 Rename `classificationSystemPrompt` to `observerSystemPrompt` in agents table

**File: `src/lib/db/schema.ts`**

The `agents` table currently has:

```typescript
classificationSystemPrompt: text("classification_system_prompt").notNull(),
```

Replace with:

```typescript
observerSystemPrompt: text("observer_system_prompt").notNull(),
```

#### 1.2 Replace classification columns on workerIterations table

The `workerIterations` table currently has:

```typescript
classificationResult: text("classification_result"), // 'synthesize' | 'populate'
classificationReasoning: text("classification_reasoning"),
```

Replace both with a single JSONB column:

```typescript
observerPlan: jsonb("observer_plan"), // Stores { queries: ObserverQuery[], insights: ObserverInsight[] }
```

#### 1.3 Update phase comment on llmInteractions

**File: `src/lib/db/schema.ts`**

The current comment:

```typescript
phase: text("phase"), // 'classification' | 'analysis_generation' | 'advice_generation' | 'knowledge_acquisition' | 'graph_construction'
```

Update to:

```typescript
phase: text("phase"), // 'observer' | 'knowledge_acquisition' | 'graph_construction' | 'analysis_generation' | 'advice_generation' | 'conversation'
```

#### 1.4 Nuke database and regenerate migration

Since this is a development environment with no production data, nuke the database and regenerate migrations from the fresh schema.

```bash
# Drop all tables and regenerate
npx drizzle-kit generate
npx drizzle-kit migrate
```

### Phase 2: Observer Phase Implementation

#### 2.1 Define the Observer's structured output schema

**File: `src/worker/runner.ts`**

Replace the `ClassificationResultSchema` with `ObserverPlanSchema`:

```typescript
const ObserverQuerySchema = z.object({
  objective: z
    .string()
    .describe(
      "A specific research objective describing what knowledge to gather"
    ),
  reasoning: z
    .string()
    .describe(
      "Why this knowledge gap matters and how it advances the agent's mission"
    ),
  searchHints: z
    .array(z.string())
    .describe(
      "Suggested search queries or keywords to guide the research"
    ),
});

const ObserverInsightSchema = z.object({
  observation: z
    .string()
    .describe(
      "A pattern, trend, or connection spotted in the existing graph knowledge"
    ),
  relevantNodeIds: z
    .array(z.string())
    .describe(
      "UUIDs of graph nodes that are relevant to this observation"
    ),
  synthesisDirection: z
    .string()
    .describe(
      "Guidance for the Analyzer on what angle to analyze this from"
    ),
});

const ObserverPlanSchema = z.object({
  queries: z
    .array(ObserverQuerySchema)
    .describe(
      "Knowledge gaps to fill via web research. Each query becomes a Knowledge Acquisition + Graph Construction cycle."
    ),
  insights: z
    .array(ObserverInsightSchema)
    .describe(
      "Patterns worth analyzing from existing graph knowledge. Each insight becomes an Analysis Generation call."
    ),
});

type ObserverPlan = z.infer<typeof ObserverPlanSchema>;
type ObserverQuery = z.infer<typeof ObserverQuerySchema>;
type ObserverInsight = z.infer<typeof ObserverInsightSchema>;
```

> Note: These schemas and types are local to `src/worker/runner.ts` and should NOT be exported -- no other file needs them.

#### 2.2 Implement `runObserverPhase`

Replace `runClassificationPhase` with `runObserverPhase`. The Observer uses `generateLLMObject` (structured output, no tools) to produce its plan.

```typescript
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

  await updateLLMInteraction(interaction.id, {
    response: plan,
    completedAt: new Date(),
  });

  log(
    `[Observer] Agent ${agent.name} planned: ${plan.queries.length} queries, ${plan.insights.length} insights`,
  );

  return plan;
}
```

#### 2.3 Remove `ClassificationResultSchema` and `runClassificationPhase`

Delete the `ClassificationResultSchema`, `ClassificationResult` type, and `runClassificationPhase` function entirely from `src/worker/runner.ts`.

### Phase 3: Worker Runner Revamp

#### 3.1 Update `runKnowledgeAcquisitionPhase` to accept an `ObserverQuery`

The knowledge acquisition phase currently receives a `knowledgeGap: string`. Update it to accept an `ObserverQuery` so it can use the objective and search hints:

```typescript
async function runKnowledgeAcquisitionPhase(
  agent: Agent,
  query: ObserverQuery,
  graphContext: string,
  workerIterationId: string,
): Promise<string> {
  log(`[Researcher] Knowledge acquisition for: "${query.objective.substring(0, 50)}..."`);

  // ... existing setup ...

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

  // ... rest stays the same ...
}
```

#### 3.2 Update `runAnalysisGenerationPhase` to accept an `ObserverInsight`

The analysis generation phase currently receives `classificationReasoning: string`. Update it to accept an `ObserverInsight` so the Analyzer gets specific guidance:

```typescript
async function runAnalysisGenerationPhase(
  agent: Agent,
  insight: ObserverInsight,
  graphContext: string,
  workerIterationId: string,
): Promise<boolean> {
  log(`[Analyzer] Analysis generation for: "${insight.observation.substring(0, 50)}..."`);

  // ... existing setup ...

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

  // ... rest similar to current implementation ...
  // Returns true if any AgentAnalysis nodes were created, false otherwise
}
```

The function returns `boolean` indicating whether analyses were produced. This is used to decide whether to run the Adviser phase.

To determine whether analyses were produced, check the tool call events for `addAgentAnalysisNode` calls. This check should go after the `const result = await fullResponse;` line and after saving the LLM interaction, with `return analysesProduced;` as the final statement of the function:

```typescript
// After fullResponse resolves and the LLM interaction is saved:
const analysesProduced = result.events
  .filter((e): e is { toolCalls: Array<{ toolName: string; args: Record<string, unknown> }> } => "toolCalls" in e)
  .some((e) => e.toolCalls.some((tc) => tc.toolName === "addAgentAnalysisNode"));

return analysesProduced;
```

#### 3.3 Rewrite `processAgentIteration`

Replace the binary classification flow with the new pipeline:

```typescript
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
    // Note: This is a behavioral change from the current system where advice generation
    // always runs after analysis generation on a 'synthesize' classification. Under the
    // new pipeline, the Adviser only runs if at least one `addAgentAnalysisNode` tool call
    // was made during the Analyzer phase.
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
```

#### 3.4 Update the runner docstring

Update the module-level docstring at the top of `src/worker/runner.ts`:

```typescript
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
```

#### 3.5 Update runner log messages and startup message

Change `startRunner` log from `"Worker runner started (two-step classification -> action flow, per-agent intervals)"` to `"Worker runner started (Observer -> Researcher -> Analyzer -> Adviser pipeline, per-agent intervals)"`.

### Phase 4: Agent Configuration Updates

#### 4.1 Replace `getClassificationMetaPrompt` with `getObserverMetaPrompt`

**File: `src/lib/llm/agents.ts`**

Delete `getClassificationMetaPrompt(interval)` and replace with `getObserverMetaPrompt(interval)`:

```typescript
/**
 * Meta-prompt for generating the OBSERVER system prompt.
 * The Observer is the agent's "brain" -- it scans the knowledge graph and produces a structured plan.
 */
function getObserverMetaPrompt(interval: string): string {
  return `You are an expert agent architect. Given a mission/purpose, generate an OBSERVER SYSTEM PROMPT for an AI agent that acts as the central planner directing all background work.

## Context

This agent runs autonomously every ${interval}. At the start of each iteration, the Observer phase scans the knowledge graph and produces a structured plan with two types of work items:

- **Queries**: Knowledge gaps to fill via web research. Each query has an objective, reasoning, and search hints.
- **Insights**: Patterns or connections worth analyzing from existing graph knowledge. Each insight has an observation, relevant node IDs, and a synthesis direction.

The Observer does NOT execute anything -- it only plans. It does not search the web, create graph nodes, or write analyses. It reads the graph context and decides what to investigate and what to think about. The downstream phases (Researcher, Analyzer, Adviser) handle execution.

## Output Requirements

Generate an observerSystemPrompt (5-8 paragraphs) that instructs the agent to:

### 1. Graph State Analysis
- Carefully review the full graph context provided
- Identify what knowledge exists, its recency, and its completeness
- Look for areas that are well-populated vs. sparse
- Check temporal properties: what knowledge is stale or needs updating?
- Notice cross-domain connections and emerging patterns

### 2. Query Generation (Knowledge Gaps)
Generate queries when:
- Key knowledge areas have gaps that limit analysis quality
- Information is stale and needs refreshing
- New developments require investigation
- The mission has aspects not yet represented in the graph

Each query must include:
- **objective**: A specific, targeted research goal (not vague like "learn more about tech")
- **reasoning**: Why this gap matters for the mission
- **searchHints**: Concrete search queries to guide research

### 3. Insight Generation (Patterns to Analyze)
Generate insights when:
- Multiple related pieces of information can be connected to derive new understanding
- Patterns are emerging that haven't been formally captured as AgentAnalysis nodes
- Recent data creates opportunities to update or validate existing observations
- Cross-domain connections are visible that deserve deeper analysis

Each insight must include:
- **observation**: The specific pattern or connection noticed
- **relevantNodeIds**: UUIDs of nodes that inform this observation (the Observer has access to node IDs in the graph context)
- **synthesisDirection**: Clear guidance on what angle to analyze

### 4. Plan Balance
- Prefer a focused plan (2-4 total items) over an exhaustive one
- It is valid to produce an empty plan if the graph is in good shape and no action is needed
- Balance queries and insights -- don't always do one without the other
- Avoid re-querying for knowledge that already exists in the graph
- Avoid generating insights that duplicate existing AgentAnalysis nodes

### 5. Mission Alignment
- Every query and insight must tie back to the agent's core mission
- Prioritize work that advances the mission's goals
- Don't drift into tangential topics just because they're interesting

### 6. Quality Over Quantity
- One well-defined query is better than five vague ones
- One specific insight pointing at concrete nodes is better than a generic observation
- The Observer's output quality determines the quality of the entire iteration`;
}
```

#### 4.2 Update `AgentConfigurationSchema`

**File: `src/lib/llm/agents.ts`**

The current schema has:

```typescript
classificationSystemPrompt: z
  .string()
  .describe(
    "System prompt for deciding between synthesize or populate actions",
  ),
```

Replace with:

```typescript
observerSystemPrompt: z
  .string()
  .describe(
    "System prompt for the Observer phase that plans each iteration's work",
  ),
```

Update the `AgentConfiguration` type export accordingly (it is inferred from the schema, so this is automatic).

#### 4.3 Update the unified meta-prompt

**File: `src/lib/llm/agents.ts`**

Update `getUnifiedMetaPrompt(interval)` to reference the Observer instead of Classification:

```typescript
function getUnifiedMetaPrompt(interval: string): string {
  const observerMetaPrompt = getObserverMetaPrompt(interval);

  return `You are an expert agent architect. Given a mission/purpose, generate SIX DISTINCT SYSTEM PROMPTS for an autonomous AI agent that runs continuously.

## Agent Architecture Overview

This agent operates with four named actors, each with its own system prompt:

1. **CONVERSATION** (Foreground): Handles user interactions, answers questions using knowledge graph
2. **OBSERVER** (Background): Scans the graph and plans each iteration's work -- produces queries (knowledge gaps) and insights (patterns to analyze)
3. **RESEARCHER** (Background): Executes the Observer's queries via two sub-phases:
   - **KNOWLEDGE ACQUISITION**: Gathers raw information using web search
   - **GRAPH CONSTRUCTION**: Structures acquired knowledge into the graph
4. **ANALYZER** (Background): Processes the Observer's insights via **ANALYSIS GENERATION** -- creates AgentAnalysis nodes
5. **ADVISER** (Background): Reviews AgentAnalysis nodes and may create AgentAdvice recommendations

> Note: There are 5 listed actors but 6 system prompts because the RESEARCHER (item 3) covers TWO separate system prompts: `knowledgeAcquisitionSystemPrompt` and `graphConstructionSystemPrompt`. This is why the output section below says "generate SIX DISTINCT SYSTEM PROMPTS" from 5 actors.

## Iteration Pipeline

Every iteration follows the same pipeline:
1. Observer produces plan with queries and insights
2. Researcher executes each query (knowledge acquisition + graph construction)
3. Graph context is rebuilt with enriched data
4. Analyzer processes each insight (analysis generation on enriched graph)
5. Adviser runs if analyses were produced (advice generation)

## What This Agent Does

- Runs autonomously in the background every ${interval}
- Maintains a Knowledge Graph of typed nodes and edges
- Uses web search tools to research and discover information
- Creates AgentAnalysis nodes (observations, patterns) and AgentAdvice nodes (BUY/SELL/HOLD recommendations)
- Communicates with users through a chat interface

## Output Requirements

Generate all six system prompts tailored to the given mission:

### 1. conversationSystemPrompt (3-5 paragraphs)
${CONVERSATION_META_PROMPT.split("## Output Requirements")[1]}

### 2. observerSystemPrompt (5-8 paragraphs)
${observerMetaPrompt.split("## Output Requirements")[1]}

### 3. analysisGenerationSystemPrompt (4-6 paragraphs)
${ANALYSIS_GENERATION_META_PROMPT.split("## Output Requirements")[1]}

### 4. adviceGenerationSystemPrompt (4-6 paragraphs)
${ADVICE_GENERATION_META_PROMPT.split("## Output Requirements")[1]}

### 5. knowledgeAcquisitionSystemPrompt (3-5 paragraphs)
${KNOWLEDGE_ACQUISITION_META_PROMPT.split("## Output Requirements")[1]}

### 6. graphConstructionSystemPrompt (4-6 paragraphs)
${GRAPH_CONSTRUCTION_META_PROMPT.split("## Output Requirements")[1]}

## Cross-Prompt Consistency

Ensure all six prompts:
- Use consistent terminology and domain language
- Reference the same mission and goals
- Have compatible approaches to the knowledge graph
- Work together as parts of a coherent system

## Domain-Specific Tailoring

For each prompt, incorporate:
- Relevant domain terminology and concepts
- Appropriate sources and research strategies for the field
- Domain-specific analysis types and patterns
- Field-specific quality standards and best practices`;
}
```

#### 4.4 Update `ANALYSIS_GENERATION_META_PROMPT`

The analysis generation meta-prompt currently references "classification reasoning" as the input context. Update it to reference the Observer's insight structure instead:

```typescript
const ANALYSIS_GENERATION_META_PROMPT = `You are an expert agent architect. Given a mission/purpose, generate an ANALYSIS GENERATION SYSTEM PROMPT for an AI agent that derives analyses from its Knowledge Graph.

## Context

This agent has been directed to analyze a specific pattern spotted by the Observer. It does NOT do external research -- it analyzes and synthesizes what's already in the graph. The input includes a specific observation, relevant node IDs, and a synthesis direction from the Observer phase.

## Output Requirements

Generate an analysisGenerationSystemPrompt (4-6 paragraphs) that instructs the agent to:

### 1. Follow Observer Guidance
- Read the Observer's observation and synthesis direction carefully
- Focus on the specific nodes identified by the Observer
- Use the synthesis direction to guide the angle of analysis
- Don't deviate into unrelated analysis

### 2. Analysis Types
[... same as current ...]

### 3. Handling Insufficient Data
If the available knowledge is insufficient to properly analyze the Observer's observation:
- Do NOT create a low-quality or speculative analysis
- Explain what additional data would be needed
- The next iteration's Observer will see this gap and can generate appropriate queries
- It is perfectly acceptable to produce NO AgentAnalysis nodes

### 4-7. [... same as current sections 3-7 ...]`;
```

The key changes are:
- "classification" references become "Observer" references
- Section 1 changes from "Follow Classification Guidance" to "Follow Observer Guidance"
- Context paragraph changes from mentioning "reasoning from the classification phase" to "a specific observation, relevant node IDs, and a synthesis direction from the Observer phase"
- Section 3 references "the next iteration's Observer" instead of generic phrasing

#### 4.5 Update `generateAgentConfiguration` function

**File: `src/lib/llm/agents.ts`**

The user prompt should reference the new architecture:

```typescript
const userPrompt = `Mission: ${purpose}

Generate the complete agent configuration with:
1. A short, memorable name (2-4 words)
2. All six system prompts tailored to this mission

Each system prompt should be detailed and actionable, giving clear guidance for its specific phase of operation. The prompts should work together as a coherent system:
- The Observer plans what to research and what to analyze
- The Researcher gathers and structures knowledge
- The Analyzer creates analyses from existing knowledge
- The Adviser creates recommendations from analyses`;
```

### Phase 5: Tools Index Updates

#### 5.1 Remove `getClassificationTools`

**File: `src/lib/llm/tools/index.ts`**

Delete `getClassificationTools()` entirely -- the Observer phase uses structured output (`generateLLMObject`), not tools.

Current code to remove:

```typescript
/**
 * Get tools for the Classification phase (deciding synthesize vs populate)
 * Tools: queryGraph only (to assess current graph state)
 */
export function getClassificationTools(): Tool[] {
  return getAllTools().filter((tool) =>
    ["queryGraph"].includes(tool.schema.name),
  );
}
```

#### 5.2 Verify `getAnalysisGenerationTools` exists

This was handled by plan 24. Verify it exists and returns `queryGraph`, `addAgentAnalysisNode`, `addGraphEdge`. Currently confirmed present in the codebase.

### Phase 6: Worker Iterations Query Updates

#### 6.1 Update `WorkerIteration` interface

**File: `src/lib/db/queries/worker-iterations.ts`**

Current:

```typescript
export interface WorkerIteration {
  id: string;
  agentId: string;
  status: string;
  classificationResult: string | null;
  classificationReasoning: string | null;
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
}
```

Replace with:

```typescript
export interface WorkerIteration {
  id: string;
  agentId: string;
  status: string;
  observerPlan: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
}
```

#### 6.2 Update `UpdateWorkerIterationInput`

Current:

```typescript
export interface UpdateWorkerIterationInput {
  status?: string;
  classificationResult?: string;
  classificationReasoning?: string;
  errorMessage?: string;
  completedAt?: Date;
}
```

Replace with:

```typescript
export interface UpdateWorkerIterationInput {
  status?: string;
  observerPlan?: Record<string, unknown>;
  errorMessage?: string;
  completedAt?: Date;
}
```

#### 6.3 Update all functions that reference classification fields

Update `createWorkerIteration`, `getWorkerIterationsWithInteractions`, `getWorkerIterationById`, `getLastCompletedIteration` to use `observerPlan` instead of `classificationResult` and `classificationReasoning`.

For example, in `createWorkerIteration`, the returned object mapping changes from:

```typescript
classificationResult: iteration.classificationResult,
classificationReasoning: iteration.classificationReasoning,
```

to:

```typescript
observerPlan: iteration.observerPlan as Record<string, unknown> | null,
```

Apply the same pattern to `getWorkerIterationById` and `getLastCompletedIteration`.

#### 6.4 Update phase ordering

In `getWorkerIterationsWithInteractions`, update the phase ordering used for sorting LLM interactions within an iteration:

```typescript
const phaseOrder: Record<string, number> = {
  observer: 0,
  knowledge_acquisition: 1,
  graph_construction: 2,
  analysis_generation: 3,
  advice_generation: 4,
};
```

### Phase 7: API and Query Updates

#### 7.1 Update `createAgent` in queries

**File: `src/lib/db/queries/agents.ts`**

Replace `classificationSystemPrompt` with `observerSystemPrompt` in the function signature and body:

```typescript
export async function createAgent(data: {
  userId: string;
  name: string;
  purpose?: string | null;
  conversationSystemPrompt: string;
  observerSystemPrompt: string;  // RENAMED from classificationSystemPrompt
  analysisGenerationSystemPrompt: string;
  adviceGenerationSystemPrompt: string;
  knowledgeAcquisitionSystemPrompt?: string | null;
  graphConstructionSystemPrompt: string;
  iterationIntervalMs: number;
  isActive?: boolean;
}): Promise<Agent> {
  const result = await db
    .insert(agents)
    .values({
      userId: data.userId,
      name: data.name,
      purpose: data.purpose ?? null,
      conversationSystemPrompt: data.conversationSystemPrompt,
      observerSystemPrompt: data.observerSystemPrompt,
      analysisGenerationSystemPrompt: data.analysisGenerationSystemPrompt,
      adviceGenerationSystemPrompt: data.adviceGenerationSystemPrompt,
      knowledgeAcquisitionSystemPrompt: data.knowledgeAcquisitionSystemPrompt ?? null,
      graphConstructionSystemPrompt: data.graphConstructionSystemPrompt,
      iterationIntervalMs: data.iterationIntervalMs,
      isActive: data.isActive ?? true,
    })
    .returning();
  // ...
}
```

#### 7.2 Update API route

**File: `src/app/api/agents/route.ts`**

Update the POST handler to use `observerSystemPrompt` instead of `classificationSystemPrompt`:

```typescript
const agent = await createAgent({
  userId: session.user.id,
  name: config.name,
  purpose,
  conversationSystemPrompt: config.conversationSystemPrompt,
  observerSystemPrompt: config.observerSystemPrompt,
  analysisGenerationSystemPrompt: config.analysisGenerationSystemPrompt,
  adviceGenerationSystemPrompt: config.adviceGenerationSystemPrompt,
  knowledgeAcquisitionSystemPrompt: config.knowledgeAcquisitionSystemPrompt,
  graphConstructionSystemPrompt: config.graphConstructionSystemPrompt,
  iterationIntervalMs,
  isActive: true,
});
```

#### 7.3 Update LLM Interactions query phase comment

**File: `src/lib/db/queries/llm-interactions.ts`**

Update the `CreateLLMInteractionInput` interface comment:

```typescript
export interface CreateLLMInteractionInput {
  agentId: string;
  workerIterationId?: string;
  systemPrompt: string;
  request: Record<string, unknown>;
  phase?: string; // 'observer' | 'knowledge_acquisition' | 'graph_construction' | 'analysis_generation' | 'advice_generation' | 'conversation'
}
```

### Phase 8: UI Updates

> Note: The current UI is also missing cases for `knowledge_acquisition` and `advice_generation` phases (pre-existing bug). This phase fixes that gap in addition to the classification -> observer rename.

#### 8.1 Update worker iterations page

**File: `src/app/(dashboard)/agents/[id]/worker-iterations/page.tsx`**

Update `getPhaseLabel` and `getPhaseVariant` to handle the new phase names:

```typescript
function getPhaseLabel(phase: string | null): string {
  switch (phase) {
    case "observer":
      return "Observer";
    case "knowledge_acquisition":
      return "Knowledge Acquisition";
    case "graph_construction":
      return "Graph Construction";
    case "analysis_generation":
      return "Analysis Generation";
    case "advice_generation":
      return "Advice Generation";
    default:
      return "Unknown";
  }
}

function getPhaseVariant(
  phase: string | null,
): "default" | "secondary" | "outline" {
  switch (phase) {
    case "observer":
      return "outline";
    case "knowledge_acquisition":
      return "secondary";
    case "graph_construction":
      return "secondary";
    case "analysis_generation":
      return "default";
    case "advice_generation":
      return "default";
    default:
      return "outline";
  }
}
```

Update the `WorkerIteration` interface in this file to replace `classificationResult` and `classificationReasoning` with `observerPlan`:

```typescript
interface WorkerIteration {
  id: string;
  agentId: string;
  status: string;
  observerPlan: { queries?: unknown[]; insights?: unknown[] } | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  llmInteractions: LLMInteraction[];
}
```

Update the `IterationItem` component to display the Observer plan instead of classification result:

```typescript
// Replace:
const actionLabel =
  iteration.classificationResult === "synthesize"
    ? "Synthesize"
    : iteration.classificationResult === "populate"
      ? "Populate"
      : null;

// With:
const observerPlan = iteration.observerPlan;
const planSummary = observerPlan
  ? `${observerPlan.queries?.length ?? 0} queries, ${observerPlan.insights?.length ?? 0} insights`
  : null;
```

And update the badge rendering accordingly -- replace the `actionLabel` badge with a `planSummary` badge.

### Phase 9: Mock LLM Updates

#### 9.1 Update mock values in providers.ts

**File: `src/lib/llm/providers.ts`**

In the `generateLLMObject` function's mock mode, replace the classification mock with an Observer plan mock.

Remove:

```typescript
// Worker classification decision
{
  action: "populate",
  reasoning: "Mock mode - default to populate to gather more knowledge",
},
```

Add:

```typescript
// Observer plan (replaces classification)
{
  queries: [],
  insights: [],
},
```

This produces an empty plan in mock mode, which means no phases will execute beyond the Observer -- a safe default.

### Phase 10: Test Updates

#### 10.1 Files that need `classificationSystemPrompt` renamed to `observerSystemPrompt`

Every test file that creates agent fixtures must be updated. Find-and-replace `classificationSystemPrompt` with `observerSystemPrompt` in:

- `src/lib/db/__tests__/graph-schema.test.ts` (5 occurrences)
- `src/lib/db/queries/__tests__/graph-data.test.ts` (3 occurrences)
- `src/lib/db/queries/__tests__/graph-types.test.ts` (3 occurrences)
- `src/lib/db/queries/__tests__/agents.test.ts` (11 occurrences)
- `src/lib/llm/__tests__/graph-configuration.test.ts` (6 occurrences)
- `src/lib/llm/__tests__/knowledge-graph.test.ts` (5 occurrences)
- `src/lib/llm/tools/__tests__/graph-tools.test.ts` (1 occurrence)

Total: 34 occurrences across 7 test files.

#### 10.2 Update worker iteration query tests if they exist

Any tests referencing `classificationResult` or `classificationReasoning` must be updated to use `observerPlan`.

## File Changes Summary

| File | Changes |
|------|---------|
| `src/lib/db/schema.ts` | Rename `classificationSystemPrompt` to `observerSystemPrompt` on agents table, replace `classificationResult`/`classificationReasoning` with `observerPlan` (jsonb) on workerIterations table, update phase comment on llmInteractions |
| `src/worker/runner.ts` | Replace `ClassificationResultSchema` with `ObserverPlanSchema` (+ `ObserverQuerySchema`, `ObserverInsightSchema`), replace `runClassificationPhase` with `runObserverPhase`, rewrite `processAgentIteration` for new pipeline, update `runKnowledgeAcquisitionPhase` to accept `ObserverQuery`, update `runAnalysisGenerationPhase` to accept `ObserverInsight` and return boolean, update module docstring and log messages |
| `src/lib/llm/agents.ts` | Replace `getClassificationMetaPrompt` with `getObserverMetaPrompt`, update `AgentConfigurationSchema` (`classificationSystemPrompt` -> `observerSystemPrompt`), update unified meta-prompt, update `ANALYSIS_GENERATION_META_PROMPT` to reference Observer, update `generateAgentConfiguration` user prompt |
| `src/lib/llm/tools/index.ts` | Remove `getClassificationTools` |
| `src/lib/db/queries/agents.ts` | Replace `classificationSystemPrompt` with `observerSystemPrompt` in `createAgent` function signature and body |
| `src/lib/db/queries/worker-iterations.ts` | Replace `classificationResult`/`classificationReasoning` with `observerPlan` in `WorkerIteration` interface, `UpdateWorkerIterationInput` interface, and all query functions; update phase ordering |
| `src/lib/db/queries/llm-interactions.ts` | Update phase comment in `CreateLLMInteractionInput` |
| `src/app/api/agents/route.ts` | Replace `classificationSystemPrompt` with `observerSystemPrompt` in POST handler |
| `src/app/(dashboard)/agents/[id]/worker-iterations/page.tsx` | Update phase labels/variants, replace classification display with Observer plan display, update `WorkerIteration` interface |
| `src/lib/llm/providers.ts` | Replace classification mock with Observer plan mock `{ queries: [], insights: [] }` |
| `src/lib/db/__tests__/graph-schema.test.ts` | Rename `classificationSystemPrompt` to `observerSystemPrompt` in fixtures (5 occurrences) |
| `src/lib/db/queries/__tests__/graph-data.test.ts` | Rename `classificationSystemPrompt` to `observerSystemPrompt` in fixtures (3 occurrences) |
| `src/lib/db/queries/__tests__/graph-types.test.ts` | Rename `classificationSystemPrompt` to `observerSystemPrompt` in fixtures (3 occurrences) |
| `src/lib/db/queries/__tests__/agents.test.ts` | Rename `classificationSystemPrompt` to `observerSystemPrompt` in fixtures (11 occurrences) |
| `src/lib/llm/__tests__/graph-configuration.test.ts` | Rename `classificationSystemPrompt` to `observerSystemPrompt` in fixtures (6 occurrences) |
| `src/lib/llm/__tests__/knowledge-graph.test.ts` | Rename `classificationSystemPrompt` to `observerSystemPrompt` in fixtures (5 occurrences) |
| `src/lib/llm/tools/__tests__/graph-tools.test.ts` | Rename `classificationSystemPrompt` to `observerSystemPrompt` in fixtures (1 occurrence) |
| Migration files | Nuke and regenerate from fresh schema |

## Implementation Order

1. **Schema changes** (Phase 1): Rename column on agents, replace columns on workerIterations, update phase comment on llmInteractions. Nuke database and regenerate migration.
2. **Observer phase** (Phase 2): Define `ObserverPlanSchema`, implement `runObserverPhase`, delete classification code.
3. **Worker runner revamp** (Phase 3): Update `runKnowledgeAcquisitionPhase`, `runAnalysisGenerationPhase`, rewrite `processAgentIteration`, update docstring and log messages.
4. **Agent configuration** (Phase 4): Replace classification meta-prompt with observer meta-prompt, update schema and unified meta-prompt, update `ANALYSIS_GENERATION_META_PROMPT`.
5. **Tools index** (Phase 5): Remove `getClassificationTools`.
6. **Worker iterations queries** (Phase 6): Update interfaces and query functions.
7. **API and query updates** (Phase 7): Update `createAgent`, API route, LLM interactions.
8. **UI updates** (Phase 8): Update worker iterations page for new phases and Observer plan display.
9. **Mock updates** (Phase 9): Update mock LLM values.
10. **Test updates** (Phase 10): Rename all fixture fields across all test files.
