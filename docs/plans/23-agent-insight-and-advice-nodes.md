# 23 - AgentInsight and AgentAdvice Node Types

## Overview

This plan restructures the insight node system into two distinct node types:

1. **AgentInsight**: Renamed from "Insight", restricted to observations and patterns only. Does NOT notify users.
2. **AgentAdvice**: New node type for actionable recommendations (BUY, SELL, HOLD). This is the ONLY node type that creates inbox notifications.

Additionally, a new **Advice Generation Phase** runs after the Insight Synthesis phase when classification returns "synthesize".

## Current State

- **Insight node type**: Hard-coded with types: signal, observation, pattern
- **notifyUser attribute**: Exists on node types but adds unnecessary complexity
- **Insight Synthesis Phase**: Creates Insight nodes with `addInsightNode` tool
- **Flow**: Classification → (synthesize → Insight Synthesis) OR (populate → Knowledge Acquisition → Graph Construction)

## Target State

- **AgentInsight node type**: Hard-coded with types: observation, pattern (no signal)
- **AgentAdvice node type**: New hard-coded type with action (BUY, SELL, HOLD), summary, content
- **Inbox notifications**: Only `addAgentAdviceNode` tool creates inbox items (hardcoded behavior, no `notifyUser` attribute needed)
- **notifyUser attribute**: REMOVED from schema entirely
- **New Advice Generation Phase**: Runs after Insight Synthesis, but defaults to NOT creating advice
- **New Flow**: Classification → (synthesize → Insight Synthesis → Advice Generation) OR (populate → Knowledge Acquisition → Graph Construction)

## Changes Required

### 1. Database Schema Changes

**File: `src/lib/db/schema.ts`**

#### 1.1 Add `adviceGenerationSystemPrompt` column to agents table

```typescript
export const agents = pgTable("agents", {
  // ... existing fields ...
  insightSynthesisSystemPrompt: text("insight_synthesis_system_prompt").notNull(),
  adviceGenerationSystemPrompt: text("advice_generation_system_prompt").notNull(), // NEW
  knowledgeAcquisitionSystemPrompt: text("knowledge_acquisition_system_prompt"),
  // ... rest ...
});
```

#### 1.2 Remove `notifyUser` column from graphNodeTypes table

```typescript
export const graphNodeTypes = pgTable("graph_node_types", {
  // ... existing fields ...
  // REMOVE: notifyUser: boolean("notify_user").notNull().default(false),
});
```

### 2. Graph Types Changes

**File: `src/lib/llm/graph-types.ts`**

#### 2.1 Rename INSIGHT_NODE_TYPE to AGENT_INSIGHT_NODE_TYPE

```typescript
export const AGENT_INSIGHT_NODE_TYPE = {
  name: "AgentInsight",
  description: "Agent-derived observations and patterns from knowledge analysis",
  // No notifyUser - this type never creates inbox items
  propertiesSchema: {
    type: "object",
    required: ["type", "summary", "content", "generated_at"],
    properties: {
      type: {
        enum: ["observation", "pattern"],  // CHANGED: Removed "signal"
        description: "observation=notable trend or development, pattern=recurring behavior or relationship"
      },
      summary: {
        type: "string",
        description: "Brief 1-2 sentence summary of the insight"
      },
      content: {
        type: "string",
        description: "Detailed analysis with [node:uuid] or [edge:uuid] citations"
      },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      generated_at: { type: "string", format: "date-time" }
    }
  },
  exampleProperties: {
    type: "observation",
    summary: "Apple's services revenue growth is outpacing hardware sales.",
    content: "Analysis reveals...\n\nEvidence:\n- [node:abc-123] Q3 earnings...",
    confidence: 0.85,
    generated_at: "2025-01-15T10:30:00Z"
  }
};
```

#### 2.2 Add AGENT_ADVICE_NODE_TYPE

