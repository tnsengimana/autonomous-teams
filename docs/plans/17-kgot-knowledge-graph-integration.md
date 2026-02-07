# Plan: KGoT Knowledge Graph Integration

## Overview

Replace the flat `knowledge_items` table with a dynamic knowledge graph system inspired by KGoT (Knowledge Graph of Thoughts). The knowledge graph enables structured knowledge accumulation, relationship tracking between concepts, and more sophisticated reasoning over discovered information.

**Key Design Principle**: ALL node types and edge types are dynamic. No hardcoded types exist in the codebase. When an entity is created, the LLM initializes base types appropriate for that entity's purpose.

**Reference**: See `docs/research/knowledge-graph-of-thoughts.md` for the research background.

### Alignment with Research Doc

| Research Concept | Implementation |
|-----------------|----------------|
| INSERT/RETRIEVE loop | Agent instructions in `buildGraphContextBlock()` guide when to query vs. add |
| Dynamic node/edge types | LLM generates types via `initializeTypesForEntity()` on entity creation |
| Type evolution | `createNodeType` and `createEdgeType` tools let agent propose new types |
| Temporal handling | Type schemas include temporal properties (occurred_at, published_at, generated_at) |
| Text-to-graph transformation | Agent uses `addGraphNode` and `addGraphEdge` tools during task processing |
| Duplicate avoidance | `findNodeByTypeAndName` implements upsert semantics |
| Graph context for LLM | `formatTypesForLLMContext` + `serializeGraphForLLM` build agent prompts |
| Error recovery | Tools return structured errors; agent can retry with different approach |

---

## Current State

- **knowledge_items table**: Flat list with `type` enum ('fact', 'technique', 'pattern', 'lesson')
- **knowledge-items.ts**: Extracts knowledge after work sessions via LLM, stores as text records
- **Agent runtime**: Loads knowledge items as context, extracts at session end
- **No relationships**: Knowledge items are independent, no connections between facts

## Target State

- **6 new tables**: `graph_node_types`, `graph_edge_types`, `graph_edge_type_source_types`, `graph_edge_type_target_types`, `graph_nodes`, `graph_edges`
- **Dynamic schema**: Types are database records, not code enums; temporal fields are defined in type schemas
- **LLM-driven population**: Agent generates graph operations during INSERT phase
- **INSERT/RETRIEVE loop**: Agent decides whether to gather more info or query existing graph
- **Tools**: 6 graph manipulation tools for agent use
- **Type evolution**: Agent can propose new types when discovering novel knowledge

---

## Phase 1: Database Schema

### Step 1.1: Add graph type tables

**File**: `src/lib/db/schema.ts`

Add tables for storing dynamic type definitions. Edge type constraints (which node types can be source/target) use junction tables for proper FK relationships:

```typescript
// ============================================================================
// Knowledge Graph Type System
// ============================================================================

export const graphNodeTypes = pgTable('graph_node_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityId: uuid('entity_id').references(() => entities.id, { onDelete: 'cascade' }),  // NULL = global type
  name: text('name').notNull(),  // PascalCase, e.g., "Company", "Asset"
  description: text('description').notNull(),
  propertiesSchema: jsonb('properties_schema').notNull(),  // JSON Schema for validation
  exampleProperties: jsonb('example_properties'),  // For LLM few-shot learning
  createdBy: text('created_by').notNull().default('system'),  // 'system' | 'agent' | 'user'
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
}, (table) => [
  index('graph_node_types_entity_id_idx').on(table.entityId),
]);

export const graphEdgeTypes = pgTable('graph_edge_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityId: uuid('entity_id').references(() => entities.id, { onDelete: 'cascade' }),  // NULL = global type
  name: text('name').notNull(),  // snake_case, e.g., "issued_by", "affects"
  description: text('description').notNull(),
  propertiesSchema: jsonb('properties_schema'),  // JSON Schema for edge properties
  exampleProperties: jsonb('example_properties'),  // For LLM few-shot learning
  createdBy: text('created_by').notNull().default('system'),  // 'system' | 'agent' | 'user'
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
}, (table) => [
  index('graph_edge_types_entity_id_idx').on(table.entityId),
]);

// Junction tables for edge type -> node type constraints (many-to-many)
export const graphEdgeTypeSourceTypes = pgTable('graph_edge_type_source_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  edgeTypeId: uuid('edge_type_id').notNull().references(() => graphEdgeTypes.id, { onDelete: 'cascade' }),
  nodeTypeId: uuid('node_type_id').notNull().references(() => graphNodeTypes.id, { onDelete: 'cascade' }),
}, (table) => [
  index('graph_edge_type_source_types_edge_idx').on(table.edgeTypeId),
  index('graph_edge_type_source_types_node_idx').on(table.nodeTypeId),
]);

export const graphEdgeTypeTargetTypes = pgTable('graph_edge_type_target_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  edgeTypeId: uuid('edge_type_id').notNull().references(() => graphEdgeTypes.id, { onDelete: 'cascade' }),
  nodeTypeId: uuid('node_type_id').notNull().references(() => graphNodeTypes.id, { onDelete: 'cascade' }),
}, (table) => [
  index('graph_edge_type_target_types_edge_idx').on(table.edgeTypeId),
  index('graph_edge_type_target_types_node_idx').on(table.nodeTypeId),
]);
```

### Step 1.2: Add graph data tables

**File**: `src/lib/db/schema.ts`

Add tables for storing actual graph nodes and edges:

```typescript
// ============================================================================
// Knowledge Graph Data
// ============================================================================

export const graphNodes = pgTable('graph_nodes', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityId: uuid('entity_id').notNull().references(() => entities.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),  // References graphNodeTypes.name
  name: text('name').notNull(),  // Human-readable identifier
  properties: jsonb('properties').notNull().default({}),  // Validated against type schema; temporal fields live here
  sourceConversationId: uuid('source_conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
}, (table) => [
  index('graph_nodes_entity_id_idx').on(table.entityId),
  index('graph_nodes_type_idx').on(table.type),
  index('graph_nodes_entity_type_idx').on(table.entityId, table.type),
]);

export const graphEdges = pgTable('graph_edges', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityId: uuid('entity_id').notNull().references(() => entities.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),  // References graphEdgeTypes.name
  sourceId: uuid('source_id').notNull().references(() => graphNodes.id, { onDelete: 'cascade' }),
  targetId: uuid('target_id').notNull().references(() => graphNodes.id, { onDelete: 'cascade' }),
  properties: jsonb('properties').notNull().default({}),  // Validated against type schema
  sourceConversationId: uuid('source_conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
}, (table) => [
  index('graph_edges_entity_id_idx').on(table.entityId),
  index('graph_edges_type_idx').on(table.type),
  index('graph_edges_source_id_idx').on(table.sourceId),
  index('graph_edges_target_id_idx').on(table.targetId),
]);
```

