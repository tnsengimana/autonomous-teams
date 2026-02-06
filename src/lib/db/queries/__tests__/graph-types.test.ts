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
  agents,
  graphNodeTypes,
  graphEdgeTypes,
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

// Import graph type queries
import {
  createNodeType,
  getNodeTypesByAgent,
  nodeTypeExists,
  createEdgeType,
  getEdgeTypesByAgent,
  edgeTypeExists,
  formatTypesForLLMContext,
} from '../graph-types';

// ============================================================================
// Test Setup
// ============================================================================

let testUserId: string;
let testAgentId: string;
let testAgent2Id: string;

beforeAll(async () => {
  // Create test user
  const [user] = await db.insert(users).values({
    email: `graph-types-test-${Date.now()}@example.com`,
    name: 'Graph Types Test User',
  }).returning();
  testUserId = user.id;

  // Create test agents
  const [agent] = await db.insert(agents).values({
    userId: testUserId,
    name: 'Graph Types Test Team',
    purpose: 'Testing graph type management',
    conversationSystemPrompt: 'You are a test agent for graph type testing.',
    observerSystemPrompt: 'You observe and classify information for testing.',
    analysisGenerationSystemPrompt: 'You generate analyses for testing.',
    adviceGenerationSystemPrompt: 'You generate advice for testing.',
    graphConstructionSystemPrompt: 'You construct graphs for testing.',
    iterationIntervalMs: 300000,
  }).returning();
  testAgentId = agent.id;

  const [agent2] = await db.insert(agents).values({
    userId: testUserId,
    name: 'Graph Types Test Team 2',
    purpose: 'Testing graph type isolation',
    conversationSystemPrompt: 'You are a test agent for graph type isolation testing.',
    observerSystemPrompt: 'You observe and classify information for testing.',
    analysisGenerationSystemPrompt: 'You generate analyses for testing.',
    adviceGenerationSystemPrompt: 'You generate advice for testing.',
    graphConstructionSystemPrompt: 'You construct graphs for testing.',
    iterationIntervalMs: 300000,
  }).returning();
  testAgent2Id = agent2.id;
});

afterAll(async () => {
  // Cleanup: delete test user (cascades to agents, types, etc.)
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
    await db.delete(graphEdgeTypes).where(eq(graphEdgeTypes.id, id));
  }
}

// ============================================================================
// createNodeType Tests
// ============================================================================

