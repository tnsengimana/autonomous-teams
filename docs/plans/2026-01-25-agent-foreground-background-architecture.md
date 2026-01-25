# Agent Foreground/Background Architecture

## Overview

Evolve the agent system from single-conversation to a sophisticated foreground/background architecture with separate conversation contexts, task queues for all agents, and knowledge extraction.

## Core Concepts

### Two Conversation Types
- **User Conversation**: Agent ↔ User interactions (shown in UI, foreground)
- **Agent Conversation**: Agent ↔ LLM for background work (not shown to user)

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
Task picked up → Load agent conversation (or create new)
              → Process task via LLM with tools
              → May queue sub-tasks or delegate to workers
              → Mark task complete
              → If queue empty:
                  → Extract knowledge from agent conversation
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

### 1. Add `type` to conversations table

```sql
ALTER TABLE conversations ADD COLUMN type TEXT NOT NULL DEFAULT 'user';
-- Values: 'user', 'agent'
```

### 2. Extend agentTasks for self-queued tasks

Current schema has `assignedById` (who delegated) and `assignedToId` (who executes).
For self-queued tasks, both would be the same agent.

Add `source` field to distinguish:
```sql
ALTER TABLE agent_tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'delegation';
-- Values: 'delegation' (from another agent), 'user' (from user message), 'system' (bootstrap), 'self' (proactive)
```

### 3. Add scheduling fields to agents table

```sql
ALTER TABLE agents ADD COLUMN next_run_at TIMESTAMP;
ALTER TABLE agents ADD COLUMN last_completed_at TIMESTAMP;
```

---

## Implementation Tasks

### Phase 1: Schema & Database Layer

#### Task 1.1: Update conversations schema
**File**: `src/lib/db/schema.ts`

Add `type` field to conversations:
```typescript
type: text('type').notNull().default('user'), // 'user' | 'agent'
```

#### Task 1.2: Update agentTasks schema
**File**: `src/lib/db/schema.ts`

Add `source` field:
```typescript
source: text('source').notNull().default('delegation'), // 'delegation' | 'user' | 'system' | 'self'
```

#### Task 1.3: Update agents schema
**File**: `src/lib/db/schema.ts`

Add scheduling fields:
```typescript
nextRunAt: timestamp('next_run_at'),
lastCompletedAt: timestamp('last_completed_at'),
```

#### Task 1.4: Generate and apply migrations
```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

### Phase 2: Conversation Management

#### Task 2.1: Update conversation queries
**File**: `src/lib/db/queries/conversations.ts`

Add functions:
- `getUserConversation(agentId)` - get/create user conversation
- `getAgentConversation(agentId)` - get/create agent conversation
- `clearAgentConversation(agentId)` - optionally clear after knowledge extraction

#### Task 2.2: Update conversation.ts abstraction
**File**: `src/lib/agents/conversation.ts`

Update `getActiveConversation()` to accept conversation type parameter.

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

### Phase 4: Agent Lifecycle Refactor

#### Task 4.1: Split handleMessage for foreground
**File**: `src/lib/agents/agent.ts`

New `handleUserMessage()`:
1. Add user message to USER conversation
2. Generate minimal response ("I'll look into that" or smart acknowledgment)
3. Queue task with source='user'
4. Return response stream
5. Trigger background worker

#### Task 4.2: Create processTaskQueue method
**File**: `src/lib/agents/agent.ts`

New method for background processing:
```typescript
async processTaskQueue(): Promise<void> {
  // 1. Get pending tasks
  // 2. For each task:
  //    - Process via agent conversation
  //    - Mark complete
  // 3. When queue empty:
  //    - Extract knowledge
  //    - Team lead: decide briefing
  //    - Schedule next run
}
```

#### Task 4.3: Create processTask method
**File**: `src/lib/agents/agent.ts`

Process single task in agent conversation:
```typescript
async processTask(task: AgentTask): Promise<string> {
  // 1. Ensure agent conversation exists
  // 2. Build context from agent conversation + memories
  // 3. Call LLM with tools
  // 4. Persist messages to agent conversation
  // 5. Return result
}
```

#### Task 4.4: Create extractKnowledge method
**File**: `src/lib/agents/agent.ts` or `src/lib/agents/memory.ts`

Extract insights from agent conversation after work:
```typescript
async extractKnowledge(): Promise<void> {
  // 1. Load agent conversation messages
  // 2. Build prompt for knowledge extraction
  // 3. Extract memories (insights about how to work, patterns, learnings)
  // 4. Persist to memories
  // 5. Optionally summarize/clear agent conversation
}
```

#### Task 4.5: Create decideBriefing method (team lead only)
**File**: `src/lib/agents/agent.ts`

```typescript
async decideBriefing(): Promise<void> {
  if (!this.isTeamLead()) return;

  // 1. Review recent work and extracted knowledge
  // 2. LLM decides: is this worth briefing user?
  // 3. If yes:
  //    - Generate briefing content
  //    - Create inbox item (summary)
  //    - Add full briefing to USER conversation
}
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

Only return USER conversation (not agent conversation).

### Phase 7: Remove Legacy Code

#### Task 7.1: Remove hourly cycle logic
- Remove `runResearchCycle()` (replaced by task-based work)
- Remove `maybeGenerateProactiveBriefing()` (replaced by `decideBriefing()`)
- Remove `BRIEFING_INTERVAL_HOURS`, `RESEARCH_INTERVAL_MINUTES` constants

#### Task 7.2: Update runCycle dispatch
- Team lead: `processTaskQueue()` + proactive work if queue empty
- Worker: `processTaskQueue()` only

---

## Data Flow Diagrams

### User Message → Background Processing