```typescript
export const AGENT_ADVICE_NODE_TYPE = {
  name: "AgentAdvice",
  description: "Actionable investment recommendation derived exclusively from AgentInsight analysis",
  // No notifyUser attribute - inbox notification is hardcoded in addAgentAdviceNode tool
  propertiesSchema: {
    type: "object",
    required: ["action", "summary", "content", "generated_at"],
    properties: {
      action: {
        enum: ["BUY", "SELL", "HOLD"],
        description: "The recommended action"
      },
      summary: {
        type: "string",
        description: "Executive summary of the recommendation (1-2 sentences)"
      },
      content: {
        type: "string",
        description: "Detailed reasoning citing ONLY AgentInsight nodes using [node:uuid] format. Other node types are prohibited."
      },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      generated_at: { type: "string", format: "date-time" }
    }
  },
  exampleProperties: {
    action: "BUY",
    summary: "Strong buy signal for AAPL based on services growth momentum and undervaluation.",
    content: "## Recommendation: BUY\n\nBased on recent analysis...\n\n### Supporting AgentInsights\n- [node:insight-123] Services revenue pattern...\n- [node:insight-456] Institutional accumulation observation...\n\n### Risk Factors\n...",
    confidence: 0.78,
    generated_at: "2025-01-15T14:00:00Z"
  }
};
```

#### 2.3 Update createSeedNodeTypes

```typescript
export async function createSeedNodeTypes(agentId: string): Promise<void> {
  // Create AgentInsight type
  const insightExists = await nodeTypeExists(agentId, AGENT_INSIGHT_NODE_TYPE.name);
  if (!insightExists) {
    await createNodeType({
      agentId,
      name: AGENT_INSIGHT_NODE_TYPE.name,
      description: AGENT_INSIGHT_NODE_TYPE.description,
      propertiesSchema: AGENT_INSIGHT_NODE_TYPE.propertiesSchema,
      exampleProperties: AGENT_INSIGHT_NODE_TYPE.exampleProperties,
      createdBy: "system",
    });
  }

  // Create AgentAdvice type
  const adviceExists = await nodeTypeExists(agentId, AGENT_ADVICE_NODE_TYPE.name);
  if (!adviceExists) {
    await createNodeType({
      agentId,
      name: AGENT_ADVICE_NODE_TYPE.name,
      description: AGENT_ADVICE_NODE_TYPE.description,
      propertiesSchema: AGENT_ADVICE_NODE_TYPE.propertiesSchema,
      exampleProperties: AGENT_ADVICE_NODE_TYPE.exampleProperties,
      createdBy: "system",
    });
  }
}
```

### 3. Graph Tools Changes

**File: `src/lib/llm/tools/graph-tools.ts`**

#### 3.1 Rename addInsightNode to addAgentInsightNode

- Rename tool from `addInsightNode` to `addAgentInsightNode`
- Update type enum to only allow: `observation`, `pattern`
- Remove inbox item creation logic
- Remove conversation message appending
- Keep graph node creation only

```typescript
const addAgentInsightNodeTool: Tool = {
  schema: {
    name: 'addAgentInsightNode',
    description: 'Create an AgentInsight node for observations or patterns. This does NOT notify users.',
    parameters: {
      type: 'object',
      required: ['name', 'type', 'summary', 'content'],
      properties: {
        name: { type: 'string', description: 'Descriptive name for the insight' },
        type: { enum: ['observation', 'pattern'] },
        summary: { type: 'string', description: 'Brief 1-2 sentence summary' },
        content: { type: 'string', description: 'Detailed analysis with [node:uuid] citations' },
        confidence: { type: 'number', minimum: 0, maximum: 1 }
      }
    }
  },
  handler: async (params, context) => {
    // Create the AgentInsight node in the graph
    // NO inbox item creation
    // NO conversation message appending
    return { nodeId };
  }
};
```

#### 3.2 Add addAgentAdviceNode tool

```typescript
const addAgentAdviceNodeTool: Tool = {
  schema: {
    name: 'addAgentAdviceNode',
    description: 'Create an AgentAdvice node with an actionable recommendation. This WILL notify the user via inbox.',
    parameters: {
      type: 'object',
      required: ['name', 'action', 'summary', 'content'],
      properties: {
        name: { type: 'string', description: 'Descriptive name (e.g., "AAPL Buy Recommendation")' },
        action: { enum: ['BUY', 'SELL', 'HOLD'] },
        summary: { type: 'string', description: 'Executive summary (1-2 sentences)' },
        content: { type: 'string', description: 'Detailed reasoning citing AgentInsight nodes via [node:uuid]' },
        confidence: { type: 'number', minimum: 0, maximum: 1 }
      }
    }
  },
  handler: async (params, context) => {
    // 1. Create the AgentAdvice node in the graph
    // 2. Create inbox item with summary
    // 3. Append message to conversation
    return { nodeId, inboxItemId };
  }
};
```

