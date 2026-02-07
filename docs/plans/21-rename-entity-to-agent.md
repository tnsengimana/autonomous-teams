# Plan 21: Rename Entity to Agent

## Overview

Rename the "entity" concept to "agent" throughout the entire codebase. This includes database tables, columns, foreign keys, TypeScript types, React components, API routes, file names, and all references in code and comments.

**Note**: No data migration is needed - the database will be nuked and recreated.

## Scope

### Database Schema (`src/lib/db/schema.ts`)

| Current | New |
|---------|-----|
| `entities` table | `agents` table |
| `entityId` columns (9 tables) | `agentId` columns |
| `entitiesRelations` | `agentsRelations` |
| All `entity` relations in other tables | `agent` relations |
| Index names with `entity` | Index names with `agent` |

**Tables with `entityId` foreign key to rename:**
- `conversations.entityId` → `agentId`
- `memories.entityId` → `agentId`
- `inboxItems.entityId` → `agentId`
- `workerIterations.entityId` → `agentId`
- `llmInteractions.entityId` → `agentId`
- `graphNodeTypes.entityId` → `agentId`
- `graphEdgeTypes.entityId` → `agentId`
- `graphNodes.entityId` → `agentId`
- `graphEdges.entityId` → `agentId`

### TypeScript Types (`src/lib/types.ts`)

| Current | New |
|---------|-----|
| `Entity` type | `Agent` type |
| `EntityStatus` type | `AgentStatus` type |
| `entityId` fields in interfaces | `agentId` fields |

### File Renames

| Current Path | New Path |
|--------------|----------|
| `src/lib/db/queries/entities.ts` | `src/lib/db/queries/agents.ts` |
| `src/lib/llm/entity-configuration.ts` | `src/lib/llm/agent-configuration.ts` |
| `src/components/entity-actions.tsx` | `src/components/agent-actions.tsx` |
| `src/app/api/entities/` | `src/app/api/agents/` |
| `src/app/api/conversations/[entityId]/` | `src/app/api/conversations/[agentId]/` |
| `src/app/(dashboard)/entities/` | `src/app/(dashboard)/agents/` |

### API Routes

| Current Route | New Route |
|---------------|-----------|
| `GET/POST /api/entities` | `GET/POST /api/agents` |
| `GET/PATCH/DELETE /api/entities/[id]` | `GET/PATCH/DELETE /api/agents/[id]` |
| `GET /api/entities/[id]/worker-iterations` | `GET /api/agents/[id]/worker-iterations` |
| `GET /api/entities/[id]/knowledge-graph` | `GET /api/agents/[id]/knowledge-graph` |
| `GET /api/conversations/[entityId]` | `GET /api/conversations/[agentId]` |

### Dashboard Routes

| Current Route | New Route |
|---------------|-----------|
| `/entities` | `/agents` |
| `/entities/new` | `/agents/new` |
| `/entities/[id]` | `/agents/[id]` |
| `/entities/[id]/chat` | `/agents/[id]/chat` |
| `/entities/[id]/worker-iterations` | `/agents/[id]/worker-iterations` |
| `/entities/[id]/knowledge-graph` | `/agents/[id]/knowledge-graph` |

### Query Functions to Rename

**In `src/lib/db/queries/agents.ts` (was entities.ts):**
- `createEntity()` → `createAgent()`
- `getEntityById()` → `getAgentById()`
- `getEntitiesByUserId()` → `getAgentsByUserId()`
- `getActiveEntitiesByUserId()` → `getActiveAgentsByUserId()`
- `getActiveEntities()` → `getActiveAgents()`
- `updateEntity()` → `updateAgent()`
- `updateEntityStatus()` → `updateAgentStatus()`
- `activateEntity()` → `activateAgent()`
- `deleteEntity()` → `deleteAgent()`
- `getEntityUserId()` → `getAgentUserId()`

**In other query files (parameter/variable renames):**
- `entityId` parameters → `agentId`
- `getLatestConversation(entityId)` → `getLatestConversation(agentId)`
- `getConversationsByEntityId()` → `getConversationsByAgentId()`
- `getMemoriesByEntityId()` → `getMemoriesByAgentId()`
- `deleteEntityMemories()` → `deleteAgentMemories()`
- `getInboxItemsByEntityId()` → `getInboxItemsByAgentId()`
- `getLLMInteractionsByEntity()` → `getLLMInteractionsByAgent()`
- `getNodeTypesByEntity()` → `getNodeTypesByAgent()`
- `getEdgeTypesByEntity()` → `getEdgeTypesByAgent()`
- `getNodesByEntity()` → `getNodesByAgent()`
- `getEdgesByEntity()` → `getEdgesByAgent()`
- `getGraphStats(entityId)` → `getGraphStats(agentId)`

### LLM Module Renames

**In `src/lib/llm/agent-configuration.ts` (was entity-configuration.ts):**
- `EntityConfigurationSchema` → `AgentConfigurationSchema`
- `EntityConfiguration` type → `AgentConfiguration`
- `generateEntityConfiguration()` → `generateAgentConfiguration()`

**In `src/lib/llm/tools/index.ts`:**
- `ToolContext.entityId` → `ToolContext.agentId`

