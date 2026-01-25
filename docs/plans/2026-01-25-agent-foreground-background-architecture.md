# Agent Foreground/Background Architecture

## Overview

Evolve the agent system from single-conversation to a sophisticated foreground/background architecture with separate conversation contexts, task queues for all agents, and knowledge extraction.

## Core Concepts

### Conversations vs Threads

| Aspect | Conversation | Thread |
|--------|--------------|--------|
| Purpose | User ↔ Agent interaction | Agent background work session |
| Lifecycle | One per agent, permanent | Many per agent, ephemeral |
| Visibility | Shown in UI | Internal only |
| Persistence | Long-lived, accumulates | Discarded after knowledge extraction |
| Context | Grows over time | Fresh each session, compaction if needed |

- **Conversation**: The user-facing chat history. One per agent. This is where briefings and user interactions live.
- **Thread**: A single background work session. Agent creates new thread each time it processes its queue. Thread is used for agent ↔ LLM communication during work. Discarded after extracting knowledge.

### Memories vs Insights

| Aspect | Memories | Insights |
|--------|----------|----------|
| Source | User conversations | Work threads (+ user-shared professional info) |
| Purpose | User interaction context | Professional knowledge base |
| Content | Preferences, past requests, relationship | Domain expertise, techniques, patterns, facts |
| Sent to LLM | Foreground only (user conversations) | Background only (threads) |
| Example | "User prefers concise responses" | "SEC filings are more reliable than news for earnings" |

**Cross-pollination**: If a user shares professionally valuable information during conversation (e.g., "NVIDIA always reports earnings on the last Wednesday of February"), the agent should add this to insights, not memories. The agent can also show/manage insights when the user asks (e.g., "What do you know about NVIDIA?").

**Tools in foreground**: Agent has access to insight management tools (`addInsight`, `listInsights`, `removeInsight`) during user conversations to handle these cases.

### Why This Model Works

1. **No context overflow across sessions**: Each work session starts with a fresh thread
2. **Mid-session compaction**: If thread exceeds context during work, compact and continue
3. **Learning becomes critical**: Memories + Insights are what persist between sessions
4. **Professional growth**: Agent improves by extracting insights from work threads
5. **Clean separation**: Users see conversation, internal work happens in disposable threads
6. **Distinct knowledge types**: User context (memories) vs domain expertise (insights)

### Agent Types & Behavior

| Aspect | Team Lead | Teammate Worker |
|--------|-----------|-----------------|
| Task Queue | Yes | Yes |
| Proactive | Yes (seeks work based on mission) | No (purely reactive) |
| 1-Hour Trigger | Yes (to further mission) | No (only queue-triggered) |
| Can Send Briefings | Yes (decides after work) | No |
| Knowledge Extraction | Yes (after clearing queue) | Yes (after clearing queue) |

### Key Flows

**User Message Flow (Foreground)**:
```
User sends message → Agent responds minimally ("I'll look into that")
                   → Agent queues task to own queue
                   → Return response to user
                   → Background picks up task immediately
```

**Background Work Flow**:
```
Task picked up → Load thread (or create new)
              → Process task via LLM with tools
              → May queue sub-tasks or delegate to workers
              → Mark task complete
              → If queue empty:
                  → Extract insights from thread → insights table
                  → Team lead only: decide if briefing needed
                  → If briefing: create inbox item + message in user conversation
                  → Schedule next run (team lead: 1 hour, worker: none)
```

**Team Creation Bootstrap**:
```
Team created → Team lead created
            → Queue "get to work" task
            → Background picks up immediately
            → Team lead starts mission execution
```

---

## Database Schema Changes

### 1. Create threads table (NEW)

Threads are ephemeral work sessions for background processing:

```typescript
export const threads = pgTable('threads', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('active'), // 'active', 'completed', 'compacted'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});
```

### 2. Create threadMessages table (NEW)

Messages within a work thread:

```typescript
export const threadMessages = pgTable('thread_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  threadId: uuid('thread_id').notNull().references(() => threads.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'user' (agent as user), 'assistant' (LLM response), 'system'
  content: text('content').notNull(),
  toolCalls: jsonb('tool_calls'), // Store tool call data if any
  sequenceNumber: integer('sequence_number').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

### 3. Create insights table (NEW)

Professional knowledge extracted from work threads:

```typescript
export const insights = pgTable('insights', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'fact', 'technique', 'pattern', 'lesson'
  content: text('content').notNull(),
  sourceThreadId: uuid('source_thread_id').references(() => threads.id, { onDelete: 'set null' }),
  confidence: real('confidence'), // Optional: how confident the agent is in this insight
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

### 4. Conversations table (unchanged)

Existing conversations table remains for user ↔ agent interactions. No changes needed.

### 5. Memories table (unchanged)

Existing memories table remains for user interaction context. No changes needed.

### 6. Extend agentTasks for self-queued tasks

Add `source` field to distinguish task origins:

```sql
ALTER TABLE agent_tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'delegation';
-- Values: 'delegation' (from another agent), 'user' (from user message), 'system' (bootstrap), 'self' (proactive)
```

### 7. Add scheduling fields to agents table

```sql
ALTER TABLE agents ADD COLUMN next_run_at TIMESTAMP;
ALTER TABLE agents ADD COLUMN last_completed_at TIMESTAMP;
```

---

## Implementation Tasks

### Phase 1: Schema & Database Layer

#### Task 1.1: Create threads and threadMessages tables
**File**: `src/lib/db/schema.ts`

Add new tables for background work sessions:
```typescript
// Threads - ephemeral work sessions
export const threads = pgTable('threads', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});

// Thread messages
export const threadMessages = pgTable('thread_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  threadId: uuid('thread_id').notNull().references(() => threads.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  toolCalls: jsonb('tool_calls'),
  sequenceNumber: integer('sequence_number').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

#### Task 1.2: Create insights table
**File**: `src/lib/db/schema.ts`

Add table for professional knowledge:
```typescript
// Insights - professional knowledge extracted from work threads
export const insights = pgTable('insights', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'fact', 'technique', 'pattern', 'lesson'
  content: text('content').notNull(),
  sourceThreadId: uuid('source_thread_id').references(() => threads.id, { onDelete: 'set null' }),
  confidence: real('confidence'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

#### Task 1.3: Update agentTasks schema
**File**: `src/lib/db/schema.ts`

Add `source` field:
```typescript
source: text('source').notNull().default('delegation'), // 'delegation' | 'user' | 'system' | 'self'
```

#### Task 1.4: Update agents schema
**File**: `src/lib/db/schema.ts`

Add scheduling fields:
```typescript
nextRunAt: timestamp('next_run_at'),
lastCompletedAt: timestamp('last_completed_at'),
```

#### Task 1.5: Generate and apply migrations
```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

#### Task 1.6: Create insights queries
**File**: `src/lib/db/queries/insights.ts` (NEW)

Create functions for insight management:
- `createInsight(agentId, type, content, sourceThreadId?)` - store new insight
- `getInsightsByAgentId(agentId)` - get all insights for agent
- `getRecentInsights(agentId, limit)` - get most recent insights
- `deleteInsight(insightId)` - remove an insight
- `searchInsights(agentId, query)` - search insights by content

#### Task 1.8: Add schema tests
**File**: `src/lib/db/__tests__/schema.test.ts` (NEW)

Test database operations directly (no HTTP mocking needed for DB):
```typescript
describe('threads schema', () => {
  test('creates thread for agent', async () => {
    const thread = await createThread(agentId);
    expect(thread.agentId).toBe(agentId);
    expect(thread.status).toBe('active');
  });

  test('cascades delete when agent deleted', async () => {
    // Create thread, delete agent, verify thread gone
  });
});

describe('insights schema', () => {
  test('creates insight for agent', async () => {
    const insight = await createInsight(agentId, 'fact', 'NVIDIA reports earnings in February');
    expect(insight.agentId).toBe(agentId);
    expect(insight.type).toBe('fact');
  });

  test('links insight to source thread', async () => {
    const thread = await createThread(agentId);
    const insight = await createInsight(agentId, 'technique', 'Check SEC filings first', thread.id);
    expect(insight.sourceThreadId).toBe(thread.id);
  });

  test('nullifies sourceThreadId when thread deleted', async () => {
    const thread = await createThread(agentId);
    const insight = await createInsight(agentId, 'pattern', 'Market volatility increases before earnings', thread.id);
    await deleteThread(thread.id);
    const updated = await getInsightById(insight.id);
    expect(updated.sourceThreadId).toBeNull();
  });
});

describe('agentTasks schema', () => {
  test('creates task with source field', async () => {
    const task = await queueTask(agentId, 'test task', 'user');
    expect(task.source).toBe('user');
  });
});
```

### Phase 2: Thread Management (NEW)

#### Task 2.1: Create thread queries
**File**: `src/lib/db/queries/threads.ts` (NEW)

Create functions for thread lifecycle:
- `createThread(agentId)` - start new work session
- `getActiveThread(agentId)` - get current active thread (if any)
- `completeThread(threadId)` - mark thread as completed
- `getThreadMessages(threadId)` - get all messages in thread
- `appendThreadMessage(threadId, role, content, toolCalls?)` - add message
- `compactThread(threadId, summary)` - replace messages with summary (mid-session compaction)

#### Task 2.2: Create thread abstraction
**File**: `src/lib/agents/thread.ts` (NEW)

High-level thread management:
- `startWorkSession(agentId)` - create thread, return thread context
- `addToThread(threadId, role, content)` - append message
- `buildThreadContext(threadId, maxTokens)` - get messages for LLM call
- `shouldCompact(threadId)` - check if approaching context limit
- `compactIfNeeded(threadId)` - summarize and replace if too long
- `endWorkSession(threadId)` - mark complete

#### Task 2.3: Add thread tests
**File**: `src/lib/agents/__tests__/thread.test.ts` (NEW)

```typescript
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('thread management', () => {
  test('startWorkSession creates new thread', async () => {
    const { threadId } = await startWorkSession(agentId);
    expect(threadId).toBeDefined();

    const thread = await getActiveThread(agentId);
    expect(thread.status).toBe('active');
  });

  test('addToThread appends message with correct sequence', async () => {
    const { threadId } = await startWorkSession(agentId);

    await addToThread(threadId, 'user', 'First message');
    await addToThread(threadId, 'assistant', 'Second message');

    const messages = await getThreadMessages(threadId);
    expect(messages).toHaveLength(2);
    expect(messages[0].sequenceNumber).toBe(1);
    expect(messages[1].sequenceNumber).toBe(2);
  });

  test('compactIfNeeded summarizes when approaching limit', async () => {
    // Mock LLM for summarization
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', () => {
        return HttpResponse.json({
          choices: [{ message: { content: 'Summary of conversation' } }]
        });
      })
    );

    const { threadId } = await startWorkSession(agentId);
    // Add many messages to approach limit
    // Call compactIfNeeded
    // Verify messages replaced with summary
  });

  test('endWorkSession marks thread completed', async () => {
    const { threadId } = await startWorkSession(agentId);
    await endWorkSession(threadId);

    const thread = await getThreadById(threadId);
    expect(thread.status).toBe('completed');
    expect(thread.completedAt).toBeDefined();
  });
});
```

### Phase 3: Task Queue System

#### Task 3.1: Update task queries
**File**: `src/lib/db/queries/agentTasks.ts`

Add functions:
- `queueTask(agentId, task, source)` - add task to agent's own queue
- `getOwnPendingTasks(agentId)` - tasks where agent is assignedToId
- `hasQueuedWork(agentId)` - check if queue is non-empty

#### Task 3.2: Create queueUserTask function
**File**: `src/lib/agents/agent.ts` (or new file)

Function to queue a task from user message:
```typescript
async queueUserTask(userMessage: string): Promise<void> {
  await queueTask(this.id, userMessage, 'user');
  // Trigger background processing
}
```

#### Task 3.3: Add task queue tests
**File**: `src/lib/db/queries/__tests__/agentTasks.test.ts` (NEW)

```typescript
describe('task queue operations', () => {
  test('queueTask creates task with correct source', async () => {
    const task = await queueTask(agentId, 'Research NVIDIA', 'user');

    expect(task.assignedToId).toBe(agentId);
    expect(task.assignedById).toBe(agentId); // self-assigned
    expect(task.source).toBe('user');
    expect(task.status).toBe('pending');
  });

  test('getOwnPendingTasks returns only pending tasks for agent', async () => {
    await queueTask(agentId, 'Task 1', 'user');
    await queueTask(agentId, 'Task 2', 'system');
    await queueTask(otherAgentId, 'Task 3', 'user');

    const tasks = await getOwnPendingTasks(agentId);

    expect(tasks).toHaveLength(2);
    expect(tasks.every(t => t.assignedToId === agentId)).toBe(true);
  });

  test('hasQueuedWork returns true when tasks pending', async () => {
    expect(await hasQueuedWork(agentId)).toBe(false);

    await queueTask(agentId, 'Task 1', 'user');

    expect(await hasQueuedWork(agentId)).toBe(true);
  });
});
```

### Phase 4: Agent Lifecycle Refactor

#### Task 4.1: Split handleMessage for foreground
**File**: `src/lib/agents/agent.ts`

New `handleUserMessage()`:
1. Add user message to USER conversation
2. Generate contextual acknowledgment via quick LLM call
3. Add acknowledgment to USER conversation
4. Queue task with source='user'
5. Return response stream
6. Trigger background worker

#### Task 4.2: Create runWorkSession method
**File**: `src/lib/agents/agent.ts`

Main entry point for background processing:
```typescript
async runWorkSession(): Promise<void> {
  // 1. Create new thread for this session
  // 2. Load memories (user context) + insights (professional knowledge) for context
  // 3. Process all pending tasks in queue
  // 4. When queue empty:
  //    - Extract insights from thread → insights table
  //    - Mark thread completed
  //    - Team lead: decide briefing
  //    - Schedule next run (team lead only)
}
```

#### Task 4.3: Create processTaskInThread method
**File**: `src/lib/agents/agent.ts`

Process single task within current thread:
```typescript
async processTaskInThread(threadId: string, task: AgentTask): Promise<string> {
  // 1. Build context from thread messages + memories
  // 2. Add task as "user" message to thread (agent is the user here)
  // 3. Call LLM with tools
  // 4. Add response to thread
  // 5. If tool calls, execute and continue conversation
  // 6. Check if should compact thread (context limit)
  // 7. Mark task complete
  // 8. Return result
}
```

#### Task 4.4: Create insight management tools for foreground
**File**: `src/lib/agents/tools/insight-tools.ts` (NEW)

Tools available during user conversations for managing professional knowledge:

```typescript
// addInsight - Add professional knowledge from user conversation
const addInsightTool: Tool = {
  schema: {
    name: 'addInsight',
    description: 'Store professional knowledge shared by the user or discovered during conversation',
    parameters: [
      { name: 'type', type: 'string', enum: ['fact', 'technique', 'pattern', 'lesson'], required: true },
      { name: 'content', type: 'string', description: 'The insight to store', required: true },
    ],
  },
  handler: async (params, context) => { /* ... */ }
};