### Step 1.3: Add relations

**File**: `src/lib/db/schema.ts`

```typescript
export const graphNodeTypesRelations = relations(graphNodeTypes, ({ one }) => ({
  entity: one(entities, {
    fields: [graphNodeTypes.entityId],
    references: [entities.id],
  }),
}));

export const graphEdgeTypesRelations = relations(graphEdgeTypes, ({ one, many }) => ({
  entity: one(entities, {
    fields: [graphEdgeTypes.entityId],
    references: [entities.id],
  }),
  sourceTypes: many(graphEdgeTypeSourceTypes),
  targetTypes: many(graphEdgeTypeTargetTypes),
}));

export const graphEdgeTypeSourceTypesRelations = relations(graphEdgeTypeSourceTypes, ({ one }) => ({
  edgeType: one(graphEdgeTypes, {
    fields: [graphEdgeTypeSourceTypes.edgeTypeId],
    references: [graphEdgeTypes.id],
  }),
  nodeType: one(graphNodeTypes, {
    fields: [graphEdgeTypeSourceTypes.nodeTypeId],
    references: [graphNodeTypes.id],
  }),
}));

export const graphEdgeTypeTargetTypesRelations = relations(graphEdgeTypeTargetTypes, ({ one }) => ({
  edgeType: one(graphEdgeTypes, {
    fields: [graphEdgeTypeTargetTypes.edgeTypeId],
    references: [graphEdgeTypes.id],
  }),
  nodeType: one(graphNodeTypes, {
    fields: [graphEdgeTypeTargetTypes.nodeTypeId],
    references: [graphNodeTypes.id],
  }),
}));

export const graphNodesRelations = relations(graphNodes, ({ one, many }) => ({
  entity: one(entities, {
    fields: [graphNodes.entityId],
    references: [entities.id],
  }),
  sourceConversation: one(conversations, {
    fields: [graphNodes.sourceConversationId],
    references: [conversations.id],
  }),
  outgoingEdges: many(graphEdges, { relationName: 'sourceNode' }),
  incomingEdges: many(graphEdges, { relationName: 'targetNode' }),
}));

export const graphEdgesRelations = relations(graphEdges, ({ one }) => ({
  entity: one(entities, {
    fields: [graphEdges.entityId],
    references: [entities.id],
  }),
  sourceNode: one(graphNodes, {
    fields: [graphEdges.sourceId],
    references: [graphNodes.id],
    relationName: 'sourceNode',
  }),
  targetNode: one(graphNodes, {
    fields: [graphEdges.targetId],
    references: [graphNodes.id],
    relationName: 'targetNode',
  }),
  sourceConversation: one(conversations, {
    fields: [graphEdges.sourceConversationId],
    references: [conversations.id],
  }),
}));
```

### Step 1.4: Update entities relations

**File**: `src/lib/db/schema.ts`

Update `entitiesRelations` to include graph types and data:

```typescript
export const entitiesRelations = relations(entities, ({ one, many }) => ({
  // ... existing relations ...
  graphNodeTypes: many(graphNodeTypes),
  graphEdgeTypes: many(graphEdgeTypes),
  graphNodes: many(graphNodes),
  graphEdges: many(graphEdges),
}));
```

### Step 1.5: Generate and apply migration

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

### Step 1.6: Tests

**New file**: `src/lib/db/__tests__/graph-schema.test.ts`

Write tests to verify:
- All 6 tables are created with correct columns
- Foreign key constraints work (cascade deletes)
- Junction table relationships are correct
- Indexes are created

---

## Phase 2: Query Layer for Graph Types

### Step 2.1: Create graph type queries

**New file**: `src/lib/db/queries/graph-types.ts`

```typescript
/**
 * Graph Type Queries
 *
 * CRUD operations for dynamic node and edge type definitions.
 * Types can be global (entityId=null) or entity-specific.
 */

// Node type operations
export async function createNodeType(data: {
  entityId?: string | null;
  name: string;
  description: string;
  propertiesSchema: object;
  exampleProperties?: object;
  createdBy?: 'system' | 'agent' | 'user';
}): Promise<GraphNodeType>;

export async function getNodeTypesByEntity(entityId: string): Promise<GraphNodeType[]>;
// Returns entity-specific types + global types (entityId=null)

export async function getNodeTypeByName(
  entityId: string,
  name: string
): Promise<GraphNodeType | null>;

export async function nodeTypeExists(
  entityId: string,
  name: string
): Promise<boolean>;

// Edge type operations (with junction table management)
export async function createEdgeType(data: {
  entityId?: string | null;
  name: string;
  description: string;
  sourceNodeTypeNames?: string[];  // Resolved to IDs internally
  targetNodeTypeNames?: string[];  // Resolved to IDs internally
  propertiesSchema?: object;
  exampleProperties?: object;
  createdBy?: 'system' | 'agent' | 'user';
}): Promise<GraphEdgeType>;
// Creates edge type + inserts into junction tables for source/target constraints

export async function getEdgeTypesByEntity(entityId: string): Promise<GraphEdgeTypeWithConstraints[]>;
// Returns edge types with sourceNodeTypes and targetNodeTypes populated

export async function addSourceNodeTypeToEdgeType(
  edgeTypeId: string,
  nodeTypeId: string
): Promise<void>;

export async function addTargetNodeTypeToEdgeType(
  edgeTypeId: string,
  nodeTypeId: string
): Promise<void>;

export async function getEdgeTypeByName(
  entityId: string,
  name: string
): Promise<GraphEdgeType | null>;

export async function edgeTypeExists(
  entityId: string,
  name: string
): Promise<boolean>;

// Formatting for LLM context
export async function formatTypesForLLMContext(entityId: string): Promise<string>;
// Returns formatted type definitions for inclusion in prompts
// Output format:
// ### Node Types
// - **Asset**: Financial instrument (stocks, bonds, ETFs, crypto)
//   Required: symbol
//   Optional: type, name
//   Example: {"symbol": "AAPL", "type": "stock", "name": "Apple Inc."}
//
// - **Company**: Legal entity that issues securities
//   Required: name
//   Optional: ticker, country, sector
//   Example: {"name": "Apple Inc.", "ticker": "AAPL", "country": "USA"}
//
// ### Edge Types
// - **issued_by**: Asset → Company
//   Description: Asset issued by a company
//
// - **affects**: MarketEvent|Institution → Asset|Company|Sector|AssetClass
//   Description: Event or institution impacts an entity
//   Example: {"direction": "positive", "magnitude": 0.7}

// Implementation sketch:
/*
async function formatTypesForLLMContext(entityId: string): Promise<string> {
  const nodeTypes = await getNodeTypesByEntity(entityId);
  const edgeTypes = await getEdgeTypesByEntity(entityId);

  const nodeTypeLines = nodeTypes.map(nt => {
    const schema = nt.propertiesSchema as { required?: string[]; properties?: Record<string, any> };
    const required = schema.required?.join(', ') || 'none';
    const optional = Object.keys(schema.properties || {})
      .filter(k => !schema.required?.includes(k))
      .join(', ') || 'none';
    const example = nt.exampleProperties ? JSON.stringify(nt.exampleProperties) : 'n/a';

    return `- **${nt.name}**: ${nt.description}
  Required: ${required}
  Optional: ${optional}
  Example: ${example}`;
  });

  const edgeTypeLines = edgeTypes.map(et => {
    const sources = et.sourceNodeTypes?.map(t => t.name).join('|') || '*';
    const targets = et.targetNodeTypes?.map(t => t.name).join('|') || '*';
    const example = et.exampleProperties ? `\n  Example: ${JSON.stringify(et.exampleProperties)}` : '';

    return `- **${et.name}**: ${sources} → ${targets}
  ${et.description}${example}`;
  });

  return `### Node Types\n${nodeTypeLines.join('\n\n')}\n\n### Edge Types\n${edgeTypeLines.join('\n\n')}`;
}
*/
```

### Step 2.2: Create graph data queries

**New file**: `src/lib/db/queries/graph-data.ts`

```typescript
/**
 * Graph Data Queries
 *
 * CRUD operations for knowledge graph nodes and edges.
 */

