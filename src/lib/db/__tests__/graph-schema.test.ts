import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db/client';
import {
  users,
  entities,
  conversations,
  graphNodeTypes,
  graphEdgeTypes,
  graphEdgeTypeSourceTypes,
  graphEdgeTypeTargetTypes,
  graphNodes,
  graphEdges,
} from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

// Test utilities
let testUserId: string;
let testEntityId: string;
let testConversationId: string;

beforeAll(async () => {
  // Create test user
  const [user] = await db.insert(users).values({
    email: `test-graph-${Date.now()}@example.com`,
    name: 'Graph Test User',
  }).returning();
  testUserId = user.id;

  // Create test entity
  const [entity] = await db.insert(entities).values({
    userId: testUserId,
    name: 'Graph Test Team',
    purpose: 'Testing knowledge graph',
    systemPrompt: 'You are a test entity for knowledge graph testing.',
  }).returning();
  testEntityId = entity.id;

  // Create test conversation
  const [conversation] = await db.insert(conversations).values({
    entityId: testEntityId,
  }).returning();
  testConversationId = conversation.id;
});

afterAll(async () => {
  // Cleanup: delete test user (cascades to entities, agents, etc.)
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
      entityId: testEntityId,
      name: 'Asset',
      description: 'A financial asset such as a stock or bond',
      propertiesSchema,
      exampleProperties,
      createdBy: 'system',
    }).returning();

    expect(nodeType.id).toBeDefined();
    expect(nodeType.entityId).toBe(testEntityId);
    expect(nodeType.name).toBe('Asset');
    expect(nodeType.description).toBe('A financial asset such as a stock or bond');
    expect(nodeType.propertiesSchema).toEqual(propertiesSchema);
    expect(nodeType.exampleProperties).toEqual(exampleProperties);
    expect(nodeType.createdBy).toBe('system');
    expect(nodeType.createdAt).toBeDefined();

    // Cleanup
    await db.delete(graphNodeTypes).where(eq(graphNodeTypes.id, nodeType.id));
  });

  test('creates global node type with null entityId', async () => {
    const [nodeType] = await db.insert(graphNodeTypes).values({
      entityId: null,  // Global type
      name: 'GlobalConcept',
      description: 'A global concept shared across entities',
      propertiesSchema: { type: 'object', properties: {} },
      createdBy: 'system',
    }).returning();

    expect(nodeType.entityId).toBeNull();
    expect(nodeType.name).toBe('GlobalConcept');

    // Cleanup
    await db.delete(graphNodeTypes).where(eq(graphNodeTypes.id, nodeType.id));
  });

  test('createdBy defaults to system', async () => {
    const [nodeType] = await db.insert(graphNodeTypes).values({
      entityId: testEntityId,
      name: 'DefaultCreatedBy',
      description: 'Testing default createdBy value',
      propertiesSchema: { type: 'object', properties: {} },
    }).returning();

    expect(nodeType.createdBy).toBe('system');

    // Cleanup
    await db.delete(graphNodeTypes).where(eq(graphNodeTypes.id, nodeType.id));
  });

  test('supports agent-created types', async () => {
    const [nodeType] = await db.insert(graphNodeTypes).values({
      entityId: testEntityId,
      name: 'AgentCreatedType',
      description: 'A type created by the agent',
      propertiesSchema: { type: 'object', properties: {} },
      createdBy: 'agent',
    }).returning();

    expect(nodeType.createdBy).toBe('agent');

    // Cleanup
    await db.delete(graphNodeTypes).where(eq(graphNodeTypes.id, nodeType.id));
  });

  test('cascades delete when entity deleted', async () => {
    // Create a separate entity for this test
    const [tempEntity] = await db.insert(entities).values({
      userId: testUserId,
      name: 'Temp Entity for Cascade Test',
      systemPrompt: 'Test prompt',
    }).returning();

    const [nodeType] = await db.insert(graphNodeTypes).values({
      entityId: tempEntity.id,
      name: 'CascadeTestType',
      description: 'Type that should be deleted with entity',
      propertiesSchema: { type: 'object', properties: {} },
    }).returning();

    // Delete the entity
    await db.delete(entities).where(eq(entities.id, tempEntity.id));

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
      entityId: testEntityId,
      name: 'issued_by',
      description: 'Links an asset to its issuing company',
      propertiesSchema,
      exampleProperties,
      createdBy: 'system',
    }).returning();

    expect(edgeType.id).toBeDefined();
    expect(edgeType.entityId).toBe(testEntityId);
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
      entityId: testEntityId,
      name: 'simple_relation',
      description: 'A simple relationship without properties',
      propertiesSchema: null,
    }).returning();

    expect(edgeType.propertiesSchema).toBeNull();

    // Cleanup
    await db.delete(graphEdgeTypes).where(eq(graphEdgeTypes.id, edgeType.id));
  });

  test('cascades delete when entity deleted', async () => {
    // Create a separate entity for this test
    const [tempEntity] = await db.insert(entities).values({
      userId: testUserId,
      name: 'Temp Entity for Edge Cascade Test',
      systemPrompt: 'Test prompt',
    }).returning();

    const [edgeType] = await db.insert(graphEdgeTypes).values({
      entityId: tempEntity.id,
      name: 'cascade_test_edge',
      description: 'Edge type that should be deleted with entity',
    }).returning();

    // Delete the entity
    await db.delete(entities).where(eq(entities.id, tempEntity.id));

    // Edge type should be gone
    const remaining = await db.select().from(graphEdgeTypes).where(eq(graphEdgeTypes.id, edgeType.id));
    expect(remaining).toHaveLength(0);
  });
});

