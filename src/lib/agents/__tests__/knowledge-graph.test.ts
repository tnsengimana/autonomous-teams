/**
 * Tests for Knowledge Graph Service
 *
 * Tests the high-level knowledge graph operations for the INSERT/RETRIEVE loop
 * and context building.
 */

import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { users, entities } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  buildGraphContextBlock,
  ensureGraphTypesInitialized,
} from '../knowledge-graph';
import { createNodeType } from '@/lib/db/queries/graph-types';
import { createNode } from '@/lib/db/queries/graph-data';
import * as graphTypeInitializer from '../graph-type-initializer';

// ============================================================================
// Test Setup
// ============================================================================

let testUserId: string;
let testEntityId: string;

beforeAll(async () => {
  // Create test user
  const [user] = await db
    .insert(users)
    .values({
      email: `knowledge-graph-test-${Date.now()}@example.com`,
      name: 'Knowledge Graph Test User',
    })
    .returning();
  testUserId = user.id;

  // Create test entity
  const [entity] = await db
    .insert(entities)
    .values({
      userId: testUserId,
      name: 'Test Research Team',
      purpose: 'Financial research and analysis',
      systemPrompt: 'You are a test entity for knowledge graph testing.',
      status: 'active',
    })
    .returning();
  testEntityId = entity.id;
});

afterAll(async () => {
  // Cleanup: delete test user (cascades to entities, types, nodes, etc.)
  await db.delete(users).where(eq(users.id, testUserId));
});

// ============================================================================
// buildGraphContextBlock Tests
// ============================================================================

describe('buildGraphContextBlock', () => {
  test('returns formatted context with types and graph state', async () => {
    // First create some types
    await createNodeType({
      entityId: testEntityId,
      name: 'Company',
      description: 'A business entity',
      propertiesSchema: {
        type: 'object',
        properties: {
          ticker: { type: 'string' },
        },
      },
      createdBy: 'system',
    });

    // Create a node
    await createNode({
      entityId: testEntityId,
      type: 'Company',
      name: 'Acme Corp',
      properties: { ticker: 'ACME' },
    });

    const context = await buildGraphContextBlock(testEntityId);

    // Should contain the knowledge_graph tags
    expect(context).toContain('<knowledge_graph>');
    expect(context).toContain('</knowledge_graph>');

    // Should mention node/edge counts
    expect(context).toMatch(/Current graph has \d+ nodes? and \d+ edges?/);

    // Should contain available types section
    expect(context).toContain('## Available Types');
    expect(context).toContain('Company');

    // Should contain graph state
    expect(context).toContain('Acme Corp');

    // Should contain usage instructions
    expect(context).toContain('How to Use the Knowledge Graph');
    expect(context).toContain('RETRIEVE first');
    expect(context).toContain('INSERT when needed');
  });

  test('handles empty graph correctly', async () => {
    // Create a new entity with no types or nodes
    const [emptyEntity] = await db
      .insert(entities)
      .values({
        userId: testUserId,
        name: 'Empty Test Entity',
        purpose: 'Testing empty graph',
        systemPrompt: 'You are a test entity for empty graph testing.',
        status: 'active',
      })
      .returning();

    try {
      const context = await buildGraphContextBlock(emptyEntity.id);

      // Should contain the knowledge_graph tags
      expect(context).toContain('<knowledge_graph>');
      expect(context).toContain('</knowledge_graph>');

      // Should indicate empty graph
      expect(context).toContain('knowledge graph is currently empty');

      // Should still contain usage instructions
      expect(context).toContain('How to Use the Knowledge Graph');
      expect(context).toContain('RETRIEVE first');
      expect(context).toContain('INSERT when needed');

      // Should NOT contain the freshness reasoning (only in non-empty graph)
      expect(context).not.toContain('Reason about freshness');
    } finally {
      // Cleanup
      await db.delete(entities).where(eq(entities.id, emptyEntity.id));
    }
  });
});

// ============================================================================
// ensureGraphTypesInitialized Tests
// ============================================================================

