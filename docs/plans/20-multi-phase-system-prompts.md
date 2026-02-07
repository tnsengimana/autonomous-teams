# Multi-Phase System Prompts Architecture

> Splitting the single system prompt into four distinct phase-specific prompts with dedicated tool sets.

---

## Overview

Currently, `entity-configuration.ts` generates a single system prompt. This plan introduces four separate system prompts, each tailored to a specific phase of agent operation, with corresponding tool sets.

---

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      USER CONVERSATION (Foreground)                      │
├─────────────────────────────────────────────────────────────────────────┤
│  entities.conversationSystemPrompt                                       │
│  conversationTools: queryGraph, CRUD memories                           │
└─────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────┐
│                    BACKGROUND ITERATION (Every 5 min)                    │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
              ┌─────────────────────────────────────┐
              │       CLASSIFICATION LLM CALL       │
              │  entities.classificationSystemPrompt │
              │  classificationTools: queryGraph     │
              │                                     │
              │  Output:                            │
              │  - action: "synthesize" | "populate"│
              │  - reasoning: granular direction    │
              └─────────────────────────────────────┘
                                  │
                  ┌───────────────┴───────────────┐
                  ▼                               ▼
┌───────────────────────────────────┐ ┌───────────────────────────────────┐
│      GRAPH CONSTRUCTION           │ │        INSIGHT SYNTHESIS          │
│  entities.graphConstruction-      │ │  entities.insightSynthesis-       │
│           SystemPrompt            │ │           SystemPrompt            │
│                                   │ │                                   │
│  Input: classification.reasoning  │ │  Input: classification.reasoning  │
│                                   │ │                                   │
│  graphConstructionTools:          │ │  insightSynthesisTools:           │
│  - queryGraph                     │ │  - queryGraph                     │
│  - addGraphNode, addGraphEdge     │ │  - addInsightNode (creates node   │
│  - tavilySearch, tavilyExtract    │ │    + inbox item + conversation    │
│  - tavilyResearch                 │ │    message)                       │
│                                   │ │  - addGraphEdge                   │
└───────────────────────────────────┘ └───────────────────────────────────┘
```

---

## The Four Phases

### 1. Conversation Phase (Foreground)

**When**: User is chatting with the agent/entity.

**System Prompt**: `entities.conversationSystemPrompt`

**Tools** (`conversationTools`):
- `queryGraph` - Query the knowledge graph
- Memory CRUD operations (create, read, update, delete memories)

**Purpose**: Handle user interactions, answer questions using graph knowledge, manage user-specific memories.

---

### 2. Classification Phase (Background)

**When**: Start of each background iteration.

**System Prompt**: `entities.classificationSystemPrompt`

**Tools** (`classificationTools`):
- `queryGraph` - Query the knowledge graph to assess current state

**Purpose**: Analyze the current graph state and decide the next action:
- **"synthesize"** → Enough knowledge exists to create insight nodes
- **"populate"** → Need to gather more external knowledge

**Output**: Decision + reasoning (the "why" that flows to the next phase).

---

### 3. Insight Synthesis Phase (Background)

**When**: Classification decided "synthesize".

**System Prompt**: `entities.insightSynthesisSystemPrompt`

**Tools** (`insightSynthesisTools`):
- `queryGraph` - Query the knowledge graph
- `addInsightNode` - Special tool that creates an Insight node AND:
  - Creates an inbox item to notify the user
  - Appends the insight to the entity's conversation so user can discuss it
- `addGraphEdge` - Create relationships

**Input**: Granular reasoning from classification about what specific insights to derive.

**Purpose**: Analyze existing graph knowledge and create Insight nodes (signals, observations, patterns) with appropriate edges (`about`, `derived_from`).

---

### 4. Graph Construction Phase (Background)

**When**: Classification decided "populate".

**System Prompt**: `entities.graphConstructionSystemPrompt`

**Tools** (`graphConstructionTools`):
- `queryGraph` - Query the knowledge graph
- `addGraphNode` - Create new nodes
- `addGraphEdge` - Create relationships
- `tavilySearch` - Web search
- `tavilyExtract` - Extract content from URLs
- `tavilyResearch` - Deep research

**Input**: Reasoning from classification about what knowledge gaps to fill.

**Purpose**: Gather external information via Tavily tools and populate the graph with new nodes (MarketEvent, News, Company, Asset, etc.) and edges.

---

## Mapping to KGoT's INSERT/RETRIEVE Loop

| KGoT Concept | Our Adaptation |
|--------------|-----------------|
| `DEFINE_NEXT_STEP` (INSERT vs RETRIEVE) | `classificationSystemPrompt` (populate vs synthesize) |
| INSERT branch (graph lacks data) | Graph Construction phase with tavily tools |
| RETRIEVE branch (synthesize answer) | Insight Synthesis phase (create Insight nodes) |

**Key difference**: In KGoT, RETRIEVE means "answer the question and stop." In our system, "synthesize" means "create Insight nodes that persist in the graph." The agent continues running regardless.

---

## Database Schema Changes

Add four new columns to `entities` table:

```sql
ALTER TABLE entities ADD COLUMN conversation_system_prompt TEXT;
ALTER TABLE entities ADD COLUMN classification_system_prompt TEXT;
ALTER TABLE entities ADD COLUMN insight_synthesis_system_prompt TEXT;
ALTER TABLE entities ADD COLUMN graph_construction_system_prompt TEXT;
```

---

## Tool Sets Summary

| Tool Set | Tools | Used By |
|----------|-------|---------|
| `conversationTools` | queryGraph, memory CRUD | Conversation phase |
| `classificationTools` | queryGraph | Classification phase |
| `insightSynthesisTools` | queryGraph, addInsightNode, addGraphEdge | Insight Synthesis phase |
| `graphConstructionTools` | queryGraph, addGraphNode, addGraphEdge, tavily* | Graph Construction phase |

---

## Design Decisions

### 1. One Action Per Iteration

Each background iteration performs exactly one classification → one action. No multi-phase cycles within a single iteration. This keeps the system simple and easier to reason about/debug.

### 2. Special `addInsightNode` Tool

The insight synthesis phase uses a dedicated `addInsightNode` tool (not the generic `addGraphNode`) that:

1. **Creates the Insight node** in the graph with standardized schema
2. **Creates an inbox item** to notify the user
3. **Appends the insight to the conversation** so users can navigate from the notification and discuss the insight with the agent

This ensures insights are always surfaced to users and are discussable.

### 3. Granular Classification Output

Classification acts like a "tech lead" - it provides granular direction to the next phase:

- Instead of just "populate", it specifies: "populate: need more data on Fed policy impact on tech sector"
- Instead of just "synthesize", it specifies: "synthesize: enough data on AAPL earnings + Fed decision to derive trading signal"

This granularity improves the quality of the subsequent phase's work.

---

## Standardized Insight Node Type

The `Insight` node type must be standardized in the codebase with this schema (from research doc):

```jsonc
{
  "name": "Insight",
  "description": "Derived analysis including signals, observations, and patterns",
  "properties_schema": {
    "type": "object",
    "required": ["type", "summary", "generated_at"],
    "properties": {
      "type": {
        "type": "string",
        "enum": ["signal", "observation", "pattern"],
        "description": "signal=actionable, observation=notable trend, pattern=recurring behavior"
      },
      "summary": {
        "type": "string",
        "description": "The explanation/reasoning for this insight"
      },
      "action": {
        "type": "string",
        "enum": ["buy", "sell", "hold"],
        "description": "Recommended action (only for signals, null otherwise)"
      },
      "strength": {
        "type": "number",
        "minimum": 0,
        "maximum": 1,
        "description": "Confidence level (0=low, 1=high)"
      },
      "generated_at": {
        "type": "string",
        "format": "date-time",
        "description": "When this insight was derived"
      }
    }
  },
  "example_properties": {
    "type": "signal",
    "summary": "AAPL oversold with RSI at 28, positive earnings surprise of 12%, and sector tailwinds from Fed holding rates",
    "action": "buy",
    "strength": 0.8,
    "generated_at": "2026-02-04T10:30:00Z"
  },
  "notify_user": true
}
```

---

## `addInsightNode` Tool Behavior

When the agent calls `addInsightNode`, the system performs three actions atomically:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Agent calls: addInsightNode({                                          │
│    name: "AAPL Buy Signal",                                             │
│    properties: {                                                        │
│      type: "signal",                                                    │
│      summary: "AAPL oversold with RSI at 28...",                        │
│      action: "buy",                                                     │
│      strength: 0.8,                                                     │
│      generated_at: "2026-02-04T10:30:00Z"                               │
│    }                                                                    │
│  })                                                                     │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  1. INSERT into graph_nodes (type: "Insight", ...)                      │
│                                                                         │
│  2. INSERT into inbox_items (entity_id, title, content, node_id)        │
│     → User sees notification in their inbox                             │
│                                                                         │
│  3. INSERT into messages (conversation_id, role: "assistant",           │
│     content: formatted insight)                                         │
│     → Insight appears in chat, user can discuss it                      │
└─────────────────────────────────────────────────────────────────────────┘
```