// listInsights - Show insights to user when asked
const listInsightsTool: Tool = {
  schema: {
    name: 'listInsights',
    description: 'List professional knowledge the agent has accumulated',
    parameters: [
      { name: 'query', type: 'string', description: 'Optional search query', required: false },
      { name: 'type', type: 'string', enum: ['fact', 'technique', 'pattern', 'lesson'], required: false },
    ],
  },
  handler: async (params, context) => { /* ... */ }
};

// removeInsight - Remove incorrect or outdated insight
const removeInsightTool: Tool = {
  schema: {
    name: 'removeInsight',
    description: 'Remove an insight that is incorrect or outdated',
    parameters: [
      { name: 'insightId', type: 'string', required: true },
    ],
  },
  handler: async (params, context) => { /* ... */ }
};
```

#### Task 4.5: Create extractInsightsFromThread method
**File**: `src/lib/agents/agent.ts` or `src/lib/agents/insights.ts` (NEW)

Extract professional knowledge from work session:
```typescript
async extractInsightsFromThread(threadId: string): Promise<void> {
  // 1. Load all thread messages
  // 2. Build extraction prompt focused on:
  //    - What approaches worked/didn't work (type: 'technique')
  //    - Patterns discovered (type: 'pattern')
  //    - Skills or techniques learned (type: 'lesson')
  //    - Facts about the domain (type: 'fact')
  // 3. Extract insights via LLM (generateObject with insight schema)
  // 4. Persist to insights table with sourceThreadId
  // 5. This is how the agent "grows professionally"
}
```

#### Task 4.6: Create decideBriefing method (team lead only)
**File**: `src/lib/agents/agent.ts`

```typescript
async decideBriefing(threadId: string): Promise<void> {
  if (!this.isTeamLead()) return;

  // 1. Review thread work and newly extracted knowledge
  // 2. LLM decides: is this worth briefing user?
  //    - Significant discoveries?
  //    - Actionable insights?
  //    - Important alerts?
  // 3. If yes:
  //    - Generate briefing content
  //    - Create inbox item (summary)
  //    - Add full briefing to USER conversation
  // 4. If no: complete silently (no noise)
}
```

#### Task 4.7: Add agent lifecycle tests
**File**: `src/lib/agents/__tests__/agent.test.ts` (NEW)

```typescript
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('handleUserMessage (foreground)', () => {
  test('queues task and returns contextual acknowledgment', async () => {
    // Mock LLM for acknowledgment generation
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', () => {
        return HttpResponse.json({
          choices: [{
            message: { content: "I'll research NVIDIA's latest earnings for you." }
          }]
        });
      })
    );

    const agent = await Agent.fromId(teamLeadId);
    const response = await agent.handleUserMessage('Research NVIDIA stock');

    // Verify acknowledgment returned
    let fullResponse = '';
    for await (const chunk of response) {
      fullResponse += chunk;
    }
    expect(fullResponse).toContain('NVIDIA');

    // Verify task was queued
    const tasks = await getOwnPendingTasks(teamLeadId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].task).toBe('Research NVIDIA stock');
    expect(tasks[0].source).toBe('user');
  });
});