describe('ensureGraphTypesInitialized', () => {
  test('initializes types for entity without types', async () => {
    // Create a new entity with no types
    const [newEntity] = await db
      .insert(entities)
      .values({
        userId: testUserId,
        name: 'No Types Entity',
        purpose: 'Testing type initialization',
        systemPrompt: 'You are a test entity for type initialization.',
        status: 'active',
      })
      .returning();

    // Mock the initializeAndPersistTypesForEntity function
    const mockInit = vi
      .spyOn(graphTypeInitializer, 'initializeAndPersistTypesForEntity')
      .mockResolvedValueOnce();

    try {
      await ensureGraphTypesInitialized(
        newEntity.id,
        { name: newEntity.name, type: 'entity', purpose: newEntity.purpose },
        { userId: testUserId }
      );

      // Should have called the initializer
      expect(mockInit).toHaveBeenCalledWith(
        newEntity.id,
        { name: newEntity.name, type: 'entity', purpose: newEntity.purpose },
        { userId: testUserId }
      );
    } finally {
      mockInit.mockRestore();
      // Cleanup
      await db.delete(entities).where(eq(entities.id, newEntity.id));
    }
  });

  test('skips initialization if types exist', async () => {
    // The test entity already has types from the first test
    // Mock the initializeAndPersistTypesForEntity function
    const mockInit = vi
      .spyOn(graphTypeInitializer, 'initializeAndPersistTypesForEntity')
      .mockResolvedValueOnce();

    try {
      await ensureGraphTypesInitialized(
        testEntityId,
        { name: 'Test Research Team', type: 'team', purpose: 'Financial research' },
        { userId: testUserId }
      );

      // Should NOT have called the initializer since types exist
      expect(mockInit).not.toHaveBeenCalled();
    } finally {
      mockInit.mockRestore();
    }
  });

  test('handles missing userId gracefully', async () => {
    // Create a new entity with no types
    const [newEntity] = await db
      .insert(entities)
      .values({
        userId: testUserId,
        name: 'No UserId Entity',
        purpose: 'Testing without userId',
        systemPrompt: 'You are a test entity for userId testing.',
        status: 'active',
      })
      .returning();

    // Mock the initializeAndPersistTypesForEntity function
    const mockInit = vi
      .spyOn(graphTypeInitializer, 'initializeAndPersistTypesForEntity')
      .mockResolvedValueOnce();

    try {
      // Call without userId option
      await ensureGraphTypesInitialized(newEntity.id, {
        name: newEntity.name,
        type: 'entity',
        purpose: newEntity.purpose,
      });

      // Should still have called the initializer
      expect(mockInit).toHaveBeenCalledWith(
        newEntity.id,
        { name: newEntity.name, type: 'entity', purpose: newEntity.purpose },
        undefined
      );
    } finally {
      mockInit.mockRestore();
      // Cleanup
      await db.delete(entities).where(eq(entities.id, newEntity.id));
    }
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration', () => {
  test('buildGraphContextBlock includes recently added nodes', async () => {
    // Create another entity for isolation
    const [integrationEntity] = await db
      .insert(entities)
      .values({
        userId: testUserId,
        name: 'Integration Test Team',
        purpose: 'Integration testing',
        systemPrompt: 'You are a test entity for integration testing.',
        status: 'active',
      })
      .returning();

    try {
      // Create a node type
      await createNodeType({
        entityId: integrationEntity.id,
        name: 'Analyst',
        description: 'A financial analyst',
        propertiesSchema: {
          type: 'object',
          properties: {
            specialty: { type: 'string' },
          },
        },
        createdBy: 'system',
      });

      // Create multiple nodes
      await createNode({
        entityId: integrationEntity.id,
        type: 'Analyst',
        name: 'Alice Smith',
        properties: { specialty: 'Tech' },
      });

      await createNode({
        entityId: integrationEntity.id,
        type: 'Analyst',
        name: 'Bob Jones',
        properties: { specialty: 'Finance' },
      });

      const context = await buildGraphContextBlock(integrationEntity.id);

      // Should contain both nodes
      expect(context).toContain('Alice Smith');
      expect(context).toContain('Bob Jones');

      // Should have correct count
      expect(context).toContain('2 nodes');
    } finally {
      // Cleanup
      await db.delete(entities).where(eq(entities.id, integrationEntity.id));
    }
  });
});
