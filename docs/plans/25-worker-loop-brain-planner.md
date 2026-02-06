# 25 - Worker Loop: Brain as Planner

## Overview

This plan replaces the binary classification phase in the worker loop with a **Brain** that produces structured work plans. Instead of choosing between "synthesize" or "populate," the Brain scans the knowledge graph and produces **queries** (knowledge gaps to fill) and **insights** (patterns to analyze). All phases can execute within a single iteration, eliminating the ping-pong oscillation between populate and synthesize cycles.

**Prerequisite:** Plan 24 (rename insight to analysis) has already been applied. This plan uses the new terminology: `AgentAnalysis`, `analysisGenerationSystemPrompt`, `addAgentAnalysisNode`, `getAnalysisGenerationTools`, `runAnalysisGenerationPhase`.

## Research Reference

See `docs/research/2-worker-loop-brain-planner.md` for the full design discussion including problem statement, proposed solution, and Q&A.

## Current State

- **Binary classification**: The worker loop starts each iteration with a classification phase that picks between "synthesize" or "populate"
- **Either/or execution**: Only one branch runs per iteration -- either insight synthesis + advice generation, OR knowledge acquisition + graph construction
- **Ping-pong problem**: If an agent populates data, it must wait for the next iteration to synthesize, then another iteration if synthesis reveals missing data
- **Classification schema**: `ClassificationResultSchema` produces `{ action: "synthesize" | "populate", reasoning: string, knowledge_gaps?: string[] }`
- **Agent column**: `classificationSystemPrompt` in the agents table
- **Phase values**: `classification`, `insight_synthesis`, `advice_generation`, `knowledge_acquisition`, `graph_construction`

## Target State

- **Brain as planner**: The Brain scans the graph and produces a structured plan with queries and insights
- **Full pipeline per iteration**: Brain -> Researcher (for each query) -> rebuild graph context -> Synthesizer (for each insight) -> Adviser (if analyses were produced)
- **No binary choice**: The Brain can produce any combination of queries and insights (including none of either)
- **Named actors**: Brain, Researcher, Synthesizer, Adviser
- **Agent column**: `brainSystemPrompt` (replaces `classificationSystemPrompt`)
- **Phase values**: `brain`, `knowledge_acquisition`, `graph_construction`, `analysis_generation`, `advice_generation`

### New Iteration Pipeline