// Node operations
export async function createNode(data: {
  entityId: string;
  type: string;
  name: string;
  properties?: object;  // Temporal fields (occurred_at, etc.) are part of properties per type schema
  sourceConversationId?: string;
}): Promise<GraphNode>;

export async function getNodeById(nodeId: string): Promise<GraphNode | null>;

export async function getNodesByEntity(
  entityId: string,
  options?: {
    type?: string;
    limit?: number;
  }
): Promise<GraphNode[]>;

export async function findNodeByTypeAndName(
  entityId: string,
  type: string,
  name: string
): Promise<GraphNode | null>;

export async function updateNodeProperties(
  nodeId: string,
  properties: object
): Promise<void>;

export async function deleteNode(nodeId: string): Promise<void>;

// Edge operations
export async function createEdge(data: {
  entityId: string;
  type: string;
  sourceId: string;
  targetId: string;
  properties?: object;
  sourceConversationId?: string;
}): Promise<GraphEdge>;

export async function getEdgesByNode(
  nodeId: string,
  direction: 'incoming' | 'outgoing' | 'both'
): Promise<GraphEdge[]>;

export async function findEdge(
  entityId: string,
  type: string,
  sourceId: string,
  targetId: string
): Promise<GraphEdge | null>;

export async function deleteEdge(edgeId: string): Promise<void>;

