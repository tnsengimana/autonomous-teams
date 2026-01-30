/**
 * Entities Database Queries
 *
 * CRUD operations for entities (teams and aides unified).
 */

import { eq, desc, and, isNull } from 'drizzle-orm';
import { db } from '../client';
import { entities, agents } from '../schema';
import type { Entity, EntityStatus, EntityType, EntityWithAgents, Agent } from '@/lib/types';

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Create a new entity
 */
export async function createEntity(data: {
  userId: string;
  type: EntityType;
  name: string;
  purpose?: string | null;
  status?: EntityStatus;
}): Promise<Entity> {
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

  return result[0];
}

/**
 * Get an entity by ID
 */
export async function getEntityById(entityId: string): Promise<Entity | null> {
  const result = await db
    .select()
    .from(entities)
    .where(eq(entities.id, entityId))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Get all entities for a user, optionally filtered by type
 */
export async function getEntitiesByUserId(
  userId: string,
  type?: EntityType
): Promise<Entity[]> {
  if (type) {
    return db
      .select()
      .from(entities)
      .where(and(eq(entities.userId, userId), eq(entities.type, type)))
      .orderBy(desc(entities.createdAt));
  }
  return db
    .select()
    .from(entities)
    .where(eq(entities.userId, userId))
    .orderBy(desc(entities.createdAt));
}

/**
 * Get active entities for a user, optionally filtered by type
 */
export async function getActiveEntitiesByUserId(
  userId: string,
  type?: EntityType
): Promise<Entity[]> {
  const conditions = [eq(entities.userId, userId), eq(entities.status, 'active')];
  if (type) {
    conditions.push(eq(entities.type, type));
  }
  return db
    .select()
    .from(entities)
    .where(and(...conditions))
    .orderBy(desc(entities.createdAt));
}

/**
 * Update entity details
 */
export async function updateEntity(
  entityId: string,
  data: {
    name?: string;
    purpose?: string | null;
    status?: EntityStatus;
  }
): Promise<void> {
  await db
    .update(entities)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(entities.id, entityId));
}

/**
 * Update entity status
 */
export async function updateEntityStatus(
  entityId: string,
  status: EntityStatus
): Promise<void> {
  await db
    .update(entities)
    .set({ status, updatedAt: new Date() })
    .where(eq(entities.id, entityId));
}

/**
 * Activate an entity (set status to 'active')
 */
export async function activateEntity(entityId: string): Promise<void> {
  await updateEntityStatus(entityId, 'active');
}

/**
 * Delete an entity (cascades to agents, conversations, etc.)
 */
export async function deleteEntity(entityId: string): Promise<void> {
  await db.delete(entities).where(eq(entities.id, entityId));
}

/**
 * Get the user ID for an entity
 */
export async function getEntityUserId(entityId: string): Promise<string | null> {
  const result = await db
    .select({ userId: entities.userId })
    .from(entities)
    .where(eq(entities.id, entityId))
    .limit(1);

  return result[0]?.userId ?? null;
}

/**
 * Get the lead agent (parentAgentId is null) for an entity
 */
export async function getEntityLead(entityId: string): Promise<Agent | null> {
  const result = await db
    .select()
    .from(agents)
    .where(and(eq(agents.entityId, entityId), isNull(agents.parentAgentId)))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Get an entity with its agents
 */
export async function getEntityWithAgents(
  entityId: string
): Promise<EntityWithAgents | null> {
  const entity = await getEntityById(entityId);
  if (!entity) {
    return null;
  }

  const entityAgents = await db
    .select()
    .from(agents)
    .where(eq(agents.entityId, entityId));

  return {
    ...entity,
    agents: entityAgents,
  };
}