### 4. Tools Index Changes

**File: `src/lib/llm/tools/index.ts`**

#### 4.1 Update getInsightSynthesisTools

```typescript
export function getInsightSynthesisTools(): Tool[] {
  return [
    queryGraphTool,
    addAgentInsightNodeTool,  // Renamed from addInsightNode
    addGraphEdgeTool,
  ];
}
```

#### 4.2 Add getAdviceGenerationTools

```typescript
export function getAdviceGenerationTools(): Tool[] {
  return [
    queryGraphTool,
    addAgentAdviceNodeTool,  // New tool - only available in advice generation phase
  ];
}
```

### 5. Meta-Prompts Changes

**File: `src/lib/llm/agents.ts`**

#### 5.1 Update INSIGHT_SYNTHESIS_META_PROMPT

Remove "signal" references, focus on observations and patterns only:

```typescript
const INSIGHT_SYNTHESIS_META_PROMPT = `
You are creating the insight synthesis system prompt for an autonomous agent.
The agent creates AgentInsight nodes from existing knowledge. These insights do NOT notify users directly.

INSIGHT TYPES (only these two):
- observation: Notable trends, developments, or facts worth tracking
- pattern: Recurring behaviors, relationships, or correlations

IMPORTANT: AgentInsight nodes are internal analysis. They do NOT create user notifications.
The agent should freely create observations and patterns as it analyzes the knowledge graph.

[... rest of meta-prompt focused on observations/patterns ...]
`;
```

#### 5.2 Add ADVICE_GENERATION_META_PROMPT

```typescript
const ADVICE_GENERATION_META_PROMPT = `
You are creating the advice generation system prompt for an autonomous agent.
The agent reviews AgentInsight nodes and may create AgentAdvice nodes with actionable recommendations.

## DEFAULT BEHAVIOR: DO NOT CREATE ADVICE

The default action for every advice generation phase is to CREATE NOTHING. AgentAdvice nodes should be
exceptionally rare. The agent runs in a continuous loop, and the knowledge graph only gets
better over time. It is always acceptable—and usually preferable—to wait for more AgentInsight
nodes to accumulate before making any recommendation.

## WHEN TO CREATE AgentAdvice

Only create AgentAdvice when ALL of the following conditions are met:
1. There are AgentInsight nodes that address EVERY IMAGINABLE QUESTION about the recommendation
2. The supporting AgentInsight nodes provide 100% coverage of the reasoning
3. There are no gaps, uncertainties, or missing perspectives in the analysis
4. The agent has absolute conviction in the recommendation

If there is ANY doubt, ANY missing information, or ANY unanswered question: DO NOT CREATE ADVICE.
Wait for the next iteration. The knowledge graph will be richer. Better advice will be possible later.

## ONE OR MULTIPLE AgentAdvice NODES

The agent may create one or multiple AgentAdvice nodes in a single phase, if the existing
AgentInsight nodes truly warrant it. For example, if the agent has comprehensive insights about
multiple distinct subjects that each independently meet the criteria above, it should create
a separate AgentAdvice node for each. Do not artificially constrain to a single recommendation
when the evidence supports multiple independent ones.

## STRICT CITATION RULES

AgentAdvice content MUST cite ONLY AgentInsight nodes. This is a HARD REQUIREMENT.

PROHIBITED:
- Citing any node type other than AgentInsight (e.g., Company, Earnings, Article nodes)
- Making claims without AgentInsight citations
- Referencing raw data nodes directly

The rationale: AgentInsight nodes represent the agent's analyzed understanding. Raw knowledge
nodes are just data. Advice must be grounded in analyzed insights, not raw data.

## AgentAdvice STRUCTURE

- action: BUY, SELL, or HOLD
- summary: Executive summary for inbox notification (1-2 sentences)
- content: Detailed reasoning citing ONLY AgentInsight nodes using [node:uuid] format

Content sections:
1. Recommendation summary and conviction level
2. Supporting AgentInsight citations (REQUIRED - must have multiple)
3. Risk factors (also derived from AgentInsight nodes)
4. Why NOW is the right time (not earlier, not later)

Generate a system prompt that incorporates this guidance while maintaining the agent's:
- Name: {agentName}
- Purpose: {agentPurpose}
`;
```