// Graph traversal
export async function getNodeNeighbors(
  nodeId: string,
  depth?: number
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>;

// Serialization for LLM context
export async function serializeGraphForLLM(
  entityId: string,
  maxNodes: number = 50
): Promise<string>;
// Returns text representation of graph state for LLM prompts
// Algorithm:
// 1. Get most recent nodes (ORDER BY createdAt DESC LIMIT maxNodes)
// 2. Get all edges where both source and target are in the node set
// 3. Format as readable text:
//    Nodes:
//    - [Asset] AAPL: {symbol: "AAPL", type: "stock"}
//    - [Company] Apple Inc.: {name: "Apple Inc.", ticker: "AAPL"}
//    Relationships:
//    - AAPL --issued_by--> Apple Inc.
//    - Apple Inc. --in_sector--> Technology

// Statistics
export async function getGraphStats(entityId: string): Promise<{
  nodeCount: number;
  edgeCount: number;
  nodesByType: Record<string, number>;
  edgesByType: Record<string, number>;
}>;

// Implementation sketch for serializeGraphForLLM:
/*
async function serializeGraphForLLM(entityId: string, maxNodes: number = 50): Promise<string> {
  // Get recent nodes
  const nodes = await db.select()
    .from(graphNodes)
    .where(eq(graphNodes.entityId, entityId))
    .orderBy(desc(graphNodes.createdAt))
    .limit(maxNodes);

  if (nodes.length === 0) return 'No nodes in graph.';

  const nodeIds = nodes.map(n => n.id);

  // Get edges between these nodes
  const edges = await db.select()
    .from(graphEdges)
    .where(and(
      eq(graphEdges.entityId, entityId),
      inArray(graphEdges.sourceId, nodeIds),
      inArray(graphEdges.targetId, nodeIds)
    ));

  // Build node lookup
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // Format output
  const nodeLines = nodes.map(n =>
    `- [${n.type}] ${n.name}: ${JSON.stringify(n.properties)}`
  );

  const edgeLines = edges.map(e => {
    const source = nodeMap.get(e.sourceId);
    const target = nodeMap.get(e.targetId);
    return `- ${source?.name} --${e.type}--> ${target?.name}`;
  });

  return `Nodes:\n${nodeLines.join('\n')}\n\nRelationships:\n${edgeLines.join('\n')}`;
}
*/
```

### Step 2.3: Tests

**New file**: `src/lib/db/queries/__tests__/graph-types.test.ts`

Write tests for graph type operations:
- `createNodeType` - creates type with schema validation
- `getNodeTypesByEntity` - returns entity-specific + global types
- `nodeTypeExists` - returns correct boolean
- `createEdgeType` - creates type with junction table entries
- `getEdgeTypesByEntity` - returns types with source/target constraints populated
- `formatTypesForLLMContext` - returns properly formatted string

**New file**: `src/lib/db/queries/__tests__/graph-data.test.ts`

Write tests for graph data operations:
- `createNode` - creates node with properties
- `findNodeByTypeAndName` - finds existing node or returns null
- `updateNodeProperties` - merges properties correctly
- `createEdge` - creates edge between nodes
- `findEdge` - detects duplicate edges
- `getNodesByEntity` - returns nodes with optional filtering
- `getEdgesByNode` - returns incoming/outgoing/both edges
- `serializeGraphForLLM` - returns properly formatted string
- `getGraphStats` - returns correct counts by type

---

## Phase 3: Entity Creation with Dynamic Type Initialization

### Step 3.1: Create type initialization service

**New file**: `src/lib/agents/graph-type-initializer.ts`

```typescript
/**
 * Graph Type Initializer
 *
 * Uses LLM to generate appropriate base node and edge types
 * when a new entity is created, based on the entity's purpose.
 */

import { z } from 'zod';
import { generateLLMObject, type StreamOptions } from './llm';

// Schema for LLM-generated type definitions
const NodeTypeDefinitionSchema = z.object({
  name: z.string().describe('PascalCase type name'),
  description: z.string().describe('What this type represents'),
  propertiesSchema: z.object({
    type: z.literal('object'),
    required: z.array(z.string()).optional(),
    properties: z.record(z.any()),
  }),
  exampleProperties: z.record(z.any()),
});

const EdgeTypeDefinitionSchema = z.object({
  name: z.string().describe('snake_case edge type name'),
  description: z.string().describe('What this relationship represents'),
  sourceNodeTypeNames: z.array(z.string()).describe('Names of node types allowed as source'),
  targetNodeTypeNames: z.array(z.string()).describe('Names of node types allowed as target'),
  propertiesSchema: z.object({
    type: z.literal('object'),
    properties: z.record(z.any()),
  }).optional(),
  exampleProperties: z.record(z.any()).optional(),
});

const TypeInitializationResultSchema = z.object({
  nodeTypes: z.array(NodeTypeDefinitionSchema),
  edgeTypes: z.array(EdgeTypeDefinitionSchema),
});

export type TypeInitializationResult = z.infer<typeof TypeInitializationResultSchema>;

const TYPE_INITIALIZATION_PROMPT = `You are a knowledge graph schema designer. Given an entity's purpose, design appropriate node types and edge types for its knowledge graph.

Guidelines:
- Node type names: PascalCase (e.g., "Company", "MarketEvent")
- Edge type names: snake_case (e.g., "affects", "issued_by")
- Each node type needs: name, description, propertiesSchema (JSON Schema), exampleProperties
- Each edge type needs: name, description, sourceNodeTypes, targetNodeTypes, and optionally propertiesSchema/exampleProperties
- Design 5-10 node types and 5-10 edge types that cover the key concepts for this domain
- Types should be specific enough to be useful but general enough to avoid proliferation
- Include standard types like news/events if relevant to the domain
- Focus on discoverable knowledge, not user data (no User, Portfolio, Account types)

Entity Name: {entityName}
Entity Type: {entityType}
Entity Purpose: {entityPurpose}

Design the knowledge graph schema that would best support this entity's mission.`;

export async function initializeTypesForEntity(
  entity: { name: string; type: string; purpose: string | null },
  options: StreamOptions = {}
): Promise<TypeInitializationResult> {
  const prompt = TYPE_INITIALIZATION_PROMPT
    .replace('{entityName}', entity.name)
    .replace('{entityType}', entity.type)
    .replace('{entityPurpose}', entity.purpose || 'General purpose assistant');

  const result = await generateLLMObject(
    [{ role: 'user', content: prompt }],
    TypeInitializationResultSchema,
    'Design knowledge graph types for this entity',
    { ...options, temperature: 0.7 }
  );

  return result;
}

export async function persistInitializedTypes(
  entityId: string,
  types: TypeInitializationResult
): Promise<void> {
  const { createNodeType } = await import('@/lib/db/queries/graph-types');
  const { createEdgeType } = await import('@/lib/db/queries/graph-types');

  // Create node types
  for (const nodeType of types.nodeTypes) {
    await createNodeType({
      entityId,
      name: nodeType.name,
      description: nodeType.description,
      propertiesSchema: nodeType.propertiesSchema,
      exampleProperties: nodeType.exampleProperties,
      createdBy: 'system',
    });
  }

  // Create edge types (must happen after node types so FKs can resolve)
  for (const edgeType of types.edgeTypes) {
    await createEdgeType({
      entityId,
      name: edgeType.name,
      description: edgeType.description,
      sourceNodeTypeNames: edgeType.sourceNodeTypeNames,
      targetNodeTypeNames: edgeType.targetNodeTypeNames,
      propertiesSchema: edgeType.propertiesSchema,
      exampleProperties: edgeType.exampleProperties,
      createdBy: 'system',
    });
  }
}
```

### Step 3.2: Update entity creation

**File**: `src/lib/db/queries/entities.ts`

Update `createEntity` to call type initialization:

```typescript
import { initializeTypesForEntity, persistInitializedTypes } from '@/lib/agents/graph-type-initializer';

export async function createEntity(data: {
  userId: string;
  type: EntityType;
  name: string;
  purpose?: string | null;
  status?: EntityStatus;
}): Promise<Entity> {
  // Create entity record
  const result = await db
    .insert(entities)
    .values({
      userId: data.userId,
      type: data.type,
      name: data.name,
      purpose: data.purpose ?? null,
      status: data.status ?? 'active',
    })
    .returning();

  const entity = result[0];

  // Initialize graph types for this entity (fire and forget, or await)
  initializeTypesForEntity(
    { name: entity.name, type: entity.type, purpose: entity.purpose },
    { entityId: entity.id }
  )
    .then((types) => persistInitializedTypes(entity.id, types))
    .catch((err) => console.error('Failed to initialize graph types:', err));

  return entity;
}
```

**Alternative**: Move type initialization to a separate endpoint so entity creation is fast, and types are initialized async or on-demand.

### Step 3.3: Tests

**New file**: `src/lib/agents/__tests__/graph-type-initializer.test.ts`

Write tests for type initialization:
- `initializeTypesForEntity` - returns valid node and edge type definitions
- Generated types have correct naming conventions (PascalCase/snake_case)
- Generated types have valid JSON Schema in propertiesSchema
- Generated types include exampleProperties
- Edge types reference valid node types in source/target constraints

**Update file**: `src/lib/db/queries/__tests__/entities.test.ts`

Add tests for entity creation with type initialization:
- Creating entity triggers type initialization
- Entity has graph types after creation
- Type initialization failure doesn't block entity creation

---

## Phase 4: Graph Tools for Agent Use

### Step 4.1: Create graph manipulation tools

**New file**: `src/lib/agents/tools/graph-tools.ts`

```typescript
/**
 * Graph Tools
 *
 * Tools for agents to manipulate the knowledge graph:
 * - Add/update nodes
 * - Add edges
 * - Query the graph
 * - Create new types
 */

import { tool } from 'ai';
import { z } from 'zod';
import type { ToolContext } from './index';

export const addGraphNode = tool({
  description: 'Add a node to the knowledge graph. Use existing node types when possible. Temporal fields (occurred_at, published_at, etc.) should be included in properties per the type schema.',
  parameters: z.object({
    type: z.string().describe('Node type (must be an existing type, e.g., "Company", "Asset")'),
    name: z.string().describe('Human-readable identifier for this node'),
    properties: z.record(z.any()).describe('Properties for this node (must match type schema, including any temporal fields)'),
  }),
  execute: async ({ type, name, properties }, { toolContext }) => {
    const ctx = toolContext as ToolContext;
    const { createNode, findNodeByTypeAndName } = await import('@/lib/db/queries/graph-data');
    const { nodeTypeExists } = await import('@/lib/db/queries/graph-types');

    // Validate type exists
    if (!(await nodeTypeExists(ctx.entityId, type))) {
      return { success: false, error: `Node type "${type}" does not exist. Use createNodeType first or use an existing type.` };
    }

    // Check for existing node (upsert semantics)
    const existing = await findNodeByTypeAndName(ctx.entityId, type, name);
    if (existing) {
      // Update existing node properties
      const { updateNodeProperties } = await import('@/lib/db/queries/graph-data');
      await updateNodeProperties(existing.id, { ...existing.properties, ...properties });
      return { success: true, nodeId: existing.id, action: 'updated' };
    }

    // Create new node
    const node = await createNode({
      entityId: ctx.entityId,
      type,
      name,
      properties,
      sourceConversationId: ctx.conversationId,
    });

    return { success: true, nodeId: node.id, action: 'created' };
  },
});

export const addGraphEdge = tool({
  description: 'Add a relationship (edge) between two nodes in the knowledge graph.',
  parameters: z.object({
    type: z.string().describe('Edge type (e.g., "affects", "issued_by")'),
    sourceName: z.string().describe('Name of the source node'),
    sourceType: z.string().describe('Type of the source node'),
    targetName: z.string().describe('Name of the target node'),
    targetType: z.string().describe('Type of the target node'),
    properties: z.record(z.any()).optional().describe('Optional properties for this edge'),
  }),
  execute: async ({ type, sourceName, sourceType, targetName, targetType, properties }, { toolContext }) => {
    const ctx = toolContext as ToolContext;
    const { findNodeByTypeAndName, createEdge, findEdge } = await import('@/lib/db/queries/graph-data');
    const { edgeTypeExists } = await import('@/lib/db/queries/graph-types');

    // Validate edge type exists
    if (!(await edgeTypeExists(ctx.entityId, type))) {
      return { success: false, error: `Edge type "${type}" does not exist.` };
    }

    // Find source and target nodes
    const sourceNode = await findNodeByTypeAndName(ctx.entityId, sourceType, sourceName);
    const targetNode = await findNodeByTypeAndName(ctx.entityId, targetType, targetName);

    if (!sourceNode) {
      return { success: false, error: `Source node "${sourceName}" of type "${sourceType}" not found. Create it first.` };
    }
    if (!targetNode) {
      return { success: false, error: `Target node "${targetName}" of type "${targetType}" not found. Create it first.` };
    }

    // Check for existing edge (avoid duplicates)
    const existing = await findEdge(ctx.entityId, type, sourceNode.id, targetNode.id);
    if (existing) {
      return { success: true, edgeId: existing.id, action: 'already_exists' };
    }

    // Create edge
    const edge = await createEdge({
      entityId: ctx.entityId,
      type,
      sourceId: sourceNode.id,
      targetId: targetNode.id,
      properties: properties || {},
      sourceConversationId: ctx.conversationId,
    });

    return { success: true, edgeId: edge.id, action: 'created' };
  },
});

export const queryGraph = tool({
  description: 'Query the knowledge graph to find relevant information. Returns nodes and their relationships.',
  parameters: z.object({
    nodeType: z.string().optional().describe('Filter by node type'),
    searchTerm: z.string().optional().describe('Search in node names'),
    limit: z.number().optional().default(20).describe('Maximum nodes to return'),
  }),
  execute: async ({ nodeType, searchTerm, limit }, { toolContext }) => {
    const ctx = toolContext as ToolContext;
    const { getNodesByEntity, getEdgesByNode } = await import('@/lib/db/queries/graph-data');

    let nodes = await getNodesByEntity(ctx.entityId, { type: nodeType, limit });

    // Filter by search term if provided
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      nodes = nodes.filter(n => n.name.toLowerCase().includes(term));
    }

    // Get edges for these nodes
    const edgePromises = nodes.map(n => getEdgesByNode(n.id, 'both'));
    const edgeResults = await Promise.all(edgePromises);
    const edges = [...new Set(edgeResults.flat())];  // Deduplicate

    return {
      nodes: nodes.map(n => ({
        id: n.id,
        type: n.type,
        name: n.name,
        properties: n.properties,
      })),
      edges: edges.map(e => ({ type: e.type, sourceId: e.sourceId, targetId: e.targetId, properties: e.properties })),
    };
  },
});

