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
  agents,
  graphNodes,
  graphNodeTypes,
  graphEdgeTypes,
  inboxItems,
  conversations,
  messages,
} from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

// Import tools
import {
  addGraphNodeTool,
  addGraphEdgeTool,
  queryGraphTool,
  getGraphSummaryTool,
  listNodeTypesTool,
  listEdgeTypesTool,
  createNodeTypeTool,
  createEdgeTypeTool,
  addAgentAnalysisNodeTool,
  AddAgentAnalysisNodeParamsSchema,
  addAgentAdviceNodeTool,
  AddAgentAdviceNodeParamsSchema,
} from '../graph-tools';
import type { GraphToolContext } from '../graph-tools';

// ============================================================================
// Test Setup
// ============================================================================

let testUserId: string;
let testAgentId: string;
let testContext: GraphToolContext;

beforeAll(async () => {
  // Create test user
  const [user] = await db.insert(users).values({
    email: `graph-tools-test-${Date.now()}@example.com`,
    name: 'Graph Tools Test User',
  }).returning();
  testUserId = user.id;

  // Create test agent
  const [agent] = await db.insert(agents).values({
    userId: testUserId,
    name: 'Graph Tools Test Team',
    purpose: 'Testing graph tools',
    conversationSystemPrompt: 'You are a test agent for graph tools testing.',
    queryIdentificationSystemPrompt: 'You identify queries for testing.',
    insightIdentificationSystemPrompt: 'You identify insights for testing.',
    analysisGenerationSystemPrompt: 'You generate analyses for testing.',
    adviceGenerationSystemPrompt: 'You generate advice for testing.',
    knowledgeAcquisitionSystemPrompt: 'You gather knowledge for testing.',
    graphConstructionSystemPrompt: 'You construct graphs for testing.',
    iterationIntervalMs: 300000,
  }).returning();
  testAgentId = agent.id;

  // Create test context (conversationId is optional and not required for tests)
  testContext = {
    agentId: testAgentId,
  };

  // Create some initial node types for testing
  await db.insert(graphNodeTypes).values([
    {
      agentId: testAgentId,
      name: 'Company',
      description: 'A company or organization',
      justification: 'Baseline entity type for organizations referenced in graph tests.',
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
      agentId: testAgentId,
      name: 'Person',
      description: 'An individual person',
      justification: 'Baseline entity type for people referenced in graph tests.',
      propertiesSchema: {
        type: 'object',
        properties: {
          role: { type: 'string' },
        },
      },
      createdBy: 'system',
    },
    {
      agentId: testAgentId,
      name: 'Market Quote',
      description: 'A time-stamped market quote and related trading metrics',
      justification: 'Dedicated type for numeric quote data to avoid overloading Company nodes in tests.',
      propertiesSchema: {
        type: 'object',
        required: ['price', 'currency', 'as_of'],
        properties: {
          price: { type: 'number' },
          currency: { type: 'string' },
          volume: { type: 'number' },
          as_of: { type: 'string', format: 'date-time' },
          raw_text: { type: 'string' },
        },
      },
      createdBy: 'system',
    },
    {
      agentId: testAgentId,
      name: 'AgentAnalysis',
      description: 'Agent-derived observations and patterns from knowledge analysis',
      justification: 'Required baseline node type for analysis outputs in graph tool tests.',
      propertiesSchema: {
        type: 'object',
        required: ['type', 'summary', 'content', 'generated_at'],
        properties: {
          type: { type: 'string', enum: ['observation', 'pattern'] },
          summary: { type: 'string' },
          content: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          generated_at: { type: 'string', format: 'date-time' },
        },
      },
      createdBy: 'system',
    },
    {
      agentId: testAgentId,
      name: 'AgentAdvice',
      description: 'Actionable investment recommendation derived exclusively from AgentAnalysis analysis',
      justification: 'Required baseline node type for advice outputs in graph tool tests.',
      propertiesSchema: {
        type: 'object',
        required: ['action', 'summary', 'content', 'generated_at'],
        properties: {
          action: { type: 'string', enum: ['BUY', 'SELL', 'HOLD'] },
          summary: { type: 'string' },
          content: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          generated_at: { type: 'string', format: 'date-time' },
        },
      },
      createdBy: 'system',
    },
  ]);

  // Create initial edge types for testing
  await db.insert(graphEdgeTypes).values([
    {
      agentId: testAgentId,
      name: 'works_at',
      description: 'A person works at a company',
      justification: 'Baseline relationship needed for graph edge tool tests.',
      createdBy: 'system',
    },
    {
      agentId: testAgentId,
      name: 'derived_from',
      description: 'An analysis is derived from source data',
      justification: 'Baseline lineage relationship needed for analysis linkage tests.',
      createdBy: 'system',
    },
    {
      agentId: testAgentId,
      name: 'has_quote_metric',
      description: 'Connects an entity relationship to a numeric quote/metric payload',
      justification: 'Used to verify edge property schema validation behavior in tests.',
      propertiesSchema: {
        type: 'object',
        required: ['price', 'as_of'],
        properties: {
          price: { type: 'number' },
          as_of: { type: 'string', format: 'date-time' },
          raw_text: { type: 'string' },
        },
      },
      createdBy: 'system',
    },
  ]);
});