### 6. Agent Creation/Update

**File: `src/lib/llm/agents.ts`**

Update `generateAgentSystemPrompts` to include advice generation prompt:

```typescript
export async function generateAgentSystemPrompts(name: string, purpose: string): Promise<{
  conversationSystemPrompt: string;
  classificationSystemPrompt: string;
  insightSynthesisSystemPrompt: string;
  adviceGenerationSystemPrompt: string;  // NEW
  knowledgeAcquisitionSystemPrompt: string;
  graphConstructionSystemPrompt: string;
}> {
  // ... existing prompts ...

  const adviceGenerationSystemPrompt = await generateSystemPrompt(
    ADVICE_GENERATION_META_PROMPT,
    name,
    purpose
  );

  return {
    // ... existing ...
    adviceGenerationSystemPrompt,
  };
}
```

### 7. Worker Runner Changes

**File: `src/worker/runner.ts`**

#### 7.1 Add runAdviceGenerationPhase function

**Phase name in code**: `adviceGeneration` (camelCase), `advice_generation` (snake_case in DB)

```typescript
async function runAdviceGenerationPhase(
  agent: Agent,
  graphContext: string,
  workerIterationId: string
): Promise<void> {
  const adviceGenerationTools = getAdviceGenerationTools();
  const toolSchemas = adviceGenerationTools.map(t => t.schema);

  const llmInteraction = await createLLMInteraction({
    agentId: agent.id,
    workerIterationId,
    systemPrompt: agent.adviceGenerationSystemPrompt,
    phase: "advice_generation",
    request: {
      model: "...",
      messages: [
        { role: "system", content: agent.adviceGenerationSystemPrompt },
        { role: "user", content: `<graph_context>\n${graphContext}\n</graph_context>\n\nReview recent AgentInsight nodes and determine if an actionable recommendation is warranted. Only create AgentAdvice if you have sufficient evidence.` }
      ],
      tools: toolSchemas
    }
  });

  const response = await callLLM(/* ... */);

  await updateLLMInteraction(llmInteraction.id, {
    response,
    completedAt: new Date()
  });
}
```

#### 7.2 Update processAgentIteration

```typescript
async function processAgentIteration(agent: Agent) {
  // ... existing classification ...

  if (classification.action === "synthesize") {
    // Step 2a: Insight Synthesis
    await runInsightSynthesisPhase(agent, classification.reasoning, graphContext, iterationId);

    // Step 2b: Advice Generation (NEW - runs after insight synthesis)
    await runAdviceGenerationPhase(agent, graphContext, iterationId);
  } else {
    // "populate" action - unchanged
    for (const gap of classification.knowledge_gaps) {
      const markdown = await runKnowledgeAcquisitionPhase(agent, gap, graphContext, iterationId);
      await runGraphConstructionPhase(agent, markdown, graphContext, iterationId);
    }
  }
}
```

### 8. LLM Interactions Schema

**File: `src/lib/db/schema.ts`**

Update phase enum comment to include "advice_generation":

```typescript
phase: text("phase"), // 'classification' | 'insight_synthesis' | 'advice_generation' | 'knowledge_acquisition' | 'graph_construction'
```

## Migration Strategy

### Database Migration

1. Add `advice_generation_system_prompt` column to agents table (nullable initially)
2. Backfill existing agents with generated advice generation prompts
3. Make column non-nullable

### Node Type Migration

For existing agents:
1. Rename existing "Insight" node type to "AgentInsight"
2. Remove "signal" from the type enum in propertiesSchema
3. Create new "AgentAdvice" node type

### Schema Migration: Remove notifyUser

1. Remove `notifyUser` column from `graphNodeTypes` table
2. Update all code that references this column

### Existing Insight Nodes

- Existing Insight nodes with type="signal" can remain in the graph
- They just won't be creatable going forward
- Consider a one-time migration to convert signals to AgentAdvice if appropriate

## 9. Tests

There are currently ZERO tests for the worker/runner phases. This implementation adds comprehensive test
coverage for all phases and their integration.

**Test framework**: Vitest (already configured), tests in `__tests__/` directories, hitting real PostgreSQL.

**Existing relevant tests to update**:
- `src/lib/llm/tools/__tests__/graph-tools.test.ts` - has `addInsightNode` tests that must be updated

### 9.1 Update Existing Graph Tools Tests