export const getGraphSummary = tool({
  description: 'Get a summary of the current knowledge graph state (node counts, edge counts by type).',
  parameters: z.object({}),
  execute: async (_, { toolContext }) => {
    const ctx = toolContext as ToolContext;
    const { getGraphStats } = await import('@/lib/db/queries/graph-data');
    return getGraphStats(ctx.entityId);
  },
});

export const createNodeType = tool({
  description: 'Create a new node type when you discover knowledge that does not fit existing types. Use sparingly - prefer existing types.',
  parameters: z.object({
    name: z.string().describe('PascalCase name for the new type (e.g., "Regulation", "Patent")'),
    description: z.string().describe('Clear explanation of what this type represents'),
    propertiesSchema: z.object({
      type: z.literal('object'),
      required: z.array(z.string()).optional(),
      properties: z.record(z.any()),
    }).describe('JSON Schema defining allowed properties'),
    exampleProperties: z.record(z.any()).describe('Example property values for few-shot learning'),
    justification: z.string().describe('Why existing types are insufficient'),
  }),
  execute: async ({ name, description, propertiesSchema, exampleProperties, justification }, { toolContext }) => {
    const ctx = toolContext as ToolContext;
    const { createNodeType: createType, nodeTypeExists } = await import('@/lib/db/queries/graph-types');

    // Check if type already exists
    if (await nodeTypeExists(ctx.entityId, name)) {
      return { success: false, error: `Node type "${name}" already exists.` };
    }

    // Validate name is PascalCase
    if (!/^[A-Z][a-zA-Z]*$/.test(name)) {
      return { success: false, error: 'Node type name must be PascalCase (e.g., "MarketEvent", "Company")' };
    }

    await createType({
      entityId: ctx.entityId,
      name,
      description,
      propertiesSchema,
      exampleProperties,
      createdBy: 'agent',
    });

    console.log(`[Graph] Agent created new node type: ${name}. Justification: ${justification}`);
    return { success: true, typeName: name };
  },
});

