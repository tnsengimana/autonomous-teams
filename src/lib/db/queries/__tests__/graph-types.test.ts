/**
 * Tests for graph type queries
 *
 * These tests verify the node type and edge type management system
 * for the knowledge graph.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db/client';
import {
  users,
  entities,
  graphNodeTypes,
  graphEdgeTypes,
  graphEdgeTypeSourceTypes,
  graphEdgeTypeTargetTypes,
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

// Import graph type queries
import {
  createNodeType,
  getNodeTypesByEntity,
  nodeTypeExists,
  createEdgeType,
  getEdgeTypesByEntity,
  edgeTypeExists,
  formatTypesForLLMContext,
} from '../graph-types';

// ============================================================================
// Test Setup
// ============================================================================

let testUserId: string;
let testEntityId: string;
let testEntity2Id: string;

beforeAll(async () => {
  // Create test user
  const [user] = await db.insert(users).values({
    email: `graph-types-test-${Date.now()}@example.com`,
    name: 'Graph Types Test User',
  }).returning();
  testUserId = user.id;

  // Create test entities
  const [entity] = await db.insert(entities).values({
    userId: testUserId,
    type: 'team',
    name: 'Graph Types Test Team',
    purpose: 'Testing graph type management',
  }).returning();
  testEntityId = entity.id;

  const [entity2] = await db.insert(entities).values({
    userId: testUserId,
    type: 'team',
    name: 'Graph Types Test Team 2',
    purpose: 'Testing graph type isolation',
  }).returning();
  testEntity2Id = entity2.id;
});

afterAll(async () => {
  // Cleanup: delete test user (cascades to entities, types, etc.)
  await db.delete(users).where(eq(users.id, testUserId));
});

// Helper to cleanup node types created during tests
async function cleanupNodeTypes(nodeTypeIds: string[]) {
  for (const id of nodeTypeIds) {
    await db.delete(graphNodeTypes).where(eq(graphNodeTypes.id, id));
  }
}

// Helper to cleanup edge types created during tests
async function cleanupEdgeTypes(edgeTypeIds: string[]) {
  for (const id of edgeTypeIds) {
    // Junction tables cascade delete
    await db.delete(graphEdgeTypes).where(eq(graphEdgeTypes.id, id));
  }
}

// ============================================================================
// createNodeType Tests
// ============================================================================

describe('createNodeType', () => {
  test('creates a node type with required fields', async () => {
    const nodeType = await createNodeType({
      entityId: testEntityId,
      name: 'Company',
      description: 'A business entity',
      propertiesSchema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          ticker: { type: 'string' },
        },
      },
    });

    expect(nodeType.id).toBeDefined();
    expect(nodeType.entityId).toBe(testEntityId);
    expect(nodeType.name).toBe('Company');
    expect(nodeType.description).toBe('A business entity');
    expect(nodeType.propertiesSchema).toBeDefined();
    expect(nodeType.createdBy).toBe('system');

    await cleanupNodeTypes([nodeType.id]);
  });

  test('creates a node type with example properties', async () => {
    const nodeType = await createNodeType({
      entityId: testEntityId,
      name: 'Asset',
      description: 'A financial instrument',
      propertiesSchema: {
        type: 'object',
        required: ['symbol'],
        properties: {
          symbol: { type: 'string' },
          type: { type: 'string' },
          name: { type: 'string' },
        },
      },
      exampleProperties: { symbol: 'AAPL', type: 'stock', name: 'Apple Inc.' },
    });

    expect(nodeType.exampleProperties).toEqual({
      symbol: 'AAPL',
      type: 'stock',
      name: 'Apple Inc.',
    });

    await cleanupNodeTypes([nodeType.id]);
  });

  test('creates a global node type (entityId=null)', async () => {
    const nodeType = await createNodeType({
      entityId: null,
      name: 'GlobalPerson',
      description: 'A global person type',
      propertiesSchema: {
        type: 'object',
        properties: {
          firstName: { type: 'string' },
          lastName: { type: 'string' },
        },
      },
    });

    expect(nodeType.entityId).toBeNull();
    expect(nodeType.name).toBe('GlobalPerson');

    await cleanupNodeTypes([nodeType.id]);
  });

  test('sets createdBy correctly', async () => {
    const agentType = await createNodeType({
      entityId: testEntityId,
      name: 'AgentCreated',
      description: 'Created by agent',
      propertiesSchema: {},
      createdBy: 'agent',
    });

    const userType = await createNodeType({
      entityId: testEntityId,
      name: 'UserCreated',
      description: 'Created by user',
      propertiesSchema: {},
      createdBy: 'user',
    });

    expect(agentType.createdBy).toBe('agent');
    expect(userType.createdBy).toBe('user');

    await cleanupNodeTypes([agentType.id, userType.id]);
  });
});

// ============================================================================
// getNodeTypesByEntity Tests
// ============================================================================

describe('getNodeTypesByEntity', () => {
  test('returns entity-specific types', async () => {
    const nodeType = await createNodeType({
      entityId: testEntityId,
      name: 'EntitySpecificType',
      description: 'Entity specific',
      propertiesSchema: {},
    });

    const types = await getNodeTypesByEntity(testEntityId);
    expect(types.some(t => t.id === nodeType.id)).toBe(true);

    await cleanupNodeTypes([nodeType.id]);
  });

  test('returns global types for any entity', async () => {
    const globalType = await createNodeType({
      entityId: null,
      name: 'GlobalTypeForEntity',
      description: 'Global type',
      propertiesSchema: {},
    });

    const types = await getNodeTypesByEntity(testEntityId);
    expect(types.some(t => t.id === globalType.id)).toBe(true);

    // Also available for other entities
    const types2 = await getNodeTypesByEntity(testEntity2Id);
    expect(types2.some(t => t.id === globalType.id)).toBe(true);

    await cleanupNodeTypes([globalType.id]);
  });

  test('does not return types from other entities', async () => {
    const entity1Type = await createNodeType({
      entityId: testEntityId,
      name: 'Entity1Only',
      description: 'Entity 1 specific',
      propertiesSchema: {},
    });

    const types = await getNodeTypesByEntity(testEntity2Id);
    expect(types.some(t => t.id === entity1Type.id)).toBe(false);

    await cleanupNodeTypes([entity1Type.id]);
  });
});

// ============================================================================
// nodeTypeExists Tests
// ============================================================================

describe('nodeTypeExists', () => {
  test('returns true for existing entity-specific type', async () => {
    const nodeType = await createNodeType({
      entityId: testEntityId,
      name: 'ExistingType',
      description: 'Exists',
      propertiesSchema: {},
    });

    const exists = await nodeTypeExists(testEntityId, 'ExistingType');
    expect(exists).toBe(true);

    await cleanupNodeTypes([nodeType.id]);
  });

  test('returns true for existing global type', async () => {
    const globalType = await createNodeType({
      entityId: null,
      name: 'GlobalExisting',
      description: 'Global exists',
      propertiesSchema: {},
    });

    const exists = await nodeTypeExists(testEntityId, 'GlobalExisting');
    expect(exists).toBe(true);

    await cleanupNodeTypes([globalType.id]);
  });

  test('returns false for non-existent type', async () => {
    const exists = await nodeTypeExists(testEntityId, 'NonExistentType');
    expect(exists).toBe(false);
  });
});

// ============================================================================
// createEdgeType Tests
// ============================================================================

describe('createEdgeType', () => {
  test('creates an edge type with basic fields', async () => {
    const edgeType = await createEdgeType({
      entityId: testEntityId,
      name: 'belongs_to',
      description: 'Indicates ownership or membership',
    });

    expect(edgeType.id).toBeDefined();
    expect(edgeType.entityId).toBe(testEntityId);
    expect(edgeType.name).toBe('belongs_to');
    expect(edgeType.description).toBe('Indicates ownership or membership');
    expect(edgeType.createdBy).toBe('system');

    await cleanupEdgeTypes([edgeType.id]);
  });

  test('creates an edge type with source/target constraints', async () => {
    // First create the node types
    const assetType = await createNodeType({
      entityId: testEntityId,
      name: 'AssetForEdge',
      description: 'Asset type',
      propertiesSchema: {},
    });

    const companyType = await createNodeType({
      entityId: testEntityId,
      name: 'CompanyForEdge',
      description: 'Company type',
      propertiesSchema: {},
    });

    const edgeType = await createEdgeType({
      entityId: testEntityId,
      name: 'issued_by',
      description: 'Asset issued by a company',
      sourceNodeTypeNames: ['AssetForEdge'],
      targetNodeTypeNames: ['CompanyForEdge'],
    });

    // Verify the edge type was created
    expect(edgeType.id).toBeDefined();

    // Check the junction tables
    const sourceLinks = await db
      .select()
      .from(graphEdgeTypeSourceTypes)
      .where(eq(graphEdgeTypeSourceTypes.edgeTypeId, edgeType.id));
    expect(sourceLinks.length).toBe(1);
    expect(sourceLinks[0].nodeTypeId).toBe(assetType.id);

    const targetLinks = await db
      .select()
      .from(graphEdgeTypeTargetTypes)
      .where(eq(graphEdgeTypeTargetTypes.edgeTypeId, edgeType.id));
    expect(targetLinks.length).toBe(1);
    expect(targetLinks[0].nodeTypeId).toBe(companyType.id);

    await cleanupEdgeTypes([edgeType.id]);
    await cleanupNodeTypes([assetType.id, companyType.id]);
  });

  test('creates edge type with properties schema', async () => {
    const edgeType = await createEdgeType({
      entityId: testEntityId,
      name: 'invested_in',
      description: 'Investment relationship',
      propertiesSchema: {
        type: 'object',
        properties: {
          amount: { type: 'number' },
          date: { type: 'string' },
        },
      },
      exampleProperties: { amount: 10000, date: '2024-01-15' },
    });

    expect(edgeType.propertiesSchema).toBeDefined();
    expect(edgeType.exampleProperties).toEqual({ amount: 10000, date: '2024-01-15' });

    await cleanupEdgeTypes([edgeType.id]);
  });
});

// ============================================================================
// getEdgeTypesByEntity Tests
// ============================================================================

describe('getEdgeTypesByEntity', () => {
  test('returns edge types with populated constraints', async () => {
    // Create node types
    const sourceType = await createNodeType({
      entityId: testEntityId,
      name: 'SourceNodeType',
      description: 'Source',
      propertiesSchema: {},
    });

    const targetType = await createNodeType({
      entityId: testEntityId,
      name: 'TargetNodeType',
      description: 'Target',
      propertiesSchema: {},
    });

    // Create edge type with constraints
    const edgeType = await createEdgeType({
      entityId: testEntityId,
      name: 'connects_to',
      description: 'Connection',
      sourceNodeTypeNames: ['SourceNodeType'],
      targetNodeTypeNames: ['TargetNodeType'],
    });

    const edgeTypes = await getEdgeTypesByEntity(testEntityId);
    const found = edgeTypes.find(et => et.id === edgeType.id);

    expect(found).toBeDefined();
    expect(found!.sourceNodeTypes.length).toBe(1);
    expect(found!.sourceNodeTypes[0].name).toBe('SourceNodeType');
    expect(found!.targetNodeTypes.length).toBe(1);
    expect(found!.targetNodeTypes[0].name).toBe('TargetNodeType');

    await cleanupEdgeTypes([edgeType.id]);
    await cleanupNodeTypes([sourceType.id, targetType.id]);
  });

  test('returns global edge types', async () => {
    const globalEdgeType = await createEdgeType({
      entityId: null,
      name: 'global_relationship',
      description: 'Global edge type',
    });

    const edgeTypes = await getEdgeTypesByEntity(testEntityId);
    expect(edgeTypes.some(et => et.id === globalEdgeType.id)).toBe(true);

    await cleanupEdgeTypes([globalEdgeType.id]);
  });
});

// ============================================================================
// edgeTypeExists Tests
// ============================================================================

describe('edgeTypeExists', () => {
  test('returns true for existing edge type', async () => {
    const edgeType = await createEdgeType({
      entityId: testEntityId,
      name: 'existing_edge',
      description: 'Exists',
    });

    const exists = await edgeTypeExists(testEntityId, 'existing_edge');
    expect(exists).toBe(true);

    await cleanupEdgeTypes([edgeType.id]);
  });

  test('returns false for non-existent edge type', async () => {
    const exists = await edgeTypeExists(testEntityId, 'non_existent_edge');
    expect(exists).toBe(false);
  });
});

// ============================================================================
// formatTypesForLLMContext Tests
// ============================================================================

describe('formatTypesForLLMContext', () => {
  test('returns properly formatted string with node and edge types', async () => {
    // Create node types
    const assetType = await createNodeType({
      entityId: testEntityId,
      name: 'LLMAsset',
      description: 'Financial instrument (stocks, bonds, ETFs, crypto)',
      propertiesSchema: {
        type: 'object',
        required: ['symbol'],
        properties: {
          symbol: { type: 'string' },
          type: { type: 'string' },
          name: { type: 'string' },
        },
      },
      exampleProperties: { symbol: 'AAPL', type: 'stock', name: 'Apple Inc.' },
    });

    const companyType = await createNodeType({
      entityId: testEntityId,
      name: 'LLMCompany',
      description: 'A business entity',
      propertiesSchema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          ticker: { type: 'string' },
        },
      },
    });

    // Create edge type
    const edgeType = await createEdgeType({
      entityId: testEntityId,
      name: 'llm_issued_by',
      description: 'Asset issued by a company',
      sourceNodeTypeNames: ['LLMAsset'],
      targetNodeTypeNames: ['LLMCompany'],
    });

    const formatted = await formatTypesForLLMContext(testEntityId);

    // Check structure
    expect(formatted).toContain('### Node Types');
    expect(formatted).toContain('### Edge Types');

    // Check node type formatting
    expect(formatted).toContain('**LLMAsset**');
    expect(formatted).toContain('Financial instrument');
    expect(formatted).toContain('Required: symbol');
    expect(formatted).toContain('Example:');

    // Check edge type formatting
    expect(formatted).toContain('**llm_issued_by**');
    expect(formatted).toContain('LLMAsset');
    expect(formatted).toContain('LLMCompany');

    await cleanupEdgeTypes([edgeType.id]);
    await cleanupNodeTypes([assetType.id, companyType.id]);
  });

  test('handles empty types gracefully', async () => {
    // Use a fresh entity with no types
    const [freshEntity] = await db.insert(entities).values({
      userId: testUserId,
      type: 'team',
      name: 'Empty Types Test',
    }).returning();

    const formatted = await formatTypesForLLMContext(freshEntity.id);

    expect(formatted).toContain('### Node Types');
    expect(formatted).toContain('No node types defined.');
    expect(formatted).toContain('### Edge Types');
    expect(formatted).toContain('No edge types defined.');

    await db.delete(entities).where(eq(entities.id, freshEntity.id));
  });
});
