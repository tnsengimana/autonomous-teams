# Plan: Remove Agents and Simplify Architecture

## Summary

With the implementation of KGoT (Knowledge Graph of Thoughts), we no longer need the "agent" abstraction. We are simply calling the LLM with various system prompts and tools. This plan removes the agent concept entirely and simplifies the architecture.

**Entity becomes the central unit:**
- Has a `systemPrompt` (moved from lead agent)
- Has a knowledge graph
- Has one foreground conversation (user chat)
- Background LLM iterations tracked in `llm_interactions`

**Background Worker (24/7):**
1. Call LLM with system prompt + graph context + tools
2. LLM augments knowledge graph via tools
3. When a node is created in the graph → notify user (if node type has `notifyUser: true`)
4. Wait 5 minutes
5. Repeat forever
6. Uses existing `llm.ts` abstraction (LMStudio is already the preferred/default provider)

---

## Database Changes

### Tables to DELETE

**`agents`** (current columns):
- id, entityId, parentAgentId, name, type, systemPrompt, status
- leadNextRunAt, backoffNextRunAt, backoffAttemptCount, lastCompletedAt
- createdAt, updatedAt
- Indexes: entity_id, lead_next_run_at, backoff_next_run_at

**`agent_tasks`** (current columns):
- id, entityId, assignedToId, assignedById, task, result, status, source
- createdAt, completedAt
- Index: entity_id

### Tables to MODIFY

**`entities`:**
- Remove `type` field (was: 'team' | 'aide')
- Remove `type` index
- Add `systemPrompt` (text, not null) - moved from lead agent

**`conversations`:**
- Remove `mode` field (was: 'foreground' | 'background')
- Change `agentId` → `entityId` (FK to entities, cascade delete)
- One conversation per entity (user chat only)

**`memories`:**
- Change `agentId` → `entityId` (FK to entities, cascade delete)

**`inbox_items`:**
- Change `agentId` → `entityId` (FK to entities, cascade delete)

**`briefings`:**
- Remove `agentId` field (keep entityId)

**`graph_node_types`:**
- Add `notifyUser` (boolean, not null, default false) - Whether creating nodes of this type should notify user

### Tables to ADD

**`llm_interactions`:**
```sql
CREATE TABLE llm_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  system_prompt TEXT NOT NULL,
  request JSONB NOT NULL,
  response JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);
CREATE INDEX llm_interactions_entity_id_idx ON llm_interactions(entity_id);
CREATE INDEX llm_interactions_created_at_idx ON llm_interactions(created_at);
```

**Note:** No data migration - nuke the database.

---

## Background Trace Table Design

### `llm_interactions` Table