describe('runWorkSession (background)', () => {
  test('creates new thread and processes tasks', async () => {
    // Mock LLM for task processing
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', () => {
        return HttpResponse.json({
          choices: [{
            message: { content: 'Research completed. Found key insights.' }
          }]
        });
      })
    );

    // Queue a task
    await queueTask(teamLeadId, 'Research market trends', 'user');

    const agent = await Agent.fromId(teamLeadId);
    await agent.runWorkSession();

    // Verify thread was created and completed
    const threads = await getThreadsByAgentId(teamLeadId);
    expect(threads.some(t => t.status === 'completed')).toBe(true);

    // Verify task was completed
    const tasks = await getOwnPendingTasks(teamLeadId);
    expect(tasks).toHaveLength(0);
  });

  test('extracts insights after clearing queue', async () => {
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', ({ request }) => {
        // Different responses for task processing vs insight extraction
        return HttpResponse.json({
          choices: [{
            message: { content: 'Market volatility increases before earnings reports' }
          }]
        });
      })
    );

    await queueTask(teamLeadId, 'Analyze market', 'user');

    const agent = await Agent.fromId(teamLeadId);
    const insightsBefore = await getInsightsByAgentId(teamLeadId);

    await agent.runWorkSession();

    const insightsAfter = await getInsightsByAgentId(teamLeadId);
    expect(insightsAfter.length).toBeGreaterThan(insightsBefore.length);
    // Verify insight is linked to the thread
    expect(insightsAfter[insightsAfter.length - 1].sourceThreadId).toBeDefined();
  });
});

describe('decideBriefing (team lead)', () => {
  test('creates inbox item when LLM decides to brief', async () => {
    let callCount = 0;
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', () => {
        callCount++;
        if (callCount === 1) {
          // Decision: should brief
          return HttpResponse.json({
            choices: [{ message: { content: 'YES - significant findings' } }]
          });
        }
        // Briefing content
        return HttpResponse.json({
          choices: [{ message: { content: 'Important market update...' } }]
        });
      })
    );

    const agent = await Agent.fromId(teamLeadId);
    const { threadId } = await startWorkSession(teamLeadId);

    await agent.decideBriefing(threadId);

    // Verify inbox item created
    const inboxItems = await getInboxItemsByUserId(userId);
    expect(inboxItems.some(i => i.type === 'briefing')).toBe(true);
  });

  test('does not create inbox item when LLM decides not to brief', async () => {
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', () => {
        return HttpResponse.json({
          choices: [{ message: { content: 'NO - nothing significant' } }]
        });
      })
    );

    const agent = await Agent.fromId(teamLeadId);
    const { threadId } = await startWorkSession(teamLeadId);
    const inboxBefore = await getInboxItemsByUserId(userId);

    await agent.decideBriefing(threadId);

    const inboxAfter = await getInboxItemsByUserId(userId);
    expect(inboxAfter.length).toBe(inboxBefore.length);
  });

  test('worker agents cannot send briefings', async () => {
    const agent = await Agent.fromId(workerId);
    const { threadId } = await startWorkSession(workerId);

    await agent.decideBriefing(threadId);

    // No inbox items created for worker's team
    // (decideBriefing returns early for non-team-leads)
  });
});