```
┌─────────────────────────────────────────────────────────────────┐
│ FOREGROUND (API Request)                                        │
├─────────────────────────────────────────────────────────────────┤
│ 1. User sends: "Research NVIDIA stock"                          │
│ 2. Agent receives in handleUserMessage()                        │
│ 3. Add to USER conversation: user message                       │
│ 4. Generate minimal response: "I'll research NVIDIA for you"    │
│ 5. Add to USER conversation: assistant message                  │
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
│ 2. Load AGENT conversation (create if empty)                    │
│ 3. Process task via LLM with tools                              │
│    - tavilySearch("NVIDIA stock news")                          │
│    - May delegate to workers                                    │
│    - Builds up AGENT conversation with research                 │
│ 4. Mark task complete                                           │
│ 5. Check queue → empty                                          │
│ 6. Extract knowledge from AGENT conversation → memories         │
│ 7. Decide briefing: "Yes, found significant news"               │
│ 8. Create inbox item (summary)                                  │
│ 9. Add full briefing to USER conversation                       │
│ 10. Schedule next run: now + 1 hour                             │
└─────────────────────────────────────────────────────────────────┘
```

### Team Lead Proactive Cycle (1-Hour Trigger)

```
┌─────────────────────────────────────────────────────────────────┐
│ BACKGROUND (Worker Process - 1 Hour Timer)                      │
├─────────────────────────────────────────────────────────────────┤
│ 1. Worker picks up team lead (nextRunAt <= now)                 │
│ 2. Check queue → empty                                          │
│ 3. Load mission + memories                                      │
│ 4. LLM decides proactive work based on mission                  │
│ 5. Queue self-tasks: {task: "...", source: 'self'}              │
│ 6. May delegate tasks to workers                                │
│ 7. Process queued tasks via AGENT conversation                  │
│ 8. When done: extract knowledge, decide briefing                │
│ 9. Schedule next run: now + 1 hour                              │
└─────────────────────────────────────────────────────────────────┘
```

### Teammate Worker (Purely Reactive)

```
┌─────────────────────────────────────────────────────────────────┐
│ BACKGROUND (Worker Process - Task Queued)                       │
├─────────────────────────────────────────────────────────────────┤
│ 1. Task delegated by team lead → queue updated                  │
│ 2. Worker picks up agent (has pending task)                     │
│ 3. Process task via AGENT conversation                          │
│ 4. Mark task complete, report to lead                           │
│ 5. Check queue → empty                                          │
│ 6. Extract knowledge → memories                                 │
│ 7. NO briefing (workers can't send)                             │
│ 8. NO scheduling (purely reactive)                              │
│ 9. Go idle until next task queued                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## File Changes Summary

| File | Changes |
|------|---------|
| `src/lib/db/schema.ts` | Add conversation type, task source, agent scheduling fields |
| `src/lib/db/queries/conversations.ts` | getUserConversation, getAgentConversation |
| `src/lib/db/queries/agentTasks.ts` | queueTask, getOwnPendingTasks, hasQueuedWork |
| `src/lib/db/queries/agents.ts` | scheduleNextRun, getAgentsDueToRun |
| `src/lib/agents/agent.ts` | Major refactor: handleUserMessage, processTaskQueue, processTask, extractKnowledge, decideBriefing |
| `src/lib/agents/conversation.ts` | Support for conversation types |
| `src/lib/agents/memory.ts` | extractKnowledge function |
| `src/worker/runner.ts` | Event-driven + timer-based scheduling |
| `src/app/api/messages/route.ts` | Use handleUserMessage |
| `src/app/api/teams/route.ts` | Bootstrap "get to work" task |
| `src/app/api/conversations/[agentId]/route.ts` | Filter to user conversation |

---

## Implementation Order

1. **Schema changes** (Tasks 1.1-1.4) - foundation for everything
2. **Conversation management** (Tasks 2.1-2.2) - needed before agent refactor
3. **Task queue system** (Tasks 3.1-3.2) - needed before agent refactor
4. **Agent lifecycle** (Tasks 4.1-4.5) - core behavior changes
5. **Background worker** (Tasks 5.1-5.2) - execution infrastructure
6. **API updates** (Tasks 6.1-6.3) - wire up new system
7. **Cleanup** (Tasks 7.1-7.2) - remove legacy code

---

## Verification Plan

### 1. Schema Verification
```bash
npx drizzle-kit generate
npx drizzle-kit migrate
npx drizzle-kit studio  # Verify new columns
```

### 2. Unit Tests
- Test `queueTask()` creates task with correct source
- Test `getUserConversation()` vs `getAgentConversation()` return different records
- Test `handleUserMessage()` queues task and returns minimal response

### 3. Integration Tests
1. Create team → verify "get to work" task queued
2. Send user message → verify task queued + minimal response
3. Run worker → verify task processed via agent conversation
4. Check queue empty → verify knowledge extracted
5. Check team lead → verify briefing decision made

### 4. End-to-End Test
1. Start worker: `npx ts-node --project tsconfig.json src/worker/index.ts`
2. Create new team via UI
3. Verify team lead starts working (check logs)
4. Send message to team lead
5. Verify minimal response returned immediately
6. Wait for background processing
7. Check inbox for briefing (if significant)
8. Check USER conversation has briefing content
9. Check memories for extracted knowledge

---

## Success Criteria

- [ ] Conversations have type field (user/agent)
- [ ] Tasks have source field (delegation/user/system/self)
- [ ] User messages queue tasks, return minimal response
- [ ] Background processes tasks via agent conversation
- [ ] Knowledge extracted after queue cleared
- [ ] Team leads decide briefings (not automatic)
- [ ] Team leads have 1-hour proactive trigger
- [ ] Workers are purely reactive (queue-triggered only)
- [ ] New teams bootstrap with "get to work" task
- [ ] UI shows only user conversation
