# Plan 26: Agent Detail Layout Revamp

## Context

The agent detail area (`/agents/[id]/...`) currently has no shared layout — each sub-page is standalone with its own back links, headers, and auth checks. This makes navigation between agent pages feel disconnected and requires redundant boilerplate in every page. Additionally, there are no pages to inspect graph node types and edge types.

This plan introduces a two-panel layout with a persistent sidebar navigation and content area, plus two new pages for graph type inspection.

## Target Layout

```
┌─────────────────────────────────────────────────────────────┐
│ Back to Agents                                              │
│ Agent Name                                                  │
├──────────────────┬──────────────────────────────────────────┤
│                  │                                          │
│  Details         │                                          │
│  Open Chat       │                                          │
│  Worker Iter.    │     Content of selected page             │
│  Knowledge Graph │                                          │
│  Graph Node Types│                                          │
│  Graph Edge Types│                                          │
│                  │                                          │
└──────────────────┴──────────────────────────────────────────┘
```

## Phases

### Phase 1: Create agent detail sidebar nav component

**Create** `src/components/agent-detail-nav.tsx`

Client component (`"use client"`) following the pattern of `src/components/nav.tsx`. Uses `usePathname()` for active state detection. Nav items:

- Details (`/agents/${agentId}`) — exact match only
- Open Chat (`/agents/${agentId}/chat`)
- Worker Iterations (`/agents/${agentId}/worker-iterations`)
- Knowledge Graph (`/agents/${agentId}/knowledge-graph`)
- Graph Node Types (`/agents/${agentId}/graph-node-types`)
- Graph Edge Types (`/agents/${agentId}/graph-edge-types`)

Uses `Button` with `variant="secondary"` for active, `variant="ghost"` for inactive.

### Phase 2: Create the agent detail layout

**Create** `src/app/(dashboard)/agents/[id]/layout.tsx`

Async server component that:
- Authenticates via `auth()`, redirects if no session
- Fetches agent via `getAgentById(id)`, calls `notFound()` if missing or wrong user
- Renders: "Back to Agents" link, agent name `<h1>`, then a `flex` container with `<AgentDetailNav>` sidebar (left) and `{children}` (right)

### Phase 3: Simplify existing pages

Since the layout now handles auth, back links, and agent name:

**Modify** `src/app/(dashboard)/agents/[id]/page.tsx` (Details):
- Remove back link, agent name heading, quick action buttons (sidebar replaces them)
- Keep `AgentActions` (Edit/Pause/Delete), mission card, stats card
- Still fetches agent for its data (purpose, isActive, etc.) but skip auth check

**Modify** `src/app/(dashboard)/agents/[id]/chat/page.tsx`:
- Remove auth check and ownership verification

**Modify** `src/app/(dashboard)/agents/[id]/chat/chat-view.tsx`:
- Remove back link and "Chat with {name}" header
- Adjust height calc to account for layout header

**Modify** `src/app/(dashboard)/agents/[id]/knowledge-graph/page.tsx`:
- Remove auth check, back link, heading
- Adjust height calc

**Modify** `src/app/(dashboard)/agents/[id]/worker-iterations/page.tsx`:
- Remove back link, heading, description

### Phase 4: Create new graph type pages

**Create** `src/app/(dashboard)/agents/[id]/graph-node-types/page.tsx`

Server component. Calls `getNodeTypesByAgent(id)` from `src/lib/db/queries/graph-types.ts`. Renders card list with: name, description, badges (Global/Agent-specific, createdBy), collapsible propertiesSchema JSON, optional exampleProperties. Empty state card if no types.

**Create** `src/app/(dashboard)/agents/[id]/graph-edge-types/page.tsx`

Server component. Calls `getEdgeTypesByAgent(id)` from `src/lib/db/queries/graph-types.ts` (returns with populated sourceNodeTypes/targetNodeTypes). Renders card list with: name, description, source/target constraints display, badges, collapsible propertiesSchema.

### Phase 5: Test and adjust heights

After all changes, verify in browser:
- Chat page fills available height correctly
- Knowledge graph visualization fills available space
- Worker iterations scrolls properly
- New graph type pages render correctly
- Sidebar navigation highlights correctly on each page

## Key files

| File | Action |
|------|--------|
| `src/components/agent-detail-nav.tsx` | CREATE |
| `src/app/(dashboard)/agents/[id]/layout.tsx` | CREATE |
| `src/app/(dashboard)/agents/[id]/page.tsx` | MODIFY |
| `src/app/(dashboard)/agents/[id]/chat/page.tsx` | MODIFY |
| `src/app/(dashboard)/agents/[id]/chat/chat-view.tsx` | MODIFY |
| `src/app/(dashboard)/agents/[id]/knowledge-graph/page.tsx` | MODIFY |
| `src/app/(dashboard)/agents/[id]/worker-iterations/page.tsx` | MODIFY |
| `src/app/(dashboard)/agents/[id]/graph-node-types/page.tsx` | CREATE |
| `src/app/(dashboard)/agents/[id]/graph-edge-types/page.tsx` | CREATE |

## Existing code to reuse

- `src/components/nav.tsx` — Pattern for sidebar nav (usePathname, Button variants, cn)
- `src/app/(dashboard)/layout.tsx` — Pattern for auth + sidebar + content layout
- `src/lib/db/queries/graph-types.ts` — `getNodeTypesByAgent()`, `getEdgeTypesByAgent()` (no new queries needed)
- `src/lib/db/queries/agents.ts` — `getAgentById()`

## Verification

1. Navigate to `/agents/[id]` — should show two-panel layout with Details content
2. Click each sidebar link — content area updates, active link highlights
3. Chat page renders within the layout, fills available space
4. Knowledge graph 3D visualization renders correctly in the content area
5. Worker iterations page shows iteration list without redundant headers
6. Graph Node Types page lists all node types with schemas
7. Graph Edge Types page lists all edge types with constraints
8. "Back to Agents" link works from any sub-page
9. TypeScript compiles clean