This ensures:
- Every insight is persisted in the knowledge graph
- Users are always notified of new insights
- Users can navigate to the conversation and ask follow-up questions about the insight

---

## Implementation Phases

### Phase 1: Database Schema & Types

**Goal**: Extend the database schema to support four system prompts per entity.

**Files to modify**:
- `src/lib/db/schema.ts` - Add four new columns to `entities` table
- `src/lib/types.ts` - Update `Entity` type exports

**Schema changes**:
```typescript
// In entities table, add:
conversationSystemPrompt: text('conversation_system_prompt'),
classificationSystemPrompt: text('classification_system_prompt'),
insightSynthesisSystemPrompt: text('insight_synthesis_system_prompt'),
graphConstructionSystemPrompt: text('graph_construction_system_prompt'),
```

**Migration**: Generate and apply with `npx drizzle-kit generate && npx drizzle-kit migrate`

**Deliverable**: Database supports storing four distinct system prompts per entity.

---

### Phase 2: Standardized Insight Node Type

**Goal**: Create a hardcoded `Insight` node type that all entities share.

**Files to modify**:
- `src/lib/llm/graph-configuration.ts` - Add Insight to seed types
- `src/lib/db/queries/graph.ts` - Ensure Insight type exists check

**The Insight node type**:
- Name: `Insight`
- Required properties: `type`, `summary`, `generated_at`
- Optional properties: `action`, `strength`
- `notify_user: true` (always creates inbox item)

