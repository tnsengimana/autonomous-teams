# Plan: Briefings Overhaul

## Context
Briefings today are created via `createInboxItem` and the full message is appended to the foreground conversation. Briefing decisions are made via `generateLLMObject` outside the background conversation, so the decision isn’t captured in the background log and isn’t tool-driven. The product requirement is to:
- Store briefings in a dedicated table.
- Trigger briefing creation via a tool call from the background conversation after the task queue is drained.
- Avoid foreground conversation writes; the user reads briefings via inbox notifications and `/teams|aides/<id>/briefings/<id>`.
- Make briefing creation optional and rare; the prompt must strongly bias toward skipping unless the update is material.

## Goals
- Create a `briefings` table to store full briefing content plus metadata.
- Add a `createBriefing` tool that writes to `briefings` and creates an inbox item (summary only), without touching the foreground conversation.
- Run briefing decisions as a background conversation turn (with tool calling) after all queued tasks are processed.
- Update UI/UX and APIs so inbox notifications link to briefing pages.
- Preserve knowledge extraction behavior, but run it **after** the briefing decision turn is appended to the background conversation.

## Non-goals
- Redesigning the inbox UI beyond necessary changes for linking to briefings.
- Retrofitting historical inbox items into the new briefings table (no backfill; existing data can be dropped).

## Plan
1. **Data model + migrations**
   - Add `briefings` table in `src/lib/db/schema.ts` with: `id`, `userId`, `teamId`/`aideId`, `agentId`, `title`, `summary`, `content`, and timestamps.
   - Add `briefingId` nullable FK to `inbox_items` to link notifications to briefings.
   - Add indexes for `briefings.userId`, and optionally `briefings.teamId`/`briefings.aideId`.
   - Add Drizzle migration and update types in `src/lib/types.ts`.
   - Add DB query helpers in `src/lib/db/queries/briefings.ts`.

2. **Tooling: createBriefing**
   - Add a `createBriefing` tool (likely in `src/lib/agents/tools/lead-tools.ts`) with params `{ title, summary, fullMessage }`.
   - Tool behavior: create `briefings` row + `inbox_items` row (type `briefing`, content = summary, briefingId set) in a single transaction. No foreground conversation writes.
   - Update tool registry (`src/lib/agents/tools/index.ts`) to include `createBriefing` and `requestUserInput` (feedback) for leads.

3. **Briefing decision as a background conversation turn**
   - Replace `generateLLMObject` flow in `decideBriefing` with a tool-driven prompt using `streamLLMResponseWithTools`.
   - Build a dedicated prompt that:
     - Summarizes recent background work.
     - Includes recent briefings (e.g., last 5) to avoid repetition.
    - Explicitly instructs the model to *avoid* briefings unless there is material progress or a significant insight the user should act on.
   - Append this turn to the background conversation (persist user + assistant/tool messages via `createTurnMessagesInTransaction`).
   - Update `runWorkSession` flow to call this briefing-decision turn **before** knowledge extraction, and only for leads.

4. **UI + API updates for briefings**
   - Add new pages: `src/app/(dashboard)/teams/[id]/briefings/[briefingId]/page.tsx` and `src/app/(dashboard)/aides/[id]/briefings/[briefingId]/page.tsx`.
   - Add query helpers for reading briefings with auth checks (owner + user).
   - Update inbox API responses to include `briefingId` when present.
   - Update inbox UI to link briefings to the briefing detail page (replace “View Conversation” for briefings). Handle legacy briefing items without `briefingId` gracefully.

5. **Tests + mock behavior**
   - Update `decideBriefing` tests to assert no foreground conversation writes and to cover briefings stored in the new table.
   - Add tests for `createBriefing` tool (inserts briefing + inbox item).
   - Ensure mock LLM behavior doesn’t accidentally create briefings unless explicitly intended.

## Open Questions
- None currently.
