# Plan: Rename Agent `role` to `type` and Update Lead Terminology

## Goal

1. Rename the `role` field on agents to `type`
2. Introduce `AgentType` enum with values `lead` and `subordinate`
3. Change "team lead" terminology to just "lead" across the codebase
4. Rename files with "team-lead" to "lead"

## Current State

- `role` field stores: `'team_lead'`, `'aide_lead'`, or descriptive text
- Lead/subordinate distinction uses `parentAgentId === null` check
- `isTeamLead()` method determines if agent is a lead
- File `team-lead-tools.ts` contains lead-specific tools

## Proposed Changes

### 1) Database Schema + Migration

**File: `src/lib/db/schema.ts`**
- Rename `role: text('role').notNull()` to `type: text('type').notNull()`
- Add comment: `// 'lead' | 'subordinate'`

**File: `drizzle/0004_rename_role_to_type.sql`** (new)
```sql
ALTER TABLE "agents" RENAME COLUMN "role" TO "type";
UPDATE "agents" SET "type" = 'lead' WHERE "type" IN ('team_lead', 'aide_lead');
UPDATE "agents" SET "type" = 'subordinate' WHERE "type" NOT IN ('lead');
```

**File: `drizzle/meta/_journal.json`**
- Add entry for new migration

### 2) Type Definitions

**File: `src/lib/types.ts`**
- Add: `export type AgentType = 'lead' | 'subordinate';`

### 3) File Renames

| Old Path | New Path |
|----------|----------|
| `src/lib/agents/tools/team-lead-tools.ts` | `src/lib/agents/tools/lead-tools.ts` |

### 4) Function/Method Renames

| Location | Old Name | New Name |
|----------|----------|----------|
| `src/lib/agents/agent.ts` | `isTeamLead()` | `isLead()` |
| `src/lib/db/queries/agents.ts` | `getTeamLead()` | `getLead()` |
| `src/lib/db/queries/agents.ts` | `getActiveTeamLeads()` | `getActiveLeads()` |
| `src/lib/db/queries/agents.ts` | `getTeamLeadsDueToRun()` | `getLeadsDueToRun()` |
| `src/lib/agents/tools/lead-tools.ts` | `getTeamLeadTools()` | `getLeadTools()` |
| `src/lib/agents/tools/lead-tools.ts` | `registerTeamLeadTools()` | `registerLeadTools()` |
| `src/lib/agents/tools/index.ts` | `getTeamLeadTools()` | `getLeadTools()` |

### 5) Interface/Property Updates

**File: `src/lib/agents/tools/index.ts`**
- Change `isTeamLead: boolean` to `isLead: boolean` in `ToolContext`

### 6) Constant Renames

**File: `src/lib/agents/agent.ts`**
- Rename `TEAM_LEAD_NEXT_RUN_HOURS` to `LEAD_NEXT_RUN_HOURS`

### 7) Code Updates (replace `role` with `type`)

**API Routes:**
- `src/app/api/teams/route.ts` - Change `role: 'team_lead'` to `type: 'lead'`
- `src/app/api/aides/route.ts` - Change `role: 'aide_lead'` to `type: 'lead'`
- `src/app/api/teams/[id]/agents/route.ts` - Update schema and usage
- `src/app/api/aides/[id]/agents/route.ts` - Update schema and usage
- `src/app/api/aides/[id]/agents/[agentId]/route.ts` - Update schema

**Query Functions:**
- `src/lib/db/queries/agents.ts` - Update all `role` references to `type`

**Agent Class:**
- `src/lib/agents/agent.ts` - Change `this.role` to `this.type`, update all usages

**UI Components:**
- `src/app/(dashboard)/teams/[id]/page.tsx` - Update `teamLead.role` to display-friendly text
- `src/app/(dashboard)/teams/[id]/agents/[agentId]/page.tsx` - Update role display
- `src/app/(dashboard)/aides/[id]/agents/[agentId]/page.tsx` - Update role display
- Edit/new agent forms - Remove role input field (type is determined by parentAgentId)

### 8) Comment/String Updates

Files with "team lead" text to update to "lead":
- `src/lib/agents/tools/lead-tools.ts` (after rename)
- `src/lib/agents/tools/subordinate-tools.ts`
- `src/lib/agents/tools/index.ts`
- `src/lib/agents/agent.ts`
- `src/lib/db/queries/agents.ts`
- `src/worker/runner.ts`
- `CLAUDE.md`

### 9) Test Updates

- `src/lib/agents/__tests__/agent.test.ts` - Update variable names, function calls
- `src/worker/__tests__/runner.test.ts` - Update variable names, function calls
- `src/lib/db/__tests__/aides.test.ts` - Update `role` to `type`
- `src/lib/db/__tests__/schema.test.ts` - Update tests
- `src/app/api/__tests__/api.test.ts` - Update variable names

### 10) Files NOT to Change

- `docs/plans/*.md` - Historical documents, leave as-is

## UI Considerations

The UI currently displays `{teamLead.role}` which shows "team_lead". After this change:
- Remove the role display since `type` is either `lead` or `subordinate` (redundant with section headers)
- Or display a human-friendly label like "Lead Agent" / "Subordinate"

## Verification

1. Run `npx drizzle-kit migrate` to apply schema changes
2. Run `npm run test:run` - all 233 tests should pass
3. Run `npm run build` - no TypeScript errors
4. Test UI: Create team, view agents, verify display is correct
5. Test worker: Ensure leads are still scheduled correctly
