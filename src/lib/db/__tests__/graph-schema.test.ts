import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db/client';
import {
  users,
  agents,
  conversations,
  graphNodeTypes,
  graphEdgeTypes,
  graphNodes,
  graphEdges,
} from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

// Test utilities
let testUserId: string;
let testAgentId: string;
let testConversationId: string;

beforeAll(async () => {
  // Create test user
  const [user] = await db.insert(users).values({
    email: `test-graph-${Date.now()}@example.com`,
    name: 'Graph Test User',
  }).returning();
  testUserId = user.id;

  // Create test agent
  const [agent] = await db.insert(agents).values({
    userId: testUserId,
    name: 'Graph Test Team',
    purpose: 'Testing knowledge graph',
    conversationSystemPrompt: 'You are a test agent for knowledge graph testing.',
    observerSystemPrompt: 'You observe and classify information for testing.',
    analysisGenerationSystemPrompt: 'You generate analyses for testing.',
    adviceGenerationSystemPrompt: 'You generate advice for testing.',
    graphConstructionSystemPrompt: 'You construct graphs for testing.',
    iterationIntervalMs: 300000,
  }).returning();
  testAgentId = agent.id;

  // Create test conversation
  const [conversation] = await db.insert(conversations).values({
    agentId: testAgentId,
  }).returning();
  testConversationId = conversation.id;
});

afterAll(async () => {
  // Cleanup: delete test user (cascades to agents, etc.)
  await db.delete(users).where(eq(users.id, testUserId));
});

describe('graphNodeTypes schema', () => {
  test('creates node type with all fields', async () => {
    const propertiesSchema = {
      type: 'object',
      required: ['symbol'],
      properties: {
        symbol: { type: 'string' },
        name: { type: 'string' },
      },
    };
    const exampleProperties = { symbol: 'AAPL', name: 'Apple Inc.' };

    const [nodeType] = await db.insert(graphNodeTypes).values({
      agentId: testAgentId,
      name: 'Asset',
      description: 'A financial asset such as a stock or bond',
      justification: 'Schema test for full node type creation.',
      propertiesSchema,
      exampleProperties,
      createdBy: 'system',
    }).returning();

    expect(nodeType.id).toBeDefined();
    expect(nodeType.agentId).toBe(testAgentId);
    expect(nodeType.name).toBe('Asset');
    expect(nodeType.description).toBe('A financial asset such as a stock or bond');
    expect(nodeType.propertiesSchema).toEqual(propertiesSchema);
    expect(nodeType.exampleProperties).toEqual(exampleProperties);
    expect(nodeType.createdBy).toBe('system');
    expect(nodeType.createdAt).toBeDefined();

    // Cleanup
    await db.delete(graphNodeTypes).where(eq(graphNodeTypes.id, nodeType.id));
  });

  test('creates global node type with null agentId', async () => {
    const [nodeType] = await db.insert(graphNodeTypes).values({
      agentId: null,  // Global type
      name: 'GlobalConcept',
      description: 'A global concept shared across agents',
      justification: 'Schema test for global node types.',
      propertiesSchema: { type: 'object', properties: {} },
      createdBy: 'system',
    }).returning();

    expect(nodeType.agentId).toBeNull();
    expect(nodeType.name).toBe('GlobalConcept');

    // Cleanup
    await db.delete(graphNodeTypes).where(eq(graphNodeTypes.id, nodeType.id));
  });

  test('createdBy defaults to system', async () => {
    const [nodeType] = await db.insert(graphNodeTypes).values({
      agentId: testAgentId,
      name: 'DefaultCreatedBy',
      description: 'Testing default createdBy value',
      justification: 'Schema test for createdBy default behavior.',
      propertiesSchema: { type: 'object', properties: {} },
    }).returning();

    expect(nodeType.createdBy).toBe('system');

    // Cleanup
    await db.delete(graphNodeTypes).where(eq(graphNodeTypes.id, nodeType.id));
  });

  test('supports agent-created types', async () => {
    const [nodeType] = await db.insert(graphNodeTypes).values({
      agentId: testAgentId,
      name: 'AgentCreatedType',
      description: 'A type created by the agent',
      justification: 'Schema test for agent-created node type.',
      propertiesSchema: { type: 'object', properties: {} },
      createdBy: 'agent',
    }).returning();

    expect(nodeType.createdBy).toBe('agent');

    // Cleanup
    await db.delete(graphNodeTypes).where(eq(graphNodeTypes.id, nodeType.id));
  });

  test('cascades delete when agent deleted', async () => {
    // Create a separate agent for this test
    const [tempAgent] = await db.insert(agents).values({
      userId: testUserId,
      name: 'Temp Agent for Cascade Test',
      conversationSystemPrompt: 'Test prompt',
      observerSystemPrompt: 'Test prompt',
      analysisGenerationSystemPrompt: 'Test prompt',
      adviceGenerationSystemPrompt: 'Test prompt',
      graphConstructionSystemPrompt: 'Test prompt',
      iterationIntervalMs: 300000,
    }).returning();

    const [nodeType] = await db.insert(graphNodeTypes).values({
      agentId: tempAgent.id,
      name: 'CascadeTestType',
      description: 'Type that should be deleted with agent',
      justification: 'Schema test for agent cascade delete on node types.',
      propertiesSchema: { type: 'object', properties: {} },
    }).returning();

    // Delete the agent
    await db.delete(agents).where(eq(agents.id, tempAgent.id));

    // Node type should be gone
    const remaining = await db.select().from(graphNodeTypes).where(eq(graphNodeTypes.id, nodeType.id));
    expect(remaining).toHaveLength(0);
  });
});