**Deliverable**: Every entity has the standardized `Insight` node type available.

---

### Phase 3: Tool Set Reorganization

**Goal**: Create four distinct tool set functions for each phase.

**Files to modify**:
- `src/lib/llm/tools/index.ts` - Add new tool getter functions
- `src/lib/llm/tools/graph-tools.ts` - Add `addInsightNode` tool
- `src/lib/llm/tools/memory-tools.ts` - Create memory CRUD tools (if not existing)

**New functions in `tools/index.ts`**:
```typescript
export function getConversationTools(): Tool[]
  // queryGraph, memory CRUD

export function getClassificationTools(): Tool[]
  // queryGraph only

export function getInsightSynthesisTools(): Tool[]
  // queryGraph, addInsightNode, addGraphEdge

export function getGraphConstructionTools(): Tool[]
  // queryGraph, addGraphNode, addGraphEdge, tavily*
```

**New tool `addInsightNode`**:
- Validates properties against Insight schema
- Creates graph node
- Creates inbox item
- Appends message to entity's conversation

**Deliverable**: Four tool sets available, each with appropriate tools for its phase.

---

### Phase 4: Meta-Prompt System for Four Prompts

**Goal**: Generate four distinct system prompts when creating an entity.

**Files to modify**:
- `src/lib/llm/entity-configuration.ts` - Rewrite to generate four prompts

**New structure**:
```typescript
export interface EntityConfiguration {
  name: string;
  conversationSystemPrompt: string;
  classificationSystemPrompt: string;
  insightSynthesisSystemPrompt: string;
  graphConstructionSystemPrompt: string;
}
```

**Four meta-prompts** (each guides LLM to generate one system prompt):
1. `CONVERSATION_META_PROMPT` - User-facing, helpful, uses graph for answers
2. `CLASSIFICATION_META_PROMPT` - Decides populate vs synthesize, provides granular reasoning
3. `INSIGHT_SYNTHESIS_META_PROMPT` - Creates insights from existing graph data
4. `GRAPH_CONSTRUCTION_META_PROMPT` - Gathers external data, populates graph

**Deliverable**: `generateEntityConfiguration()` returns all four system prompts.

---

### Phase 5: Background Worker Two-Step Flow

**Goal**: Implement classification → action flow in the background worker.

**Files to modify**:
- `src/worker/runner.ts` - Rewrite `processEntityIteration()`

**New flow**:
```typescript
async function processEntityIteration(entity: Entity) {
  // Step 1: Classification
  const classificationResult = await runClassificationPhase(entity);
  // Returns: { action: "synthesize" | "populate", reasoning: string }

  // Step 2: Execute action based on classification
  if (classificationResult.action === "synthesize") {
    await runInsightSynthesisPhase(entity, classificationResult.reasoning);
  } else {
    await runGraphConstructionPhase(entity, classificationResult.reasoning);
  }
}
```

**Each phase function**:
- Uses appropriate system prompt from entity
- Uses appropriate tool set
- Logs to `llm_interactions` with phase identifier

**Deliverable**: Background iterations follow classification → action pattern.

---

### Phase 6: Foreground Conversation Update

**Goal**: Use `conversationSystemPrompt` for user chat interactions.

**Files to modify**:
- `src/app/api/messages/route.ts` - Use conversation-specific prompt
- Potentially add conversation tools support

**Changes**:
```typescript
// Before:
const systemPrompt = entity.systemPrompt;

// After:
const systemPrompt = entity.conversationSystemPrompt || entity.systemPrompt;
```