describe('insight tools (foreground)', () => {
  test('addInsight stores user-shared professional knowledge', async () => {
    const result = await addInsightTool.handler(
      { type: 'fact', content: 'NVIDIA reports earnings last Wednesday of February' },
      { agentId: teamLeadId, teamId, isTeamLead: true }
    );

    expect(result.success).toBe(true);

    const insights = await getInsightsByAgentId(teamLeadId);
    expect(insights.some(i => i.content.includes('NVIDIA'))).toBe(true);
    expect(insights.find(i => i.content.includes('NVIDIA')).sourceThreadId).toBeNull(); // No thread, from conversation
  });

  test('listInsights returns agent knowledge', async () => {
    await createInsight(teamLeadId, 'fact', 'Tech stocks volatile in Q1');
    await createInsight(teamLeadId, 'technique', 'Check SEC filings first');

    const result = await listInsightsTool.handler(
      {},
      { agentId: teamLeadId, teamId, isTeamLead: true }
    );

    expect(result.success).toBe(true);
    expect(result.data.insights).toHaveLength(2);
  });

  test('listInsights filters by type', async () => {
    await createInsight(teamLeadId, 'fact', 'Fact 1');
    await createInsight(teamLeadId, 'technique', 'Technique 1');

    const result = await listInsightsTool.handler(
      { type: 'fact' },
      { agentId: teamLeadId, teamId, isTeamLead: true }
    );

    expect(result.data.insights).toHaveLength(1);
    expect(result.data.insights[0].type).toBe('fact');
  });

  test('removeInsight deletes insight', async () => {
    const insight = await createInsight(teamLeadId, 'fact', 'Outdated info');

    const result = await removeInsightTool.handler(
      { insightId: insight.id },
      { agentId: teamLeadId, teamId, isTeamLead: true }
    );

    expect(result.success).toBe(true);

    const insights = await getInsightsByAgentId(teamLeadId);
    expect(insights.some(i => i.id === insight.id)).toBe(false);
  });
});
```

### Phase 5: Background Worker Refactor

#### Task 5.1: Refactor runner for event-driven execution
**File**: `src/worker/runner.ts`

Change from polling all team leads to:
- Listen for agents with pending tasks OR nextRunAt <= now
- Process one agent at a time
- Team leads: schedule next run 1 hour after completion
- Workers: no next run scheduling (purely reactive)

#### Task 5.2: Add immediate trigger on task queue
**File**: `src/worker/runner.ts` or new file

When task is queued, immediately trigger processing:
```typescript
export async function notifyTaskQueued(agentId: string): Promise<void> {
  // Wake up the agent to process its queue
}
```

#### Task 5.3: Add background worker tests
**File**: `src/worker/__tests__/runner.test.ts` (NEW)

```typescript
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('background worker scheduling', () => {
  test('picks up agent with pending tasks', async () => {
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', () => {
        return HttpResponse.json({
          choices: [{ message: { content: 'Task completed' } }]
        });
      })
    );

    await queueTask(teamLeadId, 'Process this', 'user');

    const agentsDue = await getAgentsWithWork();
    expect(agentsDue.some(a => a.id === teamLeadId)).toBe(true);
  });

  test('picks up team lead when nextRunAt reached', async () => {
    // Set nextRunAt to past
    await scheduleNextRun(teamLeadId, new Date(Date.now() - 1000));

    const agentsDue = await getAgentsDueToRun();
    expect(agentsDue.some(a => a.id === teamLeadId)).toBe(true);
  });

  test('does not pick up worker when no tasks (purely reactive)', async () => {
    // Worker has no tasks and no nextRunAt
    const agentsDue = await getAgentsWithWork();
    expect(agentsDue.some(a => a.id === workerId)).toBe(false);
  });

  test('schedules team lead for 1 hour after completion', async () => {
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', () => {
        return HttpResponse.json({
          choices: [{ message: { content: 'Done' } }]
        });
      })
    );

    await queueTask(teamLeadId, 'Work', 'user');

    const agent = await Agent.fromId(teamLeadId);
    await agent.runWorkSession();

    const updatedAgent = await getAgentById(teamLeadId);
    const oneHourFromNow = Date.now() + 60 * 60 * 1000;
    expect(updatedAgent.nextRunAt.getTime()).toBeCloseTo(oneHourFromNow, -4); // within 10 seconds
  });

  test('does not schedule worker after completion', async () => {
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', () => {
        return HttpResponse.json({
          choices: [{ message: { content: 'Done' } }]
        });
      })
    );

    await queueTask(workerId, 'Work', 'delegation');

    const agent = await Agent.fromId(workerId);
    await agent.runWorkSession();

    const updatedAgent = await getAgentById(workerId);
    expect(updatedAgent.nextRunAt).toBeNull();
  });
});