describe('graphEdgeTypes schema', () => {
  test('creates edge type with all fields', async () => {
    const propertiesSchema = {
      type: 'object',
      properties: {
        strength: { type: 'number' },
        since: { type: 'string' },
      },
    };
    const exampleProperties = { strength: 0.8, since: '2024-01-01' };

    const [edgeType] = await db.insert(graphEdgeTypes).values({
      agentId: testAgentId,
      name: 'issued_by',
      description: 'Links an asset to its issuing company',
      justification: 'Schema test for full edge type creation.',
      propertiesSchema,
      exampleProperties,
      createdBy: 'system',
    }).returning();

    expect(edgeType.id).toBeDefined();
    expect(edgeType.agentId).toBe(testAgentId);
    expect(edgeType.name).toBe('issued_by');
    expect(edgeType.description).toBe('Links an asset to its issuing company');
    expect(edgeType.propertiesSchema).toEqual(propertiesSchema);
    expect(edgeType.exampleProperties).toEqual(exampleProperties);
    expect(edgeType.createdBy).toBe('system');
    expect(edgeType.createdAt).toBeDefined();

    // Cleanup
    await db.delete(graphEdgeTypes).where(eq(graphEdgeTypes.id, edgeType.id));
  });

  test('creates edge type with null propertiesSchema', async () => {
    const [edgeType] = await db.insert(graphEdgeTypes).values({
      agentId: testAgentId,
      name: 'simple_relation',
      description: 'A simple relationship without properties',
      justification: 'Schema test for nullable edge property schemas.',
      propertiesSchema: null,
    }).returning();

    expect(edgeType.propertiesSchema).toBeNull();

    // Cleanup
    await db.delete(graphEdgeTypes).where(eq(graphEdgeTypes.id, edgeType.id));
  });

  test('cascades delete when agent deleted', async () => {
    // Create a separate agent for this test
    const [tempAgent] = await db.insert(agents).values({
      userId: testUserId,
      name: 'Temp Agent for Edge Cascade Test',
      conversationSystemPrompt: 'Test prompt',
      observerSystemPrompt: 'Test prompt',
      analysisGenerationSystemPrompt: 'Test prompt',
      adviceGenerationSystemPrompt: 'Test prompt',
      graphConstructionSystemPrompt: 'Test prompt',
      iterationIntervalMs: 300000,
    }).returning();

    const [edgeType] = await db.insert(graphEdgeTypes).values({
      agentId: tempAgent.id,
      name: 'cascade_test_edge',
      description: 'Edge type that should be deleted with agent',
      justification: 'Schema test for agent cascade delete on edge types.',
    }).returning();

    // Delete the agent
    await db.delete(agents).where(eq(agents.id, tempAgent.id));

    // Edge type should be gone
    const remaining = await db.select().from(graphEdgeTypes).where(eq(graphEdgeTypes.id, edgeType.id));
    expect(remaining).toHaveLength(0);
  });
});