describe('createNodeType', () => {
  test('creates a node type with required fields', async () => {
    const nodeType = await createNodeType({
      agentId: testAgentId,
      name: 'Company',
      description: 'A business agent',
      justification: 'Test coverage for required node type creation.',
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
    expect(nodeType.agentId).toBe(testAgentId);
    expect(nodeType.name).toBe('Company');
    expect(nodeType.description).toBe('A business agent');
    expect(nodeType.propertiesSchema).toBeDefined();
    expect(nodeType.createdBy).toBe('system');

    await cleanupNodeTypes([nodeType.id]);
  });

  test('creates a node type with example properties', async () => {
    const nodeType = await createNodeType({
      agentId: testAgentId,
      name: 'Asset',
      description: 'A financial instrument',
      justification: 'Test coverage for node type creation with examples.',
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

  test('creates a global node type (agentId=null)', async () => {
    const nodeType = await createNodeType({
      agentId: null,
      name: 'GlobalPerson',
      description: 'A global person type',
      justification: 'Test coverage for global node type behavior.',
      propertiesSchema: {
        type: 'object',
        properties: {
          firstName: { type: 'string' },
          lastName: { type: 'string' },
        },
      },
    });

    expect(nodeType.agentId).toBeNull();
    expect(nodeType.name).toBe('GlobalPerson');

    await cleanupNodeTypes([nodeType.id]);
  });

  test('sets createdBy correctly', async () => {
    const agentType = await createNodeType({
      agentId: testAgentId,
      name: 'AgentCreated',
      description: 'Created by agent',
      justification: 'Test coverage for createdBy=agent.',
      propertiesSchema: {},
      createdBy: 'agent',
    });

    const userType = await createNodeType({
      agentId: testAgentId,
      name: 'UserCreated',
      description: 'Created by user',
      justification: 'Test coverage for createdBy=user.',
      propertiesSchema: {},
      createdBy: 'user',
    });

    expect(agentType.createdBy).toBe('agent');
    expect(userType.createdBy).toBe('user');

    await cleanupNodeTypes([agentType.id, userType.id]);
  });
});

// ============================================================================
// getNodeTypesByAgent Tests
// ============================================================================

describe('getNodeTypesByAgent', () => {
  test('returns agent-specific types', async () => {
    const nodeType = await createNodeType({
      agentId: testAgentId,
      name: 'AgentSpecificType',
      description: 'Agent specific',
      justification: 'Test coverage for agent-specific lookup.',
      propertiesSchema: {},
    });

    const types = await getNodeTypesByAgent(testAgentId);
    expect(types.some(t => t.id === nodeType.id)).toBe(true);

    await cleanupNodeTypes([nodeType.id]);
  });

  test('returns global types for any agent', async () => {
    const globalType = await createNodeType({
      agentId: null,
      name: 'GlobalTypeForAgent',
      description: 'Global type',
      justification: 'Test coverage for global type lookup.',
      propertiesSchema: {},
    });

    const types = await getNodeTypesByAgent(testAgentId);
    expect(types.some(t => t.id === globalType.id)).toBe(true);

    // Also available for other agents
    const types2 = await getNodeTypesByAgent(testAgent2Id);
    expect(types2.some(t => t.id === globalType.id)).toBe(true);

    await cleanupNodeTypes([globalType.id]);
  });

  test('does not return types from other agents', async () => {
    const agent1Type = await createNodeType({
      agentId: testAgentId,
      name: 'Agent1Only',
      description: 'Agent 1 specific',
      justification: 'Test coverage for agent isolation.',
      propertiesSchema: {},
    });

    const types = await getNodeTypesByAgent(testAgent2Id);
    expect(types.some(t => t.id === agent1Type.id)).toBe(false);

    await cleanupNodeTypes([agent1Type.id]);
  });
});

// ============================================================================
// nodeTypeExists Tests
// ============================================================================

describe('nodeTypeExists', () => {
  test('returns true for existing agent-specific type', async () => {
    const nodeType = await createNodeType({
      agentId: testAgentId,
      name: 'ExistingType',
      description: 'Exists',
      justification: 'Test coverage for existence check.',
      propertiesSchema: {},
    });

    const exists = await nodeTypeExists(testAgentId, 'ExistingType');
    expect(exists).toBe(true);

    await cleanupNodeTypes([nodeType.id]);
  });

  test('returns true for existing global type', async () => {
    const globalType = await createNodeType({
      agentId: null,
      name: 'GlobalExisting',
      description: 'Global exists',
      justification: 'Test coverage for global existence check.',
      propertiesSchema: {},
    });

    const exists = await nodeTypeExists(testAgentId, 'GlobalExisting');
    expect(exists).toBe(true);

    await cleanupNodeTypes([globalType.id]);
  });

  test('returns false for non-existent type', async () => {
    const exists = await nodeTypeExists(testAgentId, 'NonExistentType');
    expect(exists).toBe(false);
  });
});

// ============================================================================
// createEdgeType Tests
// ============================================================================

describe('createEdgeType', () => {
  test('creates an edge type with basic fields', async () => {
    const edgeType = await createEdgeType({
      agentId: testAgentId,
      name: 'belongs_to',
      description: 'Indicates ownership or membership',
      justification: 'Test coverage for required edge type creation.',
    });

    expect(edgeType.id).toBeDefined();
    expect(edgeType.agentId).toBe(testAgentId);
    expect(edgeType.name).toBe('belongs_to');
    expect(edgeType.description).toBe('Indicates ownership or membership');
    expect(edgeType.createdBy).toBe('system');

    await cleanupEdgeTypes([edgeType.id]);
  });

  test('creates an edge type without constraints', async () => {
    const edgeType = await createEdgeType({
      agentId: testAgentId,
      name: 'issued_by',
      description: 'Asset issued by a company',
      justification: 'Test coverage for unconstrained edge types.',
    });

    expect(edgeType.id).toBeDefined();
    expect(edgeType.name).toBe('issued_by');
    expect(edgeType.description).toBe('Asset issued by a company');

    await cleanupEdgeTypes([edgeType.id]);
  });

  test('creates edge type with properties schema', async () => {
    const edgeType = await createEdgeType({
      agentId: testAgentId,
      name: 'invested_in',
      description: 'Investment relationship',
      justification: 'Test coverage for edge type properties schema.',
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
// getEdgeTypesByAgent Tests
// ============================================================================

describe('getEdgeTypesByAgent', () => {
  test('returns edge types for agent', async () => {
    const edgeType = await createEdgeType({
      agentId: testAgentId,
      name: 'connects_to',
      description: 'Connection',
      justification: 'Test coverage for agent edge type lookup.',
    });

    const edgeTypes = await getEdgeTypesByAgent(testAgentId);
    const found = edgeTypes.find(et => et.id === edgeType.id);

    expect(found).toBeDefined();
    expect(found!.name).toBe('connects_to');

    await cleanupEdgeTypes([edgeType.id]);
  });

  test('returns global edge types', async () => {
    const globalEdgeType = await createEdgeType({
      agentId: null,
      name: 'global_relationship',
      description: 'Global edge type',
      justification: 'Test coverage for global edge type lookup.',
    });

    const edgeTypes = await getEdgeTypesByAgent(testAgentId);
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
      agentId: testAgentId,
      name: 'existing_edge',
      description: 'Exists',
      justification: 'Test coverage for edge existence check.',
    });

    const exists = await edgeTypeExists(testAgentId, 'existing_edge');
    expect(exists).toBe(true);

    await cleanupEdgeTypes([edgeType.id]);
  });

  test('returns false for non-existent edge type', async () => {
    const exists = await edgeTypeExists(testAgentId, 'non_existent_edge');
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
      agentId: testAgentId,
      name: 'LLMAsset',
      description: 'Financial instrument (stocks, bonds, ETFs, crypto)',
      justification: 'Test coverage for LLM context formatting.',
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
      agentId: testAgentId,
      name: 'LLMCompany',
      description: 'A business agent',
      justification: 'Test coverage for LLM context formatting with required fields.',
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
      agentId: testAgentId,
      name: 'llm_issued_by',
      description: 'Asset issued by a company',
      justification: 'Test coverage for edge formatting in LLM context.',
    });

    const formatted = await formatTypesForLLMContext(testAgentId);

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

    await cleanupEdgeTypes([edgeType.id]);
    await cleanupNodeTypes([assetType.id, companyType.id]);
  });

  test('handles empty types gracefully', async () => {
    // Use a fresh agent with no types
    const [freshAgent] = await db.insert(agents).values({
      userId: testUserId,
      name: 'Empty Types Test',
      conversationSystemPrompt: 'Test prompt',
      observerSystemPrompt: 'Test prompt',
      analysisGenerationSystemPrompt: 'Test prompt',
      adviceGenerationSystemPrompt: 'Test prompt',
      graphConstructionSystemPrompt: 'Test prompt',
      iterationIntervalMs: 300000,
    }).returning();

    const formatted = await formatTypesForLLMContext(freshAgent.id);

    expect(formatted).toContain('### Node Types');
    expect(formatted).toContain('No node types defined.');
    expect(formatted).toContain('### Edge Types');
    expect(formatted).toContain('No edge types defined.');

    await db.delete(agents).where(eq(agents.id, freshAgent.id));
  });
});