describe('notifyTaskQueued', () => {
  test('triggers immediate processing', async () => {
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', () => {
        return HttpResponse.json({
          choices: [{ message: { content: 'Processed' } }]
        });
      })
    );

    await queueTask(teamLeadId, 'Urgent task', 'user');
    await notifyTaskQueued(teamLeadId);

    // Task should be processed
    const tasks = await getOwnPendingTasks(teamLeadId);
    expect(tasks).toHaveLength(0);
  });
});
```

### Phase 6: API Updates

#### Task 6.1: Update messages API for foreground handling
**File**: `src/app/api/messages/route.ts`

Change to:
1. Call `agent.handleUserMessage()` instead of `handleMessage()`
2. Return minimal response
3. Task is queued automatically

#### Task 6.2: Update team creation to bootstrap
**File**: `src/app/api/teams/route.ts`

After creating team lead:
```typescript
await queueTask(teamLead.id, 'Get to work on your mission', 'system');
```

#### Task 6.3: Update conversations API
**File**: `src/app/api/conversations/[agentId]/route.ts`

Only return USER conversation (not thread).

#### Task 6.4: Add API integration tests
**File**: `src/app/api/__tests__/messages.test.ts` (NEW)

```typescript
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import request from 'supertest';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('POST /api/messages', () => {
  test('returns contextual ack and queues task', async () => {
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', () => {
        return HttpResponse.json({
          choices: [{
            message: { content: "I'll look into NVIDIA for you." }
          }]
        });
      })
    );

    const response = await request(app)
      .post('/api/messages')
      .set('Authorization', 'Bearer test-token')
      .send({
        teamId: testTeamId,
        agentId: teamLeadId,
        content: 'Research NVIDIA stock'
      });

    expect(response.status).toBe(200);
    expect(response.text).toContain('NVIDIA');

    // Verify task was queued
    const tasks = await getOwnPendingTasks(teamLeadId);
    expect(tasks).toHaveLength(1);
  });

  test('adds user message to conversation', async () => {
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', () => {
        return HttpResponse.json({
          choices: [{ message: { content: 'Acknowledged' } }]
        });
      })
    );

    await request(app)
      .post('/api/messages')
      .set('Authorization', 'Bearer test-token')
      .send({
        teamId: testTeamId,
        agentId: teamLeadId,
        content: 'Hello agent'
      });

    // Verify message in conversation
    const conversation = await getLatestConversation(teamLeadId);
    const messages = await getMessagesByConversationId(conversation.id);
    expect(messages.some(m => m.content === 'Hello agent')).toBe(true);
  });
});

describe('POST /api/teams', () => {
  test('creates team and queues bootstrap task for team lead', async () => {
    const response = await request(app)
      .post('/api/teams')
      .set('Authorization', 'Bearer test-token')
      .send({
        name: 'Market Research Team',
        description: 'Researches market trends',
        mission: 'Track tech stocks',
        leadAgentName: 'Research Lead',
        leadAgentPrompt: 'You are a market research expert'
      });

    expect(response.status).toBe(200);
    const { teamId, teamLeadId } = response.body;

    // Verify bootstrap task queued
    const tasks = await getOwnPendingTasks(teamLeadId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].source).toBe('system');
    expect(tasks[0].task).toContain('mission');
  });
});

