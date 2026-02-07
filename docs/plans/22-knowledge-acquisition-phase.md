# 22 - Knowledge Acquisition Phase

## Problem Statement

The current Graph Construction Phase combines two distinct responsibilities:
1. Researching/gathering information (tavily tools)
2. Structuring information into the knowledge graph (graph tools)

This coupling makes it harder to optimize each step individually and limits extensibility.

## Current Flow

```
Classification Phase
    ↓
    Returns { action: "synthesize" | "populate", reasoning: string }
    ↓
    If "populate" → Graph Construction Phase
                    (currently has BOTH tavily tools AND graph tools)
```

## Proposed Flow

```
Classification Phase
    ↓
    Returns { action, reasoning, knowledge_gaps? }
    ↓
    If "populate":
        ↓
        For each gap in knowledge_gaps (sequential):
            ↓
            Knowledge Acquisition Phase (NEW)
                └─ Input: single knowledge gap query
                └─ Tools: tavily (search, extract, research)
                └─ Uses: knowledgeAcquisitionSystemPrompt
                └─ Output: raw markdown text
            ↓
            Graph Construction Phase
                └─ Input: markdown from acquisition phase
                └─ Tools: graph only (queryGraph, addGraphNode, addGraphEdge)
                └─ Uses: graphConstructionSystemPrompt
                └─ Output: nodes/edges added to graph
```

## Benefits

1. **Single Responsibility** - Each phase does exactly one thing:
   - Classification: decides what to research
   - Knowledge Acquisition: gathers raw information
   - Graph Construction: structures information into typed nodes/edges

2. **Independent Optimization** - Each phase can be tuned separately:
   - Better prompts for research strategies
   - Better prompts for graph structuring
   - Different models per phase if needed

3. **Extensibility** - Adding Python sandbox to knowledge acquisition later won't affect graph construction logic

4. **Clearer Contract** - `knowledge_gaps: string[]` provides explicit queries for structured handoff between phases

## Decisions

1. **Output format**: Knowledge acquisition returns raw text (markdown) of arbitrary size, which gets piped to graph construction
2. **Query processing**: Sequential for now (can optimize to parallel later)
3. **System prompt generation**: Via meta-prompt like the other prompts

## Changes Required

### 1. Schema Change

Update `ClassificationResultSchema` in `src/worker/runner.ts`:

```typescript
const ClassificationResultSchema = z.object({
  action: z
    .enum(["synthesize", "populate"])
    .describe("The action to take"),
  reasoning: z
    .string()
    .describe("Explains WHY this action was chosen"),
  knowledge_gaps: z
    .array(z.string())
    .optional()
    .describe("Required when action='populate'. Each string is a query representing a knowledge gap to fill"),
});
```

**Rationale**:
- `reasoning` stays semantic - it's the rationale for the decision
- `knowledge_gaps` is self-documenting - clearly represents what needs to be researched
- Clean separation: **reasoning = why**, **knowledge_gaps = what**

### 2. New System Prompt

Add `knowledgeAcquisitionSystemPrompt` to the agent schema (5th system prompt, generated via meta-prompt at agent creation).

### 3. New Tool Set

Create `getKnowledgeAcquisitionTools()` in `src/lib/llm/tools/index.ts`:
- `tavilySearch`
- `tavilyExtract`
- `tavilyResearch`
- (Future: Python sandbox, advanced analytics)

### 4. Updated Graph Construction Tools

Update `getGraphConstructionTools()` to remove tavily tools:
- `queryGraph`
- `addGraphNode`
- `addGraphEdge`

### 5. New Phase in Runner

Add `runKnowledgeAcquisitionPhase()` in `src/worker/runner.ts`:

```typescript
async function runKnowledgeAcquisitionPhase(
  agent: Agent,
  knowledgeGap: string,  // Single query
  graphContext: string,
  workerIterationId: string  // For linking llm_interaction
): Promise<string> {
  // 1. Create llmInteraction with phase="knowledge_acquisition" and workerIterationId
  // 2. Call LLM with knowledgeAcquisitionSystemPrompt
  // 3. LLM uses tavily tools to research the gap
  // 4. Save tool calls/results to llmInteraction incrementally
  // 5. Return raw markdown text with findings
}
```

**Note**: Each call creates its own `llm_interaction` record linked to the current `worker_iteration_id`, consistent with other phases.

### 6. Update Runner Loop for Populate Action

When `action === "populate"`:

```typescript
for (const gap of classificationResult.knowledge_gaps ?? []) {
  // Step 1: Acquire knowledge (creates its own llm_interaction)
  const markdown = await runKnowledgeAcquisitionPhase(
    agent, gap, graphContext, workerIterationId
  );

  // Step 2: Construct graph from acquired knowledge (creates its own llm_interaction)
  await runGraphConstructionPhase(
    agent, markdown, graphContext, workerIterationId
  );
}
```

This means a single worker iteration with 3 knowledge gaps will create:
- 1 `llm_interaction` for classification
- 3 `llm_interaction` records for knowledge acquisition (one per gap)
- 3 `llm_interaction` records for graph construction (one per gap)

### 7. Database Schema

Add `phase` enum value:
- Current: `"classification" | "insight_synthesis" | "graph_construction"`
- New: `"classification" | "insight_synthesis" | "knowledge_acquisition" | "graph_construction"`

### 8. Agent Schema

Add `knowledgeAcquisitionSystemPrompt` column to `agents` table.

### 9. Meta-Prompt Update

Update `getUnifiedMetaPrompt()` in `src/lib/llm/graph-types.ts` to generate the new prompt alongside the existing four.
