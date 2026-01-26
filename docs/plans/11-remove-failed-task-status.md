# Plan: Remove Failed Task Status

## Goal
Remove `failed` from `agent_tasks.status` so tasks remain `pending` until completed, aligning with FIFO-only queues and atomic turn persistence.

## Scope
- Schema + migration changes for `agent_tasks.status` comment/type usage.
- Query helpers and agent/task flow code paths that reference `failed`.
- Tests that assert failed status or transitions.

## Steps
1) Update schema and types to remove `failed` from `AgentTaskStatus` and any status comments.
2) Remove or adjust any code paths that set status to `failed` (e.g., `failTask`, `completeTask` default). Keep tasks pending on errors.
3) Update tests to remove failed status expectations or rewrite to assert pending remains when failures occur.
4) Add migration note to reconcile any existing `failed` rows (e.g., update to `pending`) if needed.

## Risks / Considerations
- Tasks will remain pending indefinitely on persistent errors; worker backoff should prevent hot looping.
- Tooling that reports failed tasks will need to be removed or reinterpreted.