describe('GET /api/conversations/[agentId]', () => {
  test('returns only user conversation messages', async () => {
    // Add message to user conversation
    const conversation = await getOrCreateConversation(teamLeadId);
    await appendMessage(conversation.id, 'user', 'Hello');
    await appendMessage(conversation.id, 'assistant', 'Hi there');

    // Create a thread (should not be returned)
    const { threadId } = await startWorkSession(teamLeadId);
    await addToThread(threadId, 'user', 'Internal task');

    const response = await request(app)
      .get(`/api/conversations/${teamLeadId}`)
      .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
    expect(response.body.messages).toHaveLength(2);
    expect(response.body.messages.every(m =>
      m.content !== 'Internal task'
    )).toBe(true);
  });
});
```

### Phase 7: Remove Legacy Code

#### Task 7.1: Remove hourly cycle logic
- Remove `runResearchCycle()` (replaced by task-based work)
- Remove `maybeGenerateProactiveBriefing()` (replaced by `decideBriefing()`)
- Remove `BRIEFING_INTERVAL_HOURS`, `RESEARCH_INTERVAL_MINUTES` constants

#### Task 7.2: Update runCycle dispatch
- Team lead: `runWorkSession()` + proactive work if queue empty
- Worker: `runWorkSession()` only

### Phase 8: Documentation Update

#### Task 8.1: Update CLAUDE.md
**File**: `CLAUDE.md`

Update to reflect new architecture:

1. **Architecture section** - Rewrite to describe:
   - Conversations (user ↔ agent, permanent, UI-visible)
   - Threads (background work sessions, ephemeral, internal)
   - Task queue system (all agents have queues)
   - Memories vs Insights distinction

2. **Agent Runtime section** - Update to describe:
   - `handleUserMessage()` - foreground, queues task, returns ack
   - `runWorkSession()` - background, processes queue in thread
   - `extractInsightsFromThread()` - post-session professional learning
   - `decideBriefing()` - team lead briefing decision

3. **Data Flow section** - Update to reflect:
   - Foreground: User message → ack + task queued
   - Background: Task → thread → insights → briefing (maybe)

4. **Background Worker section** - Update to describe:
   - Event-driven (task queued) + timer-based (team lead 1-hour)
   - Workers purely reactive, team leads proactive

5. **Commands section** - Verify worker command still accurate

6. **Remove outdated sections**:
   - Remove references to hourly cycles
   - Remove references to `runResearchCycle`
   - Remove references to `maybeGenerateProactiveBriefing`

7. **Add new key concepts**:
   - **Memories vs Insights**: Memories store user interaction context (preferences, past requests). Insights are the agent's professional knowledge base - domain expertise, techniques, patterns, and facts extracted from work threads.
   - Thread lifecycle (created → active → insight extraction → completed)
   - Thread compaction (mid-session context management)
   - Professional growth model (insights as accumulated expertise)

---

## Data Flow Diagrams

### User Message → Background Processing

```
┌─────────────────────────────────────────────────────────────────┐
│ FOREGROUND (API Request)                                        │
├─────────────────────────────────────────────────────────────────┤
│ 1. User sends: "Research NVIDIA stock"                          │
│ 2. Agent receives in handleUserMessage()                        │
│ 3. Add to CONVERSATION: user message                            │
│ 4. Quick LLM call for contextual ack                            │
│ 5. Add to CONVERSATION: "I'll research NVIDIA's latest..."      │
│ 6. Queue task: {task: "Research NVIDIA stock", source: 'user'}  │
│ 7. Trigger background: notifyTaskQueued(agentId)                │
│ 8. Return response to user                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ BACKGROUND (Worker Process)                                     │
├─────────────────────────────────────────────────────────────────┤
│ 1. Worker picks up agent (has pending task)                     │
│ 2. runWorkSession() starts                                      │
│ 3. Create NEW THREAD for this session                           │
│ 4. Load memories + insights for context                         │
│ 5. Process task in thread:                                      │
│    - Add task as "user" message to thread                       │
│    - LLM responds with tool calls                               │
│    - tavilySearch("NVIDIA stock news") → add result to thread   │
│    - May delegate to workers                                    │
│    - Thread grows with work conversation                        │
│    - Compact if approaching context limit                       │
│ 6. Mark task complete                                           │
│ 7. Check queue → empty                                          │
│ 8. Extract insights from THREAD → insights table                │
│ 9. Mark thread completed (can be cleaned up later)              │
│ 10. Decide briefing: "Yes, found significant news"              │
│ 11. Create inbox item (summary)                                 │
│ 12. Add full briefing to USER CONVERSATION                      │
│ 13. Schedule next run: now + 1 hour                             │
└─────────────────────────────────────────────────────────────────┘
```

### Team Lead Proactive Cycle (1-Hour Trigger)

```
┌─────────────────────────────────────────────────────────────────┐
│ BACKGROUND (Worker Process - 1 Hour Timer)                      │
├─────────────────────────────────────────────────────────────────┤
│ 1. Worker picks up team lead (nextRunAt <= now)                 │
│ 2. runWorkSession() starts                                      │
│ 3. Create NEW THREAD for this session                           │
│ 4. Check queue → empty                                          │
│ 5. Load mission + memories + insights                           │
│ 6. Add to thread: "What should I work on for my mission?"       │
│ 7. LLM decides proactive work based on mission & learnings      │
│ 8. Execute work in thread (search, delegate, etc.)              │
│ 9. When done: extract insights from thread → insights table     │
│ 10. Mark thread completed                                       │
│ 11. Decide briefing based on significance                       │
│ 12. Schedule next run: now + 1 hour                             │
└─────────────────────────────────────────────────────────────────┘
```

### Teammate Worker (Purely Reactive)

```
┌─────────────────────────────────────────────────────────────────┐
│ BACKGROUND (Worker Process - Task Queued)                       │
├─────────────────────────────────────────────────────────────────┤
│ 1. Task delegated by team lead → queue updated                  │
│ 2. notifyTaskQueued() triggers worker pickup                    │
│ 3. runWorkSession() starts                                      │
│ 4. Create NEW THREAD for this session                           │
│ 5. Process task in thread                                       │
│ 6. Mark task complete, report to lead                           │
│ 7. Check queue → empty                                          │
│ 8. Extract insights from thread → insights table                │
│ 9. Mark thread completed                                        │
│ 10. NO briefing (workers can't send)                            │
│ 11. NO scheduling (purely reactive)                             │
│ 12. Session ends, agent goes idle                               │
└─────────────────────────────────────────────────────────────────┘
```

### Thread Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│ THREAD LIFECYCLE                                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐    ┌──────────────────────────────────────┐       │
│  │ Created  │───▶│ Active (processing tasks)            │       │
│  └──────────┘    │                                      │       │
│                  │  Messages accumulate:                │       │
│                  │  - Agent adds task as "user"         │       │
│                  │  - LLM responds as "assistant"       │       │
│                  │  - Tool results added                │       │
│                  │                                      │       │
│                  │  If context limit approached:        │       │
│                  │  ┌────────────────────────────┐      │       │
│                  │  │ Compact: summarize history │      │       │
│                  │  │ Replace with summary msg   │      │       │
│                  │  │ Continue working           │      │       │
│                  │  └────────────────────────────┘      │       │
│                  └──────────────────────────────────────┘       │
│                                    │                            │
│                                    ▼                            │
│                  ┌──────────────────────────────────────┐       │
│                  │ Queue Empty → Extract Insights       │       │
│                  │                                      │       │
│                  │  - Review all thread messages        │       │
│                  │  - Extract facts, techniques,        │       │
│                  │    patterns, lessons                 │       │
│                  │  - Persist to insights table         │       │
│                  │  - Agent "grows professionally"      │       │
│                  └──────────────────────────────────────┘       │
│                                    │                            │
│                                    ▼                            │
│                  ┌──────────────────────────────────────┐       │
│                  │ Completed                            │       │
│                  │                                      │       │
│                  │  Thread marked completed             │       │
│                  │  Can be cleaned up/archived later    │       │
│                  │  Next session = NEW thread           │       │
│                  └──────────────────────────────────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## File Changes Summary

| File | Changes |
|------|---------|
| `src/lib/db/schema.ts` | Add threads, threadMessages, insights tables; task source; agent scheduling fields |
| `src/lib/db/queries/threads.ts` | NEW: createThread, getThreadMessages, appendThreadMessage, compactThread, completeThread |
| `src/lib/db/queries/insights.ts` | NEW: createInsight, getInsightsByAgentId, getRecentInsights |
| `src/lib/db/queries/agentTasks.ts` | queueTask, getOwnPendingTasks, hasQueuedWork |
| `src/lib/db/queries/agents.ts` | scheduleNextRun, getAgentsDueToRun |
| `src/lib/agents/agent.ts` | Major refactor: handleUserMessage, runWorkSession, processTaskInThread, extractInsightsFromThread, decideBriefing |
| `src/lib/agents/thread.ts` | NEW: startWorkSession, addToThread, buildThreadContext, shouldCompact, compactIfNeeded |
| `src/lib/agents/insights.ts` | NEW: extractInsightsFromThread function |
| `src/lib/agents/tools/insight-tools.ts` | NEW: addInsight, listInsights, removeInsight tools for foreground |
| `src/worker/runner.ts` | Event-driven + timer-based scheduling |
| `src/app/api/messages/route.ts` | Use handleUserMessage |
| `src/app/api/teams/route.ts` | Bootstrap "get to work" task |
| `src/app/api/conversations/[agentId]/route.ts` | No changes needed (already returns user conversation) |
| `CLAUDE.md` | Update architecture docs to reflect new system |

---

## Subagent Workflow

Each task is implemented using three subagent types in sequence:

### 1. Implementation Subagent
- Writes code, creates files, installs dependencies
- Follows TDD: write tests first, then implementation
- Runs tests to verify functionality
- Self-reviews before handoff

### 2. Spec Reviewer Subagent
- Verifies implementation matches plan spec
- **Augments the plan**: Can add missing tests, edge cases, error handling even if not explicitly in plan
- Fills gaps the plan didn't anticipate
- Ensures comprehensive coverage (integration scenarios, boundary conditions)
- If issues found → implementation subagent fixes → spec reviewer reviews again
- Does NOT just check against plan - actively improves implementation

### 3. Code Quality Reviewer Subagent
- Reviews for code quality, patterns, maintainability
- Checks for security issues, performance concerns
- Ensures consistency with codebase conventions
- If issues found → implementation subagent fixes → quality reviewer reviews again
- Commits changes when approved

**Flow per task:**
```
Implementation → Spec Review (augment if needed) → Quality Review → Commit
                     ↑                                    ↑
                     └──── fix loop ──────────────────────┘
```

---

## Implementation Order

1. **Schema changes** (Tasks 1.1-1.8) - foundation for everything (threads, insights, task source, scheduling)
2. **Thread management** (Tasks 2.1-2.3) - new thread infrastructure
3. **Task queue system** (Tasks 3.1-3.3) - needed before agent refactor
4. **Agent lifecycle** (Tasks 4.1-4.7) - core behavior changes + insight tools for foreground
5. **Background worker** (Tasks 5.1-5.3) - execution infrastructure
6. **API updates** (Tasks 6.1-6.4) - wire up new system
7. **Cleanup** (Tasks 7.1-7.2) - remove legacy code
8. **Documentation** (Task 8.1) - update CLAUDE.md with memories vs insights distinction

---

## Verification Plan

### 1. Schema Verification
```bash
npx drizzle-kit generate
npx drizzle-kit migrate
npx drizzle-kit studio  # Verify new tables: threads, thread_messages, insights
```

### 2. Unit Tests
- Test `createThread()` creates new thread for agent
- Test `appendThreadMessage()` adds message with correct sequence
- Test `compactThread()` replaces messages with summary
- Test `queueTask()` creates task with correct source
- Test `createInsight()` stores insight with sourceThreadId
- Test `handleUserMessage()` queues task and returns contextual ack

### 3. Integration Tests
1. Create team → verify "get to work" task queued
2. Send user message → verify task queued + contextual response
3. Run worker → verify NEW thread created for session
4. Verify task processed via thread (not conversation)
5. Check queue empty → verify insights extracted from thread
6. Verify insights stored with sourceThreadId
7. Verify thread marked completed
8. Check team lead → verify briefing decision made
9. If briefing → verify inbox item + conversation message

### 4. End-to-End Test
1. Start worker: `npx ts-node --project tsconfig.json src/worker/index.ts`
2. Create new team via UI
3. Verify team lead starts working (check logs for "new thread created")
4. Send message to team lead
5. Verify contextual response returned immediately
6. Wait for background processing
7. Verify thread completed and insights extracted
8. Check inbox for briefing (if significant)
9. Check USER conversation has briefing content
10. Check insights table for extracted professional knowledge
11. Wait 1 hour (or manually trigger) → verify team lead wakes up
12. Verify NEW thread created for proactive work

### 5. Thread Compaction Test
1. Create task that requires many LLM exchanges
2. Monitor thread message count
3. Verify compaction triggers when approaching context limit
4. Verify work continues after compaction

---

## Success Criteria

- [ ] Threads table exists with proper schema
- [ ] ThreadMessages table exists with proper schema
- [ ] Insights table exists with proper schema
- [ ] Each work session creates NEW thread
- [ ] Tasks have source field (delegation/user/system/self)
- [ ] User messages queue tasks, return contextual ack
- [ ] Background processes tasks via thread (not conversation)
- [ ] Mid-session compaction works when context limit approached
- [ ] Insights extracted from thread after queue cleared
- [ ] Insights linked to sourceThreadId
- [ ] Thread marked completed after insight extraction
- [ ] Team leads decide briefings (not automatic)
- [ ] Briefings go to inbox (summary) + conversation (full)
- [ ] Team leads have 1-hour proactive trigger
- [ ] Workers are purely reactive (queue-triggered only)
- [ ] New teams bootstrap with "get to work" task
- [ ] Insights accumulate professional knowledge over time
- [ ] Insights sent to LLM only in background (threads)
- [ ] Memories sent to LLM only in foreground (conversations)
- [ ] Agent can add insights from user conversation (addInsight tool)
- [ ] Agent can show insights to user when asked (listInsights tool)
- [ ] Agent can remove outdated insights (removeInsight tool)
- [ ] UI shows only user conversation (not threads)
- [ ] CLAUDE.md updated with memories vs insights distinction
