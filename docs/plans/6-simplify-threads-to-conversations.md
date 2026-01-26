# Simplify Threads to Conversations

## Overview

Remove the threads/threadMessages tables in favor of a unified conversation model. Each agent will have:
- **Foreground conversation**: User ↔ Agent interaction
- **Background conversation**: Agent ↔ LLM interaction (work sessions)

This simplifies the architecture while maintaining full message history with automatic compaction.

## Current vs New Architecture

**Current:**
```
User ↔ Agent: conversations + messages tables
Agent work:   threads + threadMessages tables
```

**New:**
```
User ↔ Agent: conversations (mode='foreground') + messages
Agent work:   conversations (mode='background') + messages
```

---

## Database Schema Changes

### 1. Conversations Table - Add Mode

```typescript
export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  mode: text('mode').notNull().default('foreground'), // 'foreground' | 'background'
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
});
```

### 2. Messages Table - Add Fields

**Current messages schema has:**
- `id`, `conversationId`, `role`, `content`, `thinking`, `sequenceNumber`, `createdAt`

**Need to add:**
- `toolCalls` (jsonb) - For assistant messages with tool calls
- `toolCallId` (text) - For tool role - links result to call
- `previousMessageId` (uuid, self-reference) - Linked list for compaction

**Need to update:**
- `role` - Add 'tool' and 'summary' roles, remove 'system' (currently supports 'user' | 'assistant' | 'system')
- Remove `sequenceNumber` - replaced by `previousMessageId` linked list

```typescript
export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'user' | 'assistant' | 'tool' | 'summary'
  content: text('content').notNull(),
  thinking: text('thinking'), // Keep for extended thinking/reasoning
  toolCalls: jsonb('tool_calls'), // For assistant messages with tool calls
  toolCallId: text('tool_call_id'), // For tool role - links result to call
  previousMessageId: uuid('previous_message_id').references(() => messages.id), // Linked list for compaction
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});
```

### 3. Remove Tables

- `threads` - DELETE
- `threadMessages` - DELETE

### 4. Update Knowledge Items Foreign Key

**Current:** `knowledgeItems.sourceThreadId` references `threads.id`
**New:** Change to `knowledgeItems.sourceConversationId` references `conversations.id`

### 5. Update Relations

Remove from `schema.ts`:
- `threadsRelations`
- `threadMessagesRelations`
- `agents.threads` relation
- `knowledgeItems.sourceThread` relation

Update in `schema.ts`:
- `knowledgeItemsRelations` - change sourceThread to sourceConversation

---

## Message Roles

| Role | Purpose |
|------|---------|
| `user` | Human (foreground) or Agent (background) sending input |
| `assistant` | LLM response, may include `toolCalls` JSON |
| `tool` | Tool execution result, linked via `toolCallId` |
| `summary` | Compaction summary, `previousMessageId` points to last summarized message |

**Note:** No `system` role stored. System prompts are built dynamically from `agent.systemPrompt` + context.

---

## Tool Results Storage (Vercel AI SDK Pattern)

Following the Vercel AI SDK approach for storing tool calls and results:

```typescript
// 1. User/Agent request
{ role: 'user', content: 'What is NVDA price?' }

// 2. Assistant calls tool
{
  role: 'assistant',
  content: 'Let me check the current price...',
  toolCalls: [{ toolCallId: 'call_1', toolName: 'tavilySearch', args: { query: 'NVDA stock price' } }]
}

// 3. Tool result stored
{
  role: 'tool',
  content: '{"price": 142.50, "change": "+2.3%"}',
  toolCallId: 'call_1'
}

// 4. Assistant final response
{ role: 'assistant', content: 'NVIDIA is currently trading at $142.50, up 2.3% today.' }
```

---

## Automatic Compaction

### How It Works

Messages form a linked list via `previousMessageId`. Compaction creates a `summary` message without deleting any messages.