describe('graphEdgeTypeSourceTypes junction table', () => {
  test('creates junction between edge type and source node type', async () => {
    // Create node type
    const [nodeType] = await db.insert(graphNodeTypes).values({
      entityId: testEntityId,
      name: 'SourceNodeType',
      description: 'A source node type',
      propertiesSchema: { type: 'object', properties: {} },
    }).returning();

    // Create edge type
    const [edgeType] = await db.insert(graphEdgeTypes).values({
      entityId: testEntityId,
      name: 'junction_test_edge',
      description: 'Testing junction table',
    }).returning();

    // Create junction
    const [junction] = await db.insert(graphEdgeTypeSourceTypes).values({
      edgeTypeId: edgeType.id,
      nodeTypeId: nodeType.id,
    }).returning();

    expect(junction.id).toBeDefined();
    expect(junction.edgeTypeId).toBe(edgeType.id);
    expect(junction.nodeTypeId).toBe(nodeType.id);

    // Cleanup
    await db.delete(graphEdgeTypes).where(eq(graphEdgeTypes.id, edgeType.id));
    await db.delete(graphNodeTypes).where(eq(graphNodeTypes.id, nodeType.id));
  });

  test('cascades delete when edge type deleted', async () => {
    // Create node type
    const [nodeType] = await db.insert(graphNodeTypes).values({
      entityId: testEntityId,
      name: 'SourceForCascade',
      description: 'Testing cascade delete',
      propertiesSchema: { type: 'object', properties: {} },
    }).returning();

    // Create edge type
    const [edgeType] = await db.insert(graphEdgeTypes).values({
      entityId: testEntityId,
      name: 'cascade_edge_type',
      description: 'Will be deleted',
    }).returning();

    // Create junction
    const [junction] = await db.insert(graphEdgeTypeSourceTypes).values({
      edgeTypeId: edgeType.id,
      nodeTypeId: nodeType.id,
    }).returning();

    // Delete edge type
    await db.delete(graphEdgeTypes).where(eq(graphEdgeTypes.id, edgeType.id));

    // Junction should be gone
    const remaining = await db.select().from(graphEdgeTypeSourceTypes).where(eq(graphEdgeTypeSourceTypes.id, junction.id));
    expect(remaining).toHaveLength(0);

    // Cleanup
    await db.delete(graphNodeTypes).where(eq(graphNodeTypes.id, nodeType.id));
  });

  test('cascades delete when node type deleted', async () => {
    // Create node type
    const [nodeType] = await db.insert(graphNodeTypes).values({
      entityId: testEntityId,
      name: 'NodeToDelete',
      description: 'Will be deleted',
      propertiesSchema: { type: 'object', properties: {} },
    }).returning();

    // Create edge type
    const [edgeType] = await db.insert(graphEdgeTypes).values({
      entityId: testEntityId,
      name: 'edge_for_node_cascade',
      description: 'Stays after node deleted',
    }).returning();

    // Create junction
    const [junction] = await db.insert(graphEdgeTypeSourceTypes).values({
      edgeTypeId: edgeType.id,
      nodeTypeId: nodeType.id,
    }).returning();

    // Delete node type
    await db.delete(graphNodeTypes).where(eq(graphNodeTypes.id, nodeType.id));

    // Junction should be gone
    const remainingJunction = await db.select().from(graphEdgeTypeSourceTypes).where(eq(graphEdgeTypeSourceTypes.id, junction.id));
    expect(remainingJunction).toHaveLength(0);

    // Edge type should still exist
    const remainingEdge = await db.select().from(graphEdgeTypes).where(eq(graphEdgeTypes.id, edgeType.id));
    expect(remainingEdge).toHaveLength(1);

    // Cleanup
    await db.delete(graphEdgeTypes).where(eq(graphEdgeTypes.id, edgeType.id));
  });
});