export const createEdgeType = tool({
  description: 'Create a new edge (relationship) type when you need to express a relationship not covered by existing types.',
  parameters: z.object({
    name: z.string().describe('snake_case name for the relationship (e.g., "regulates", "competes_with")'),
    description: z.string().describe('Clear explanation of what this relationship represents'),
    sourceNodeTypeNames: z.array(z.string()).describe('Names of node types allowed as source'),
    targetNodeTypeNames: z.array(z.string()).describe('Names of node types allowed as target'),
    propertiesSchema: z.object({
      type: z.literal('object'),
      properties: z.record(z.any()),
    }).optional().describe('Optional JSON Schema for edge properties'),
    exampleProperties: z.record(z.any()).optional().describe('Example property values'),
    justification: z.string().describe('Why existing edge types are insufficient'),
  }),
  execute: async ({ name, description, sourceNodeTypeNames, targetNodeTypeNames, propertiesSchema, exampleProperties, justification }, { toolContext }) => {
    const ctx = toolContext as ToolContext;
    const { createEdgeType: createType, edgeTypeExists } = await import('@/lib/db/queries/graph-types');

    if (await edgeTypeExists(ctx.entityId, name)) {
      return { success: false, error: `Edge type "${name}" already exists.` };
    }

    // Validate name is snake_case
    if (!/^[a-z][a-z_]*$/.test(name)) {
      return { success: false, error: 'Edge type name must be snake_case (e.g., "affects", "issued_by")' };
    }

    await createType({
      entityId: ctx.entityId,
      name,
      description,
      sourceNodeTypeNames,
      targetNodeTypeNames,
      propertiesSchema,
      exampleProperties,
      createdBy: 'agent',
    });

    console.log(`[Graph] Agent created new edge type: ${name}. Justification: ${justification}`);
    return { success: true, typeName: name };
  },
});

// Export all graph tools
export function getGraphTools() {
  return [
    addGraphNode,
    addGraphEdge,
    queryGraph,
    getGraphSummary,
    createNodeType,
    createEdgeType,
  ];
}
```

### Step 4.2: Update tools index

**File**: `src/lib/agents/tools/index.ts`

Add graph tools to background tools:

```typescript
import { getGraphTools } from './graph-tools';

export function getBackgroundTools(isLead: boolean): ReturnType<typeof tool>[] {
  const tools = [
    ...getTavilyTools(),
    ...getGraphTools(),  // Add graph tools
    // ... other tools
  ];

  if (isLead) {
    tools.push(...getLeadTools());
  }

  return tools;
}
```

### Step 4.3: Update ToolContext

**File**: `src/lib/agents/tools/index.ts`

Add conversationId to ToolContext:

```typescript
export interface ToolContext {
  agentId: string;
  entityId: string;
  isLead: boolean;
  conversationId?: string;  // Add for graph tools
}
```

### Step 4.3: Tests

**New file**: `src/lib/agents/tools/__tests__/graph-tools.test.ts`

Write tests for each graph tool:
- `addGraphNode` - creates node, handles upsert, validates type exists
- `addGraphEdge` - creates edge, finds nodes by name, validates edge type
- `queryGraph` - returns nodes and edges, filters by type, searches by name
- `getGraphSummary` - returns correct statistics
- `createNodeType` - validates naming conventions, stores schema
- `createEdgeType` - validates naming, creates junction table entries

Test error cases:
- Adding node with non-existent type returns error
- Adding edge with non-existent nodes returns error
- Creating duplicate type returns error
- Invalid naming conventions rejected

---

## Phase 5: Agent Runtime Integration

### Step 5.1: Create knowledge graph service

**New file**: `src/lib/agents/knowledge-graph.ts`

```typescript
/**
 * Knowledge Graph Service
 *
 * High-level operations for the INSERT/RETRIEVE loop
 * and knowledge context building.
 */

import { formatTypesForLLMContext } from '@/lib/db/queries/graph-types';
import { serializeGraphForLLM, getGraphStats } from '@/lib/db/queries/graph-data';

/**
 * Build knowledge graph context block for agent system prompts
 */
export async function buildGraphContextBlock(entityId: string): Promise<string> {
  const [typeContext, graphData, stats] = await Promise.all([
    formatTypesForLLMContext(entityId),
    serializeGraphForLLM(entityId, 50),  // Include recent graph state
    getGraphStats(entityId),
  ]);

  if (stats.nodeCount === 0) {
    return `
<knowledge_graph>
The knowledge graph is currently empty. Use the graph tools to populate it with discovered knowledge.

${typeContext}

## How to Use the Knowledge Graph

When working on tasks, follow this pattern:

1. **RETRIEVE first**: Before researching, check if the graph already has relevant information
   - Use queryGraph to search for nodes related to your task
   - If you find relevant, recent information, use it

2. **INSERT when needed**: If the graph lacks information you need:
   - Use external tools (web search, etc.) to gather information
   - Use addGraphNode to create nodes for entities you discover
   - Use addGraphEdge to create relationships between nodes
   - Include temporal properties (occurred_at, published_at) where applicable

3. **Avoid duplicates**: Before creating a node, the system checks if one with the same type+name exists
   - If it exists, properties are merged (updated)
   - Use consistent naming (e.g., "Apple Inc." not "Apple" vs "Apple Inc")

4. **Use existing types**: Prefer existing node/edge types over creating new ones
   - Only use createNodeType/createEdgeType if truly necessary
   - Provide justification when creating new types
</knowledge_graph>
`;
  }

  return `
<knowledge_graph>
Current graph has ${stats.nodeCount} nodes and ${stats.edgeCount} edges.

## Available Types
${typeContext}

## Current Graph State (most recent ${Math.min(stats.nodeCount, 50)} nodes)
${graphData}

## How to Use the Knowledge Graph

When working on tasks, follow this pattern:

1. **RETRIEVE first**: Before researching, check if the graph already has relevant information
   - Use queryGraph to search for nodes related to your task
   - Review the graph state above for relevant prior knowledge
   - If you find relevant, recent information, use it

2. **INSERT when needed**: If the graph lacks information you need:
   - Use external tools (web search, etc.) to gather information
   - Use addGraphNode to create nodes for entities you discover
   - Use addGraphEdge to create relationships between nodes
   - Include temporal properties (occurred_at, published_at) where applicable

3. **Avoid duplicates**: Before creating a node, the system checks if one with the same type+name exists
   - If it exists, properties are merged (updated)
   - Use consistent naming (e.g., "Apple Inc." not "Apple" vs "Apple Inc")

4. **Use existing types**: Prefer existing node/edge types over creating new ones
   - Only use createNodeType/createEdgeType if truly necessary
   - Provide justification when creating new types

5. **Reason about freshness**: Check temporal properties to assess data relevance
   - A signal from weeks ago may be stale
   - Recent news is more relevant than old news
</knowledge_graph>
`;
}

/**
 * Determine if the graph has enough information to answer a question
 * (simplified version of KGoT's RETRIEVE decision)
 */