**Before compaction (10 messages, context limit hit):**
```
msg A (prev: null)     role='user'      "Research NVDA"
msg B (prev: A)        role='assistant' "Looking into it..."
msg C (prev: B)        role='tool'      [search results]
msg D (prev: C)        role='assistant' "Here's what I found..."
...
msg J (prev: I)        role='assistant' "Analysis complete."
```

**After compaction:**
```
msg A-J                (unchanged, still exist in DB)
msg K (prev: J)        role='summary'   "Summary: User requested NVDA research..."
```

**After more work + second compaction:**
```
msg K                  role='summary'   (first summary)
msg L-W                (new messages)
msg X (prev: W)        role='summary'   "Summary: [includes K's content] + new findings..."
```

### Context Loading

```typescript
async function getConversationContext(conversationId: string): Promise<Message[]> {
  // Find latest summary
  const latestSummary = await db.query.messages.findFirst({
    where: and(
      eq(messages.conversationId, conversationId),
      eq(messages.role, 'summary')
    ),
    orderBy: desc(messages.createdAt)
  });

  if (latestSummary) {
    // Get messages created after the summary
    const recentMessages = await db.query.messages.findMany({
      where: and(
        eq(messages.conversationId, conversationId),
        gt(messages.createdAt, latestSummary.createdAt)
      ),
      orderBy: asc(messages.createdAt)
    });
    return [latestSummary, ...recentMessages];
  }

  // No summary yet, return all messages
  return db.query.messages.findMany({
    where: eq(messages.conversationId, conversationId),
    orderBy: asc(messages.createdAt)
  });
}
```

### Compaction Trigger

```typescript
async function compactIfNeeded(conversationId: string, contextLimit: number = 50): Promise<void> {
  const context = await getConversationContext(conversationId);

  if (context.length < contextLimit) return;

  // Generate summary from current context
  const summary = await generateSummary(context);

  // Find the last message (to set previousMessageId)
  const lastMessage = context[context.length - 1];

  // Create summary message
  await addMessage(conversationId, {
    role: 'summary',
    content: summary,
    previousMessageId: lastMessage.id
  });
}
```

---

## Conversation Modes

### Foreground Conversation (mode='foreground')

- **Purpose:** User ↔ Agent chat
- **Participants:** Human user (role='user'), Agent via LLM (role='assistant')
- **Tools:** Available (Tavily, knowledge items, etc.)
- **Created:** On first user interaction with agent

### Background Conversation (mode='background')

- **Purpose:** Agent work sessions
- **Participants:** Agent as requester (role='user'), LLM as worker (role='assistant')
- **Tools:** All tools including coordination (delegateToAgent, createInboxItem, etc.)
- **Created:** On agent creation or first work session
- **Persistent:** Same conversation used across all work sessions (with compaction)

---

## Subordinate Communication

All inter-agent communication uses background conversations.

### requestInput (Subordinate → Lead)

```
Subordinate's background conversation:
  { role: 'assistant', toolCalls: [{toolName: 'requestInput', args: {question: '...'}}] }
  { role: 'tool', toolCallId: '...', content: 'Request sent to lead' }

Team Lead's background conversation:
  { role: 'user', content: 'Subordinate [name] is asking: [question]' }
  { role: 'assistant', content: '...response...' }
```

### reportToLead (Subordinate → Lead)

```
Subordinate's background conversation:
  { role: 'assistant', toolCalls: [{toolName: 'reportToLead', args: {result: '...'}}] }
  { role: 'tool', toolCallId: '...', content: 'Report sent to lead' }

Team Lead's background conversation:
  { role: 'user', content: 'Subordinate [name] reports: [result]' }
```

---

## Briefing Flow

1. **Decision in background:** Lead decides to brief based on work results
2. **Tool call:** `createInboxItem` tool called
3. **Inbox notification:** Summary added to inbox
4. **Foreground message:** Full briefing added to foreground conversation

```
Team Lead's background conversation:
  { role: 'assistant', toolCalls: [{toolName: 'createInboxItem', args: {...}}] }
  { role: 'tool', content: 'Briefing sent' }

Team Lead's foreground conversation:
  { role: 'assistant', content: '[Full briefing message]' }

Inbox:
  { type: 'briefing', title: '...', content: '[Summary]' }
```