```
+---------------------------------------------------+
|                    ITERATION                       |
|                                                    |
|  1. BRAIN (planner)                                |
|     Input: graph context + agent mission           |
|     Output: { queries[], insights[] }              |
|                                                    |
|  2. RESEARCHER (for each query)                    |
|     Knowledge Acquisition -> Graph Construction    |
|     (enriches the graph)                           |
|                                                    |
|  3. Rebuild graph context (now enriched)           |
|                                                    |
|  4. SYNTHESIZER (for each insight, on enriched     |
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

#### 1.1 Rename `classificationSystemPrompt` to `brainSystemPrompt` in agents table

**File: `src/lib/db/schema.ts`**

```typescript
export const agents = pgTable("agents", {
  // ... existing fields ...
  // RENAME: classificationSystemPrompt -> brainSystemPrompt
  brainSystemPrompt: text("brain_system_prompt").notNull(),
  // ... rest unchanged ...
});
```

#### 1.2 Replace classification columns on workerIterations table

The `classificationResult` and `classificationReasoning` columns no longer make sense with the new pipeline. Replace them with a `brainPlan` JSONB column that stores the structured Brain output.

**File: `src/lib/db/schema.ts`**

```typescript
export const workerIterations = pgTable("worker_iterations", {
  // ... existing fields ...
  // REMOVE: classificationResult: text("classification_result"),
  // REMOVE: classificationReasoning: text("classification_reasoning"),
  // ADD:
  brainPlan: jsonb("brain_plan"), // Stores { queries: Query[], insights: Insight[] }
  // ... rest unchanged ...
});
```

#### 1.3 Update phase comment on llmInteractions

**File: `src/lib/db/schema.ts`**

```typescript
phase: text("phase"), // 'brain' | 'knowledge_acquisition' | 'graph_construction' | 'analysis_generation' | 'advice_generation'
```

#### 1.4 Nuke database and regenerate migration

Since this is a development environment with no production data, nuke the database and regenerate migrations from the fresh schema.

```bash
# Drop all tables and regenerate
npx drizzle-kit generate
npx drizzle-kit migrate
```

### Phase 2: Brain Phase Implementation

#### 2.1 Define the Brain's structured output schema

**File: `src/worker/runner.ts`**

Replace the `ClassificationResultSchema` with a `BrainPlanSchema`:

```typescript
const BrainQuerySchema = z.object({
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

const BrainInsightSchema = z.object({
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
      "Guidance for the Synthesizer on what angle to analyze this from"
    ),
});

const BrainPlanSchema = z.object({
  queries: z
    .array(BrainQuerySchema)
    .describe(
      "Knowledge gaps to fill via web research. Each query becomes a Knowledge Acquisition + Graph Construction cycle."
    ),
  insights: z
    .array(BrainInsightSchema)
    .describe(
      "Patterns worth analyzing from existing graph knowledge. Each insight becomes an Analysis Generation call."
    ),
});

type BrainPlan = z.infer<typeof BrainPlanSchema>;
type BrainQuery = z.infer<typeof BrainQuerySchema>;
type BrainInsight = z.infer<typeof BrainInsightSchema>;
```

#### 2.2 Implement `runBrainPhase`

Replace `runClassificationPhase` with `runBrainPhase`. The Brain uses `generateLLMObject` (structured output, no tools) to produce its plan.

```typescript
async function runBrainPhase(
  agent: Agent,
  graphContext: string,
  workerIterationId: string,
): Promise<BrainPlan> {
  log(`[Brain] Starting for agent: ${agent.name}`);

  const systemPrompt = agent.brainSystemPrompt;
  if (!systemPrompt) {
    throw new Error("Agent missing brainSystemPrompt");
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
    phase: "brain",
  });

  const plan = await generateLLMObject(
    requestMessages,
    BrainPlanSchema,
    systemPrompt,
    { agentId: agent.id },
  );

  await updateLLMInteraction(interaction.id, {
    response: plan,
    completedAt: new Date(),
  });

  log(
    `[Brain] Agent ${agent.name} planned: ${plan.queries.length} queries, ${plan.insights.length} insights`,
  );

  return plan;
}
```

#### 2.3 Remove `ClassificationResultSchema` and `runClassificationPhase`

Delete the `ClassificationResultSchema`, `ClassificationResult` type, and `runClassificationPhase` function entirely.

### Phase 3: Worker Runner Revamp

#### 3.1 Update `runKnowledgeAcquisitionPhase` to accept a `BrainQuery`

The knowledge acquisition phase currently receives a `knowledgeGap: string`. Update it to accept a `BrainQuery` so it can use the objective and search hints:

```typescript
async function runKnowledgeAcquisitionPhase(
  agent: Agent,
  query: BrainQuery,
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

#### 3.2 Update `runAnalysisGenerationPhase` to accept a `BrainInsight`

The analysis generation phase (renamed from insight synthesis in plan 24) currently receives classification reasoning. Update it to accept a `BrainInsight` so the Synthesizer gets specific guidance:

```typescript
async function runAnalysisGenerationPhase(
  agent: Agent,
  insight: BrainInsight,
  graphContext: string,
  workerIterationId: string,
): Promise<boolean> {
  log(`[Synthesizer] Analysis generation for: "${insight.observation.substring(0, 50)}..."`);

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

To determine whether analyses were produced, check the tool call events for `addAgentAnalysisNode` calls:

```typescript
// After fullResponse resolves:
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

    // ── Step 1: BRAIN ──
    const plan = await runBrainPhase(agent, graphContext, workerIteration.id);

    // Store the brain plan on the worker iteration
    await updateWorkerIteration(workerIteration.id, {
      brainPlan: plan,
    });

    // ── Step 2: RESEARCHER (for each query) ──
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

      // ── Step 3: Rebuild graph context (now enriched) ──
      graphContext = await buildGraphContextBlock(agent.id);
    }

    // ── Step 4: SYNTHESIZER (for each insight) ──
    let analysesProduced = false;
    if (plan.insights.length > 0) {
      log(`[Synthesizer] Processing ${plan.insights.length} insights`);
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

    // ── Step 5: ADVISER (if analyses were produced) ──
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

Update the module-level docstring at the top of `runner.ts`:

```typescript
/**
 * Worker Runner
 *
 * Agent-based iteration with configurable intervals using a Brain -> Researcher -> Synthesizer -> Adviser pipeline.
 *
 * For each active agent:
 * 1. Brain phase: scan graph, produce plan with queries (knowledge gaps) and insights (patterns)
 * 2. Researcher phase: for each query, run knowledge acquisition + graph construction
 * 3. Rebuild graph context after all queries are processed
 * 4. Synthesizer phase: for each insight, run analysis generation
 * 5. Adviser phase: if analyses were produced, run advice generation
 */
```

### Phase 4: Agent Configuration Updates

#### 4.1 Replace `CLASSIFICATION_META_PROMPT` with `BRAIN_META_PROMPT`

**File: `src/lib/llm/agents.ts`**

Delete `getClassificationMetaPrompt(interval)` and replace with `getBrainMetaPrompt(interval)`:

```typescript
/**
 * Meta-prompt for generating the BRAIN system prompt.
 * The brain scans the knowledge graph and produces a structured plan.
 */
function getBrainMetaPrompt(interval: string): string {
  return `You are an expert agent architect. Given a mission/purpose, generate a BRAIN SYSTEM PROMPT for an AI agent that acts as the central planner directing all background work.

## Context

This agent runs autonomously every ${interval}. At the start of each iteration, the Brain phase scans the knowledge graph and produces a structured plan with two types of work items:

- **Queries**: Knowledge gaps to fill via web research. Each query has an objective, reasoning, and search hints.
- **Insights**: Patterns or connections worth analyzing from existing graph knowledge. Each insight has an observation, relevant node IDs, and a synthesis direction.

The Brain does NOT execute anything -- it only plans. It does not search the web, create graph nodes, or write analyses. It reads the graph context and decides what to investigate and what to think about. The downstream phases (Researcher, Synthesizer, Adviser) handle execution.

## Output Requirements

Generate a brainSystemPrompt (5-8 paragraphs) that instructs the agent to:

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
- **relevantNodeIds**: UUIDs of nodes that inform this observation (the Brain has access to node IDs in the graph context)
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
- The Brain's output quality determines the quality of the entire iteration`;
}
```

#### 4.2 Update `AgentConfigurationSchema`

**File: `src/lib/llm/agents.ts`**

```typescript
const AgentConfigurationSchema = z.object({
  name: z
    .string()
    .describe("A short, memorable name for this agent (2-4 words)"),
  conversationSystemPrompt: z
    .string()
    .describe("System prompt for user-facing conversations"),
  brainSystemPrompt: z  // RENAMED from classificationSystemPrompt
    .string()
    .describe(
      "System prompt for the Brain phase that plans each iteration's work",
    ),
  analysisGenerationSystemPrompt: z  // RENAMED from insightSynthesisSystemPrompt (plan 24)
    .string()
    .describe("System prompt for creating analyses from existing knowledge"),
  adviceGenerationSystemPrompt: z
    .string()
    .describe(
      "System prompt for generating actionable recommendations from analyses",
    ),
  knowledgeAcquisitionSystemPrompt: z
    .string()
    .describe("System prompt for gathering raw information using web search tools"),
  graphConstructionSystemPrompt: z
    .string()
    .describe("System prompt for structuring acquired knowledge into the graph"),
});
```

#### 4.3 Update the unified meta-prompt

**File: `src/lib/llm/agents.ts`**

Update `getUnifiedMetaPrompt(interval)` to reference the Brain instead of Classification:

```typescript
function getUnifiedMetaPrompt(interval: string): string {
  const brainMetaPrompt = getBrainMetaPrompt(interval);

  return `You are an expert agent architect. Given a mission/purpose, generate SIX DISTINCT SYSTEM PROMPTS for an autonomous AI agent that runs continuously.

## Agent Architecture Overview

This agent operates with four named actors, each with its own system prompt:

1. **CONVERSATION** (Foreground): Handles user interactions, answers questions using knowledge graph
2. **BRAIN** (Background): Scans the graph and plans each iteration's work -- produces queries (knowledge gaps) and insights (patterns to analyze)
3. **RESEARCHER** (Background): Executes the Brain's queries via two sub-phases:
   - **KNOWLEDGE ACQUISITION**: Gathers raw information using web search
   - **GRAPH CONSTRUCTION**: Structures acquired knowledge into the graph
4. **SYNTHESIZER** (Background): Processes the Brain's insights via **ANALYSIS GENERATION** -- creates AgentAnalysis nodes
5. **ADVISER** (Background): Reviews AgentAnalysis nodes and may create AgentAdvice recommendations

## Iteration Pipeline

Every iteration follows the same pipeline:
1. Brain produces plan with queries and insights
2. Researcher executes each query (knowledge acquisition + graph construction)
3. Graph context is rebuilt with enriched data
4. Synthesizer processes each insight (analysis generation on enriched graph)
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

### 2. brainSystemPrompt (5-8 paragraphs)
${brainMetaPrompt.split("## Output Requirements")[1]}

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

#### 4.4 Update `ANALYSIS_GENERATION_META_PROMPT` (renamed from `INSIGHT_SYNTHESIS_META_PROMPT`)

The analysis generation meta-prompt needs to be updated to reference the Brain's insight structure rather than "classification reasoning":

```typescript
const ANALYSIS_GENERATION_META_PROMPT = `You are an expert agent architect. Given a mission/purpose, generate an ANALYSIS GENERATION SYSTEM PROMPT for an AI agent that derives analyses from its Knowledge Graph.

## Context

This agent has been directed to analyze a specific pattern spotted by the Brain. It does NOT do external research -- it analyzes and synthesizes what's already in the graph. The input includes a specific observation, relevant node IDs, and a synthesis direction from the Brain phase.

## Output Requirements

Generate an analysisGenerationSystemPrompt (4-6 paragraphs) that instructs the agent to:

### 1. Follow Brain Guidance
- Read the Brain's observation and synthesis direction carefully
- Focus on the specific nodes identified by the Brain
- Use the synthesis direction to guide the angle of analysis
- Don't deviate into unrelated analysis

### 2. Analysis Types
Create analyses using the AgentAnalysis node type with these categories:
- **observation**: Notable trends or developments worth tracking
- **pattern**: Recurring behaviors or correlations discovered

IMPORTANT: AgentAnalysis nodes are internal analysis. They do NOT create user notifications.
The agent should freely create observations and patterns as it analyzes the knowledge graph.
Do NOT create actionable recommendations here -- those belong in the Advice Generation phase.

### 3. Handling Insufficient Data
If the available knowledge is insufficient to properly analyze the Brain's observation:
- Do NOT create a low-quality or speculative analysis
- Explain what additional data would be needed
- The next iteration's Brain will see this gap and can generate appropriate queries
- It is perfectly acceptable to produce NO AgentAnalysis nodes

### 4. Evidence-Based Reasoning
- Query the graph to gather supporting evidence from the specific nodes referenced
- Create edges connecting the analysis to its source data (derived_from, about edges)
- Include confidence levels based on evidence strength and recency

### 5. Analysis Properties - SUMMARY and CONTENT (BOTH REQUIRED)
[... same as current INSIGHT_SYNTHESIS_META_PROMPT section 5 ...]

### 6. Analysis Value
[... same as current section 6, adjusted for terminology ...]

### 7. Graph Hygiene
[... same as current section 7 ...]`;
```

#### 4.5 Update `generateAgentConfiguration` function

**File: `src/lib/llm/agents.ts`**

The function signature stays the same, but the user prompt should reference the new architecture:

```typescript
const userPrompt = `Mission: ${purpose}

Generate the complete agent configuration with:
1. A short, memorable name (2-4 words)
2. All six system prompts tailored to this mission

Each system prompt should be detailed and actionable, giving clear guidance for its specific phase of operation. The prompts should work together as a coherent system:
- The Brain plans what to research and what to analyze
- The Researcher gathers and structures knowledge
- The Synthesizer creates analyses from existing knowledge
- The Adviser creates recommendations from analyses`;
```

### Phase 5: Tools Index Updates

#### 5.1 Remove `getClassificationTools`

**File: `src/lib/llm/tools/index.ts`**

Delete `getClassificationTools()` entirely -- the Brain phase uses structured output (`generateLLMObject`), not tools.

#### 5.2 Rename `getInsightSynthesisTools` to `getAnalysisGenerationTools`

This was already handled by plan 24. Verify it's done. The function should return:

```typescript
export function getAnalysisGenerationTools(): Tool[] {
  return getAllTools().filter((tool) =>
    [
      "queryGraph",
      "addAgentAnalysisNode",
      "addGraphEdge",
    ].includes(tool.schema.name),
  );
}
```

### Phase 6: Worker Iterations Query Updates

#### 6.1 Update `WorkerIteration` interface

**File: `src/lib/db/queries/worker-iterations.ts`**

```typescript
export interface WorkerIteration {
  id: string;
  agentId: string;
  status: string;
  brainPlan: Record<string, unknown> | null;  // REPLACED classificationResult + classificationReasoning
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
}
```

#### 6.2 Update `UpdateWorkerIterationInput`

```typescript
export interface UpdateWorkerIterationInput {
  status?: string;
  brainPlan?: Record<string, unknown>;  // REPLACED classificationResult + classificationReasoning
  errorMessage?: string;
  completedAt?: Date;
}
```

#### 6.3 Update all functions that reference classification fields

Update `createWorkerIteration`, `getWorkerIterationsWithInteractions`, `getWorkerIterationById`, `getLastCompletedIteration` to use `brainPlan` instead of `classificationResult` and `classificationReasoning`.

#### 6.4 Update phase ordering

In `getWorkerIterationsWithInteractions`, update the phase ordering:

```typescript
const phaseOrder: Record<string, number> = {
  brain: 0,
  knowledge_acquisition: 1,
  graph_construction: 2,
  analysis_generation: 3,
  advice_generation: 4,
};
```

### Phase 7: API and Query Updates

#### 7.1 Update `createAgent` in queries

**File: `src/lib/db/queries/agents.ts`**

Replace `classificationSystemPrompt` with `brainSystemPrompt` in the function signature and body:

```typescript
export async function createAgent(data: {
  userId: string;
  name: string;
  purpose?: string | null;
  conversationSystemPrompt: string;
  brainSystemPrompt: string;  // RENAMED
  analysisGenerationSystemPrompt: string;  // RENAMED (plan 24)
  adviceGenerationSystemPrompt: string;
  knowledgeAcquisitionSystemPrompt?: string | null;
  graphConstructionSystemPrompt: string;
  iterationIntervalMs: number;
  isActive?: boolean;
}): Promise<Agent> {
  const result = await db
    .insert(agents)
    .values({
      // ... update to use brainSystemPrompt ...
    })
    .returning();
  // ...
}
```

#### 7.2 Update API route

**File: `src/app/api/agents/route.ts`**

Update the POST handler to use `brainSystemPrompt` instead of `classificationSystemPrompt`:

```typescript
const agent = await createAgent({
  userId: session.user.id,
  name: config.name,
  purpose,
  conversationSystemPrompt: config.conversationSystemPrompt,
  brainSystemPrompt: config.brainSystemPrompt,  // RENAMED
  analysisGenerationSystemPrompt: config.analysisGenerationSystemPrompt,  // RENAMED (plan 24)
  adviceGenerationSystemPrompt: config.adviceGenerationSystemPrompt,
  knowledgeAcquisitionSystemPrompt: config.knowledgeAcquisitionSystemPrompt,
  graphConstructionSystemPrompt: config.graphConstructionSystemPrompt,
  iterationIntervalMs,
  isActive: true,
});
```

#### 7.3 Update LLM Interactions query phase comment

**File: `src/lib/db/queries/llm-interactions.ts`**

Update the `CreateLLMInteractionInput` interface:

```typescript
export interface CreateLLMInteractionInput {
  agentId: string;
  workerIterationId?: string;
  systemPrompt: string;
  request: Record<string, unknown>;
  phase?: string; // 'brain' | 'knowledge_acquisition' | 'graph_construction' | 'analysis_generation' | 'advice_generation' | 'conversation'
}
```

### Phase 8: UI Updates

#### 8.1 Update worker iterations page

**File: `src/app/(dashboard)/agents/[id]/worker-iterations/page.tsx`**

Update `getPhaseLabel` and `getPhaseVariant` to handle the new phase names:

```typescript
function getPhaseLabel(phase: string | null): string {
  switch (phase) {
    case "brain":
      return "Brain";
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
    case "brain":
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

Update the `IterationItem` component to display the Brain plan instead of classification result:

```typescript
// Replace:
const actionLabel =
  iteration.classificationResult === "synthesize"
    ? "Synthesize"
    : iteration.classificationResult === "populate"
      ? "Populate"
      : null;

// With something like:
const brainPlan = iteration.brainPlan as { queries?: unknown[]; insights?: unknown[] } | null;
const planSummary = brainPlan
  ? `${brainPlan.queries?.length ?? 0} queries, ${brainPlan.insights?.length ?? 0} insights`
  : null;
```

Update the `WorkerIteration` interface in this file to match the new schema (replace `classificationResult` and `classificationReasoning` with `brainPlan`).

### Phase 9: Mock LLM Updates

#### 9.1 Update mock values in providers.ts

**File: `src/lib/llm/providers.ts`**

Update the mock values in `generateLLMObject` to include a Brain plan mock:

```typescript
const mockValues = [
  // ... existing mocks ...
  // Brain plan (replaces classification)
  {
    queries: [],
    insights: [],
  },
  // ... rest ...
];
```

Remove the old classification mock:

```typescript
// REMOVE:
{
  action: "populate",
  reasoning: "Mock mode - default to populate to gather more knowledge",
},
```

### Phase 10: Test Updates

#### 10.1 Files that need `classificationSystemPrompt` renamed to `brainSystemPrompt`

Every test file that creates agent fixtures must be updated. Find-and-replace `classificationSystemPrompt` with `brainSystemPrompt` in:

- `src/lib/db/__tests__/graph-schema.test.ts` (5 occurrences)
- `src/lib/db/queries/__tests__/graph-data.test.ts` (3 occurrences)
- `src/lib/db/queries/__tests__/graph-types.test.ts` (3 occurrences)
- `src/lib/db/queries/__tests__/agents.test.ts` (11 occurrences)
- `src/lib/llm/__tests__/graph-configuration.test.ts` (6 occurrences)
- `src/lib/llm/__tests__/knowledge-graph.test.ts` (5 occurrences)
- `src/lib/llm/tools/__tests__/graph-tools.test.ts` (1 occurrence)

#### 10.2 Files that need `insightSynthesisSystemPrompt` renamed to `analysisGenerationSystemPrompt`

Same set of test files -- find-and-replace `insightSynthesisSystemPrompt` with `analysisGenerationSystemPrompt`. This was part of plan 24 but listing here for completeness since both renames happen together.

#### 10.3 Update worker iteration query tests if they exist

Any tests referencing `classificationResult` or `classificationReasoning` must be updated to use `brainPlan`.

## File Changes Summary

| File | Changes |
|------|---------|
| `src/lib/db/schema.ts` | Rename `classificationSystemPrompt` to `brainSystemPrompt`, replace `classificationResult`/`classificationReasoning` with `brainPlan` on workerIterations, update phase comment on llmInteractions |
| `src/worker/runner.ts` | Replace `ClassificationResultSchema` with `BrainPlanSchema`, replace `runClassificationPhase` with `runBrainPhase`, rewrite `processAgentIteration` for new pipeline, update `runKnowledgeAcquisitionPhase` to accept `BrainQuery`, update `runAnalysisGenerationPhase` to accept `BrainInsight` and return boolean |
| `src/lib/llm/agents.ts` | Replace `getClassificationMetaPrompt` with `getBrainMetaPrompt`, update `AgentConfigurationSchema`, update unified meta-prompt, update `ANALYSIS_GENERATION_META_PROMPT` |
| `src/lib/llm/tools/index.ts` | Remove `getClassificationTools` |
| `src/lib/db/queries/agents.ts` | Replace `classificationSystemPrompt` with `brainSystemPrompt` in `createAgent` |
| `src/lib/db/queries/worker-iterations.ts` | Replace `classificationResult`/`classificationReasoning` with `brainPlan`, update `WorkerIteration` interface, update phase ordering |
| `src/lib/db/queries/llm-interactions.ts` | Update phase comment |
| `src/app/api/agents/route.ts` | Replace `classificationSystemPrompt` with `brainSystemPrompt` |
| `src/app/(dashboard)/agents/[id]/worker-iterations/page.tsx` | Update phase labels/variants, replace classification display with Brain plan display |
| `src/lib/llm/providers.ts` | Update mock values for Brain plan |
| `src/lib/db/__tests__/graph-schema.test.ts` | Rename `classificationSystemPrompt` to `brainSystemPrompt` in fixtures |
| `src/lib/db/queries/__tests__/graph-data.test.ts` | Rename `classificationSystemPrompt` to `brainSystemPrompt` in fixtures |
| `src/lib/db/queries/__tests__/graph-types.test.ts` | Rename `classificationSystemPrompt` to `brainSystemPrompt` in fixtures |
| `src/lib/db/queries/__tests__/agents.test.ts` | Rename `classificationSystemPrompt` to `brainSystemPrompt` in fixtures |
| `src/lib/llm/__tests__/graph-configuration.test.ts` | Rename `classificationSystemPrompt` to `brainSystemPrompt` in fixtures |
| `src/lib/llm/__tests__/knowledge-graph.test.ts` | Rename `classificationSystemPrompt` to `brainSystemPrompt` in fixtures |
| `src/lib/llm/tools/__tests__/graph-tools.test.ts` | Rename `classificationSystemPrompt` to `brainSystemPrompt` in fixtures |
| Migration files | Nuke and regenerate from fresh schema |

## Implementation Order

1. **Schema changes** (Phase 1): Rename column on agents, replace columns on workerIterations, update phase comment on llmInteractions. Nuke database and regenerate migration.
2. **Brain phase** (Phase 2): Define `BrainPlanSchema`, implement `runBrainPhase`, delete classification code.
3. **Worker runner revamp** (Phase 3): Update `runKnowledgeAcquisitionPhase`, `runAnalysisGenerationPhase`, rewrite `processAgentIteration`.
4. **Agent configuration** (Phase 4): Replace classification meta-prompt with brain meta-prompt, update schema and unified meta-prompt.
5. **Tools index** (Phase 5): Remove `getClassificationTools`.
6. **Worker iterations queries** (Phase 6): Update interfaces and query functions.
7. **API and query updates** (Phase 7): Update `createAgent`, API route, LLM interactions.
8. **UI updates** (Phase 8): Update worker iterations page for new phases and brain plan display.
9. **Mock updates** (Phase 9): Update mock LLM values.
10. **Test updates** (Phase 10): Rename all fixture fields across all test files.
