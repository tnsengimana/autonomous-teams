/**
 * Tests for graph tools
 *
 * These tests verify the graph manipulation tools available to agents
 * during background work sessions.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '@/lib/db/client';
import {
  users,
  entities,
  graphNodes,
  graphNodeTypes,
  graphEdgeTypes,
} from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

// Import tools
import {
  addGraphNodeTool,
  addGraphEdgeTool,
  queryGraphTool,
  getGraphSummaryTool,
  createNodeTypeTool,
  createEdgeTypeTool,
} from '../graph-tools';
import type { GraphToolContext } from '../graph-tools';

// ============================================================================
// Test Setup
// ============================================================================

let testUserId: string;
let testEntityId: string;
let testContext: GraphToolContext;

beforeAll(async () => {
  // Create test user
  const [user] = await db.insert(users).values({
    email: `graph-tools-test-${Date.now()}@example.com`,
    name: 'Graph Tools Test User',
  }).returning();
  testUserId = user.id;

  // Create test entity
  const [entity] = await db.insert(entities).values({
    userId: testUserId,
    name: 'Graph Tools Test Team',
    purpose: 'Testing graph tools',
    systemPrompt: 'You are a test entity for graph tools testing.',
  }).returning();
  testEntityId = entity.id;

  // Create test context (conversationId is optional and not required for tests)
  testContext = {
    entityId: testEntityId,
  };

  // Create some initial node types for testing
  await db.insert(graphNodeTypes).values([
    {
      entityId: testEntityId,
      name: 'Company',
      description: 'A company or organization',
      propertiesSchema: {
        type: 'object',
        properties: {
          ticker: { type: 'string' },
          sector: { type: 'string' },
        },
      },
      createdBy: 'system',
    },
    {
      entityId: testEntityId,
      name: 'Person',
      description: 'An individual person',
      propertiesSchema: {
        type: 'object',
        properties: {
          role: { type: 'string' },
        },
      },
      createdBy: 'system',
    },
  ]);

  // Create an initial edge type for testing
  await db.insert(graphEdgeTypes).values({
    entityId: testEntityId,
    name: 'works_at',
    description: 'A person works at a company',
    createdBy: 'system',
  });
});

afterAll(async () => {
  // Cleanup: delete test user (cascades to entities, nodes, edges, types, etc.)
  await db.delete(users).where(eq(users.id, testUserId));
});

// Helper to cleanup nodes created during tests
async function cleanupNodes(nodeIds: string[]) {
  for (const id of nodeIds) {
    await db.delete(graphNodes).where(eq(graphNodes.id, id));
  }
}

// Helper to cleanup node types created during tests
async function cleanupNodeTypes(names: string[]) {
  for (const name of names) {
    await db.delete(graphNodeTypes).where(
      and(
        eq(graphNodeTypes.entityId, testEntityId),
        eq(graphNodeTypes.name, name)
      )
    );
  }
}

// Helper to cleanup edge types created during tests
async function cleanupEdgeTypes(names: string[]) {
  for (const name of names) {
    await db.delete(graphEdgeTypes).where(
      and(
        eq(graphEdgeTypes.entityId, testEntityId),
        eq(graphEdgeTypes.name, name)
      )
    );
  }
}

// ============================================================================
// addGraphNode Tests
// ============================================================================

describe('addGraphNode', () => {
  test('creates a new node with valid type', async () => {
    const result = await addGraphNodeTool.handler(
      {
        type: 'Company',
        name: 'Test Company',
        properties: { ticker: 'TEST', sector: 'Technology' },
      },
      testContext
    );

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect((result.data as { nodeId: string; action: string }).action).toBe('created');
    expect((result.data as { nodeId: string }).nodeId).toBeDefined();

    await cleanupNodes([(result.data as { nodeId: string }).nodeId]);
  });

  test('updates existing node with same type and name', async () => {
    // First create a node
    const createResult = await addGraphNodeTool.handler(
      {
        type: 'Company',
        name: 'Upsert Test Company',
        properties: { ticker: 'UPS1' },
      },
      testContext
    );

    expect(createResult.success).toBe(true);
    const nodeId = (createResult.data as { nodeId: string }).nodeId;

    // Now update it
    const updateResult = await addGraphNodeTool.handler(
      {
        type: 'Company',
        name: 'Upsert Test Company',
        properties: { ticker: 'UPS2', sector: 'Finance' },
      },
      testContext
    );

    expect(updateResult.success).toBe(true);
    expect((updateResult.data as { nodeId: string; action: string }).action).toBe('updated');
    expect((updateResult.data as { nodeId: string }).nodeId).toBe(nodeId);

    await cleanupNodes([nodeId]);
  });

  test('returns error for non-existent node type', async () => {
    const result = await addGraphNodeTool.handler(
      {
        type: 'NonExistentType',
        name: 'Test Node',
        properties: {},
      },
      testContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('does not exist');
  });

  test('validates required parameters', async () => {
    const result = await addGraphNodeTool.handler(
      {
        type: '',
        name: 'Test Node',
      },
      testContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid parameters');
  });
});

// ============================================================================
// addGraphEdge Tests
// ============================================================================

describe('addGraphEdge', () => {
  let companyNodeId: string;
  let personNodeId: string;

  beforeEach(async () => {
    // Create nodes for edge tests
    const companyResult = await addGraphNodeTool.handler(
      { type: 'Company', name: 'Edge Test Company', properties: {} },
      testContext
    );
    companyNodeId = (companyResult.data as { nodeId: string }).nodeId;

    const personResult = await addGraphNodeTool.handler(
      { type: 'Person', name: 'Edge Test Person', properties: {} },
      testContext
    );
    personNodeId = (personResult.data as { nodeId: string }).nodeId;
  });

  afterAll(async () => {
    await cleanupNodes([companyNodeId, personNodeId].filter(Boolean));
  });

  test('creates edge between existing nodes', async () => {
    const result = await addGraphEdgeTool.handler(
      {
        type: 'works_at',
        sourceName: 'Edge Test Person',
        sourceType: 'Person',
        targetName: 'Edge Test Company',
        targetType: 'Company',
      },
      testContext
    );

    expect(result.success).toBe(true);
    expect((result.data as { edgeId: string; action: string }).action).toBe('created');
    expect((result.data as { edgeId: string }).edgeId).toBeDefined();
  });

  test('returns already_exists for duplicate edge', async () => {
    // Create edge
    await addGraphEdgeTool.handler(
      {
        type: 'works_at',
        sourceName: 'Edge Test Person',
        sourceType: 'Person',
        targetName: 'Edge Test Company',
        targetType: 'Company',
      },
      testContext
    );

    // Try to create again
    const result = await addGraphEdgeTool.handler(
      {
        type: 'works_at',
        sourceName: 'Edge Test Person',
        sourceType: 'Person',
        targetName: 'Edge Test Company',
        targetType: 'Company',
      },
      testContext
    );

    expect(result.success).toBe(true);
    expect((result.data as { action: string }).action).toBe('already_exists');
  });

  test('returns error for non-existent source node', async () => {
    const result = await addGraphEdgeTool.handler(
      {
        type: 'works_at',
        sourceName: 'Non Existent Person',
        sourceType: 'Person',
        targetName: 'Edge Test Company',
        targetType: 'Company',
      },
      testContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Source node');
    expect(result.error).toContain('not found');
  });

  test('returns error for non-existent target node', async () => {
    const result = await addGraphEdgeTool.handler(
      {
        type: 'works_at',
        sourceName: 'Edge Test Person',
        sourceType: 'Person',
        targetName: 'Non Existent Company',
        targetType: 'Company',
      },
      testContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Target node');
    expect(result.error).toContain('not found');
  });

  test('returns error for non-existent edge type', async () => {
    const result = await addGraphEdgeTool.handler(
      {
        type: 'non_existent_relationship',
        sourceName: 'Edge Test Person',
        sourceType: 'Person',
        targetName: 'Edge Test Company',
        targetType: 'Company',
      },
      testContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('does not exist');
  });
});

// ============================================================================
// queryGraph Tests
// ============================================================================

describe('queryGraph', () => {
  const testNodeIds: string[] = [];

  beforeAll(async () => {
    // Create test nodes for querying
    const companies = ['Query Company A', 'Query Company B', 'Other Corp'];
    for (const name of companies) {
      const result = await addGraphNodeTool.handler(
        { type: 'Company', name, properties: {} },
        testContext
      );
      if (result.success) {
        testNodeIds.push((result.data as { nodeId: string }).nodeId);
      }
    }
  });

  afterAll(async () => {
    await cleanupNodes(testNodeIds);
  });

  test('returns nodes and edges', async () => {
    const result = await queryGraphTool.handler({}, testContext);

    expect(result.success).toBe(true);
    expect((result.data as { nodes: unknown[] }).nodes).toBeInstanceOf(Array);
    expect((result.data as { edges: unknown[] }).edges).toBeInstanceOf(Array);
  });

  test('filters by node type', async () => {
    const result = await queryGraphTool.handler(
      { nodeType: 'Company' },
      testContext
    );

    expect(result.success).toBe(true);
    const nodes = (result.data as { nodes: Array<{ type: string }> }).nodes;
    expect(nodes.every(n => n.type === 'Company')).toBe(true);
  });

  test('searches by name', async () => {
    const result = await queryGraphTool.handler(
      { searchTerm: 'Query Company' },
      testContext
    );

    expect(result.success).toBe(true);
    const nodes = (result.data as { nodes: Array<{ name: string }> }).nodes;
    expect(nodes.every(n => n.name.includes('Query Company'))).toBe(true);
  });

  test('respects limit parameter', async () => {
    const result = await queryGraphTool.handler(
      { limit: 2 },
      testContext
    );

    expect(result.success).toBe(true);
    const nodes = (result.data as { nodes: unknown[] }).nodes;
    expect(nodes.length).toBeLessThanOrEqual(2);
  });
});

// ============================================================================
// getGraphSummary Tests
// ============================================================================

describe('getGraphSummary', () => {
  test('returns statistics about the graph', async () => {
    // Create some test data
    const nodeResult = await addGraphNodeTool.handler(
      { type: 'Company', name: 'Stats Test Company', properties: {} },
      testContext
    );

    const result = await getGraphSummaryTool.handler({}, testContext);

    expect(result.success).toBe(true);
    const stats = result.data as {
      nodeCount: number;
      edgeCount: number;
      nodesByType: Record<string, number>;
      edgesByType: Record<string, number>;
    };
    expect(typeof stats.nodeCount).toBe('number');
    expect(typeof stats.edgeCount).toBe('number');
    expect(stats.nodesByType).toBeDefined();
    expect(stats.edgesByType).toBeDefined();

    await cleanupNodes([(nodeResult.data as { nodeId: string }).nodeId]);
  });
});

// ============================================================================
// createNodeType Tests
// ============================================================================

describe('createNodeType', () => {
  const testTypeNames: string[] = [];

  afterAll(async () => {
    await cleanupNodeTypes(testTypeNames);
  });

  test('creates new node type with PascalCase name', async () => {
    const result = await createNodeTypeTool.handler(
      {
        name: 'TestRegulation',
        description: 'A government regulation',
        propertiesSchema: {
          type: 'object',
          properties: {
            effectiveDate: { type: 'string' },
          },
        },
        exampleProperties: { effectiveDate: '2024-01-01' },
        justification: 'Need to track regulatory compliance',
      },
      testContext
    );

    expect(result.success).toBe(true);
    expect((result.data as { name: string }).name).toBe('TestRegulation');
    testTypeNames.push('TestRegulation');
  });

  test('rejects non-PascalCase names', async () => {
    const result = await createNodeTypeTool.handler(
      {
        name: 'test_regulation',
        description: 'A government regulation',
        propertiesSchema: {
          type: 'object',
          properties: {},
        },
        exampleProperties: {},
        justification: 'Testing naming validation',
      },
      testContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('PascalCase');
  });

  test('rejects duplicate type name', async () => {
    // First create a type
    await createNodeTypeTool.handler(
      {
        name: 'DuplicateTest',
        description: 'First type',
        propertiesSchema: { type: 'object', properties: {} },
        exampleProperties: {},
        justification: 'Testing',
      },
      testContext
    );
    testTypeNames.push('DuplicateTest');

    // Try to create duplicate
    const result = await createNodeTypeTool.handler(
      {
        name: 'DuplicateTest',
        description: 'Duplicate type',
        propertiesSchema: { type: 'object', properties: {} },
        exampleProperties: {},
        justification: 'Testing',
      },
      testContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
  });
});

// ============================================================================
// createEdgeType Tests
// ============================================================================

describe('createEdgeType', () => {
  const testEdgeTypeNames: string[] = [];

  afterAll(async () => {
    await cleanupEdgeTypes(testEdgeTypeNames);
  });

  test('creates new edge type with snake_case name', async () => {
    const result = await createEdgeTypeTool.handler(
      {
        name: 'regulates',
        description: 'A regulatory relationship',
        sourceNodeTypeNames: ['Company'],
        targetNodeTypeNames: ['Company'],
        justification: 'Need to track regulatory relationships',
      },
      testContext
    );

    expect(result.success).toBe(true);
    expect((result.data as { name: string }).name).toBe('regulates');
    testEdgeTypeNames.push('regulates');
  });

  test('rejects non-snake_case names', async () => {
    const result = await createEdgeTypeTool.handler(
      {
        name: 'RegulatesCompany',
        description: 'Bad name',
        sourceNodeTypeNames: ['Company'],
        targetNodeTypeNames: ['Company'],
        justification: 'Testing',
      },
      testContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('snake_case');
  });

  test('rejects duplicate edge type name', async () => {
    // First create an edge type
    await createEdgeTypeTool.handler(
      {
        name: 'duplicate_edge',
        description: 'First edge type',
        sourceNodeTypeNames: ['Company'],
        targetNodeTypeNames: ['Person'],
        justification: 'Testing',
      },
      testContext
    );
    testEdgeTypeNames.push('duplicate_edge');

    // Try to create duplicate
    const result = await createEdgeTypeTool.handler(
      {
        name: 'duplicate_edge',
        description: 'Duplicate',
        sourceNodeTypeNames: ['Company'],
        targetNodeTypeNames: ['Person'],
        justification: 'Testing',
      },
      testContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
  });

  test('rejects edge type with non-existent source node type', async () => {
    const result = await createEdgeTypeTool.handler(
      {
        name: 'invalid_source_edge',
        description: 'Edge with invalid source',
        sourceNodeTypeNames: ['NonExistentType'],
        targetNodeTypeNames: ['Company'],
        justification: 'Testing',
      },
      testContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Source node type');
    expect(result.error).toContain('does not exist');
  });

  test('rejects edge type with non-existent target node type', async () => {
    const result = await createEdgeTypeTool.handler(
      {
        name: 'invalid_target_edge',
        description: 'Edge with invalid target',
        sourceNodeTypeNames: ['Company'],
        targetNodeTypeNames: ['NonExistentType'],
        justification: 'Testing',
      },
      testContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Target node type');
    expect(result.error).toContain('does not exist');
  });

  test('creates edge type with optional properties schema', async () => {
    const result = await createEdgeTypeTool.handler(
      {
        name: 'with_props',
        description: 'Edge with properties',
        sourceNodeTypeNames: ['Person'],
        targetNodeTypeNames: ['Company'],
        propertiesSchema: {
          type: 'object',
          properties: {
            startDate: { type: 'string' },
          },
        },
        exampleProperties: { startDate: '2024-01-01' },
        justification: 'Testing properties',
      },
      testContext
    );

    expect(result.success).toBe(true);
    testEdgeTypeNames.push('with_props');
  });
});