---

## Implementation Phases

### Phase 1: Schema Migration

**Files to modify:**
- `src/lib/db/schema.ts`

**Changes:**
1. Add `mode` field to `conversations` table (default: 'foreground')
2. Add `toolCalls` (jsonb), `toolCallId` (text), `previousMessageId` (uuid self-reference) fields to `messages` table
3. Remove `sequenceNumber` from `messages` table
4. Update `role` type to include `'tool' | 'summary'` (remove `'system'` in types)
5. Change `knowledgeItems.sourceThreadId` to `knowledgeItems.sourceConversationId`
6. Remove `threads` and `threadMessages` tables from schema
7. Remove `threadsRelations` and `threadMessagesRelations`
8. Update `agentsRelations` to remove `threads: many(threads)`
9. Update `knowledgeItemsRelations` to use `sourceConversation` instead of `sourceThread`
10. Generate migration with `npx drizzle-kit generate`
11. Apply migration with `npx drizzle-kit migrate`

**Testing requirements:**
- Verify migration applies cleanly
- Verify new fields are accessible via Drizzle
- Test foreign key constraint on `previousMessageId`

---

### Phase 2: Conversation Queries

**Files to modify:**
- `src/lib/db/queries/conversations.ts`
- `src/lib/db/queries/messages.ts`

**Changes to `conversations.ts`:**
1. Update `createConversation(agentId)` to accept `mode` parameter: `createConversation(agentId, mode: 'foreground' | 'background')`
2. Update `getOrCreateConversation(agentId)` to accept `mode` parameter: `getOrCreateConversation(agentId, mode)`
3. Add `getConversationByMode(agentId, mode)` - get specific conversation type
4. Add `getBackgroundConversation(agentId)` - convenience wrapper
5. Add `getForegroundConversation(agentId)` - convenience wrapper
6. Update `getLatestConversation(agentId)` to optionally filter by mode

**Changes to `messages.ts`:**
1. Create `getConversationContext(conversationId)` - load context with compaction awareness (summary + recent)
2. Create `addToolResultMessage(conversationId, toolCallId, result)` - add tool role message
3. Update `appendMessage` to support `toolCalls` and `previousMessageId` parameters
4. Update `createMessage` to support new fields
5. Remove functions that use `sequenceNumber` or update to use `previousMessageId`
6. Add `getLastMessage(conversationId)` - for getting previousMessageId reference
7. Add `getMessageAfterSummary(conversationId)` - get messages after latest summary

**Testing requirements:**
- Test `getOrCreateConversation` with foreground mode
- Test `getOrCreateConversation` with background mode
- Test `getConversationContext` returns summary + recent messages
- Test `getConversationContext` returns all messages when no summary exists
- Test `addToolResultMessage` links correctly via toolCallId

---

### Phase 3: Compaction System

**Files to create:**
- `src/lib/agents/compaction.ts` (NEW)

**Files to modify:**
- `src/lib/agents/conversation.ts`

**Changes to new `compaction.ts`:**
1. Create `compactConversation(conversationId, llmOptions)` - generate summary + create summary message
2. Create `generateConversationSummary(messages, llmOptions)` - LLM call to summarize context
3. Create `shouldCompact(conversationId, limit)` - check if compaction needed
4. Create `compactIfNeeded(conversationId, limit, llmOptions)` - conditional compaction

**Changes to `conversation.ts`:**
1. Update `buildMessageContext` to use `getConversationContext` (compaction-aware)
2. Remove or update `trimMessagesToTokenBudget` - may need adjustment for linked list approach
3. Update `estimateTokenCount` to handle new message format

**Note:** The existing `thread.ts` has similar compaction logic that can be adapted:
- `shouldCompact(threadId, maxMessages)` -> adapt for conversations
- `compactWithSummary(threadId, summary)` -> adapt for conversations
- `trimMessagesToTokenBudget` -> adapt for linked list approach