**File: `src/lib/llm/tools/__tests__/graph-tools.test.ts`**

- Rename all `addInsightNode` test cases to `addAgentInsightNode`
- Remove tests for `type: "signal"` (no longer valid)
- Remove assertions about inbox item creation (AgentInsight never creates inbox items)
- Remove assertions about conversation message appending
- Add tests for `addAgentAdviceNode`:
  - Creates node with action (BUY/SELL/HOLD), summary, content
  - Creates inbox item with summary
  - Appends message to conversation
  - Validates required fields (action, summary, content)
  - Rejects invalid action values
  - Validates confidence range (0-1)

### 9.2 Graph Types Tests

**File: `src/lib/llm/__tests__/graph-types.test.ts`** (new or extend existing)

- `createSeedNodeTypes` creates both AgentInsight and AgentAdvice types
- AgentInsight type has correct schema (observation, pattern only; no signal)
- AgentAdvice type has correct schema (BUY, SELL, HOLD action)
- Idempotent: calling `createSeedNodeTypes` twice doesn't duplicate types
- No `notifyUser` property on either type definition

### 9.3 Worker Phase Unit Tests

**File: `src/worker/__tests__/runner.test.ts`** (new)

Each phase should be tested in isolation by mocking the LLM call and verifying:

#### Classification Phase Tests
- Returns `{ action: "synthesize", reasoning: "..." }` when LLM responds with synthesize
- Returns `{ action: "populate", reasoning: "...", knowledge_gaps: [...] }` when LLM responds with populate
- Uses `classificationSystemPrompt` from agent
- Receives graph context in the prompt
- Creates `llm_interaction` record with `phase: "classification"`
- Only has `queryGraph` tool available

#### Insight Synthesis Phase Tests
- Uses `insightSynthesisSystemPrompt` from agent
- Receives classification reasoning in the prompt
- Creates `llm_interaction` record with `phase: "insight_synthesis"`
- Has tools: `queryGraph`, `addAgentInsightNode`, `addGraphEdge`
- Does NOT have: `addAgentAdviceNode`, tavily tools, `addGraphNode`
- Successfully creates AgentInsight nodes via tool calls
- AgentInsight creation does NOT create inbox items

#### Advice Generation Phase Tests
- Uses `adviceGenerationSystemPrompt` from agent
- Creates `llm_interaction` record with `phase: "advice_generation"`
- Has tools: `queryGraph`, `addAgentAdviceNode`
- Does NOT have: `addAgentInsightNode`, tavily tools, `addGraphNode`, `addGraphEdge`
- Successfully creates AgentAdvice nodes via tool calls
- Can create multiple AgentAdvice nodes in a single phase
- AgentAdvice creation DOES create inbox items
- AgentAdvice creation DOES append to conversation
- Phase can complete without creating any AgentAdvice (discretionary)

#### Knowledge Acquisition Phase Tests
- Uses `knowledgeAcquisitionSystemPrompt` from agent
- Creates `llm_interaction` record with `phase: "knowledge_acquisition"`
- Has tools: `tavilySearch`, `tavilyExtract`, `tavilyResearch`
- Does NOT have: graph tools
- Returns markdown document with findings

#### Graph Construction Phase Tests
- Uses `graphConstructionSystemPrompt` from agent
- Receives markdown from knowledge acquisition phase
- Creates `llm_interaction` record with `phase: "graph_construction"`
- Has tools: `queryGraph`, `addGraphNode`, `addGraphEdge`
- Does NOT have: tavily tools, `addAgentInsightNode`, `addAgentAdviceNode`

### 9.4 Iteration Flow Integration Tests

**File: `src/worker/__tests__/iteration-flow.test.ts`** (new)

Test the full `processAgentIteration` function with mocked LLM calls:

#### Synthesize Flow
- Classification returns "synthesize" → runs insight synthesis → runs advice generation
- Verify all three phases execute in order
- Verify each phase creates its own `llm_interaction` record
- Verify `workerIteration` record is created and completed
- Verify graph context is rebuilt between insight synthesis and advice generation (so advice generation sees new AgentInsight nodes)

#### Populate Flow
- Classification returns "populate" with knowledge gaps → runs knowledge acquisition → runs graph construction
- Verify advice generation phase does NOT run in populate flow
- Verify knowledge acquisition runs for each gap
- Verify graph construction receives markdown from acquisition
- Verify `workerIteration` record is created and completed