describe('graphNodes schema', () => {
  test('creates node with all fields', async () => {
    const properties = {
      symbol: 'AAPL',
      name: 'Apple Inc.',
      lastUpdated: '2024-01-15',
    };

    const [node] = await db.insert(graphNodes).values({
      agentId: testAgentId,
      type: 'Asset',
      name: 'AAPL',
      properties,
    }).returning();

    expect(node.id).toBeDefined();
    expect(node.agentId).toBe(testAgentId);
    expect(node.type).toBe('Asset');
    expect(node.name).toBe('AAPL');
    expect(node.properties).toEqual(properties);
    expect(node.createdAt).toBeDefined();

    // Cleanup
    await db.delete(graphNodes).where(eq(graphNodes.id, node.id));
  });

  test('properties defaults to empty object', async () => {
    const [node] = await db.insert(graphNodes).values({
      agentId: testAgentId,
      type: 'EmptyPropsNode',
      name: 'No Properties',
    }).returning();

    expect(node.properties).toEqual({});

    // Cleanup
    await db.delete(graphNodes).where(eq(graphNodes.id, node.id));
  });

  test('cascades delete when agent deleted', async () => {
    // Create a separate agent
    const [tempAgent] = await db.insert(agents).values({
      userId: testUserId,
      name: 'Temp Agent for Node Cascade',
      conversationSystemPrompt: 'Test prompt',
      observerSystemPrompt: 'Test prompt',
      analysisGenerationSystemPrompt: 'Test prompt',
      adviceGenerationSystemPrompt: 'Test prompt',
      graphConstructionSystemPrompt: 'Test prompt',
      iterationIntervalMs: 300000,
    }).returning();

    const [node] = await db.insert(graphNodes).values({
      agentId: tempAgent.id,
      type: 'CascadeNode',
      name: 'Will Be Deleted',
    }).returning();

    // Delete agent
    await db.delete(agents).where(eq(agents.id, tempAgent.id));

    // Node should be gone
    const remaining = await db.select().from(graphNodes).where(eq(graphNodes.id, node.id));
    expect(remaining).toHaveLength(0);
  });
});

