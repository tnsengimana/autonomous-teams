/**
 * Tests for graph data queries
 *
 * These tests verify the node and edge management system
 * for the knowledge graph.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db/client';
import {
  users,
  entities,
  conversations,
  graphNodes,
  graphEdges,
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

// Import graph data queries
import {
  createNode,
  getNodeById,
  getNodesByEntity,
  findNodeByTypeAndName,
  updateNodeProperties,
  deleteNode,
  createEdge,
  getEdgesByNode,
  findEdge,
  getNodeNeighbors,
  serializeGraphForLLM,
  getGraphStats,
} from '../graph-data';

// ============================================================================
// Test Setup
// ============================================================================

let testUserId: string;
let testEntityId: string;
let testConversationId: string;

beforeAll(async () => {
  // Create test user
  const [user] = await db.insert(users).values({
    email: `graph-data-test-${Date.now()}@example.com`,
    name: 'Graph Data Test User',
  }).returning();
  testUserId = user.id;

  // Create test entity
  const [entity] = await db.insert(entities).values({
    userId: testUserId,
    name: 'Graph Data Test Team',
    purpose: 'Testing graph data management',
    systemPrompt: 'You are a test entity for graph data testing.',
  }).returning();
  testEntityId = entity.id;

  // Create test conversation
  const [conversation] = await db.insert(conversations).values({
    entityId: testEntityId,
  }).returning();
  testConversationId = conversation.id;
});

afterAll(async () => {
  // Cleanup: delete test user (cascades to entities, nodes, edges, etc.)
  await db.delete(users).where(eq(users.id, testUserId));
});

// Helper to cleanup nodes created during tests
async function cleanupNodes(nodeIds: string[]) {
  for (const id of nodeIds) {
    await db.delete(graphNodes).where(eq(graphNodes.id, id));
  }
}

// Helper to cleanup edges created during tests
async function cleanupEdges(edgeIds: string[]) {
  for (const id of edgeIds) {
    await db.delete(graphEdges).where(eq(graphEdges.id, id));
  }
}

// ============================================================================
// createNode Tests
// ============================================================================

describe('createNode', () => {
  test('creates a node with properties', async () => {
    const node = await createNode({
      entityId: testEntityId,
      type: 'Company',
      name: 'Apple Inc.',
      properties: { ticker: 'AAPL', sector: 'Technology' },
    });

    expect(node.id).toBeDefined();
    expect(node.entityId).toBe(testEntityId);
    expect(node.type).toBe('Company');
    expect(node.name).toBe('Apple Inc.');
    expect(node.properties).toEqual({ ticker: 'AAPL', sector: 'Technology' });
    expect(node.createdAt).toBeDefined();

    await cleanupNodes([node.id]);
  });

  test('creates a node with empty properties by default', async () => {
    const node = await createNode({
      entityId: testEntityId,
      type: 'Person',
      name: 'John Doe',
    });

    expect(node.properties).toEqual({});

    await cleanupNodes([node.id]);
  });

  test('creates a node with source conversation ID', async () => {
    const node = await createNode({
      entityId: testEntityId,
      type: 'Concept',
      name: 'Test Concept',
      sourceConversationId: testConversationId,
    });

    expect(node.sourceConversationId).toBe(testConversationId);

    await cleanupNodes([node.id]);
  });
});

// ============================================================================
// findNodeByTypeAndName Tests
// ============================================================================

describe('findNodeByTypeAndName', () => {
  test('finds existing node', async () => {
    const created = await createNode({
      entityId: testEntityId,
      type: 'FindTest',
      name: 'Findable Node',
    });

    const found = await findNodeByTypeAndName(testEntityId, 'FindTest', 'Findable Node');

    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);

    await cleanupNodes([created.id]);
  });

  test('returns null for non-existent node', async () => {
    const found = await findNodeByTypeAndName(testEntityId, 'NonExistent', 'No Such Node');
    expect(found).toBeNull();
  });

  test('distinguishes between types', async () => {
    const company = await createNode({
      entityId: testEntityId,
      type: 'Company',
      name: 'Same Name',
    });

    const person = await createNode({
      entityId: testEntityId,
      type: 'Person',
      name: 'Same Name',
    });

    const foundCompany = await findNodeByTypeAndName(testEntityId, 'Company', 'Same Name');
    const foundPerson = await findNodeByTypeAndName(testEntityId, 'Person', 'Same Name');

    expect(foundCompany!.id).toBe(company.id);
    expect(foundPerson!.id).toBe(person.id);
    expect(foundCompany!.id).not.toBe(foundPerson!.id);

    await cleanupNodes([company.id, person.id]);
  });
});

// ============================================================================
// updateNodeProperties Tests
// ============================================================================

describe('updateNodeProperties', () => {
  test('merges properties correctly', async () => {
    const node = await createNode({
      entityId: testEntityId,
      type: 'UpdateTest',
      name: 'Updatable Node',
      properties: { a: 1, b: 2 },
    });

    await updateNodeProperties(node.id, { b: 3, c: 4 });

    const updated = await getNodeById(node.id);
    expect(updated!.properties).toEqual({ a: 1, b: 3, c: 4 });

    await cleanupNodes([node.id]);
  });

  test('adds properties to empty node', async () => {
    const node = await createNode({
      entityId: testEntityId,
      type: 'UpdateTest',
      name: 'Empty Props Node',
    });

    await updateNodeProperties(node.id, { x: 'new' });

    const updated = await getNodeById(node.id);
    expect(updated!.properties).toEqual({ x: 'new' });

    await cleanupNodes([node.id]);
  });

  test('throws error for non-existent node', async () => {
    await expect(
      updateNodeProperties('00000000-0000-0000-0000-000000000000', { a: 1 })
    ).rejects.toThrow('Node not found');
  });
});

// ============================================================================
// createEdge Tests
// ============================================================================

describe('createEdge', () => {
  test('creates edge between nodes', async () => {
    const source = await createNode({
      entityId: testEntityId,
      type: 'Asset',
      name: 'AAPL',
    });

    const target = await createNode({
      entityId: testEntityId,
      type: 'Company',
      name: 'Apple Inc.',
    });

    const edge = await createEdge({
      entityId: testEntityId,
      type: 'issued_by',
      sourceId: source.id,
      targetId: target.id,
    });

    expect(edge.id).toBeDefined();
    expect(edge.entityId).toBe(testEntityId);
    expect(edge.type).toBe('issued_by');
    expect(edge.sourceId).toBe(source.id);
    expect(edge.targetId).toBe(target.id);
    expect(edge.properties).toEqual({});

    await cleanupEdges([edge.id]);
    await cleanupNodes([source.id, target.id]);
  });

  test('creates edge with properties', async () => {
    const source = await createNode({
      entityId: testEntityId,
      type: 'Investor',
      name: 'John',
    });

    const target = await createNode({
      entityId: testEntityId,
      type: 'Stock',
      name: 'AAPL',
    });

    const edge = await createEdge({
      entityId: testEntityId,
      type: 'invested_in',
      sourceId: source.id,
      targetId: target.id,
      properties: { amount: 10000, date: '2024-01-15' },
    });

    expect(edge.properties).toEqual({ amount: 10000, date: '2024-01-15' });

    await cleanupEdges([edge.id]);
    await cleanupNodes([source.id, target.id]);
  });
});

// ============================================================================
// findEdge Tests
// ============================================================================

describe('findEdge', () => {
  test('detects existing edge', async () => {
    const source = await createNode({
      entityId: testEntityId,
      type: 'A',
      name: 'Source',
    });

    const target = await createNode({
      entityId: testEntityId,
      type: 'B',
      name: 'Target',
    });

    const edge = await createEdge({
      entityId: testEntityId,
      type: 'links_to',
      sourceId: source.id,
      targetId: target.id,
    });

    const found = await findEdge(testEntityId, 'links_to', source.id, target.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(edge.id);

    await cleanupEdges([edge.id]);
    await cleanupNodes([source.id, target.id]);
  });

  test('returns null for non-existent edge', async () => {
    const found = await findEdge(
      testEntityId,
      'non_existent',
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002'
    );
    expect(found).toBeNull();
  });

  test('distinguishes edge direction', async () => {
    const nodeA = await createNode({
      entityId: testEntityId,
      type: 'Node',
      name: 'A',
    });

    const nodeB = await createNode({
      entityId: testEntityId,
      type: 'Node',
      name: 'B',
    });

    const edge = await createEdge({
      entityId: testEntityId,
      type: 'directed',
      sourceId: nodeA.id,
      targetId: nodeB.id,
    });

    // Forward direction exists
    const forward = await findEdge(testEntityId, 'directed', nodeA.id, nodeB.id);
    expect(forward).not.toBeNull();

    // Reverse direction does not exist
    const reverse = await findEdge(testEntityId, 'directed', nodeB.id, nodeA.id);
    expect(reverse).toBeNull();

    await cleanupEdges([edge.id]);
    await cleanupNodes([nodeA.id, nodeB.id]);
  });
});

// ============================================================================
// getNodesByEntity Tests
// ============================================================================

describe('getNodesByEntity', () => {
  test('returns all nodes for entity', async () => {
    const node1 = await createNode({
      entityId: testEntityId,
      type: 'TypeA',
      name: 'Node 1',
    });

    const node2 = await createNode({
      entityId: testEntityId,
      type: 'TypeB',
      name: 'Node 2',
    });

    const nodes = await getNodesByEntity(testEntityId);

    expect(nodes.some(n => n.id === node1.id)).toBe(true);
    expect(nodes.some(n => n.id === node2.id)).toBe(true);

    await cleanupNodes([node1.id, node2.id]);
  });

  test('filters by type', async () => {
    const nodeA = await createNode({
      entityId: testEntityId,
      type: 'FilterType',
      name: 'Filtered Node',
    });

    const nodeB = await createNode({
      entityId: testEntityId,
      type: 'OtherType',
      name: 'Other Node',
    });

    const filtered = await getNodesByEntity(testEntityId, { type: 'FilterType' });

    expect(filtered.some(n => n.id === nodeA.id)).toBe(true);
    expect(filtered.some(n => n.id === nodeB.id)).toBe(false);

    await cleanupNodes([nodeA.id, nodeB.id]);
  });

  test('respects limit option', async () => {
    const nodes: string[] = [];
    for (let i = 0; i < 5; i++) {
      const node = await createNode({
        entityId: testEntityId,
        type: 'LimitTest',
        name: `Limit Node ${i}`,
      });
      nodes.push(node.id);
    }

    const limited = await getNodesByEntity(testEntityId, { type: 'LimitTest', limit: 3 });
    expect(limited.length).toBe(3);

    await cleanupNodes(nodes);
  });
});

// ============================================================================
// getEdgesByNode Tests
// ============================================================================

describe('getEdgesByNode', () => {
  test('returns incoming edges', async () => {
    const source = await createNode({
      entityId: testEntityId,
      type: 'S',
      name: 'Source',
    });

    const target = await createNode({
      entityId: testEntityId,
      type: 'T',
      name: 'Target',
    });

    const edge = await createEdge({
      entityId: testEntityId,
      type: 'points_to',
      sourceId: source.id,
      targetId: target.id,
    });

    const incoming = await getEdgesByNode(target.id, 'incoming');
    expect(incoming.some(e => e.id === edge.id)).toBe(true);

    const outgoing = await getEdgesByNode(target.id, 'outgoing');
    expect(outgoing.some(e => e.id === edge.id)).toBe(false);

    await cleanupEdges([edge.id]);
    await cleanupNodes([source.id, target.id]);
  });

  test('returns outgoing edges', async () => {
    const source = await createNode({
      entityId: testEntityId,
      type: 'S',
      name: 'OutSource',
    });

    const target = await createNode({
      entityId: testEntityId,
      type: 'T',
      name: 'OutTarget',
    });

    const edge = await createEdge({
      entityId: testEntityId,
      type: 'flows_to',
      sourceId: source.id,
      targetId: target.id,
    });

    const outgoing = await getEdgesByNode(source.id, 'outgoing');
    expect(outgoing.some(e => e.id === edge.id)).toBe(true);

    const incoming = await getEdgesByNode(source.id, 'incoming');
    expect(incoming.some(e => e.id === edge.id)).toBe(false);

    await cleanupEdges([edge.id]);
    await cleanupNodes([source.id, target.id]);
  });

  test('returns both directions', async () => {
    const nodeA = await createNode({
      entityId: testEntityId,
      type: 'N',
      name: 'NodeA',
    });

    const nodeB = await createNode({
      entityId: testEntityId,
      type: 'N',
      name: 'NodeB',
    });

    const nodeC = await createNode({
      entityId: testEntityId,
      type: 'N',
      name: 'NodeC',
    });

    const edgeIn = await createEdge({
      entityId: testEntityId,
      type: 'connects',
      sourceId: nodeA.id,
      targetId: nodeB.id,
    });

    const edgeOut = await createEdge({
      entityId: testEntityId,
      type: 'connects',
      sourceId: nodeB.id,
      targetId: nodeC.id,
    });

    const both = await getEdgesByNode(nodeB.id, 'both');
    expect(both.some(e => e.id === edgeIn.id)).toBe(true);
    expect(both.some(e => e.id === edgeOut.id)).toBe(true);

    await cleanupEdges([edgeIn.id, edgeOut.id]);
    await cleanupNodes([nodeA.id, nodeB.id, nodeC.id]);
  });
});

// ============================================================================
// serializeGraphForLLM Tests
// ============================================================================

describe('serializeGraphForLLM', () => {
  test('returns properly formatted string', async () => {
    const apple = await createNode({
      entityId: testEntityId,
      type: 'Company',
      name: 'Apple Inc.',
      properties: { ticker: 'AAPL' },
    });

    const aapl = await createNode({
      entityId: testEntityId,
      type: 'Asset',
      name: 'AAPL',
      properties: { type: 'stock' },
    });

    const edge = await createEdge({
      entityId: testEntityId,
      type: 'issued_by',
      sourceId: aapl.id,
      targetId: apple.id,
    });

    const serialized = await serializeGraphForLLM(testEntityId);

    expect(serialized).toContain('Nodes:');
    expect(serialized).toContain('[Company] Apple Inc.');
    expect(serialized).toContain('[Asset] AAPL');
    expect(serialized).toContain('Relationships:');
    expect(serialized).toContain('AAPL --issued_by--> Apple Inc.');

    await cleanupEdges([edge.id]);
    await cleanupNodes([apple.id, aapl.id]);
  });

  test('handles empty graph', async () => {
    // Use a fresh entity with no nodes
    const [freshEntity] = await db.insert(entities).values({
      userId: testUserId,
      name: 'Empty Graph Test',
      systemPrompt: 'Test prompt',
    }).returning();

    const serialized = await serializeGraphForLLM(freshEntity.id);
    expect(serialized).toBe('No knowledge graph data available.');

    await db.delete(entities).where(eq(entities.id, freshEntity.id));
  });
});

// ============================================================================
// getGraphStats Tests
// ============================================================================

describe('getGraphStats', () => {
  test('returns correct counts by type', async () => {
    // Create nodes
    const company1 = await createNode({
      entityId: testEntityId,
      type: 'StatsCompany',
      name: 'Company 1',
    });

    const company2 = await createNode({
      entityId: testEntityId,
      type: 'StatsCompany',
      name: 'Company 2',
    });

    const person = await createNode({
      entityId: testEntityId,
      type: 'StatsPerson',
      name: 'Person 1',
    });

    // Create edges
    const edge1 = await createEdge({
      entityId: testEntityId,
      type: 'stats_works_at',
      sourceId: person.id,
      targetId: company1.id,
    });

    const edge2 = await createEdge({
      entityId: testEntityId,
      type: 'stats_works_at',
      sourceId: person.id,
      targetId: company2.id,
    });

    const stats = await getGraphStats(testEntityId);

    expect(stats.nodeCount).toBeGreaterThanOrEqual(3);
    expect(stats.edgeCount).toBeGreaterThanOrEqual(2);
    expect(stats.nodesByType['StatsCompany']).toBe(2);
    expect(stats.nodesByType['StatsPerson']).toBe(1);
    expect(stats.edgesByType['stats_works_at']).toBe(2);

    await cleanupEdges([edge1.id, edge2.id]);
    await cleanupNodes([company1.id, company2.id, person.id]);
  });

  test('returns zeros for empty graph', async () => {
    // Use a fresh entity with no nodes
    const [freshEntity] = await db.insert(entities).values({
      userId: testUserId,
      name: 'Empty Stats Test',
      systemPrompt: 'Test prompt',
    }).returning();

    const stats = await getGraphStats(freshEntity.id);

    expect(stats.nodeCount).toBe(0);
    expect(stats.edgeCount).toBe(0);
    expect(stats.nodesByType).toEqual({});
    expect(stats.edgesByType).toEqual({});

    await db.delete(entities).where(eq(entities.id, freshEntity.id));
  });
});

// ============================================================================
// getNodeNeighbors Tests
// ============================================================================

describe('getNodeNeighbors', () => {
  test('returns direct neighbors at depth 1', async () => {
    const center = await createNode({
      entityId: testEntityId,
      type: 'Center',
      name: 'Center Node',
    });

    const neighbor1 = await createNode({
      entityId: testEntityId,
      type: 'Neighbor',
      name: 'Neighbor 1',
    });

    const neighbor2 = await createNode({
      entityId: testEntityId,
      type: 'Neighbor',
      name: 'Neighbor 2',
    });

    const edge1 = await createEdge({
      entityId: testEntityId,
      type: 'connected',
      sourceId: center.id,
      targetId: neighbor1.id,
    });

    const edge2 = await createEdge({
      entityId: testEntityId,
      type: 'connected',
      sourceId: neighbor2.id,
      targetId: center.id,
    });

    const result = await getNodeNeighbors(center.id, 1);

    expect(result.nodes.length).toBe(3); // center + 2 neighbors
    expect(result.edges.length).toBe(2);
    expect(result.nodes.some(n => n.id === center.id)).toBe(true);
    expect(result.nodes.some(n => n.id === neighbor1.id)).toBe(true);
    expect(result.nodes.some(n => n.id === neighbor2.id)).toBe(true);

    await cleanupEdges([edge1.id, edge2.id]);
    await cleanupNodes([center.id, neighbor1.id, neighbor2.id]);
  });

  test('traverses multiple levels at depth 2', async () => {
    const nodeA = await createNode({
      entityId: testEntityId,
      type: 'Level',
      name: 'Level 0',
    });

    const nodeB = await createNode({
      entityId: testEntityId,
      type: 'Level',
      name: 'Level 1',
    });

    const nodeC = await createNode({
      entityId: testEntityId,
      type: 'Level',
      name: 'Level 2',
    });

    const edge1 = await createEdge({
      entityId: testEntityId,
      type: 'next',
      sourceId: nodeA.id,
      targetId: nodeB.id,
    });

    const edge2 = await createEdge({
      entityId: testEntityId,
      type: 'next',
      sourceId: nodeB.id,
      targetId: nodeC.id,
    });

    // At depth 1, should only get nodeA and nodeB
    const depth1 = await getNodeNeighbors(nodeA.id, 1);
    expect(depth1.nodes.some(n => n.id === nodeA.id)).toBe(true);
    expect(depth1.nodes.some(n => n.id === nodeB.id)).toBe(true);
    expect(depth1.nodes.some(n => n.id === nodeC.id)).toBe(false);

    // At depth 2, should get all three
    const depth2 = await getNodeNeighbors(nodeA.id, 2);
    expect(depth2.nodes.some(n => n.id === nodeA.id)).toBe(true);
    expect(depth2.nodes.some(n => n.id === nodeB.id)).toBe(true);
    expect(depth2.nodes.some(n => n.id === nodeC.id)).toBe(true);

    await cleanupEdges([edge1.id, edge2.id]);
    await cleanupNodes([nodeA.id, nodeB.id, nodeC.id]);
  });

  test('returns empty result for non-existent node', async () => {
    const result = await getNodeNeighbors('00000000-0000-0000-0000-000000000000');
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });
});

// ============================================================================
// deleteNode Tests
// ============================================================================

describe('deleteNode', () => {
  test('deletes node and cascades to edges', async () => {
    const nodeA = await createNode({
      entityId: testEntityId,
      type: 'DeleteTest',
      name: 'To Delete',
    });

    const nodeB = await createNode({
      entityId: testEntityId,
      type: 'DeleteTest',
      name: 'Remains',
    });

    const edge = await createEdge({
      entityId: testEntityId,
      type: 'link',
      sourceId: nodeA.id,
      targetId: nodeB.id,
    });

    // Delete the source node
    await deleteNode(nodeA.id);

    // Node should be gone
    const deleted = await getNodeById(nodeA.id);
    expect(deleted).toBeNull();

    // Edge should be cascade deleted
    const edges = await getEdgesByNode(nodeB.id, 'both');
    expect(edges.some(e => e.id === edge.id)).toBe(false);

    // Other node should remain
    const remaining = await getNodeById(nodeB.id);
    expect(remaining).not.toBeNull();

    await cleanupNodes([nodeB.id]);
  });
});