Captures each background LLM interaction as a single row. The `response` field contains the full multi-step execution including all tool calls and results (handled by Vercel AI SDK's `maxSteps`).

**Notes:**
- One row = one complete interaction (prompt → tool loops → final response)
- `response` jsonb contains Vercel AI SDK's full result: `steps`, `toolCalls`, `toolResults`, `text`
- Can query by `entityId` and time range to see interaction history

---

## Code Changes

### Files to DELETE

**Agent Core:**
- `src/lib/agents/agent.ts` - Main Agent class (892 lines)
- `src/lib/agents/taskQueue.ts` - Task queue wrapper (~100 lines)

**Agent Tools (delegation/hierarchy specific):**
- `src/lib/agents/tools/lead-tools.ts` - delegateToAgent, getTeamStatus, etc. (~350 lines)
- `src/lib/agents/tools/subordinate-tools.ts` - reportToLead, requestLeadInput

**Database Queries:**
- `src/lib/db/queries/agents.ts` - All agent query functions (~270 lines)
- `src/lib/db/queries/agentTasks.ts` - Task queue queries (~150 lines)

**Worker:**
- `src/worker/spawner.ts` - Subordinate agent spawning (185 lines)

**Tests:**
- `src/lib/agents/__tests__/agent.test.ts`
- `src/lib/agents/__tests__/taskQueue.test.ts`
- `src/worker/__tests__/runner.test.ts` (rewrite for new logic)

### Files to KEEP (with modifications)

**LLM & Conversation:**
- `src/lib/agents/llm.ts` - LLM provider abstraction (KEEP, set maxSteps limit to 10)
- `src/lib/agents/conversation.ts` - Conversation management (KEEP, update for entityId)
- `src/lib/agents/compaction.ts` - Conversation compaction (KEEP)
- `src/lib/agents/memory.ts` - Memory extraction (KEEP, update for entityId)

**Knowledge Graph:**
- `src/lib/agents/knowledge-graph.ts` - Graph context building (KEEP)
- `src/lib/agents/graph-type-initializer.ts` - Type initialization (KEEP, add notifyUser to schema)
- `src/lib/agents/tools/graph-tools.ts` - Graph manipulation tools (KEEP, add notification logic)
- `src/lib/agents/tools/tavily-tools.ts` - Web search tools (KEEP)

**Tools Infrastructure:**
- `src/lib/agents/tools/index.ts` - Tool registry (KEEP, simplify - remove lead/subordinate tools)

### Files to HEAVILY MODIFY

**Worker:**
- `src/worker/runner.ts` - Complete rewrite for entity-based iteration
- `src/worker/index.ts` - Entry point (minor updates)

**API Routes:**
- `src/app/api/messages/route.ts` - Update to use entityId, remove Agent class
- `src/app/api/conversations/[agentId]/route.ts` → rename to `[entityId]`, remove mode param
- `src/app/api/entities/route.ts` - Remove lead agent creation, add systemPrompt
- DELETE `src/app/api/entities/[id]/agents/` - Entire directory

**Entity Queries:**
- `src/lib/db/queries/entities.ts` - Remove agent creation, update for systemPrompt
- `src/lib/db/queries/conversations.ts` - Update for entityId
- `src/lib/db/queries/memories.ts` - Update for entityId
- `src/lib/db/queries/inboxItems.ts` - Change agentId to entityId, update joins that reference agents table
- `src/lib/db/queries/briefings.ts` - Remove agentId from createBriefing()
- `src/lib/db/queries/index.ts` - Remove agent exports

**Configuration & Utilities:**
- `src/lib/entities/configuration.ts` - Update to return systemPrompt only (no agent name)
- `src/lib/entities/utils.ts` - Remove Agent/AgentTask imports, remove buildAgentPath()

**Tests:**
- `src/app/api/__tests__/api.test.ts` - Rewrite for entity-based API

---

## UI Changes

### Pages to DELETE

```
src/app/(dashboard)/entities/[id]/agents/
├── [agentId]/
│   ├── page.tsx          (Agent detail)
│   ├── chat/page.tsx     (Chat - MOVE instead)
│   ├── inspect/page.tsx  (Background inspection)
│   ├── tasks/page.tsx    (Task queue view)
│   └── edit/page.tsx     (Edit agent)
└── new/page.tsx          (Create subordinate)
```

### Pages to MOVE

- `src/app/(dashboard)/entities/[id]/agents/[agentId]/chat/page.tsx`
  → `src/app/(dashboard)/entities/[id]/chat/page.tsx`
  - Remove agentId dependency
  - Use entityId for conversation lookup
  - Keep Chat component, update props

### Pages to ADD

- `src/app/(dashboard)/entities/[id]/interactions/page.tsx`
  - Lists all `llm_interactions` for the entity
  - Shows timestamp, request summary, response summary
  - Expandable to see full request/response JSON

### Pages to UPDATE

**Entity Detail Page** (`src/app/(dashboard)/entities/[id]/page.tsx`):
- Remove "Agents" section entirely
- Remove "Add Subordinate" button
- Show system prompt (editable?)
- Show knowledge graph stats
- Link to Chat and Interactions pages
- Keep Briefings section

**Entity Creation Page** (`src/app/(dashboard)/entities/new/page.tsx`):
- Remove type selection (Team vs Aide)
- Collect: name, purpose, systemPrompt
- No automatic agent creation

**Entities List Page** (`src/app/(dashboard)/entities/page.tsx`):
- Remove type badge/display
- Update entity cards

### Components to UPDATE

**Chat Component** (`src/components/chat/Chat.tsx`):
- Change `agentId` prop to `entityId`
- Remove `mode` prop (always foreground now)
- Update API calls to use entityId

---

## Worker Changes

### Current Implementation (to be replaced)

```typescript
// Current: 30-second polling, agent-based
const POLL_INTERVAL_MS = 30000;

async function startRunner() {
  while (!isShuttingDown) {
    const agentIds = await getAgentsNeedingWork();
    for (const agentId of agentIds) {
      await processAgentWorkSession(agentId);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}
```

### New Implementation

```typescript
import { streamLLMResponseWithTools } from '@/lib/agents/llm';
import { buildGraphContextBlock } from '@/lib/agents/knowledge-graph';
import { getBackgroundTools, type ToolContext } from '@/lib/agents/tools';

const ITERATION_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function startRunner() {
  while (!isShuttingDown) {
    const entities = await getActiveEntities();
    for (const entity of entities) {
      await processEntityIteration(entity);
    }
    await sleep(ITERATION_INTERVAL_MS);
  }
}

async function processEntityIteration(entity: Entity) {
  // 1. Create llm_interaction record
  const interaction = await createLLMInteraction({
    entityId: entity.id,
    systemPrompt: entity.systemPrompt,
    request: { messages: [{ role: 'user', content: 'Continue your work...' }] },
  });

  // 2. Build context
  const graphContext = await buildGraphContextBlock(entity.id);
  const systemPrompt = `${entity.systemPrompt}\n\n${graphContext}`;

  // 3. Get tools with context
  const toolContext: ToolContext = { entityId: entity.id };
  const tools = getBackgroundTools();

  // 4. Call LLM using existing abstraction (auto-selects LMStudio as preferred provider)
  // No maxSteps limit - let the LLM call as many tools as needed
  const { fullResponse } = await streamLLMResponseWithTools(
    [{ role: 'user', content: 'Continue your work...' }],
    systemPrompt,
    {
      tools,
      toolContext,
      entityId: entity.id,
    }
  );

  // 5. Wait for completion and record response
  const result = await fullResponse;
  await updateLLMInteraction(interaction.id, {
    response: result,
    completedAt: new Date(),
  });

  // 6. Node notifications happen automatically in addGraphNode tool
}
```

### Tools Available in Background

- `addGraphNode` - Add/update nodes (triggers notification)
- `addGraphEdge` - Add relationships
- `queryGraph` - Query existing knowledge
- `getGraphSummary` - Get graph statistics
- `createNodeType` - Create new node types
- `createEdgeType` - Create new edge types
- `tavilySearch` - Web search
- `tavilyExtract` - Extract content from URLs
- `tavilyResearch` - Deep research

### Node Creation Notification

Node types have a `notifyUser` flag in their schema that determines whether creating a node of that type should notify the user.

**Update `graph_node_types` table** - Add `notify_user` column:
```sql
ALTER TABLE graph_node_types ADD COLUMN notify_user BOOLEAN NOT NULL DEFAULT false;
```

**Update type initialization** (`src/lib/agents/graph-type-initializer.ts`):
- Add `notifyUser` field to `NodeTypeDefinitionSchema`
- LLM decides which node types should notify (e.g., Insight=true, Concept=false)

**Modify `addGraphNode` tool** in `src/lib/agents/tools/graph-tools.ts`:

```typescript
// After successfully creating a node:
if (action === 'created') {
  // Check if this node type should notify user
  const nodeType = await getNodeTypeByName(ctx.entityId, type);
  if (nodeType?.notifyUser) {
    await createInboxItem({
      userId: entity.userId,
      entityId: ctx.entityId,
      type: 'insight',
      title: `New ${type} discovered`,
      content: `${name}: ${JSON.stringify(properties)}`,
    });
  }
}
```

---

## Implementation Phases

### Phase 1: Database Schema

**Files to modify:**
- `src/lib/db/schema.ts`

**Changes:**
1. Delete `agents` table and `agentsRelations`
2. Delete `agentTasks` table and `agentTasksRelations`
3. Modify `entities`: remove `type`, add `systemPrompt`
4. Modify `conversations`: remove `mode`, change `agentId` → `entityId`
5. Modify `memories`: change `agentId` → `entityId`
6. Modify `inboxItems`: change `agentId` → `entityId`
7. Modify `briefings`: remove `agentId`
8. Modify `graphNodeTypes`: add `notifyUser` boolean field
9. Add `llmInteractions` table
10. Update all relations

**Then:**
```bash
rm -rf drizzle/  # Remove old migrations
npx drizzle-kit generate
npx drizzle-kit migrate
```

**Tests:** Verify schema compiles, tables created correctly

---

### Phase 2: Remove Agent Code

**Files to delete:**
- `src/lib/agents/agent.ts`
- `src/lib/agents/taskQueue.ts`
- `src/lib/agents/tools/lead-tools.ts`
- `src/lib/agents/tools/subordinate-tools.ts`
- `src/lib/db/queries/agents.ts`
- `src/lib/db/queries/agentTasks.ts`
- `src/lib/agents/__tests__/agent.test.ts`
- `src/lib/agents/__tests__/taskQueue.test.ts`

**Files to update:**
- `src/lib/agents/index.ts` - Remove agent exports
- `src/lib/agents/tools/index.ts` - Remove lead/subordinate tool registration
- `src/lib/db/queries/index.ts` - Remove agent query exports
- `src/lib/types.ts` - Remove types:
  - `Agent`, `AgentTask`
  - `AgentStatus`, `AgentType`, `AgentTaskStatus`, `AgentTaskSource`
  - `EntityType` (no more team/aide distinction)
  - `ConversationMode` (no more foreground/background)
  - `AgentWithRelations`, `EntityWithAgents`
  - Update `InboxItem` interface (agentId → entityId)

**Tests:** Build should pass (with errors in dependent files expected)

---

### Phase 3: Update Conversation System

**Files to modify:**
- `src/lib/db/queries/conversations.ts` - Change agentId to entityId in all functions
- `src/lib/db/queries/memories.ts` - Change agentId to entityId
- `src/lib/agents/conversation.ts` - Update for entityId
- `src/lib/agents/memory.ts` - Update for entityId

**API Routes:**
- Rename `src/app/api/conversations/[agentId]/` → `src/app/api/conversations/[entityId]/`
- Update route to use entityId, remove mode parameter
- Update `src/app/api/messages/route.ts` - Remove Agent class, use entityId

**Tests:** Conversation loading and message sending work with entityId

---

### Phase 4: Update Worker

**Files to modify:**
- `src/worker/runner.ts` - Complete rewrite

**New logic:**
1. Loop forever with 5-minute intervals
2. Get all active entities
3. For each entity:
   - Create llm_interaction record
   - Build system prompt + graph context
   - Call LLM via LMStudio with graph tools
   - Save response to llm_interaction
4. Sleep 5 minutes

**New queries needed:**
- `src/lib/db/queries/llm-interactions.ts`
  - `createLLMInteraction()`
  - `updateLLMInteraction()`
  - `getLLMInteractionsByEntity()`

**Environment:**
- Ensure `LMSTUDIO_BASE_URL` is configured (LMStudio is already the preferred provider in llm.ts)

**Tests:** Worker runs, creates llm_interactions, calls LLM

---

### Phase 5: Update UI

**Delete entire directory:**
- `src/app/(dashboard)/entities/[id]/agents/`

**Move chat page:**
- FROM: `src/app/(dashboard)/entities/[id]/agents/[agentId]/chat/page.tsx`
- TO: `src/app/(dashboard)/entities/[id]/chat/page.tsx`
- Update to use entityId instead of agentId

**Add interactions page:**
- `src/app/(dashboard)/entities/[id]/interactions/page.tsx`
- Query `llm_interactions` for entity
- Display list with expandable details

**Update entity detail page:**
- `src/app/(dashboard)/entities/[id]/page.tsx`
- Remove agents section
- Add links to Chat and Interactions
- Show system prompt
- Show graph stats

**Update entity creation:**
- `src/app/(dashboard)/entities/new/page.tsx`
- Remove type selection
- Add system prompt input
- Update API call

**Update entity API:**
- `src/app/api/entities/route.ts` - Remove agent creation
- DELETE `src/app/api/entities/[id]/agents/` directory

**Update components:**
- `src/components/chat/Chat.tsx` - Change agentId to entityId, remove mode

**Tests:** UI loads, chat works, interactions page shows data

---

### Phase 6: Cleanup

**Remove unused types:**
- `src/lib/types.ts` - Remove Agent, AgentStatus, AgentTask, AgentTaskStatus, etc.

**Remove unused utilities:**
- `src/lib/entities/utils.ts` - Remove agent-related utilities

**Update configuration:**
- `src/lib/entities/configuration.ts` - Simplify to return systemPrompt only

**Update tests:**
- Remove/update tests that reference agents
- Add tests for new llm_interactions

**Update documentation:**
- `CLAUDE.md` - Update architecture description

**Final verification:**
- `npm run build` passes
- `npm run lint` passes
- `npm test` passes
- Manual testing of all flows

---

## Testing Strategy

### Tests to DELETE

These test files are for removed functionality:

```
src/lib/agents/__tests__/agent.test.ts      # Agent class tests
src/lib/agents/__tests__/taskQueue.test.ts  # Task queue tests
src/lib/db/__tests__/agentTasks.test.ts     # Agent tasks query tests
```

### Tests to REWRITE

**`src/worker/__tests__/runner.test.ts`** - Complete rewrite for entity-based iteration:
- Test `processEntityIteration()` creates llm_interaction record
- Test iteration calls LLM with correct system prompt + graph context
- Test 5-minute loop timing
- Test graceful shutdown
- Mock LLM responses with tool calls

**`src/app/api/__tests__/api.test.ts`** - Rewrite for entity-based API:
- Test entity creation (no agent creation, includes systemPrompt)
- Test message sending with entityId
- Test conversation retrieval with entityId
- Remove all agent-related test cases

### Tests to UPDATE

**`src/lib/db/__tests__/schema.test.ts`**:
- Update for removed `agents` and `agentTasks` tables
- Update for modified `entities` table (no type, has systemPrompt)
- Update for modified `conversations` table (no mode, entityId instead of agentId)
- Add test for new `llmInteractions` table

### Tests to KEEP (KGoT tests - no changes needed)

These tests are for KGoT functionality which remains unchanged:

```
src/lib/db/queries/__tests__/graph-types.test.ts
src/lib/db/queries/__tests__/graph-data.test.ts
src/lib/agents/__tests__/graph-type-initializer.test.ts
src/lib/agents/__tests__/knowledge-graph.test.ts
src/lib/db/__tests__/graph-schema.test.ts
```

### Tests to ADD

**`src/lib/db/queries/__tests__/llm-interactions.test.ts`**:
```typescript
describe('LLM Interactions Queries', () => {
  test('createLLMInteraction creates record with request');
  test('updateLLMInteraction saves response and completedAt');
  test('getLLMInteractionsByEntity returns interactions for entity');
  test('getLLMInteractionsByEntity orders by createdAt desc');
  test('cascade delete removes interactions when entity deleted');
});
```

**`src/lib/agents/tools/__tests__/graph-tools.test.ts`** - Add notification tests:
```typescript
describe('addGraphNode notifications', () => {
  test('creates inbox item when node type has notifyUser=true');
  test('does not create inbox item when node type has notifyUser=false');
  test('does not create inbox item on node update (only create)');
});
```

**`src/lib/db/queries/__tests__/conversations.test.ts`** (new file):
```typescript
describe('Conversations Queries', () => {
  test('getOrCreateConversation uses entityId');
  test('getConversationByEntityId returns conversation');
  test('one conversation per entity constraint');
});
```

### Test Execution by Phase

**Phase 1 (Database):**
- `npm test src/lib/db/__tests__/schema.test.ts` should pass

**Phase 2 (Remove Agent Code):**
- Build passes (tests may fail due to missing imports in dependent files)

**Phase 3 (Conversation System):**
- `npm test src/lib/db/queries/__tests__/conversations.test.ts` should pass

**Phase 4 (Worker):**
- `npm test src/worker/__tests__/runner.test.ts` should pass
- `npm test src/lib/db/queries/__tests__/llm-interactions.test.ts` should pass

**Phase 5 (UI):**
- Manual testing of UI flows
- `npm test src/app/api/__tests__/api.test.ts` should pass

**Phase 6 (Cleanup):**
- `npm test` - all tests pass
- `npm run build` - no errors
- `npm run lint` - no warnings

---

## Files Summary

### To DELETE (18+ files)
```
src/lib/agents/agent.ts
src/lib/agents/taskQueue.ts
src/lib/agents/tools/lead-tools.ts
src/lib/agents/tools/subordinate-tools.ts
src/lib/db/queries/agents.ts
src/lib/db/queries/agentTasks.ts
src/worker/spawner.ts
src/lib/agents/__tests__/agent.test.ts
src/lib/agents/__tests__/taskQueue.test.ts
src/lib/db/__tests__/agentTasks.test.ts
src/app/api/entities/[id]/agents/ (entire directory)
src/app/(dashboard)/entities/[id]/agents/ (entire directory)
```

### To CREATE (5 files)
```
src/lib/db/queries/llm-interactions.ts
src/lib/db/queries/__tests__/llm-interactions.test.ts
src/lib/db/queries/__tests__/conversations.test.ts
src/app/(dashboard)/entities/[id]/chat/page.tsx (moved)
src/app/(dashboard)/entities/[id]/interactions/page.tsx
```

### To HEAVILY MODIFY (20+ files)
```
src/lib/db/schema.ts
src/lib/agents/index.ts
src/lib/agents/tools/index.ts
src/lib/agents/conversation.ts
src/lib/agents/memory.ts
src/lib/db/queries/index.ts
src/lib/db/queries/conversations.ts
src/lib/db/queries/memories.ts
src/lib/db/queries/entities.ts
src/lib/db/queries/inboxItems.ts
src/lib/db/queries/briefings.ts
src/lib/types.ts
src/lib/entities/utils.ts
src/lib/entities/configuration.ts
src/worker/runner.ts
src/app/api/messages/route.ts
src/app/api/conversations/[entityId]/route.ts
src/app/api/__tests__/api.test.ts
src/app/(dashboard)/entities/[id]/page.tsx
src/app/(dashboard)/entities/new/page.tsx
src/components/chat/Chat.tsx
CLAUDE.md
```