describe('graphEdges schema', () => {
  test('creates edge between nodes', async () => {
    // Create two nodes
    const [sourceNode] = await db.insert(graphNodes).values({
      agentId: testAgentId,
      type: 'Asset',
      name: 'AAPL',
    }).returning();

    const [targetNode] = await db.insert(graphNodes).values({
      agentId: testAgentId,
      type: 'Company',
      name: 'Apple Inc.',
    }).returning();

    const properties = { since: '1976', isPrimary: true };

    const [edge] = await db.insert(graphEdges).values({
      agentId: testAgentId,
      type: 'issued_by',
      sourceId: sourceNode.id,
      targetId: targetNode.id,
      properties,
    }).returning();

    expect(edge.id).toBeDefined();
    expect(edge.agentId).toBe(testAgentId);
    expect(edge.type).toBe('issued_by');
    expect(edge.sourceId).toBe(sourceNode.id);
    expect(edge.targetId).toBe(targetNode.id);
    expect(edge.properties).toEqual(properties);
    expect(edge.createdAt).toBeDefined();

    // Cleanup
    await db.delete(graphNodes).where(eq(graphNodes.id, sourceNode.id));
    await db.delete(graphNodes).where(eq(graphNodes.id, targetNode.id));
  });

  test('properties defaults to empty object', async () => {
    // Create two nodes
    const [sourceNode] = await db.insert(graphNodes).values({
      agentId: testAgentId,
      type: 'Node1',
      name: 'Source',
    }).returning();

    const [targetNode] = await db.insert(graphNodes).values({
      agentId: testAgentId,
      type: 'Node2',
      name: 'Target',
    }).returning();

    const [edge] = await db.insert(graphEdges).values({
      agentId: testAgentId,
      type: 'simple_edge',
      sourceId: sourceNode.id,
      targetId: targetNode.id,
    }).returning();

    expect(edge.properties).toEqual({});

    // Cleanup
    await db.delete(graphNodes).where(eq(graphNodes.id, sourceNode.id));
    await db.delete(graphNodes).where(eq(graphNodes.id, targetNode.id));
  });

  test('cascades delete when source node deleted', async () => {
    // Create two nodes
    const [sourceNode] = await db.insert(graphNodes).values({
      agentId: testAgentId,
      type: 'SourceToDelete',
      name: 'Source',
    }).returning();

    const [targetNode] = await db.insert(graphNodes).values({
      agentId: testAgentId,
      type: 'TargetToKeep',
      name: 'Target',
    }).returning();

    const [edge] = await db.insert(graphEdges).values({
      agentId: testAgentId,
      type: 'cascade_test',
      sourceId: sourceNode.id,
      targetId: targetNode.id,
    }).returning();

    // Delete source node
    await db.delete(graphNodes).where(eq(graphNodes.id, sourceNode.id));

    // Edge should be gone
    const remainingEdge = await db.select().from(graphEdges).where(eq(graphEdges.id, edge.id));
    expect(remainingEdge).toHaveLength(0);

    // Target node should still exist
    const remainingTarget = await db.select().from(graphNodes).where(eq(graphNodes.id, targetNode.id));
    expect(remainingTarget).toHaveLength(1);

    // Cleanup
    await db.delete(graphNodes).where(eq(graphNodes.id, targetNode.id));
  });

  test('cascades delete when target node deleted', async () => {
    // Create two nodes
    const [sourceNode] = await db.insert(graphNodes).values({
      agentId: testAgentId,
      type: 'SourceToKeep',
      name: 'Source',
    }).returning();

    const [targetNode] = await db.insert(graphNodes).values({
      agentId: testAgentId,
      type: 'TargetToDelete',
      name: 'Target',
    }).returning();

    const [edge] = await db.insert(graphEdges).values({
      agentId: testAgentId,
      type: 'target_cascade_test',
      sourceId: sourceNode.id,
      targetId: targetNode.id,
    }).returning();

    // Delete target node
    await db.delete(graphNodes).where(eq(graphNodes.id, targetNode.id));

    // Edge should be gone
    const remainingEdge = await db.select().from(graphEdges).where(eq(graphEdges.id, edge.id));
    expect(remainingEdge).toHaveLength(0);

    // Source node should still exist
    const remainingSource = await db.select().from(graphNodes).where(eq(graphNodes.id, sourceNode.id));
    expect(remainingSource).toHaveLength(1);

    // Cleanup
    await db.delete(graphNodes).where(eq(graphNodes.id, sourceNode.id));
  });

  test('cascades delete when agent deleted', async () => {
    // Create a separate agent
    const [tempAgent] = await db.insert(agents).values({
      userId: testUserId,
      name: 'Temp Agent for Edge Cascade',
      conversationSystemPrompt: 'Test prompt',
      observerSystemPrompt: 'Test prompt',
      analysisGenerationSystemPrompt: 'Test prompt',
      adviceGenerationSystemPrompt: 'Test prompt',
      graphConstructionSystemPrompt: 'Test prompt',
      iterationIntervalMs: 300000,
    }).returning();

    // Create nodes in the temp agent
    const [sourceNode] = await db.insert(graphNodes).values({
      agentId: tempAgent.id,
      type: 'Source',
      name: 'Source',
    }).returning();

    const [targetNode] = await db.insert(graphNodes).values({
      agentId: tempAgent.id,
      type: 'Target',
      name: 'Target',
    }).returning();

    const [edge] = await db.insert(graphEdges).values({
      agentId: tempAgent.id,
      type: 'agent_cascade_edge',
      sourceId: sourceNode.id,
      targetId: targetNode.id,
    }).returning();

    // Delete agent
    await db.delete(agents).where(eq(agents.id, tempAgent.id));

    // All should be gone
    const remainingEdge = await db.select().from(graphEdges).where(eq(graphEdges.id, edge.id));
    expect(remainingEdge).toHaveLength(0);

    const remainingSource = await db.select().from(graphNodes).where(eq(graphNodes.id, sourceNode.id));
    expect(remainingSource).toHaveLength(0);

    const remainingTarget = await db.select().from(graphNodes).where(eq(graphNodes.id, targetNode.id));
    expect(remainingTarget).toHaveLength(0);
  });

});