describe('graphEdgeTypeTargetTypes junction table', () => {
  test('creates junction between edge type and target node type', async () => {
    // Create node type
    const [nodeType] = await db.insert(graphNodeTypes).values({
      entityId: testEntityId,
      name: 'TargetNodeType',
      description: 'A target node type',
      propertiesSchema: { type: 'object', properties: {} },
    }).returning();

    // Create edge type
    const [edgeType] = await db.insert(graphEdgeTypes).values({
      entityId: testEntityId,
      name: 'target_junction_test',
      description: 'Testing target junction table',
    }).returning();

    // Create junction
    const [junction] = await db.insert(graphEdgeTypeTargetTypes).values({
      edgeTypeId: edgeType.id,
      nodeTypeId: nodeType.id,
    }).returning();

    expect(junction.id).toBeDefined();
    expect(junction.edgeTypeId).toBe(edgeType.id);
    expect(junction.nodeTypeId).toBe(nodeType.id);

    // Cleanup
    await db.delete(graphEdgeTypes).where(eq(graphEdgeTypes.id, edgeType.id));
    await db.delete(graphNodeTypes).where(eq(graphNodeTypes.id, nodeType.id));
  });

  test('supports multiple target types for one edge type', async () => {
    // Create two node types
    const [nodeType1] = await db.insert(graphNodeTypes).values({
      entityId: testEntityId,
      name: 'Target1',
      description: 'First target type',
      propertiesSchema: { type: 'object', properties: {} },
    }).returning();

    const [nodeType2] = await db.insert(graphNodeTypes).values({
      entityId: testEntityId,
      name: 'Target2',
      description: 'Second target type',
      propertiesSchema: { type: 'object', properties: {} },
    }).returning();

    // Create edge type
    const [edgeType] = await db.insert(graphEdgeTypes).values({
      entityId: testEntityId,
      name: 'multi_target_edge',
      description: 'Edge with multiple target types',
    }).returning();

    // Create both junctions
    await db.insert(graphEdgeTypeTargetTypes).values([
      { edgeTypeId: edgeType.id, nodeTypeId: nodeType1.id },
      { edgeTypeId: edgeType.id, nodeTypeId: nodeType2.id },
    ]);

    // Query junctions
    const junctions = await db.select().from(graphEdgeTypeTargetTypes).where(eq(graphEdgeTypeTargetTypes.edgeTypeId, edgeType.id));
    expect(junctions).toHaveLength(2);

    // Cleanup
    await db.delete(graphEdgeTypes).where(eq(graphEdgeTypes.id, edgeType.id));
    await db.delete(graphNodeTypes).where(eq(graphNodeTypes.id, nodeType1.id));
    await db.delete(graphNodeTypes).where(eq(graphNodeTypes.id, nodeType2.id));
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
      entityId: testEntityId,
      type: 'Asset',
      name: 'AAPL',
      properties,
      sourceConversationId: testConversationId,
    }).returning();

    expect(node.id).toBeDefined();
    expect(node.entityId).toBe(testEntityId);
    expect(node.type).toBe('Asset');
    expect(node.name).toBe('AAPL');
    expect(node.properties).toEqual(properties);
    expect(node.sourceConversationId).toBe(testConversationId);
    expect(node.createdAt).toBeDefined();

    // Cleanup
    await db.delete(graphNodes).where(eq(graphNodes.id, node.id));
  });

  test('properties defaults to empty object', async () => {
    const [node] = await db.insert(graphNodes).values({
      entityId: testEntityId,
      type: 'EmptyPropsNode',
      name: 'No Properties',
    }).returning();

    expect(node.properties).toEqual({});

    // Cleanup
    await db.delete(graphNodes).where(eq(graphNodes.id, node.id));
  });

  test('sourceConversationId can be null', async () => {
    const [node] = await db.insert(graphNodes).values({
      entityId: testEntityId,
      type: 'NoSourceNode',
      name: 'No Source Conversation',
      sourceConversationId: null,
    }).returning();

    expect(node.sourceConversationId).toBeNull();

    // Cleanup
    await db.delete(graphNodes).where(eq(graphNodes.id, node.id));
  });

  test('cascades delete when entity deleted', async () => {
    // Create a separate entity
    const [tempEntity] = await db.insert(entities).values({
      userId: testUserId,
      name: 'Temp Entity for Node Cascade',
      systemPrompt: 'Test prompt',
    }).returning();

    const [node] = await db.insert(graphNodes).values({
      entityId: tempEntity.id,
      type: 'CascadeNode',
      name: 'Will Be Deleted',
    }).returning();

    // Delete entity
    await db.delete(entities).where(eq(entities.id, tempEntity.id));

    // Node should be gone
    const remaining = await db.select().from(graphNodes).where(eq(graphNodes.id, node.id));
    expect(remaining).toHaveLength(0);
  });

  test('sets sourceConversationId to null when conversation deleted', async () => {
    // Create a separate entity and conversation
    const [tempEntity] = await db.insert(entities).values({
      userId: testUserId,
      name: 'Temp Entity for Node Source Test',
      systemPrompt: 'Test prompt',
    }).returning();

    const [tempConversation] = await db.insert(conversations).values({
      entityId: tempEntity.id,
    }).returning();

    const [node] = await db.insert(graphNodes).values({
      entityId: testEntityId,
      type: 'NodeWithSource',
      name: 'Has Source Conversation',
      sourceConversationId: tempConversation.id,
    }).returning();

    // Delete conversation
    await db.delete(conversations).where(eq(conversations.id, tempConversation.id));

    // Node should remain but with null sourceConversationId
    const [updated] = await db.select().from(graphNodes).where(eq(graphNodes.id, node.id));
    expect(updated).toBeDefined();
    expect(updated.sourceConversationId).toBeNull();

    // Cleanup
    await db.delete(graphNodes).where(eq(graphNodes.id, node.id));
    await db.delete(entities).where(eq(entities.id, tempEntity.id));
  });
});

