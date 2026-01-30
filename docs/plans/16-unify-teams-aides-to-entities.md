# Plan: Unify Teams and Aides into Entities

## Overview

Replace separate `teams` and `aides` tables with a single `entities` table that has a `type` field ('team' | 'aide'). This eliminates code duplication across the database, API, and UI layers.

**Note**: No data migration needed - database will be reset.

## Current State

- **teams table**: id, userId, name, purpose, status, timestamps
- **aides table**: id, userId, name, purpose, status, timestamps (identical structure)
- **agents/briefings/agentTasks**: Have nullable `teamId` and `aideId` columns (exactly one set)
- **UI**: Parallel `/teams/*` and `/aides/*` pages
- **Nav**: Separate "Teams" and "Aides" links

## Target State

- Single `entities` table with `type: 'team' | 'aide'`
- Single `entityId` foreign key in agents, briefings, agentTasks
- Single `/entities` URL with type filtering
- Single "Entities" nav link
- Type selector during entity creation

---

## Phase 1: Database Schema

### Step 1.1: Update schema.ts

**File**: `src/lib/db/schema.ts`

- Remove `teams` and `aides` table definitions
- Add `entities` table with `type` field ('team' | 'aide')
- Replace `teamId`/`aideId` with `entityId` in agents, briefings, agentTasks
- Update all relations

```typescript
export const entities = pgTable('entities', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'team' | 'aide'
  name: text('name').notNull(),
  purpose: text('purpose'),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
}, (table) => [
  index('entities_user_id_idx').on(table.userId),
  index('entities_type_idx').on(table.type),
]);
```

### Step 1.2: Generate and apply migration

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

---

## Phase 2: Query Layer

### Step 2.1: Create entities queries

**New file**: `src/lib/db/queries/entities.ts`

Functions to implement:
- `createEntity(data: { userId, type, name, purpose?, status? })`
- `getEntityById(entityId)`
- `getEntityWithAgents(entityId)`
- `getEntitiesByUserId(userId, type?)`
- `getActiveEntitiesByUserId(userId, type?)`
- `updateEntity(entityId, data)`
- `deleteEntity(entityId)`
- `getEntityUserId(entityId)`
- `getEntityLead(entityId)` - get lead agent for entity

### Step 2.2: Update agents queries

**File**: `src/lib/db/queries/agents.ts`

- Add `createAgentForEntity(data)`
- Add `getAgentsByEntityId(entityId)`
- Update `getActiveLeads()` to use entityId
- Deprecate team/aide-specific functions

---

## Phase 3: API Consolidation

### Step 3.1: Create entities API routes

**New files**:
- `src/app/api/entities/route.ts` - GET (list with ?type filter), POST (create)
- `src/app/api/entities/[id]/route.ts` - GET, PATCH, DELETE
- `src/app/api/entities/[id]/agents/route.ts` - POST (create subordinate)
- `src/app/api/entities/[id]/agents/[agentId]/route.ts` - GET, PATCH

### Step 3.2: Update messages API

**File**: `src/app/api/messages/route.ts`

- Accept `entityId` instead of `teamId`/`aideId`
- Keep backwards compatibility temporarily

### Step 3.3: Update agent runtime

**File**: `src/lib/agents/agent.ts`

- Update constructor to use `entityId`
- Change `getOwnerInfo()` to return `{ entityId: string }`
- Update `runWorkSession()` and related methods

### Step 3.4: Update task queue

**File**: `src/lib/agents/taskQueue.ts`

- Change `TaskOwnerInfo` to `{ entityId: string }`
- Update all queue functions

### Step 3.5: Update lead tools

**File**: `src/lib/agents/tools/lead-tools.ts`

- Update `getOwnerInfo()` helper
- Update createBriefing, delegateToAgent to use entityId

### Step 3.6: Update worker

**File**: `src/worker/runner.ts`

