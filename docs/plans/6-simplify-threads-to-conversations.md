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

```typescript
export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'user' | 'assistant' | 'tool' | 'summary'
  content: text('content').notNull(),
  toolCalls: jsonb('tool_calls'), // For assistant messages with tool calls
  toolCallId: text('tool_call_id'), // For tool role - links result to call
  previousMessageId: uuid('previous_message_id').references(() => messages.id), // Linked list for compaction
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});
```

### 3. Remove Tables

- `threads` - DELETE
- `threadMessages` - DELETE

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

1. Add `mode` field to `conversations` table
2. Add `toolCalls`, `toolCallId`, `previousMessageId` fields to `messages` table
3. Update `role` to include `'tool' | 'summary'` and remove `'system'`
4. Remove `threads` and `threadMessages` tables
5. Clear existing data (fresh start)

### Phase 2: Conversation Queries

1. Update `ensureConversation(agentId)` to accept `mode` parameter: `ensureConversation(agentId, mode)`
2. Create `getConversationContext(conversationId)` - load context with compaction awareness
3. Create `addToolResultMessage(conversationId, toolCallId, result)`
4. Update `addAssistantMessage` to support `toolCalls` parameter

### Phase 3: Compaction System

1. Create `compactConversation(conversationId)` - generate summary + create summary message
2. Create `generateConversationSummary(messages)` - LLM call to summarize
3. Add compaction trigger after message additions

### Phase 4: Agent Refactor

1. Remove all thread-related code from `Agent` class
2. Replace `runWorkSession()` to use background conversation
3. Update `processTask()` to add messages to background conversation
4. Store tool results as `role='tool'` messages
5. Update knowledge extraction to work from background conversation

### Phase 5: Tool Updates

1. Update `requestInput` to add message to lead's background conversation
2. Update `reportToLead` to add message to lead's background conversation
3. Update `createInboxItem` to also add message to foreground conversation

### Phase 6: Worker Updates

1. Update runner to use background conversations
2. Remove thread creation/management
3. Add compaction checks after work sessions

### Phase 7: Cleanup

1. Remove thread-related files:
   - `src/lib/agents/thread.ts`
   - `src/lib/db/queries/threads.ts`
2. Remove thread exports from index files
3. Update CLAUDE.md documentation

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/lib/db/schema.ts` | Add conversation mode, message fields, remove threads |
| `src/lib/db/queries/conversations.ts` | Add background conversation queries |
| `src/lib/db/queries/messages.ts` | Add tool message, context loading, compaction |
| `src/lib/agents/agent.ts` | Replace thread methods with conversation methods |
| `src/lib/agents/compaction.ts` | NEW: Compaction logic |
| `src/lib/agents/tools/team-lead-tools.ts` | Update createInboxItem |
| `src/lib/agents/tools/subordinate-tools.ts` | Update requestInput, reportToLead |
| `src/lib/agents/knowledge-items.ts` | Extract from background conversation |
| `src/worker/runner.ts` | Use background conversations |
| `src/lib/types.ts` | Update types |
| `CLAUDE.md` | Update documentation |

## Files to Delete

- `src/lib/agents/thread.ts`
- `src/lib/db/queries/threads.ts`

---

## Verification

1. **Build**: `npm run build` passes
2. **Lint**: `npm run lint` passes
3. **Test scenarios**:
   - Foreground chat stores messages correctly
   - Background work stores messages with tool results
   - Compaction creates summary without deleting messages
   - Context loading returns summary + recent messages
   - Subordinate communication appears in lead's background conversation
   - Briefings appear in foreground conversation + inbox