**In other LLM files:**
- `buildGraphContextBlock(entityId)` → `buildGraphContextBlock(agentId)`
- `getActiveConversation(entityId)` → `getActiveConversation(agentId)`
- `startNewConversation(entityId)` → `startNewConversation(agentId)`
- `getCurrentConversation(entityId)` → `getCurrentConversation(agentId)`
- `initializeTypesForEntity()` → `initializeTypesForAgent()`
- `initializeAndPersistTypesForEntity()` → `initializeAndPersistTypesForAgent()`

### Component Renames

**In `src/components/agent-actions.tsx` (was entity-actions.tsx):**
- `EntityActionsProps` → `AgentActionsProps`
- `entityId` prop → `agentId`
- `entityName` prop → `agentName`

### Worker Renames (`src/worker/runner.ts`)

- `isEntityDueForIteration(entity)` → `isAgentDueForIteration(agent)`
- `classifyEntityWork(entity)` → `classifyAgentWork(agent)`
- `performInsightSynthesis(entity)` → `performInsightSynthesis(agent)` (parameter rename)
- `performGraphConstruction(entity)` → `performGraphConstruction(agent)` (parameter rename)
- `processEntityIteration(entity)` → `processAgentIteration(agent)`
- `getActiveEntities()` → `getActiveAgents()`
- All `entity.id`, `entity.name` → `agent.id`, `agent.name`
- `entityId: entity.id` in tool contexts → `agentId: agent.id`

### Navigation (`src/components/nav.tsx`)

- Update any `/entities` links to `/agents`

### CLAUDE.md Updates

- Update all references to "entity" in documentation
- Update example commands and descriptions

## Implementation Order

### Phase 1: Database Schema
1. Rename `entities` table to `agents` in schema.ts
2. Rename all `entityId` columns to `agentId`
3. Rename relation names
4. Rename index names

### Phase 2: TypeScript Types
1. Update `src/lib/types.ts` - rename `Entity` → `Agent`, `EntityStatus` → `AgentStatus`
2. Update `InboxItem` interface `entityId` → `agentId`

### Phase 3: Database Queries
1. Rename `src/lib/db/queries/entities.ts` → `agents.ts`
2. Update all function names and parameters
3. Update all other query files with `entityId` → `agentId`

### Phase 4: LLM Modules
1. Rename `src/lib/llm/entity-configuration.ts` → `agent-configuration.ts`
2. Update all types, functions, and exports
3. Update `ToolContext` interface
4. Update all other LLM files

### Phase 5: Worker
1. Update `src/worker/runner.ts` with all renames

### Phase 6: API Routes
1. Rename `/api/entities/` directory → `/api/agents/`
2. Update route handlers
3. Rename `/api/conversations/[entityId]/` → `/api/conversations/[agentId]/`

### Phase 7: Dashboard Routes
1. Rename `/app/(dashboard)/entities/` → `/agents/`
2. Update all page components

### Phase 8: Components
1. Rename `src/components/entity-actions.tsx` → `agent-actions.tsx`
2. Update component props and implementation

### Phase 9: Navigation & UI
1. Update `src/components/nav.tsx`
2. Update any other UI references

### Phase 10: Documentation
1. Update CLAUDE.md

### Phase 11: Database Reset
1. Generate new migration with `npx drizzle-kit generate`
2. Drop and recreate database

## Files to Modify (Complete List)

### Rename Files:
- `src/lib/db/queries/entities.ts` → `agents.ts`
- `src/lib/llm/entity-configuration.ts` → `agent-configuration.ts`
- `src/components/entity-actions.tsx` → `agent-actions.tsx`
- `src/app/api/entities/` → `src/app/api/agents/` (entire directory)
- `src/app/api/conversations/[entityId]/` → `[agentId]/`
- `src/app/(dashboard)/entities/` → `agents/` (entire directory)

### Modify Files:
- `src/lib/db/schema.ts`
- `src/lib/types.ts`
- `src/lib/db/queries/conversations.ts`
- `src/lib/db/queries/worker-iterations.ts`
- `src/lib/db/queries/llm-interactions.ts`
- `src/lib/db/queries/graph-types.ts`
- `src/lib/db/queries/graph-data.ts`
- `src/lib/db/queries/memories.ts`
- `src/lib/db/queries/inboxItems.ts`
- `src/lib/llm/knowledge-graph.ts`
- `src/lib/llm/conversation.ts`
- `src/lib/llm/graph-configuration.ts`
- `src/lib/llm/tools/index.ts`
- `src/lib/llm/tools/graph-tools.ts`
- `src/lib/llm/tools/inbox-tools.ts`
- `src/worker/runner.ts`
- `src/components/nav.tsx`
- `CLAUDE.md`

### Phase 12: E2E Browser Testing
1. Start the application with `docker compose up`
2. Navigate to `/agents` and verify the page loads
3. Create a new agent via `/agents/new`
4. Verify agent appears in the list
5. Navigate to agent detail page
6. Test chat, worker-iterations, and knowledge-graph sub-pages
7. Test agent actions (pause/activate, edit, delete)

## Post-Implementation

1. Run `npm run lint` to catch any missed references
2. Run `npm run build` to verify TypeScript compilation
3. Generate new migration: `npx drizzle-kit generate`
4. Start fresh with `docker compose down -v && docker compose up`
5. Complete Phase 12 E2E browser testing
