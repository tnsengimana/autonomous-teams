# Plan: Atomic Conversation Turns + Agent Backoff

## Goal
Ensure conversation turns are saved atomically (user + assistant together) and tasks are only removed from the queue after the turn is persisted. Add agent-level backoff to avoid hot-loop retries for failed tasks. Simplify task status to FIFO-only (no in_progress) under a single-worker-per-agent-queue assumption.

## Scope
- Foreground user messages (API + `Agent.handleUserMessage`).
- Background worker task processing (`Agent.processTask`, `worker/runner`, task queue queries).
- Database schema + queries to support per-agent backoff and simplified task statuses.
- Tests covering atomic turn persistence and retry scheduling.

## Proposed Changes

### 1) Database: per-agent backoff metadata + simplified task statuses
- Add `agents.backoffNextRunAt` (timestamp) to gate retries for any agent.
- Add `agents.backoffAttemptCount` (int, default 0) to compute exponential delay.
- Remove `in_progress` from `agent_tasks.status` (use `pending`, `completed`, `failed` only).
- Update Drizzle schema + create migration.

### 2) Atomic turn persistence helper
- Add a helper in `src/lib/db/queries/messages.ts` (or `src/lib/agents/conversation.ts`) to persist a full turn in a single transaction:
  - Fetch last message in the conversation.
  - Insert user message linked to last.
  - Insert assistant message linked to the user message.
  - Return both messages.
- Use this helper for both foreground and background turns.

### 3) Foreground flow updates
- In `Agent.handleUserMessage`:
  - Build LLM context in memory (history + new user message), without persisting the user message first.
  - Generate the response.
  - Persist user + assistant messages together in a single transaction.
  - Only after persistence succeeds, queue the background task (work_request) and return the response stream.
- Ensure memory extraction uses the persisted assistant message ID.
- If persistence fails, return an error (no partial write), so the user can retry safely.

### 4) Background task flow updates
- In `Agent.processTask`:
  - Build LLM context with task message appended in memory (do not write yet).
  - After response is generated, persist the task message + assistant response + task completion in a single transaction.
  - Only mark task completed once the messages are saved.
- On failures:
  - Do not mark task as failed; instead, update agent backoff state and set `backoffNextRunAt` using exponential backoff (base delay 1 minute, cap 24 hours, add jitter).
  - Keep the task at the head of the queue (FIFO; no task-level retry metadata).
- Remove any transitions to `in_progress`; a task remains `pending` until the turn is persisted.

### 5) Queue selection and agent backoff
- Update worker selection to skip agents with `backoffNextRunAt > now` (agent-level cooldown).
- When a task completes successfully, reset `backoffAttemptCount` to 0 and clear `backoffNextRunAt`.
- When a task fails to persist a full turn, increment `backoffAttemptCount` and set `backoffNextRunAt` to now + computed backoff delay.
- Ensure FIFO is enforced by always selecting the oldest pending task for an agent.

### 6) Tests
- Add tests verifying:
  - Foreground turns persist user + assistant atomically (no orphan user message on failure).
  - Background tasks are not completed until turn saved.
  - Agent backoff updates `backoffNextRunAt` and prevents immediate reprocessing.
- Update existing queue tests to remove `in_progress` cases and ensure pending-only FIFO behavior.

## Risks / Considerations
- Retrying background tasks can trigger duplicate tool side effects; tool calls may need idempotency or to tolerate retries.
- Foreground responses will only be sent after persistence succeeds, which may increase latency slightly.
- Backoff should gate all work (including queued tasks), so agents won’t be processed until `backoffNextRunAt` clears.
- This design assumes a single worker per agent queue; introducing multiple workers would require a larger refactor (locking + background conversation concurrency).

## Rollout
- Apply migration.
- Update code paths and tests.
- Monitor task retry behavior in logs.