export async function graphHasRelevantData(
  entityId: string,
  topic: string
): Promise<boolean> {
  const stats = await getGraphStats(entityId);

  // Simple heuristic: if graph is empty or very small, likely need more data
  if (stats.nodeCount < 5) {
    return false;
  }

  // Could add more sophisticated checks:
  // - Search for nodes matching topic keywords
  // - Check recency of relevant nodes
  // - Check if insight nodes exist for this topic

  return true;  // Let the LLM decide via tool calls
}
```

### Step 5.2: Update agent.ts

**File**: `src/lib/agents/agent.ts`

Replace knowledge items with knowledge graph:

```typescript
// Replace import
// OLD: import { buildKnowledgeContextBlock, loadKnowledge } from './knowledge-items';
import { buildGraphContextBlock } from './knowledge-graph';

// In Agent class:

/**
 * Build the system prompt with knowledge graph context (for background work)
 */
buildBackgroundSystemPrompt(): string {
  // Graph context is loaded async, so we build it separately
  // and pass via parameter or load before this call
  return this.systemPrompt;
}

/**
 * Build the system prompt with knowledge graph context
 */
async buildBackgroundSystemPromptWithGraph(): Promise<string> {
  const graphContext = await buildGraphContextBlock(this.entityId);

  if (graphContext) {
    return `${this.systemPrompt}\n\n${graphContext}`;
  }

  return this.systemPrompt;
}

// Update processTask to use graph context:
async processTask(conversationId: string, task: AgentTask): Promise<string> {
  const taskMessage = `Task from ${task.source}: ${task.task}`;

  const contextMessages = await getConversationContext(conversationId);

  // Build system prompt with graph context
  const systemPrompt = await this.buildBackgroundSystemPromptWithGraph();

  const contextWithTask: LLMMessage[] = [
    ...this.messagesToLLMFormat(contextMessages),
    { role: 'user', content: taskMessage },
  ];

  // Get tools including graph tools
  const tools = getBackgroundTools(this.isLead());
  const toolContext: ToolContext = {
    agentId: this.id,
    entityId: this.entityId,
    isLead: this.isLead(),
    conversationId,  // Add for graph tools
  };

  // ... rest of processTask unchanged ...
}
```

### Step 5.3: Remove old knowledge extraction

**File**: `src/lib/agents/agent.ts`

Remove or deprecate the old `extractKnowledgeFromConversation` method. Knowledge is now added to the graph in real-time via tools during task processing, not extracted after the fact.

```typescript
// In runWorkSession(), remove:
// const newKnowledge = await this.extractKnowledgeFromConversation(conversationId, conversationMessages);

// The agent now populates the graph during processTask via graph tools
```

### Step 5.4: Tests

**New file**: `src/lib/agents/__tests__/knowledge-graph.test.ts`

Write tests for knowledge graph service:
- `buildGraphContextBlock` - returns formatted context with types and graph state
- `buildGraphContextBlock` - handles empty graph correctly
- `ensureGraphTypesInitialized` - initializes types for entity without types
- `ensureGraphTypesInitialized` - skips initialization if types exist

**Update file**: `src/lib/agents/__tests__/agent.test.ts`

Update/rewrite agent tests for graph integration:
- `buildBackgroundSystemPromptWithGraph` - includes graph context
- `processTask` - has access to graph tools
- Graph tools available in background mode
- Graph tools not available in foreground mode

---

## Phase 6: Types Definition

### Step 6.1: Add TypeScript types

**File**: `src/lib/types.ts`

```typescript
// Graph Types
export interface GraphNodeType {
  id: string;
  entityId: string | null;
  name: string;
  description: string;
  propertiesSchema: object;
  exampleProperties: object | null;
  createdBy: 'system' | 'agent' | 'user';
  createdAt: Date;
}

export interface GraphEdgeType {
  id: string;
  entityId: string | null;
  name: string;
  description: string;
  propertiesSchema: object | null;
  exampleProperties: object | null;
  createdBy: 'system' | 'agent' | 'user';
  createdAt: Date;
}

// Junction table types
export interface GraphEdgeTypeSourceType {
  id: string;
  edgeTypeId: string;
  nodeTypeId: string;
}

export interface GraphEdgeTypeTargetType {
  id: string;
  edgeTypeId: string;
  nodeTypeId: string;
}

// Convenience type with resolved relations
export interface GraphEdgeTypeWithConstraints extends GraphEdgeType {
  sourceNodeTypes: GraphNodeType[];
  targetNodeTypes: GraphNodeType[];
}

export interface GraphNode {
  id: string;
  entityId: string;
  type: string;
  name: string;
  properties: object;  // Temporal fields (occurred_at, etc.) live here per type schema
  sourceConversationId: string | null;
  createdAt: Date;
}

export interface GraphEdge {
  id: string;
  entityId: string;
  type: string;
  sourceId: string;
  targetId: string;
  properties: object;
  sourceConversationId: string | null;
  createdAt: Date;
}
```

---

## Phase 7: Remove Old Knowledge Items System

### Step 7.1: Delete knowledge-items.ts

**Delete file**: `src/lib/agents/knowledge-items.ts`

The knowledge graph replaces the flat knowledge items system entirely.

### Step 7.2: Remove knowledge_items table

**File**: `src/lib/db/schema.ts`

Remove the `knowledgeItems` table and its relations. Generate a migration to drop the table.

### Step 7.3: Update UI to show graph stats instead of knowledge items

**File**: `src/app/(dashboard)/entities/[id]/agents/[agentId]/page.tsx`

Replace `KnowledgeItemsList` component with `GraphStatsCard`:

```typescript
// Remove import
// import { getRecentKnowledgeItems } from "@/lib/db/queries/knowledge-items";

// Add import
import { getGraphStats } from "@/lib/db/queries/graph-data";