afterAll(async () => {
  // Cleanup: delete test user (cascades to agents, nodes, edges, types, etc.)
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
        eq(graphNodeTypes.agentId, testAgentId),
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
        eq(graphEdgeTypes.agentId, testAgentId),
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
    expect(result.error).toContain('Available node types');
    expect(result.error).toContain('listNodeTypes');
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

  test('rejects stringified numeric properties when schema expects number', async () => {
    const result = await addGraphNodeTool.handler(
      {
        type: 'Market Quote',
        name: 'NVDA Quote Invalid Numeric',
        properties: {
          price: '$171.88',
          currency: 'USD',
          as_of: '2026-02-06T10:00:00Z',
        },
      },
      testContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('NODE_PROPERTIES_SCHEMA_VALIDATION_FAILED');
    expect(result.error).toContain('properties.price expected number');
  });

  test('rejects missing required properties from type schema', async () => {
    const result = await addGraphNodeTool.handler(
      {
        type: 'Market Quote',
        name: 'NVDA Quote Missing Required',
        properties: {
          currency: 'USD',
          as_of: '2026-02-06T10:00:00Z',
        },
      },
      testContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('NODE_PROPERTIES_SCHEMA_VALIDATION_FAILED');
    expect(result.error).toContain('properties.price is required');
  });

  test('validates merged properties on update against schema', async () => {
    const createResult = await addGraphNodeTool.handler(
      {
        type: 'Market Quote',
        name: 'AAPL Quote Upsert Validation',
        properties: {
          price: 171.88,
          currency: 'USD',
          volume: 206_310_000,
          as_of: '2026-02-06T10:00:00Z',
        },
      },
      testContext
    );

    expect(createResult.success).toBe(true);
    const nodeId = (createResult.data as { nodeId: string }).nodeId;

    const updateResult = await addGraphNodeTool.handler(
      {
        type: 'Market Quote',
        name: 'AAPL Quote Upsert Validation',
        properties: {
          volume: '206.31M',
        },
      },
      testContext
    );

    expect(updateResult.success).toBe(false);
    expect(updateResult.error).toContain('NODE_PROPERTIES_SCHEMA_VALIDATION_FAILED');
    expect(updateResult.error).toContain('properties.volume expected number');

    await cleanupNodes([nodeId]);
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
    expect(result.error).toContain('Available edge types');
    expect(result.error).toContain('listEdgeTypes');
  });

  test('rejects edge properties with invalid numeric type', async () => {
    const result = await addGraphEdgeTool.handler(
      {
        type: 'has_quote_metric',
        sourceName: 'Edge Test Person',
        sourceType: 'Person',
        targetName: 'Edge Test Company',
        targetType: 'Company',
        properties: {
          price: '$171.88',
          as_of: '2026-02-06T10:00:00Z',
        },
      },
      testContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('EDGE_PROPERTIES_SCHEMA_VALIDATION_FAILED');
    expect(result.error).toContain('properties.price expected number');
  });

  test('rejects edge properties missing required fields', async () => {
    const result = await addGraphEdgeTool.handler(
      {
        type: 'has_quote_metric',
        sourceName: 'Edge Test Person',
        sourceType: 'Person',
        targetName: 'Edge Test Company',
        targetType: 'Company',
        properties: {
          price: 171.88,
        },
      },
      testContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('EDGE_PROPERTIES_SCHEMA_VALIDATION_FAILED');
    expect(result.error).toContain('properties.as_of is required');
  });

  test('creates edge when edge properties satisfy schema', async () => {
    const result = await addGraphEdgeTool.handler(
      {
        type: 'has_quote_metric',
        sourceName: 'Edge Test Person',
        sourceType: 'Person',
        targetName: 'Edge Test Company',
        targetType: 'Company',
        properties: {
          price: 171.88,
          as_of: '2026-02-06T10:00:00Z',
          raw_text: '$171.88',
        },
      },
      testContext
    );

    expect(result.success).toBe(true);
    expect((result.data as { action: string }).action).toBe('created');
  });

});

// ============================================================================
// queryGraph Tests
// ============================================================================

describe('queryGraph', () => {
  const testNodeIds: string[] = [];
  let queryEdgeId: string | null = null;

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

    const edgeResult = await addGraphEdgeTool.handler(
      {
        type: 'derived_from',
        sourceName: 'Query Company A',
        sourceType: 'Company',
        targetName: 'Query Company B',
        targetType: 'Company',
      },
      testContext
    );

    if (edgeResult.success) {
      queryEdgeId = (edgeResult.data as { edgeId: string }).edgeId;
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
    const edges = (result.data as { edges: Array<{ id: string }> }).edges;
    if (queryEdgeId) {
      expect(edges.some((edge) => edge.id === queryEdgeId)).toBe(true);
    }
    expect(edges.every((edge) => typeof edge.id === 'string')).toBe(true);
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
// listNodeTypes Tests
// ============================================================================

describe('listNodeTypes', () => {
  test('returns available node types with schema details', async () => {
    const result = await listNodeTypesTool.handler({}, testContext);

    expect(result.success).toBe(true);
    const nodeTypes = (result.data as {
      nodeTypes: Array<{
        name: string;
        description: string;
        propertiesSchema: unknown;
      }>;
    }).nodeTypes;

    expect(Array.isArray(nodeTypes)).toBe(true);
    expect(nodeTypes.some((type) => type.name === 'Company')).toBe(true);
    expect(nodeTypes.some((type) => type.name === 'AgentAnalysis')).toBe(true);
    expect(nodeTypes.every((type) => type.description.length > 0)).toBe(true);
    expect(nodeTypes.every((type) => type.propertiesSchema !== undefined)).toBe(true);
  });
});

// ============================================================================
// listEdgeTypes Tests
// ============================================================================

describe('listEdgeTypes', () => {
  test('returns available edge types with metadata', async () => {
    const result = await listEdgeTypesTool.handler({}, testContext);

    expect(result.success).toBe(true);
    const edgeTypes = (result.data as {
      edgeTypes: Array<{
        name: string;
        description: string;
        justification: string;
      }>;
    }).edgeTypes;

    expect(Array.isArray(edgeTypes)).toBe(true);
    expect(edgeTypes.some((type) => type.name === 'works_at')).toBe(true);
    expect(edgeTypes.some((type) => type.name === 'derived_from')).toBe(true);
    expect(edgeTypes.every((type) => type.description.length > 0)).toBe(true);
    expect(edgeTypes.every((type) => type.justification.length > 0)).toBe(true);
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

  test('creates new node type with capitalized name (spaces allowed)', async () => {
    const result = await createNodeTypeTool.handler(
      {
        name: 'Test Regulation',
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
    expect((result.data as { name: string }).name).toBe('Test Regulation');
    const persisted = await db
      .select()
      .from(graphNodeTypes)
      .where(
        and(
          eq(graphNodeTypes.agentId, testAgentId),
          eq(graphNodeTypes.name, 'Test Regulation')
        )
      );
    expect(persisted[0]?.justification).toBe('Need to track regulatory compliance');
    testTypeNames.push('Test Regulation');
  });

  test('rejects node type names that do not start with a capital letter', async () => {
    const result = await createNodeTypeTool.handler(
      {
        name: 'test regulation',
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
    expect(result.error).toContain('start with a capital letter');
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
        justification: 'Need to track regulatory relationships',
      },
      testContext
    );

    expect(result.success).toBe(true);
    expect((result.data as { name: string }).name).toBe('regulates');
    const persisted = await db
      .select()
      .from(graphEdgeTypes)
      .where(
        and(
          eq(graphEdgeTypes.agentId, testAgentId),
          eq(graphEdgeTypes.name, 'regulates')
        )
      );
    expect(persisted[0]?.justification).toBe('Need to track regulatory relationships');
    testEdgeTypeNames.push('regulates');
  });

  test('rejects non-snake_case names', async () => {
    const result = await createEdgeTypeTool.handler(
      {
        name: 'RegulatesCompany',
        description: 'Bad name',
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
        justification: 'Testing',
      },
      testContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
  });

  test('creates edge type with optional properties schema', async () => {
    const result = await createEdgeTypeTool.handler(
      {
        name: 'with_props',
        description: 'Edge with properties',
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

// ============================================================================
// addAgentAnalysisNode Tests
// ============================================================================

describe('addAgentAnalysisNode', () => {
  const createdAnalysisIds: string[] = [];
  const citationNodeIds: string[] = [];
  let citedNodeOneId = '';
  let citedNodeTwoId = '';
  let citedEdgeId = '';

  beforeAll(async () => {
    const citedCompanyResult = await addGraphNodeTool.handler(
      {
        type: 'Company',
        name: 'Citation Company',
        properties: { ticker: 'CITE1' },
      },
      testContext
    );
    const citedPersonResult = await addGraphNodeTool.handler(
      {
        type: 'Person',
        name: 'Citation Analyst',
        properties: { role: 'Analyst' },
      },
      testContext
    );

    expect(citedCompanyResult.success).toBe(true);
    expect(citedPersonResult.success).toBe(true);

    citedNodeOneId = (citedCompanyResult.data as { nodeId: string }).nodeId;
    citedNodeTwoId = (citedPersonResult.data as { nodeId: string }).nodeId;
    citationNodeIds.push(citedNodeOneId, citedNodeTwoId);

    const citedEdgeResult = await addGraphEdgeTool.handler(
      {
        type: 'works_at',
        sourceName: 'Citation Analyst',
        sourceType: 'Person',
        targetName: 'Citation Company',
        targetType: 'Company',
      },
      testContext
    );

    expect(citedEdgeResult.success).toBe(true);
    citedEdgeId = (citedEdgeResult.data as { edgeId: string }).edgeId;
  });

  afterAll(async () => {
    await cleanupNodes([...createdAnalysisIds, ...citationNodeIds]);
  });

  test('creates observation analysis', async () => {
    const result = await addAgentAnalysisNodeTool.handler(
      {
        name: 'Market Trend Observation',
        properties: {
          type: 'observation',
          summary: 'Tech sector showing increased volatility after Fed announcement.',
          content: `## Observation

The technology sector has experienced increased volatility [node:${citedNodeOneId}] following the latest Federal Reserve announcement [node:${citedNodeTwoId}].

### Key Data Points
- VIX increased 15% in the past week
- Tech-heavy NASDAQ underperformed S&P 500 by 2.3%`,
          generated_at: new Date().toISOString(),
        },
      },
      testContext
    );

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect((result.data as { nodeId: string }).nodeId).toBeDefined();
    expect((result.data as { message: string }).message).toContain('Created AgentAnalysis');
    // AgentAnalysis does NOT create inbox items
    expect((result.data as Record<string, unknown>).inboxItemId).toBeUndefined();

    createdAnalysisIds.push((result.data as { nodeId: string }).nodeId);
  });

  test('creates pattern analysis', async () => {
    const result = await addAgentAnalysisNodeTool.handler(
      {
        name: 'Earnings Season Pattern',
        properties: {
          type: 'pattern',
          summary: 'Stocks typically rally 3-5% in the week following positive earnings surprises.',
          content: `## Pattern Analysis

Historical analysis of earnings season data [node:${citedNodeOneId}] reveals a consistent pattern.

### Evidence
Based on 50 earnings reports analyzed [edge:${citedEdgeId}], companies that beat earnings by >10% saw average returns of 4.2% in the following week.`,
          confidence: 0.72,
          generated_at: new Date().toISOString(),
        },
      },
      testContext
    );

    expect(result.success).toBe(true);
    createdAnalysisIds.push((result.data as { nodeId: string }).nodeId);
  });

  test('rejects analysis missing content field', async () => {
    const result = await addAgentAnalysisNodeTool.handler(
      {
        name: 'Invalid Analysis - No Content',
        properties: {
          type: 'observation',
          summary: 'This analysis is missing the content field.',
          generated_at: new Date().toISOString(),
        },
      },
      testContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid parameters');
  });

  test('rejects analysis missing summary field', async () => {
    const result = await addAgentAnalysisNodeTool.handler(
      {
        name: 'Invalid Analysis - No Summary',
        properties: {
          type: 'observation',
          content: 'This analysis is missing the summary field.',
          generated_at: new Date().toISOString(),
        },
      },
      testContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid parameters');
  });

  test('rejects analysis with invalid type', async () => {
    const result = await addAgentAnalysisNodeTool.handler(
      {
        name: 'Invalid Analysis - Bad Type',
        properties: {
          type: 'signal',
          summary: 'Signal is no longer a valid type.',
          content: 'Detailed content here.',
          generated_at: new Date().toISOString(),
        },
      },
      testContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid parameters');
  });

  test('rejects analysis missing generated_at', async () => {
    const result = await addAgentAnalysisNodeTool.handler(
      {
        name: 'Invalid Analysis - No Timestamp',
        properties: {
          type: 'observation',
          summary: 'This analysis is missing generated_at.',
          content: 'Detailed content here.',
        },
      },
      testContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid parameters');
  });

  test('allows analysis without optional confidence field', async () => {
    const result = await addAgentAnalysisNodeTool.handler(
      {
        name: 'Analysis Without Confidence',
        properties: {
          type: 'observation',
          summary: 'This analysis does not have a confidence score.',
          content: `Detailed observation content without confidence [node:${citedNodeOneId}].`,
          generated_at: new Date().toISOString(),
        },
      },
      testContext
    );

    expect(result.success).toBe(true);
    createdAnalysisIds.push((result.data as { nodeId: string }).nodeId);
  });

  test('rejects confidence outside valid range', async () => {
    const resultTooHigh = await addAgentAnalysisNodeTool.handler(
      {
        name: 'Invalid Confidence High',
        properties: {
          type: 'observation',
          summary: 'Confidence too high.',
          content: `Detailed content [node:${citedNodeOneId}].`,
          confidence: 1.5,
          generated_at: new Date().toISOString(),
        },
      },
      testContext
    );

    expect(resultTooHigh.success).toBe(false);
    expect(resultTooHigh.error).toContain('Invalid parameters');

    const resultTooLow = await addAgentAnalysisNodeTool.handler(
      {
        name: 'Invalid Confidence Low',
        properties: {
          type: 'observation',
          summary: 'Confidence too low.',
          content: `Detailed content [node:${citedNodeOneId}].`,
          confidence: -0.1,
          generated_at: new Date().toISOString(),
        },
      },
      testContext
    );

    expect(resultTooLow.success).toBe(false);
    expect(resultTooLow.error).toContain('Invalid parameters');
  });

  test('rejects analysis without citations', async () => {
    const result = await addAgentAnalysisNodeTool.handler(
      {
        name: 'Invalid Analysis - No Citations',
        properties: {
          type: 'observation',
          summary: 'Citationless analysis should be rejected.',
          content: 'This analysis has claims but no graph citations.',
          generated_at: new Date().toISOString(),
        },
      },
      testContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('must include at least one citation');
  });

  test('rejects analysis with malformed citation IDs', async () => {
    const result = await addAgentAnalysisNodeTool.handler(
      {
        name: 'Invalid Analysis - Malformed Citation',
        properties: {
          type: 'observation',
          summary: 'Malformed citation should be rejected.',
          content:
            'This analysis cites by name [node:NVIDIA Corporation (NVDA)] instead of UUID.',
          generated_at: new Date().toISOString(),
        },
      },
      testContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid citation format');
  });

  test('rejects analysis citing unknown graph IDs', async () => {
    const result = await addAgentAnalysisNodeTool.handler(
      {
        name: 'Invalid Analysis - Unknown Citation',
        properties: {
          type: 'observation',
          summary: 'Unknown node citation should be rejected.',
          content:
            'This analysis cites a missing node [node:00000000-0000-0000-0000-000000000001].',
          generated_at: new Date().toISOString(),
        },
      },
      testContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('unknown or unauthorized');
  });
});

// ============================================================================
// addAgentAdviceNode Tests
// ============================================================================

describe('addAgentAdviceNode', () => {
  const createdAdviceIds: string[] = [];

  afterAll(async () => {
    await cleanupNodes(createdAdviceIds);
    await db.delete(inboxItems).where(eq(inboxItems.agentId, testAgentId));
  });

  test('creates advice with BUY action and notifies user', async () => {
    const result = await addAgentAdviceNodeTool.handler(
      {
        name: 'AAPL Buy Recommendation',
        properties: {
          action: 'BUY',
          summary: 'Strong buy signal for AAPL based on services growth momentum.',
          content: `## Recommendation: BUY

Based on recent analysis, AAPL presents a compelling opportunity.

### Supporting AgentAnalyses
- [node:analysis-123] Services revenue pattern
- [node:analysis-456] Institutional accumulation observation

### Risk Factors
- China revenue exposure`,
          confidence: 0.85,
          generated_at: new Date().toISOString(),
        },
      },
      testContext
    );

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect((result.data as { nodeId: string }).nodeId).toBeDefined();
    expect((result.data as { inboxItemId: string }).inboxItemId).toBeDefined();
    expect((result.data as { message: string }).message).toContain('Created AgentAdvice');

    createdAdviceIds.push((result.data as { nodeId: string }).nodeId);
  });

  test('creates advice with SELL action', async () => {
    const result = await addAgentAdviceNodeTool.handler(
      {
        name: 'XYZ Sell Recommendation',
        properties: {
          action: 'SELL',
          summary: 'Recommend selling XYZ due to declining fundamentals.',
          content: `## Recommendation: SELL

Analysis shows deteriorating fundamentals.

### Supporting AgentAnalyses
- [node:analysis-789] Revenue decline pattern`,
          generated_at: new Date().toISOString(),
        },
      },
      testContext
    );

    expect(result.success).toBe(true);
    createdAdviceIds.push((result.data as { nodeId: string }).nodeId);
  });

  test('creates advice with HOLD action', async () => {
    const result = await addAgentAdviceNodeTool.handler(
      {
        name: 'ABC Hold Recommendation',
        properties: {
          action: 'HOLD',
          summary: 'Maintain position in ABC pending further data.',
          content: `## Recommendation: HOLD

Current data is insufficient to change position.

### Supporting AgentAnalyses
- [node:analysis-101] Mixed signals observation`,
          generated_at: new Date().toISOString(),
        },
      },
      testContext
    );

    expect(result.success).toBe(true);
    createdAdviceIds.push((result.data as { nodeId: string }).nodeId);
  });

  test('creates inbox notification for advice', async () => {
    const adviceName = `Inbox Test Advice ${Date.now()}`;
    const result = await addAgentAdviceNodeTool.handler(
      {
        name: adviceName,
        properties: {
          action: 'BUY',
          summary: 'This advice should create an inbox item.',
          content: 'Detailed reasoning citing [node:analysis-123].',
          generated_at: new Date().toISOString(),
        },
      },
      testContext
    );

    expect(result.success).toBe(true);
    const inboxItemId = (result.data as { inboxItemId: string }).inboxItemId;
    expect(inboxItemId).toBeDefined();

    // Verify inbox item was created
    const [inboxItem] = await db
      .select()
      .from(inboxItems)
      .where(eq(inboxItems.id, inboxItemId));

    expect(inboxItem).toBeDefined();
    expect(inboxItem.title).toContain(adviceName);
    expect(inboxItem.title).toContain('BUY');
    expect(inboxItem.content).toBe('This advice should create an inbox item.');

    createdAdviceIds.push((result.data as { nodeId: string }).nodeId);
  });

  test('rejects advice with invalid action', async () => {
    const result = await addAgentAdviceNodeTool.handler(
      {
        name: 'Invalid Action',
        properties: {
          action: 'WAIT',
          summary: 'Invalid action type.',
          content: 'Content.',
          generated_at: new Date().toISOString(),
        },
      },
      testContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid parameters');
  });

  test('rejects advice missing required fields', async () => {
    const result = await addAgentAdviceNodeTool.handler(
      {
        name: 'Missing Fields',
        properties: {
          action: 'BUY',
          generated_at: new Date().toISOString(),
        },
      },
      testContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid parameters');
  });
});

// ============================================================================
// AddAgentAnalysisNodeParamsSchema Validation Tests
// ============================================================================

describe('AddAgentAnalysisNodeParamsSchema', () => {
  test('validates complete analysis with all fields', () => {
    const result = AddAgentAnalysisNodeParamsSchema.safeParse({
      name: 'Complete Analysis',
      properties: {
        type: 'observation',
        summary: 'Brief summary.',
        content: 'Detailed content with [node:abc123] citation.',
        confidence: 0.9,
        generated_at: '2026-02-05T10:00:00Z',
      },
    });

    expect(result.success).toBe(true);
  });

  test('requires content field', () => {
    const result = AddAgentAnalysisNodeParamsSchema.safeParse({
      name: 'Missing Content',
      properties: {
        type: 'observation',
        summary: 'Brief summary.',
        generated_at: '2026-02-05T10:00:00Z',
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const contentError = result.error.issues.find(
        issue => issue.path.includes('content')
      );
      expect(contentError).toBeDefined();
    }
  });

  test('requires summary field', () => {
    const result = AddAgentAnalysisNodeParamsSchema.safeParse({
      name: 'Missing Summary',
      properties: {
        type: 'observation',
        content: 'Detailed content.',
        generated_at: '2026-02-05T10:00:00Z',
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const summaryError = result.error.issues.find(
        issue => issue.path.includes('summary')
      );
      expect(summaryError).toBeDefined();
    }
  });

  test('validates type enum values', () => {
    const validTypes = ['observation', 'pattern'];

    for (const type of validTypes) {
      const result = AddAgentAnalysisNodeParamsSchema.safeParse({
        name: `Valid ${type}`,
        properties: {
          type,
          summary: 'Summary.',
          content: 'Content.',
          generated_at: '2026-02-05T10:00:00Z',
        },
      });
      expect(result.success).toBe(true);
    }

    // Signal is no longer valid
    const invalidResult = AddAgentAnalysisNodeParamsSchema.safeParse({
      name: 'Invalid Type',
      properties: {
        type: 'signal',
        summary: 'Summary.',
        content: 'Content.',
        generated_at: '2026-02-05T10:00:00Z',
      },
    });
    expect(invalidResult.success).toBe(false);
  });

  test('confidence must be between 0 and 1', () => {
    const validValues = [0, 0.5, 1];
    for (const confidence of validValues) {
      const result = AddAgentAnalysisNodeParamsSchema.safeParse({
        name: 'Valid Confidence',
        properties: {
          type: 'observation',
          summary: 'Summary.',
          content: 'Content.',
          confidence,
          generated_at: '2026-02-05T10:00:00Z',
        },
      });
      expect(result.success).toBe(true);
    }

    const invalidValues = [-0.1, 1.1, 2];
    for (const confidence of invalidValues) {
      const result = AddAgentAnalysisNodeParamsSchema.safeParse({
        name: 'Invalid Confidence',
        properties: {
          type: 'observation',
          summary: 'Summary.',
          content: 'Content.',
          confidence,
          generated_at: '2026-02-05T10:00:00Z',
        },
      });
      expect(result.success).toBe(false);
    }
  });

  test('content cannot be empty string', () => {
    const result = AddAgentAnalysisNodeParamsSchema.safeParse({
      name: 'Empty Content',
      properties: {
        type: 'observation',
        summary: 'Summary.',
        content: '',
        generated_at: '2026-02-05T10:00:00Z',
      },
    });

    expect(result.success).toBe(false);
  });

  test('summary cannot be empty string', () => {
    const result = AddAgentAnalysisNodeParamsSchema.safeParse({
      name: 'Empty Summary',
      properties: {
        type: 'observation',
        summary: '',
        content: 'Content.',
        generated_at: '2026-02-05T10:00:00Z',
      },
    });

    expect(result.success).toBe(false);
  });
});

// ============================================================================
// AddAgentAdviceNodeParamsSchema Validation Tests
// ============================================================================

describe('AddAgentAdviceNodeParamsSchema', () => {
  test('validates complete advice with all fields', () => {
    const result = AddAgentAdviceNodeParamsSchema.safeParse({
      name: 'Complete Advice',
      properties: {
        action: 'BUY',
        summary: 'Brief recommendation summary.',
        content: 'Detailed reasoning citing [node:analysis-123].',
        confidence: 0.9,
        generated_at: '2026-02-05T10:00:00Z',
      },
    });

    expect(result.success).toBe(true);
  });

  test('validates action enum values', () => {
    const validActions = ['BUY', 'SELL', 'HOLD'];

    for (const action of validActions) {
      const result = AddAgentAdviceNodeParamsSchema.safeParse({
        name: `Valid ${action}`,
        properties: {
          action,
          summary: 'Summary.',
          content: 'Content.',
          generated_at: '2026-02-05T10:00:00Z',
        },
      });
      expect(result.success).toBe(true);
    }

    // Invalid action
    const invalidResult = AddAgentAdviceNodeParamsSchema.safeParse({
      name: 'Invalid Action',
      properties: {
        action: 'WAIT',
        summary: 'Summary.',
        content: 'Content.',
        generated_at: '2026-02-05T10:00:00Z',
      },
    });
    expect(invalidResult.success).toBe(false);
  });

  test('requires summary field', () => {
    const result = AddAgentAdviceNodeParamsSchema.safeParse({
      name: 'Missing Summary',
      properties: {
        action: 'BUY',
        content: 'Detailed content.',
        generated_at: '2026-02-05T10:00:00Z',
      },
    });

    expect(result.success).toBe(false);
  });

  test('requires content field', () => {
    const result = AddAgentAdviceNodeParamsSchema.safeParse({
      name: 'Missing Content',
      properties: {
        action: 'BUY',
        summary: 'Brief summary.',
        generated_at: '2026-02-05T10:00:00Z',
      },
    });

    expect(result.success).toBe(false);
  });

  test('confidence must be between 0 and 1', () => {
    const invalidValues = [-0.1, 1.1, 2];
    for (const confidence of invalidValues) {
      const result = AddAgentAdviceNodeParamsSchema.safeParse({
        name: 'Invalid Confidence',
        properties: {
          action: 'BUY',
          summary: 'Summary.',
          content: 'Content.',
          confidence,
          generated_at: '2026-02-05T10:00:00Z',
        },
      });
      expect(result.success).toBe(false);
    }
  });
});