**Testing requirements:**
- Test `shouldCompact` returns true when over limit
- Test `compactConversation` creates summary message with correct role
- Test `compactConversation` sets `previousMessageId` to last message
- Test `getConversationContext` correctly handles post-compaction state
- Test multiple compactions chain correctly

---

### Phase 4: Agent Refactor

**Files to modify:**
- `src/lib/agents/agent.ts`

**Current thread-related code in agent.ts:**
- Imports: `startWorkSession`, `endWorkSession`, `addToThread`, `buildThreadContext`, `shouldCompact`, `compactWithSummary`, `getMessages as getThreadMessages`, `threadMessagesToLLMFormat`
- `runWorkSession()` - uses threads
- `processTaskInThread(threadId, task)` - uses thread for task processing
- `compactThread(threadId)` - compacts thread
- `decideBriefing(threadId)` - reads from thread

**Changes:**
1. Remove thread imports, replace with conversation/compaction imports
2. Rename `processTaskInThread` to `processTask` - use background conversation
3. Update `runWorkSession()`:
   - Replace `startWorkSession(agentId)` -> `getOrCreateConversation(agentId, 'background')`
   - Replace thread message operations with conversation message operations
   - Replace `endWorkSession(threadId)` -> just mark work complete (no thread to end)
4. Update `processTask()`:
   - Replace `addToThread(threadId, 'user', taskMessage)` -> `addUserMessage(backgroundConversationId, taskMessage)`
   - Replace `buildThreadContext(threadId)` -> `getConversationContext(backgroundConversationId)`
   - Replace thread compaction check -> conversation compaction check
5. Update `decideBriefing()`:
   - Replace `getThreadMessages(threadId)` -> `getConversationContext(backgroundConversationId)`
   - Or load recent messages from background conversation
6. Update knowledge extraction call to pass background conversation ID instead of thread ID
7. Remove `compactThread()` method - use compaction module
8. Update type for `processTask` to take conversation ID instead of thread ID

**Testing requirements:**
- Test `runWorkSession` creates/uses background conversation
- Test `runWorkSession` processes tasks and adds messages to background conversation
- Test `runWorkSession` triggers compaction when needed
- Test `processTask` adds task as user message, response as assistant message
- Test `decideBriefing` reads from background conversation
- Test knowledge extraction receives correct conversation ID

---

### Phase 5: Tool Updates

**Files to modify:**
- `src/lib/agents/tools/subordinate-tools.ts`
- `src/lib/agents/tools/team-lead-tools.ts`

**Current `subordinate-tools.ts` code:**
- `requestInput`: Currently uses `getActiveConversation(agent.parentAgentId)` and `addSystemMessage` to lead's foreground conversation
- `reportToLead`: Currently just marks task complete (doesn't add message to lead's conversation)

**Changes to `subordinate-tools.ts`:**
1. Update `requestInput`:
   - Get lead's BACKGROUND conversation: `getBackgroundConversation(agent.parentAgentId)`
   - Add as USER message (not system): `addUserMessage(backgroundConvId, \`Subordinate ${agent.name} asks: ${question}\`)`
2. Update `reportToLead`:
   - Get lead's BACKGROUND conversation: `getBackgroundConversation(agent.parentAgentId)`
   - Add as USER message: `addUserMessage(backgroundConvId, \`Subordinate ${agent.name} reports: ${result}\`)`

**Current `team-lead-tools.ts` code:**
- `createInboxItem`: Creates inbox item + adds message to foreground conversation via `getOrCreateConversation(agentId)`

**Changes to `team-lead-tools.ts`:**
1. Update `createInboxItem`:
   - Explicitly get FOREGROUND conversation: `getOrCreateConversation(agentId, 'foreground')`
   - (This should already work but make explicit for clarity)

**Testing requirements:**
- Test `requestInput` adds message to lead's background conversation
- Test `reportToLead` adds message to lead's background conversation
- Test `createInboxItem` adds message to foreground conversation

---