**Tool support** (optional enhancement):
- Enable `conversationTools` in foreground
- User can ask entity to query graph or manage memories directly

**Deliverable**: User conversations use the conversation-specific system prompt.

---

### Phase 7: LLM Interaction Logging Enhancement

**Goal**: Track which phase generated each LLM interaction.

**Files to modify**:
- `src/lib/db/schema.ts` - Add `phase` column to `llm_interactions`
- `src/lib/db/queries/llm-interactions.ts` - Update create/query functions
- `src/worker/runner.ts` - Pass phase to interaction logging

**New column**:
```typescript
phase: text('phase'), // 'classification' | 'insight_synthesis' | 'graph_construction'
```

**Deliverable**: Every LLM interaction is tagged with its phase for debugging/auditing.

---

### Phase 8: Entity Creation Flow Update

**Goal**: Generate all four prompts when creating a new entity.

**Files to modify**:
- `src/app/api/entities/route.ts` - Call updated `generateEntityConfiguration()`
- `src/lib/db/queries/entities.ts` - Handle four prompt columns

**Flow**:
1. User provides entity purpose
2. `generateEntityConfiguration()` generates all four prompts
3. All four prompts saved to entity record

**Deliverable**: New entities are created with all four system prompts populated.

---

## Files Summary

| File | Phase | Changes |
|------|-------|---------|
| `src/lib/db/schema.ts` | 1, 7 | Add 4 prompt columns, add phase to llm_interactions |
| `src/lib/types.ts` | 1 | Update Entity type |
| `src/lib/llm/graph-configuration.ts` | 2 | Add standardized Insight type |
| `src/lib/llm/tools/index.ts` | 3 | Add 4 tool getter functions |
| `src/lib/llm/tools/graph-tools.ts` | 3 | Add `addInsightNode` tool |
| `src/lib/llm/entity-configuration.ts` | 4 | Generate 4 system prompts |
| `src/worker/runner.ts` | 5 | Classification → action flow |
| `src/app/api/messages/route.ts` | 6 | Use conversation prompt |
| `src/lib/db/queries/llm-interactions.ts` | 7 | Phase tracking |
| `src/app/api/entities/route.ts` | 8 | Create with 4 prompts |
| Browser testing | 9 | Verify full flow end-to-end |

---

### Phase 9: Browser Verification & End-to-End Testing

**Goal**: Verify the entire system works end-to-end in the browser, including entity creation triggering the first background iteration.

**Prerequisites**: All previous phases complete, `docker compose up` running.

**Test Checklist**:

1. **Entity Creation**
   - [ ] Navigate to entity creation UI
   - [ ] Create new entity with a purpose (e.g., "Investment advisor tracking tech stocks")
   - [ ] Verify all four system prompts are generated and saved
   - [ ] Verify entity status is 'active'

2. **First Background Iteration (Classification)**
   - [ ] Wait for worker to pick up the entity (or trigger manually)
   - [ ] Verify classification LLM call happens
   - [ ] Check `llm_interactions` table shows `phase: 'classification'`
   - [ ] Verify classification output contains action + granular reasoning

3. **Graph Construction Flow** (if classification chose "populate")
   - [ ] Verify second LLM call with `phase: 'graph_construction'`
   - [ ] Verify Tavily tools are available and called
   - [ ] Check new nodes/edges created in knowledge graph
   - [ ] Verify graph visualization shows new data

4. **Insight Synthesis Flow** (if classification chose "synthesize")
   - [ ] Verify second LLM call with `phase: 'insight_synthesis'`
   - [ ] Verify `addInsightNode` tool creates:
     - Insight node in graph
     - Inbox item for user
     - Message in entity's conversation
   - [ ] Check inbox shows the new insight notification

5. **User Conversation**
   - [ ] Open chat with the entity
   - [ ] Send a message
   - [ ] Verify response uses `conversationSystemPrompt`
   - [ ] Verify entity can query its knowledge graph in conversation
   - [ ] If insight was created, verify it appears in conversation history

6. **Insight Discussion**
   - [ ] Click inbox notification to navigate to conversation
   - [ ] Ask follow-up question about the insight
   - [ ] Verify entity responds coherently about its own insight

**Browser Tools**:
- Use browser MCP tools to automate verification
- Check console for errors
- Inspect network requests to verify API calls

**Success Criteria**:
- New entity creation → classification → action flow completes without errors
- All four phases use their respective system prompts
- Insights surface to user via inbox and conversation
- User can chat with entity about its discoveries

---

## Migration Strategy

For existing entities (if any):
1. Run schema migration (adds nullable columns)
2. Existing entities continue using `systemPrompt` field
3. New entities get all four prompts
4. Optional: backfill script to generate four prompts for existing entities
