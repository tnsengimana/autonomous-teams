# Plan 29: Remove Edge Type Source/Target Node Type Constraints

## Context

Edge types currently have source/target node type constraints enforced via junction tables (`graphEdgeTypeSourceTypes`, `graphEdgeTypeTargetTypes`). These restrict which node types can appear as source/target for a given edge type. In practice, this adds friction without proportional benefit — the LLM can work around constraints by creating new edge types, and the edge type name/description already provides sufficient semantic guidance. We're removing constraints entirely, trusting the LLM to make sensible connections. The database will be nuked, so no migration needed.

## Changes

### 1. Drop junction tables from DB schema
**File:** `src/lib/db/schema.ts`
- Remove `graphEdgeTypeSourceTypes` table definition (lines 255-270)
- Remove `graphEdgeTypeTargetTypes` table definition (lines 272-287)
- Remove `graphEdgeTypesRelations` references to `sourceTypes` and `targetTypes` (lines 478-479)
- Remove `graphEdgeTypeSourceTypesRelations` (lines 483-495)
- Remove `graphEdgeTypeTargetTypesRelations` (lines 497-509)

### 2. Remove constraint types
**File:** `src/lib/types.ts`
- Remove `GraphEdgeTypeSourceType` type (lines 38-40)
- Remove `GraphEdgeTypeTargetType` type (lines 41-43)
- Remove `GraphEdgeTypeWithConstraints` interface (lines 155-158)

### 3. Simplify edge type queries
**File:** `src/lib/db/queries/graph-types.ts`
- Remove import of `graphEdgeTypeSourceTypes`, `graphEdgeTypeTargetTypes` from schema
- Remove import/export of `GraphEdgeTypeWithConstraints`
- `createEdgeType()`: Remove `sourceNodeTypeNames`/`targetNodeTypeNames` params and the junction-table-writing logic (lines 130-131, 151-173)
- `getEdgeTypesByAgent()`: Return `GraphEdgeType[]` instead of `GraphEdgeTypeWithConstraints[]`. Remove all junction table queries (lines 214-244). Simply query and return edge types directly
- Remove `addSourceNodeTypeToEdgeType()` (lines 259-267)
- Remove `addTargetNodeTypeToEdgeType()` (lines 272-280)
- `formatTypesForLLMContext()`: Remove constraint display logic (lines 386-394). Show edge types with just name and description

### 4. Remove enforcement from addGraphEdge tool
**File:** `src/lib/llm/tools/graph-tools.ts`
- `addGraphEdgeTool` handler: Remove the source/target type constraint validation block (lines 259-283). Keep only: edge type existence check, node existence check, duplicate check, edge creation
- The handler no longer needs `getEdgeTypesByAgent` — use `edgeTypeExists` instead since we only need to verify the edge type name exists

### 5. Simplify createEdgeType tool
**File:** `src/lib/llm/tools/graph-tools.ts`
- `CreateEdgeTypeParamsSchema`: Remove `sourceNodeTypeNames` and `targetNodeTypeNames` fields (lines 63-64)
- `createEdgeTypeTool` handler: Remove node type validation loops (lines 640-657). Remove passing source/target names to `createEdgeType()` DB function

### 6. Remove constraints from seed edge types
**File:** `src/lib/llm/graph-types.ts`
- `SEED_EDGE_TYPES`: Remove `sourceNodeTypeNames` and `targetNodeTypeNames` from each entry (lines 135-178)
- `EdgeTypeDefinitionSchema`: Remove `sourceNodeTypeNames` and `targetNodeTypeNames` fields (lines 198-203)
- `TYPE_INITIALIZATION_SYSTEM_PROMPT`: Update the edge type schema requirements line to remove sourceNodeTypeNames/targetNodeTypeNames mention (line 239)
- `persistInitializedTypes()`: Remove the source/target name validation logic (lines 437-470). Simplify to just pass name, description, propertiesSchema, exampleProperties to `createEdgeType()`
- `createSeedEdgeTypes()`: Remove passing sourceNodeTypeNames/targetNodeTypeNames to `createEdgeType()`

### 7. Update UI
**File:** `src/app/(dashboard)/agents/[id]/graph-edge-types/page.tsx`
- Remove `NodeTypeRef` interface (lines 15-18)
- Remove `sourceNodeTypes`/`targetNodeTypes` from `EdgeType` interface (lines 29-30)
- Remove Source/Target display from `EdgeTypeCard` component (lines 63-76)

### 8. Update API route
**File:** `src/app/api/agents/[id]/graph-edge-types/route.ts`
- `getEdgeTypesByAgent` now returns `GraphEdgeType[]` — no code change needed in the route itself, the type change propagates naturally

### 9. Generate new migration
Run `npx drizzle-kit generate` to produce a migration that drops the two junction tables.

### 10. Update tests

**`src/lib/db/queries/__tests__/graph-types.test.ts`:**
- Remove imports of `graphEdgeTypeSourceTypes`, `graphEdgeTypeTargetTypes`
- Remove "creates an edge type with source/target constraints" test (lines 307-351) — replace with simpler test that creates edge type without constraints
- "returns edge types with populated constraints" test (lines 380-416) — simplify to just verify edge types are returned without constraint fields
- "formatTypesForLLMContext" test (lines 494-520) — remove assertions about constraint node type names

**`src/lib/llm/tools/__tests__/graph-tools.test.ts`:**
- Remove "enforces source type constraints" test (lines 393-425)
- Remove "enforces target type constraints" test (lines 427-459)
- Update `createEdgeType` tests: remove `sourceNodeTypeNames`/`targetNodeTypeNames` from tool calls (lines 658-659, etc.)
- Remove "rejects edge type with non-existent source node type" test (lines 716-731)
- Remove "rejects edge type with non-existent target node type" test (lines 733-748)

**`src/lib/llm/__tests__/graph-configuration.test.ts`:**
- Remove `sourceNodeTypeNames`/`targetNodeTypeNames` from `mockTypeInitializationResult` edge types (lines 95-121)
- Remove "generated edge types have valid source and target constraints" test (lines 233-262)
- Remove "persists edge type source/target constraints" test (lines 412-455)
- Remove "logs warning for invalid node type references in edge types" test (lines 543-595)
- Update integration test to not check for `sourceNodeTypes.length` (line 657)

**`src/lib/db/__tests__/graph-schema.test.ts`:**
- Remove imports of `graphEdgeTypeSourceTypes`, `graphEdgeTypeTargetTypes`
- Remove entire `graphEdgeTypeSourceTypes junction table` describe block (lines 238-339)
- Remove entire `graphEdgeTypeTargetTypes junction table` describe block (lines 341-411)
- Remove junction table operations from "complete graph workflow" test (lines 763-817)

## Verification

1. Generate migration: `npx drizzle-kit generate`
2. Rebuild DB: `docker compose down -v && docker compose up -d` (nukes data)
3. Apply migration: `npx drizzle-kit migrate`
4. Run tests: `npm test`
5. Build: `npm run build`