describe('graphEdges schema', () => {
  test('creates edge between nodes', async () => {
    // Create two nodes
    const [sourceNode] = await db.insert(graphNodes).values({
      entityId: testEntityId,
      type: 'Asset',
      name: 'AAPL',
    }).returning();

    const [targetNode] = await db.insert(graphNodes).values({
      entityId: testEntityId,
      type: 'Company',
      name: 'Apple Inc.',
    }).returning();

    const properties = { since: '1976', isPrimary: true };

    const [edge] = await db.insert(graphEdges).values({
      entityId: testEntityId,
      type: 'issued_by',
      sourceId: sourceNode.id,
      targetId: targetNode.id,
      properties,
      sourceConversationId: testConversationId,
    }).returning();

    expect(edge.id).toBeDefined();
    expect(edge.entityId).toBe(testEntityId);
    expect(edge.type).toBe('issued_by');
    expect(edge.sourceId).toBe(sourceNode.id);
    expect(edge.targetId).toBe(targetNode.id);
    expect(edge.properties).toEqual(properties);
    expect(edge.sourceConversationId).toBe(testConversationId);
    expect(edge.createdAt).toBeDefined();

    // Cleanup
    await db.delete(graphNodes).where(eq(graphNodes.id, sourceNode.id));
    await db.delete(graphNodes).where(eq(graphNodes.id, targetNode.id));
  });

  test('properties defaults to empty object', async () => {
    // Create two nodes
    const [sourceNode] = await db.insert(graphNodes).values({
      entityId: testEntityId,
      type: 'Node1',
      name: 'Source',
    }).returning();

    const [targetNode] = await db.insert(graphNodes).values({
      entityId: testEntityId,
      type: 'Node2',
      name: 'Target',
    }).returning();

    const [edge] = await db.insert(graphEdges).values({
      entityId: testEntityId,
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
      entityId: testEntityId,
      type: 'SourceToDelete',
      name: 'Source',
    }).returning();

    const [targetNode] = await db.insert(graphNodes).values({
      entityId: testEntityId,
      type: 'TargetToKeep',
      name: 'Target',
    }).returning();

    const [edge] = await db.insert(graphEdges).values({
      entityId: testEntityId,
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
      entityId: testEntityId,
      type: 'SourceToKeep',
      name: 'Source',
    }).returning();

    const [targetNode] = await db.insert(graphNodes).values({
      entityId: testEntityId,
      type: 'TargetToDelete',
      name: 'Target',
    }).returning();

    const [edge] = await db.insert(graphEdges).values({
      entityId: testEntityId,
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

  test('cascades delete when entity deleted', async () => {
    // Create a separate entity
    const [tempEntity] = await db.insert(entities).values({
      userId: testUserId,
      name: 'Temp Entity for Edge Cascade',
      systemPrompt: 'Test prompt',
    }).returning();

    // Create nodes in the temp entity
    const [sourceNode] = await db.insert(graphNodes).values({
      entityId: tempEntity.id,
      type: 'Source',
      name: 'Source',
    }).returning();

    const [targetNode] = await db.insert(graphNodes).values({
      entityId: tempEntity.id,
      type: 'Target',
      name: 'Target',
    }).returning();

    const [edge] = await db.insert(graphEdges).values({
      entityId: tempEntity.id,
      type: 'entity_cascade_edge',
      sourceId: sourceNode.id,
      targetId: targetNode.id,
    }).returning();

    // Delete entity
    await db.delete(entities).where(eq(entities.id, tempEntity.id));

    // All should be gone
    const remainingEdge = await db.select().from(graphEdges).where(eq(graphEdges.id, edge.id));
    expect(remainingEdge).toHaveLength(0);

    const remainingSource = await db.select().from(graphNodes).where(eq(graphNodes.id, sourceNode.id));
    expect(remainingSource).toHaveLength(0);

    const remainingTarget = await db.select().from(graphNodes).where(eq(graphNodes.id, targetNode.id));
    expect(remainingTarget).toHaveLength(0);
  });

  test('sets sourceConversationId to null when conversation deleted', async () => {
    // Create nodes
    const [sourceNode] = await db.insert(graphNodes).values({
      entityId: testEntityId,
      type: 'EdgeSource',
      name: 'Source',
    }).returning();

    const [targetNode] = await db.insert(graphNodes).values({
      entityId: testEntityId,
      type: 'EdgeTarget',
      name: 'Target',
    }).returning();

    // Create a separate entity and conversation
    const [tempEntity] = await db.insert(entities).values({
      userId: testUserId,
      name: 'Temp Entity for Edge Source Test',
      systemPrompt: 'Test prompt',
    }).returning();

    const [tempConversation] = await db.insert(conversations).values({
      entityId: tempEntity.id,
    }).returning();

    const [edge] = await db.insert(graphEdges).values({
      entityId: testEntityId,
      type: 'conversation_ref_edge',
      sourceId: sourceNode.id,
      targetId: targetNode.id,
      sourceConversationId: tempConversation.id,
    }).returning();

    // Delete conversation
    await db.delete(conversations).where(eq(conversations.id, tempConversation.id));

    // Edge should remain but with null sourceConversationId
    const [updated] = await db.select().from(graphEdges).where(eq(graphEdges.id, edge.id));
    expect(updated).toBeDefined();
    expect(updated.sourceConversationId).toBeNull();

    // Cleanup
    await db.delete(graphNodes).where(eq(graphNodes.id, sourceNode.id));
    await db.delete(graphNodes).where(eq(graphNodes.id, targetNode.id));
    await db.delete(entities).where(eq(entities.id, tempEntity.id));
  });
});

describe('graph schema indexes', () => {
  test('can query graphNodes by entityId efficiently', async () => {
    const nodes = await db.select().from(graphNodes).where(eq(graphNodes.entityId, testEntityId));
    // Just verify the query works - index existence is verified by migration
    expect(Array.isArray(nodes)).toBe(true);
  });

  test('can query graphNodes by type efficiently', async () => {
    const nodes = await db.select().from(graphNodes).where(eq(graphNodes.type, 'SomeType'));
    expect(Array.isArray(nodes)).toBe(true);
  });

  test('can query graphNodes by entityId and type efficiently', async () => {
    const nodes = await db.select().from(graphNodes).where(
      and(eq(graphNodes.entityId, testEntityId), eq(graphNodes.type, 'SomeType'))
    );
    expect(Array.isArray(nodes)).toBe(true);
  });

  test('can query graphEdges by sourceId efficiently', async () => {
    // Create a node to query for
    const [node] = await db.insert(graphNodes).values({
      entityId: testEntityId,
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
      entityId: testEntityId,
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
      entityId: testEntityId,
      name: 'Stock',
      description: 'A publicly traded stock',
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
      entityId: testEntityId,
      name: 'Corporation',
      description: 'A corporate entity',
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

    // Step 2: Create edge type with constraints
    const [edgeType] = await db.insert(graphEdgeTypes).values({
      entityId: testEntityId,
      name: 'issued_by_corp',
      description: 'Stock issued by corporation',
      propertiesSchema: {
        type: 'object',
        properties: {
          ipoDate: { type: 'string' },
        },
      },
    }).returning();

    // Step 3: Create junction table entries for edge type constraints
    await db.insert(graphEdgeTypeSourceTypes).values({
      edgeTypeId: edgeType.id,
      nodeTypeId: assetType.id,
    });

    await db.insert(graphEdgeTypeTargetTypes).values({
      edgeTypeId: edgeType.id,
      nodeTypeId: companyType.id,
    });

    // Step 4: Create actual graph nodes
    const [stockNode] = await db.insert(graphNodes).values({
      entityId: testEntityId,
      type: 'Stock',
      name: 'AAPL',
      properties: { ticker: 'AAPL', exchange: 'NASDAQ' },
    }).returning();

    const [companyNode] = await db.insert(graphNodes).values({
      entityId: testEntityId,
      type: 'Corporation',
      name: 'Apple Inc.',
      properties: { name: 'Apple Inc.', country: 'USA' },
    }).returning();

    // Step 5: Create edge between nodes
    const [edge] = await db.insert(graphEdges).values({
      entityId: testEntityId,
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

    // Query source types for edge type
    const sourceTypes = await db.select()
      .from(graphEdgeTypeSourceTypes)
      .where(eq(graphEdgeTypeSourceTypes.edgeTypeId, edgeType.id));
    expect(sourceTypes).toHaveLength(1);
    expect(sourceTypes[0].nodeTypeId).toBe(assetType.id);

    // Query target types for edge type
    const targetTypes = await db.select()
      .from(graphEdgeTypeTargetTypes)
      .where(eq(graphEdgeTypeTargetTypes.edgeTypeId, edgeType.id));
    expect(targetTypes).toHaveLength(1);
    expect(targetTypes[0].nodeTypeId).toBe(companyType.id);

    // Cleanup - order matters due to FK constraints
    await db.delete(graphEdges).where(eq(graphEdges.id, edge.id));
    await db.delete(graphNodes).where(eq(graphNodes.id, stockNode.id));
    await db.delete(graphNodes).where(eq(graphNodes.id, companyNode.id));
    await db.delete(graphEdgeTypes).where(eq(graphEdgeTypes.id, edgeType.id));
    await db.delete(graphNodeTypes).where(eq(graphNodeTypes.id, assetType.id));
    await db.delete(graphNodeTypes).where(eq(graphNodeTypes.id, companyType.id));
  });
});
