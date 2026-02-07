# Plan 27: Layout Restructure & Client-Rendered Subpages

## Context

The current agent detail layout places "Back to Agents", the page title, and actions in a single header row spanning the full width above both the sidebar and content area. The user wants the sidebar (with back link + nav) and content area to be visually distinct columns, with the title and actions living inside the content column's own header. Additionally, some subpages are server-rendered while others are client-rendered, creating inconsistency and unnecessary complexity (Date serialization, paired server/client files). Since this is a dashboard behind auth with no SEO benefit from SSR, converting all subpages to client-rendered simplifies the codebase.

## Phase 1: Layout Restructure

**Modify** `src/app/(dashboard)/agents/[id]/layout.tsx`

Current structure:
```
[Back to Agents] [AgentName - SubPage (centered)] [Actions]
[Sidebar Nav           ] [Content                         ]
```

New structure:
```
[Back to Agents        ] [AgentName - SubPage] [Actions   ]
[  Details             ] [                                 ]
[  Open Chat           ] [  (page content)                 ]
[  Worker Iterations   ] [                                 ]
[  ...                 ] [                                 ]
```

- Move "Back to Agents" link into the sidebar, above `AgentDetailNav`
- Move `AgentDetailTitle` + `AgentHeaderActionsSlot` into a header row inside the content column
- Change outer wrapper from stacked (`space-y-4`) to side-by-side (`flex gap-6`)

No changes needed to `AgentDetailTitle`, `AgentDetailNav`, or `AgentHeaderActions` components.

## Phase 2: New API Routes

Create two API routes following the existing pattern in `src/app/api/agents/[id]/worker-iterations/route.ts` (auth, ownership check, query, JSON response).

| Route | File | DB Query |
|-------|------|----------|
| `GET /api/agents/[id]/graph-node-types` | `src/app/api/agents/[id]/graph-node-types/route.ts` | `getNodeTypesByAgent()` |
| `GET /api/agents/[id]/graph-edge-types` | `src/app/api/agents/[id]/graph-edge-types/route.ts` | `getEdgeTypesByAgent()` |

Both from `src/lib/db/queries/graph-types.ts`. `NextResponse.json()` auto-serializes Dates.

## Phase 3: Convert All Subpages to Client-Rendered

All pages follow the established pattern from `worker-iterations/page.tsx`: `"use client"`, `useParams()`, `useCallback` fetch, `useState` for loading/error/data, `AutoRefresh` with `onRefresh`.

### 3a: Details Page
**Rewrite** `src/app/(dashboard)/agents/[id]/page.tsx`

- Fetch from existing `GET /api/agents/${agentId}`
- Render mission card + stats card (same UI)
- Inject `AgentActions` into header via `<AgentHeaderActions>`
- Add `<AutoRefresh onRefresh={...} />`

### 3b: Graph Node Types Page
**Rewrite** `src/app/(dashboard)/agents/[id]/graph-node-types/page.tsx`

- Merge `node-types-list.tsx` UI into the page (single file)
- Fetch from new `GET /api/agents/${agentId}/graph-node-types`
- `<AutoRefresh onRefresh={loadNodeTypes} />`

### 3c: Graph Edge Types Page
**Rewrite** `src/app/(dashboard)/agents/[id]/graph-edge-types/page.tsx`

- Merge `edge-types-list.tsx` UI into the page (single file)
- Fetch from new `GET /api/agents/${agentId}/graph-edge-types`
- `<AutoRefresh onRefresh={loadEdgeTypes} />`

### 3d: Chat Page
**Rewrite** `src/app/(dashboard)/agents/[id]/chat/page.tsx`

- Fetch from existing `GET /api/agents/${agentId}` to get `name` + `conversationSystemPrompt`
- Render `<AgentChatView>` with same props once loaded
- `chat-view.tsx` unchanged (already client, already handles its own header actions)

### 3e: Knowledge Graph Page
**Rewrite** `src/app/(dashboard)/agents/[id]/knowledge-graph/page.tsx`

- Fetch from existing `GET /api/agents/${agentId}` to get `agent.name` for description
- Render `<KnowledgeGraphView>` with agentId (already fetches its own data + has AutoRefresh)

## Phase 4: Cleanup

- **Delete** `src/app/(dashboard)/agents/[id]/graph-node-types/node-types-list.tsx` (merged into page)
- **Delete** `src/app/(dashboard)/agents/[id]/graph-edge-types/edge-types-list.tsx` (merged into page)

## Files Summary

| File | Action |
|------|--------|
| `src/app/(dashboard)/agents/[id]/layout.tsx` | Modify |
| `src/app/api/agents/[id]/graph-node-types/route.ts` | Create |
| `src/app/api/agents/[id]/graph-edge-types/route.ts` | Create |
| `src/app/(dashboard)/agents/[id]/page.tsx` | Rewrite |
| `src/app/(dashboard)/agents/[id]/graph-node-types/page.tsx` | Rewrite |
| `src/app/(dashboard)/agents/[id]/graph-edge-types/page.tsx` | Rewrite |
| `src/app/(dashboard)/agents/[id]/chat/page.tsx` | Rewrite |
| `src/app/(dashboard)/agents/[id]/knowledge-graph/page.tsx` | Rewrite |
| `src/app/(dashboard)/agents/[id]/graph-node-types/node-types-list.tsx` | Delete |
| `src/app/(dashboard)/agents/[id]/graph-edge-types/edge-types-list.tsx` | Delete |

Reference files (patterns to follow):
- `src/app/(dashboard)/agents/[id]/worker-iterations/page.tsx` — client page pattern
- `src/app/api/agents/[id]/worker-iterations/route.ts` — API route pattern
- `src/lib/db/queries/graph-types.ts` — DB queries to expose

## Verification

1. TypeScript compiles clean (`npx tsc --noEmit`)
2. Tests pass (`npx vitest run`)
3. Browser: two-column layout with back link in sidebar, title + actions in content header
4. Each subpage loads data, shows loading state, renders correctly
5. Auto-refresh works on all subpages (60s interval)
6. Manual Refresh button works on Worker Iterations, Knowledge Graph, Graph Node/Edge Types
7. Page-specific actions render correctly: Edit/Pause/Delete on Details, View System Prompt on Chat