function GraphStatsCard({ stats }: { stats: { nodeCount: number; edgeCount: number; nodesByType: Record<string, number> } }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Knowledge Graph</CardTitle>
        <CardDescription>
          Structured knowledge discovered from work sessions
        </CardDescription>
      </CardHeader>
      <CardContent>
        {stats.nodeCount === 0 ? (
          <div className="flex h-[300px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
            No knowledge in graph yet.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg border p-4 text-center">
                <div className="text-2xl font-bold">{stats.nodeCount}</div>
                <div className="text-xs text-muted-foreground">Nodes</div>
              </div>
              <div className="rounded-lg border p-4 text-center">
                <div className="text-2xl font-bold">{stats.edgeCount}</div>
                <div className="text-xs text-muted-foreground">Relationships</div>
              </div>
            </div>
            <div>
              <div className="text-sm font-medium mb-2">Nodes by Type</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(stats.nodesByType).map(([type, count]) => (
                  <Badge key={type} variant="outline">
                    {type}: {count}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// In page component, replace:
// const knowledgeItems = await getRecentKnowledgeItems(agentId, 20);
// With:
const graphStats = await getGraphStats(entity.id);

// And update the render to use <GraphStatsCard stats={graphStats} />
```

### Step 7.4: Handle existing entities without types

For existing entities that don't have graph types yet, initialize types lazily on first agent run:

**File**: `src/lib/agents/knowledge-graph.ts`

```typescript
/**
 * Ensure entity has graph types initialized.
 * Called before building graph context.
 */
export async function ensureGraphTypesInitialized(
  entityId: string,
  entity: { name: string; type: string; purpose: string | null },
  options: StreamOptions = {}
): Promise<void> {
  const { getNodeTypesByEntity } = await import('@/lib/db/queries/graph-types');

  const existingTypes = await getNodeTypesByEntity(entityId);
  if (existingTypes.length > 0) {
    return; // Already initialized
  }

  // Initialize types for this entity
  const { initializeTypesForEntity, persistInitializedTypes } =
    await import('./graph-type-initializer');

  console.log(`[Graph] Initializing types for entity ${entity.name}`);
  const types = await initializeTypesForEntity(entity, options);
  await persistInitializedTypes(entityId, types);
}
```

**File**: `src/lib/agents/agent.ts`

Update `buildBackgroundSystemPromptWithGraph` to ensure types exist:

```typescript
async buildBackgroundSystemPromptWithGraph(): Promise<string> {
  // Ensure types are initialized (handles existing entities)
  const entity = await getEntityById(this.entityId);
  if (entity) {
    await ensureGraphTypesInitialized(this.entityId, entity, this.llmOptions);
  }

  const graphContext = await buildGraphContextBlock(this.entityId);
  // ...
}
```

### Step 7.5: Tests

**Delete file**: `src/lib/agents/__tests__/knowledge-items.test.ts` (if exists)

**Delete file**: `src/lib/agents/tools/__tests__/knowledge-item-tools.test.ts` (if exists)

**New file**: `src/app/(dashboard)/entities/[id]/agents/[agentId]/__tests__/page.test.tsx`

Write tests for updated agent detail page:
- `GraphStatsCard` renders correctly with stats
- `GraphStatsCard` handles empty graph
- Page loads graph stats instead of knowledge items

### Integration Tests

After all phases are complete, write end-to-end integration tests:

**New file**: `src/lib/agents/__tests__/graph-integration.test.ts`

- Create entity → types are initialized
- Agent processes task → can use graph tools
- Add nodes and edges → graph state persists
- Query graph → returns correct data
- Create new type → type available for subsequent operations
- Lazy initialization → existing entity gets types on first run

---

## Critical Files Summary

### New Files

| File | Purpose |
|------|---------|
| `src/lib/db/queries/graph-types.ts` | Type CRUD + LLM formatting |
| `src/lib/db/queries/graph-data.ts` | Node/edge CRUD + serialization |
| `src/lib/agents/graph-type-initializer.ts` | LLM-driven type generation |
| `src/lib/agents/tools/graph-tools.ts` | 6 graph manipulation tools |
| `src/lib/agents/knowledge-graph.ts` | Context building + lazy init |

### Modified Files

| File | Changes |
|------|---------|
| `src/lib/db/schema.ts` | Add 6 new tables, remove `knowledgeItems` table + relations |
| `src/lib/db/queries/index.ts` | Remove knowledge-items export, add graph exports |
| `src/lib/db/queries/entities.ts` | Call type initialization on create |
| `src/lib/agents/index.ts` | Remove knowledge-items exports, add graph exports |
| `src/lib/agents/tools/index.ts` | Add graph tools to background tools |
| `src/lib/agents/agent.ts` | Use graph context, remove knowledge extraction calls |
| `src/lib/types.ts` | Add graph types, remove `KnowledgeItem`, `KnowledgeItemType` |
| `src/lib/entities/utils.ts` | Remove `getKnowledgeTypeBadgeVariant`, `KnowledgeItem` type |
| `src/app/(dashboard)/entities/[id]/agents/[agentId]/page.tsx` | Remove knowledge items display (or replace with graph stats) |

### Test Files

| File | Purpose |
|------|---------|
| `src/lib/db/__tests__/graph-schema.test.ts` | Schema and migration tests |
| `src/lib/db/queries/__tests__/graph-types.test.ts` | Type query tests |
| `src/lib/db/queries/__tests__/graph-data.test.ts` | Data query tests |
| `src/lib/agents/__tests__/graph-type-initializer.test.ts` | Type initialization tests |
| `src/lib/agents/tools/__tests__/graph-tools.test.ts` | Graph tool tests |
| `src/lib/agents/__tests__/knowledge-graph.test.ts` | Knowledge graph service tests |
| `src/lib/agents/__tests__/graph-integration.test.ts` | End-to-end integration tests |

### Deleted Files

| File | Reason |
|------|--------|
| `src/lib/db/queries/knowledge-items.ts` | Replaced by graph-data.ts |
| `src/lib/agents/knowledge-items.ts` | Replaced by knowledge-graph.ts |
| `src/lib/agents/tools/knowledge-item-tools.ts` | Replaced by graph-tools.ts |
| `src/lib/agents/__tests__/agent.test.ts` | Rewrite for graph system |
| `src/lib/agents/__tests__/knowledge-items.test.ts` | No longer needed |
| `src/lib/agents/tools/__tests__/knowledge-item-tools.test.ts` | No longer needed |

---

## Verification

### Automated Tests

```bash
# Run all tests
npm test

# Run graph-specific tests
npm test -- --grep "graph"
```

All test files should pass:
- `graph-schema.test.ts` - Schema tests
- `graph-types.test.ts` - Type query tests
- `graph-data.test.ts` - Data query tests
- `graph-type-initializer.test.ts` - Initialization tests
- `graph-tools.test.ts` - Tool tests
- `knowledge-graph.test.ts` - Service tests
- `graph-integration.test.ts` - Integration tests

### Manual Verification

1. **Database**: Run migrations, verify 6 new tables created
2. **Entity creation**: Create new entity, verify graph types initialized
3. **Agent work**: Run agent task, verify graph tools available
4. **Graph population**: Agent discovers info, adds nodes/edges
5. **Graph queries**: Agent queries graph for prior knowledge
6. **Type creation**: Agent creates new type when needed
7. **Context building**: Verify graph state appears in agent prompts

```bash
# Start services
docker compose up

# Test in UI:
# 1. Create new entity (e.g., "Investment Advisor" aide)
# 2. Check database: should have graph_node_types and graph_edge_types rows for this entity
# 3. Chat with agent, ask it to research something
# 4. Check database: should have graph_nodes and graph_edges
# 5. Ask agent about prior knowledge - should query graph
```

---

## Future Enhancements

1. **Graph visualization UI**: Display knowledge graph in entity detail page
2. **Type approval workflow**: Human approval for agent-created types
3. **Graph compaction**: Summarize/prune old nodes to manage growth
4. **Cross-entity knowledge**: Share global insights across entities
5. **Temporal queries**: Query graph state at a point in time
6. **Embeddings**: Vector similarity search over node/edge content
