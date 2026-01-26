# Plan 12: Shared Agent Components

## Problem

10 route files between `/teams/[id]/agents/*` and `/aides/[id]/agents/*` have ~92% code duplication (645 lines shared). Each pair differs only in:
- Import: `getTeamById` vs `getAideById`
- Variable: `team` vs `aide`
- Foreign key: `agent.teamId` vs `agent.aideId`
- URL paths: `/teams/...` vs `/aides/...`
- Labels: "Team" vs "Aide"

## Solution

Extract shared components to `src/components/agents/`, keep route files as thin wrappers (~20-30 lines each).

## Core Interface

```typescript
// src/components/agents/types.ts
export type AgentOwnerType = "team" | "aide";

export interface AgentOwnerContext {
  type: AgentOwnerType;
  id: string;
  name: string;
}
```

## File Structure

```
src/components/agents/
├── index.ts                    # Barrel export
├── types.ts                    # AgentOwnerType, AgentOwnerContext
├── utils.ts                    # formatRelativeDate, badge variants, path builders
├── AgentDetailView.tsx         # Server Component (~100 lines)
├── AgentChatView.tsx           # Server Component (~35 lines)
├── AgentInspectView.tsx        # Server Component (~35 lines)
├── AgentEditForm.tsx           # Client Component (~95 lines)
├── AgentNewForm.tsx            # Client Component (~85 lines)
├── KnowledgeItemsList.tsx      # Server Component (~50 lines)
└── MemoriesList.tsx            # Server Component (~50 lines)
```

## Implementation Tasks

### Task 1: Foundation Files
Create `types.ts`, `utils.ts`, `index.ts`

**types.ts:**
- `AgentOwnerType = "team" | "aide"`
- `AgentOwnerContext { type, id, name }`

**utils.ts:**
- `formatRelativeDate(date: Date): string`
- `getMemoryTypeBadgeVariant(type): BadgeVariant`
- `getKnowledgeTypeBadgeVariant(type): BadgeVariant`
- `buildAgentPath(owner, agentId, suffix?): string`
- `buildOwnerPath(owner): string`
- `getOwnerLabel(type): string`

### Task 2: Support Components
Create `KnowledgeItemsList.tsx` and `MemoriesList.tsx`

Extract from existing `page.tsx` files - these render the ScrollArea with items.

### Task 3: Server View Components
Create `AgentDetailView.tsx`, `AgentChatView.tsx`, `AgentInspectView.tsx`

**AgentDetailView props:**
```typescript
interface AgentDetailViewProps {
  owner: AgentOwnerContext;
  agent: Agent;
  memories: Memory[];
  knowledgeItems: KnowledgeItem[];
}
```

**AgentChatView/InspectView props:**
```typescript
interface AgentChatViewProps {
  owner: AgentOwnerContext;
  agent: Agent;
}
```

Chat component receives `teamId` or `aideId` via spread:
```typescript
<Chat
  {...(owner.type === "team" ? { teamId: owner.id } : { aideId: owner.id })}
  agentId={agent.id}
/>
```

### Task 4: Client Form Components
Create `AgentEditForm.tsx` and `AgentNewForm.tsx`

**Props pattern:**
```typescript
interface AgentEditFormProps {
  ownerType: AgentOwnerType;
  ownerId: string;
  agentId: string;
}
```

These handle their own data fetching via `useEffect` and API calls.

### Task 5: Migrate Route Files
Update all 10 route files to use shared components.

**Example thin wrapper (teams detail page):**
```typescript
import { AgentDetailView } from "@/components/agents";

export default async function AgentDetailPage({ params }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const { id, agentId } = await params;

  const team = await getTeamById(id);
  if (!team || team.userId !== session.user.id) notFound();

  const agent = await getAgentById(agentId);
  if (!agent || agent.teamId !== id) notFound();

  const [memories, knowledgeItems] = await Promise.all([
    getRecentMemories(agentId, 20),
    getRecentKnowledgeItems(agentId, 20),
  ]);

  return (
    <AgentDetailView
      owner={{ type: "team", id: team.id, name: team.name }}
      agent={agent}
      memories={memories}
      knowledgeItems={knowledgeItems}
    />
  );
}
```

## Files to Modify

**New files (10):**
- `src/components/agents/types.ts`
- `src/components/agents/utils.ts`
- `src/components/agents/index.ts`
- `src/components/agents/KnowledgeItemsList.tsx`
- `src/components/agents/MemoriesList.tsx`
- `src/components/agents/AgentDetailView.tsx`
- `src/components/agents/AgentChatView.tsx`
- `src/components/agents/AgentInspectView.tsx`
- `src/components/agents/AgentEditForm.tsx`
- `src/components/agents/AgentNewForm.tsx`

**Modified files (10):**
- `src/app/(dashboard)/teams/[id]/agents/[agentId]/page.tsx`
- `src/app/(dashboard)/teams/[id]/agents/[agentId]/chat/page.tsx`
- `src/app/(dashboard)/teams/[id]/agents/[agentId]/edit/page.tsx`
- `src/app/(dashboard)/teams/[id]/agents/[agentId]/inspect/page.tsx`
- `src/app/(dashboard)/teams/[id]/agents/new/page.tsx`
- `src/app/(dashboard)/aides/[id]/agents/[agentId]/page.tsx`
- `src/app/(dashboard)/aides/[id]/agents/[agentId]/chat/page.tsx`
- `src/app/(dashboard)/aides/[id]/agents/[agentId]/edit/page.tsx`
- `src/app/(dashboard)/aides/[id]/agents/[agentId]/inspect/page.tsx`
- `src/app/(dashboard)/aides/[id]/agents/new/page.tsx`

## Line Count Impact

| Before | After |
|--------|-------|
| 1,378 lines (10 route files) | ~208 lines (10 thin wrappers) |
| 0 lines (shared components) | ~545 lines (10 shared components) |
| **Total: 1,378 lines** | **Total: 753 lines** |

**Net reduction: ~625 lines** with better maintainability.

## Verification

1. Run `npm run build` - should compile without errors
2. Run `npm test` - all tests should pass
3. Run `npm run lint` - no new lint errors
4. Manual testing:
   - Navigate to `/teams/[id]/agents/[agentId]` - detail page renders
   - Navigate to `/aides/[id]/agents/[agentId]` - detail page renders
   - Test chat, inspect, edit, new pages for both teams and aides
   - Verify all links navigate correctly
   - Verify forms submit to correct API endpoints

## Patterns to Follow

- `src/components/chat/Chat.tsx` - `teamId?/aideId?` optional props pattern
- `src/components/entity-actions.tsx` - `EntityType` discriminated union pattern