describe('graph schema indexes', () => {
  test('can query graphNodes by agentId efficiently', async () => {
    const nodes = await db.select().from(graphNodes).where(eq(graphNodes.agentId, testAgentId));
    // Just verify the query works - index existence is verified by migration
    expect(Array.isArray(nodes)).toBe(true);
  });

  test('can query graphNodes by type efficiently', async () => {
    const nodes = await db.select().from(graphNodes).where(eq(graphNodes.type, 'SomeType'));
    expect(Array.isArray(nodes)).toBe(true);
  });

  test('can query graphNodes by agentId and type efficiently', async () => {
    const nodes = await db.select().from(graphNodes).where(
      and(eq(graphNodes.agentId, testAgentId), eq(graphNodes.type, 'SomeType'))
    );
    expect(Array.isArray(nodes)).toBe(true);
  });

  test('can query graphEdges by sourceId efficiently', async () => {
    // Create a node to query for
    const [node] = await db.insert(graphNodes).values({
      agentId: testAgentId,
      type: 'IndexTestNode',
      name: 'Index Test',
    }).returning();

    const edges = await db.select().from(graphEdges).where(eq(graphEdges.sourceId, node.id));
    expect(Array.isArray(edges)).toBe(true);

    // Cleanup
    await db.delete(graphNodes).where(eq(graphNodes.id, node.id));
  });

  test('can query graphEdges by targetId efficiently', async () => {
    // Create a node to query for
    const [node] = await db.insert(graphNodes).values({
      agentId: testAgentId,
      type: 'IndexTestNode2',
      name: 'Index Test 2',
    }).returning();

    const edges = await db.select().from(graphEdges).where(eq(graphEdges.targetId, node.id));
    expect(Array.isArray(edges)).toBe(true);

    // Cleanup
    await db.delete(graphNodes).where(eq(graphNodes.id, node.id));
  });
});

describe('complete graph workflow', () => {
  test('creates full graph with types, nodes, and edges', async () => {
    // Step 1: Create node types
    const [assetType] = await db.insert(graphNodeTypes).values({
      agentId: testAgentId,
      name: 'Stock',
      description: 'A publicly traded stock',
      justification: 'Workflow test node type for stock entities.',
      propertiesSchema: {
        type: 'object',
        required: ['ticker'],
        properties: {
          ticker: { type: 'string' },
          exchange: { type: 'string' },
        },
      },
      exampleProperties: { ticker: 'AAPL', exchange: 'NASDAQ' },
    }).returning();

    const [companyType] = await db.insert(graphNodeTypes).values({
      agentId: testAgentId,
      name: 'Corporation',
      description: 'A corporate agent',
      justification: 'Workflow test node type for corporation entities.',
      propertiesSchema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          country: { type: 'string' },
        },
      },
      exampleProperties: { name: 'Apple Inc.', country: 'USA' },
    }).returning();

    // Step 2: Create edge type
    const [edgeType] = await db.insert(graphEdgeTypes).values({
      agentId: testAgentId,
      name: 'issued_by_corp',
      description: 'Stock issued by corporation',
      justification: 'Workflow test edge type connecting stock to corporation.',
      propertiesSchema: {
        type: 'object',
        properties: {
          ipoDate: { type: 'string' },
        },
      },
    }).returning();

    // Step 3: Create actual graph nodes
    const [stockNode] = await db.insert(graphNodes).values({
      agentId: testAgentId,
      type: 'Stock',
      name: 'AAPL',
      properties: { ticker: 'AAPL', exchange: 'NASDAQ' },
    }).returning();

    const [companyNode] = await db.insert(graphNodes).values({
      agentId: testAgentId,
      type: 'Corporation',
      name: 'Apple Inc.',
      properties: { name: 'Apple Inc.', country: 'USA' },
    }).returning();

    // Step 4: Create edge between nodes
    const [edge] = await db.insert(graphEdges).values({
      agentId: testAgentId,
      type: 'issued_by_corp',
      sourceId: stockNode.id,
      targetId: companyNode.id,
      properties: { ipoDate: '1980-12-12' },
    }).returning();

    // Verify the graph structure
    expect(stockNode.type).toBe('Stock');
    expect(companyNode.type).toBe('Corporation');
    expect(edge.type).toBe('issued_by_corp');
    expect(edge.sourceId).toBe(stockNode.id);
    expect(edge.targetId).toBe(companyNode.id);

    // Cleanup - order matters due to FK constraints
    await db.delete(graphEdges).where(eq(graphEdges.id, edge.id));
    await db.delete(graphNodes).where(eq(graphNodes.id, stockNode.id));
    await db.delete(graphNodes).where(eq(graphNodes.id, companyNode.id));
    await db.delete(graphEdgeTypes).where(eq(graphEdgeTypes.id, edgeType.id));
    await db.delete(graphNodeTypes).where(eq(graphNodeTypes.id, assetType.id));
    await db.delete(graphNodeTypes).where(eq(graphNodeTypes.id, companyType.id));
  });
});