### Phase 6: Worker Updates

**Files to modify:**
- `src/worker/runner.ts`

**Current runner.ts code:**
- `processAgentWorkSession(agentId)` calls `agent.runWorkSession()`
- No direct thread usage in runner (threads are managed in agent.ts)

**Changes:**
1. No significant changes needed - runner calls `agent.runWorkSession()` which will use conversations
2. Verify tool registration still works (should be unaffected)
3. Consider adding compaction check after work session (or leave in agent.ts)

**Testing requirements:**
- Test `processAgentWorkSession` still triggers work via Agent class
- Test end-to-end: task queued -> runner picks up -> agent processes -> messages in background conversation

---

### Phase 7: Knowledge Items Update

**Files to modify:**
- `src/lib/agents/knowledge-items.ts`
- `src/lib/db/queries/knowledge-items.ts`

**Current `knowledge-items.ts` code:**
- `extractKnowledgeFromThread(threadId, agentId, agentRole, options)` - extracts from thread messages
- Uses `getThreadMessages(threadId)` to load messages

**Changes to `knowledge-items.ts`:**
1. Rename `extractKnowledgeFromThread` to `extractKnowledgeFromConversation`
2. Update to use `getConversationContext(conversationId)` instead of `getThreadMessages`
3. Or add new function and deprecate old one

**Changes to `knowledge-items.ts` (query file):**
1. Update `createKnowledgeItem` parameter: `sourceThreadId` -> `sourceConversationId`
2. Update `getKnowledgeItemsBySourceThread` -> `getKnowledgeItemsBySourceConversation`

**Testing requirements:**
- Test knowledge extraction from background conversation
- Test knowledge items link to source conversation correctly

---

### Phase 8: Type Updates

**Files to modify:**
- `src/lib/types.ts`

**Current types:**
- `Thread = InferSelectModel<typeof threads>`
- `ThreadMessage = InferSelectModel<typeof threadMessages>`
- `MessageRole = 'user' | 'assistant' | 'system'`

**Changes:**
1. Remove `Thread` type
2. Remove `ThreadMessage` type
3. Update `MessageRole` to `'user' | 'assistant' | 'tool' | 'summary'`
4. Add `ConversationMode = 'foreground' | 'background'`
5. Update `NewMessage` interface to include new fields (`toolCalls`, `toolCallId`, `previousMessageId`)
6. Remove thread imports from schema import

**Testing requirements:**
- Verify types compile correctly
- Verify no type errors in dependent files

---

### Phase 9: Index Files and Exports

**Files to modify:**
- `src/lib/agents/index.ts`
- `src/lib/db/queries/index.ts`

**Changes to `src/lib/agents/index.ts`:**
1. Remove all thread exports (lines 49-75):
   - `startWorkSession`, `getOrStartWorkSession`, `endWorkSession`, `hasActiveSession`, `getSessionThread`
   - `addToThread`, `addThreadUserMessage`, `addThreadAssistantMessage`, `addThreadSystemMessage`
   - `getThreadMessages`, `buildThreadContext`, `threadMessagesToLLMFormat`
   - `estimateThreadTokenCount`, `trimThreadMessagesToTokenBudget`
   - `shouldCompact`, `compactIfNeeded`, `compactWithSummary`, `clearThread`, `getThreadStats`, `initializeThreadWithPrompt`
   - Types: `WorkSession`, `ThreadContext`, `ThreadStats`, `SummarizeFn`
2. Update knowledge-items exports: `extractKnowledgeFromThread` -> `extractKnowledgeFromConversation`
3. Add compaction exports from new `compaction.ts`

**Changes to `src/lib/db/queries/index.ts`:**
1. Remove `export * from './threads'`

**Testing requirements:**
- Verify no import errors in dependent files
- Verify build succeeds

---

### Phase 10: Cleanup and Documentation

**Files to delete:**
- `src/lib/agents/thread.ts`
- `src/lib/db/queries/threads.ts`

**Files to modify:**
- `CLAUDE.md`