#### Error Handling
- Phase failure marks `workerIteration` as failed with error message
- Classification failure prevents subsequent phases from running
- Insight synthesis failure still marks iteration as failed (does not continue to advice generation)
- Advice generation failure marks iteration as failed (despite synthesis succeeding)

#### Tool Isolation
- Synthesize flow: verify no tavily tools are ever called
- Populate flow: verify no `addAgentInsightNode` or `addAgentAdviceNode` tools are called
- Advice generation phase: verify only `queryGraph` and `addAgentAdviceNode` are available

### 9.5 Tools Index Tests

**File: `src/lib/llm/tools/__tests__/index.test.ts`** (new)

- `getInsightSynthesisTools()` returns: queryGraph, addAgentInsightNode, addGraphEdge
- `getAdviceGenerationTools()` returns: queryGraph, addAgentAdviceNode
- `getClassificationTools()` returns: queryGraph
- `getKnowledgeAcquisitionTools()` returns: tavilySearch, tavilyExtract, tavilyResearch
- `getGraphConstructionTools()` returns: queryGraph, addGraphNode, addGraphEdge
- No tool set contains tools from an unrelated phase

### 9.6 Test Mocking Strategy

Since phases call the LLM, tests need to mock LLM responses:

- **LLM mock**: Use `MOCK_LLM=true` mode or `vi.spyOn` on the LLM call functions
- **Tavily mock**: MSW handlers to intercept Tavily API calls (MSW is already configured in test setup)
- **Database**: Real database (consistent with existing test patterns)
- **Test agent**: Create a test agent with all system prompt columns populated
- **Cleanup**: Delete test agent and associated data in `afterAll`

## File Changes Summary

| File | Changes |
|------|---------|
| `src/lib/db/schema.ts` | Add `adviceGenerationSystemPrompt` column, remove `notifyUser` column from graphNodeTypes |
| `src/lib/llm/graph-types.ts` | Rename to AGENT_INSIGHT_NODE_TYPE, add AGENT_ADVICE_NODE_TYPE, update createSeedNodeTypes, remove notifyUser references |
| `src/lib/llm/tools/graph-tools.ts` | Rename addInsightNode → addAgentInsightNode (no inbox), add addAgentAdviceNode (with inbox) |
| `src/lib/llm/tools/index.ts` | Update getInsightSynthesisTools, add getAdviceGenerationTools |
| `src/lib/llm/agents.ts` | Update INSIGHT_SYNTHESIS_META_PROMPT, add ADVICE_GENERATION_META_PROMPT, update generateAgentSystemPrompts |
| `src/worker/runner.ts` | Add runAdviceGenerationPhase, update processAgentIteration flow |
| Migration file | Schema changes (add adviceGenerationSystemPrompt, remove notifyUser) + backfill advice generation prompts |
| `src/lib/llm/tools/__tests__/graph-tools.test.ts` | Update addInsightNode → addAgentInsightNode tests, add addAgentAdviceNode tests |
| `src/lib/llm/__tests__/graph-types.test.ts` | New/extended: tests for seed types (AgentInsight + AgentAdvice) |
| `src/worker/__tests__/runner.test.ts` | New: unit tests for each phase in isolation |
| `src/worker/__tests__/iteration-flow.test.ts` | New: integration tests for full iteration flows |
| `src/lib/llm/tools/__tests__/index.test.ts` | New: verify tool sets per phase |

## Implementation Order

1. **Schema changes**: Add adviceGenerationSystemPrompt column, remove notifyUser column with migration
2. **Graph types**: Define AGENT_INSIGHT_NODE_TYPE and AGENT_ADVICE_NODE_TYPE (without notifyUser)
3. **Graph tools**: Create addAgentInsightNode and addAgentAdviceNode tools
4. **Tools index**: Add getAdviceGenerationTools, update getInsightSynthesisTools
5. **Meta-prompts**: Update insight synthesis meta-prompt, add advice generation meta-prompt
6. **Agent creation**: Update generateAgentSystemPrompts
7. **Worker runner**: Add advice generation phase, update iteration flow
8. **Node type migration**: Update existing agents' node types (rename Insight → AgentInsight, create AgentAdvice)
9. **Tests**: Update existing graph tools tests, add phase unit tests, add iteration flow integration tests, add tools index tests