- Update `getAllLeadsDueToRun()` to query via entities
- Update `getAgentsWithPendingTasks()` to use entityId

---

## Phase 4: UI Consolidation

### Step 4.1: Create entity pages

**New files**:
- `src/app/(dashboard)/entities/page.tsx` - List all entities with type tabs/filter
- `src/app/(dashboard)/entities/new/page.tsx` - Create with type selector dropdown
- `src/app/(dashboard)/entities/[id]/page.tsx` - Entity detail
- `src/app/(dashboard)/entities/[id]/agents/new/page.tsx`
- `src/app/(dashboard)/entities/[id]/agents/[agentId]/page.tsx`
- `src/app/(dashboard)/entities/[id]/agents/[agentId]/chat/page.tsx`
- `src/app/(dashboard)/entities/[id]/agents/[agentId]/inspect/page.tsx`
- `src/app/(dashboard)/entities/[id]/agents/[agentId]/edit/page.tsx`
- `src/app/(dashboard)/entities/[id]/agents/[agentId]/tasks/page.tsx`
- `src/app/(dashboard)/entities/[id]/briefings/[briefingId]/page.tsx`

### Step 4.2: Update navigation

**File**: `src/components/nav.tsx`

Change navItems:
```typescript
const navItems = [
  { href: "/inbox", label: "Inbox" },
  { href: "/entities", label: "Entities" },
  { href: "/settings", label: "Settings" },
];
```

### Step 4.3: Update shared components

**Files**:
- `src/components/entity-actions.tsx` - Use entityId
- `src/components/agents/types.ts` - Update `AgentOwnerContext` to use entityId
- `src/components/agents/utils.ts` - Update path builders

### Step 4.4: Update inbox

**File**: `src/app/(dashboard)/inbox/page.tsx`

- Update to link to `/entities/[id]` instead of `/teams/[id]` or `/aides/[id]`

---

## Phase 5: Cleanup

### Step 5.1: Remove old files

Delete:
- `src/lib/db/queries/teams.ts`
- `src/lib/db/queries/aides.ts`
- `src/app/api/teams/*`
- `src/app/api/aides/*`
- `src/app/(dashboard)/teams/*`
- `src/app/(dashboard)/aides/*`
- `src/lib/agents/team-configuration.ts`
- `src/lib/agents/aide-configuration.ts`

### Step 5.2: Create entity configuration

**New file**: `src/lib/agents/entity-configuration.ts`

Merge logic from team-configuration.ts and aide-configuration.ts into a single file that handles both entity types.

---

## Critical Files

| File | Changes |
|------|---------|
| `src/lib/db/schema.ts` | Add entities table, entityId columns |
| `src/lib/db/queries/entities.ts` | New - unified query layer |
| `src/lib/db/queries/agents.ts` | Add entity-based functions |
| `src/lib/agents/agent.ts` | Use entityId instead of teamId/aideId |
| `src/lib/agents/taskQueue.ts` | Use entityId in task owner |
| `src/lib/agents/tools/lead-tools.ts` | Update owner helpers |
| `src/worker/runner.ts` | Query leads via entities |
| `src/app/api/entities/*` | New API routes |
| `src/app/(dashboard)/entities/*` | New UI pages |
| `src/components/nav.tsx` | Single "Entities" link |

---

## Verification

1. **Database**: Run migrations successfully
2. **API**: Test CRUD operations via `/api/entities`
3. **UI**: Create entity of each type, verify display
4. **Agents**: Verify agent creation and association with entities
5. **Worker**: Start worker, verify leads are picked up correctly
6. **Briefings**: Verify briefings link to correct entity
7. **Inbox**: Verify inbox items show entity names and link correctly

```bash
# Start services
docker compose up

# Verify in browser
# - Navigate to /entities
# - Create a team-type entity
# - Create an aide-type entity
# - Verify agents can be added
# - Chat with an agent
# - Check inbox for briefings
```