**Changes to `CLAUDE.md`:**
1. Update Architecture section:
   - Remove references to threads/threadMessages
   - Update "Conversations vs Threads" to just "Conversations (foreground vs background)"
   - Update "Thread lifecycle" references
2. Update terminology: "thread" -> "background conversation" where applicable
3. Update any code examples that reference threads

**Testing requirements:**
- Verify deleted files are not imported anywhere
- Verify documentation is accurate

---

## Test Files to Update/Delete

### Files to DELETE:
- `src/lib/db/__tests__/threads.test.ts` - Tests thread queries (will be deleted)

### Files to UPDATE:

**`src/lib/agents/__tests__/agent.test.ts`:**
- Remove thread-related imports and assertions
- Update `runWorkSession` tests to verify background conversation usage
- Update `processTaskInThread` tests -> `processTask` tests
- Update `decideBriefing` tests to use background conversation
- Remove/update tests that check `threads` table

**`src/worker/__tests__/runner.test.ts`:**
- No significant changes needed (runner doesn't directly use threads)
- May need to update integration test assertions

**`src/lib/db/__tests__/schema.test.ts`:**
- Remove `threads schema` describe block
- Remove `threadMessages schema` describe block
- Update `knowledgeItems schema` tests: `sourceThreadId` -> `sourceConversationId`

**`src/app/api/__tests__/api.test.ts`:**
- Remove thread-related imports
- Update "Conversations API" tests to verify mode
- Remove thread creation in test setup
- Update comments about threads vs conversations

---

## Files Summary

### Files to Modify (in order)

| Phase | File | Changes |
|-------|------|---------|
| 1 | `src/lib/db/schema.ts` | Add conversation mode, message fields, remove threads, update relations |
| 2 | `src/lib/db/queries/conversations.ts` | Add mode parameter, background/foreground helpers |
| 2 | `src/lib/db/queries/messages.ts` | Add tool message, context loading with compaction |
| 3 | `src/lib/agents/compaction.ts` | NEW: Compaction logic |
| 3 | `src/lib/agents/conversation.ts` | Update context building for compaction |
| 4 | `src/lib/agents/agent.ts` | Replace thread methods with conversation methods |
| 5 | `src/lib/agents/tools/subordinate-tools.ts` | Update requestInput, reportToLead for background conv |
| 5 | `src/lib/agents/tools/team-lead-tools.ts` | Explicit foreground mode for createInboxItem |
| 6 | `src/worker/runner.ts` | Minimal changes (verify still works) |
| 7 | `src/lib/agents/knowledge-items.ts` | Extract from background conversation |
| 7 | `src/lib/db/queries/knowledge-items.ts` | sourceThreadId -> sourceConversationId |
| 8 | `src/lib/types.ts` | Remove Thread/ThreadMessage, update MessageRole |
| 9 | `src/lib/agents/index.ts` | Remove thread exports, add compaction exports |
| 9 | `src/lib/db/queries/index.ts` | Remove threads export |
| 10 | `CLAUDE.md` | Update documentation |

### Files to Delete

- `src/lib/agents/thread.ts`
- `src/lib/db/queries/threads.ts`
- `src/lib/db/__tests__/threads.test.ts`

### Test Files to Update

- `src/lib/agents/__tests__/agent.test.ts`
- `src/lib/db/__tests__/schema.test.ts`
- `src/app/api/__tests__/api.test.ts`
- `src/worker/__tests__/runner.test.ts` (minor)

---

## Verification

1. **Build**: `npm run build` passes
2. **Lint**: `npm run lint` passes
3. **Tests**: `npm run test` passes with updated tests
4. **Migration**: Database migration applies cleanly
5. **Test scenarios**:
   - Foreground chat stores messages correctly with mode='foreground'
   - Background work stores messages with mode='background' and tool results
   - Compaction creates summary without deleting messages
   - Context loading returns summary + recent messages
   - Subordinate communication appears in lead's background conversation
   - Briefings appear in foreground conversation + inbox
   - Knowledge extraction works from background conversation
