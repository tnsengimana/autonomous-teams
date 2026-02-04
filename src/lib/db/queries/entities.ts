/**
 * Entities Database Queries
 *
 * CRUD operations for entities.
 */

import { eq, desc } from "drizzle-orm";
import { db } from "../client";
import { entities } from "../schema";
import type { Entity, EntityStatus } from "@/lib/types";
import { initializeAndPersistTypesForEntity } from "@/lib/llm/graph-configuration";

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Create a new entity
 */
export async function createEntity(data: {
  userId: string;
  name: string;
  purpose?: string | null;
  systemPrompt: string;
  status?: EntityStatus;
}): Promise<Entity> {
  const result = await db
    .insert(entities)
    .values({
      userId: data.userId,
      name: data.name,
      purpose: data.purpose ?? null,
      systemPrompt: data.systemPrompt,
      status: data.status ?? "active",
    })
    .returning();

  const entity = result[0];

  // Fire and forget type initialization - don't block entity creation
  initializeAndPersistTypesForEntity(
    entity.id,
    { name: entity.name, purpose: entity.purpose },
    { userId: data.userId },
  ).catch((err) => {
    console.error("[createEntity] Failed to initialize graph types:", err);
  });

  return entity;
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
 * Get all entities for a user
 */
export async function getEntitiesByUserId(userId: string): Promise<Entity[]> {
  return db
    .select()
    .from(entities)
    .where(eq(entities.userId, userId))
    .orderBy(desc(entities.createdAt));
}

/**
 * Get active entities for a user
 */
export async function getActiveEntitiesByUserId(
  userId: string,
): Promise<Entity[]> {
  return db
    .select()
    .from(entities)
    .where(eq(entities.userId, userId))
    .orderBy(desc(entities.createdAt));
}

/**
 * Get all active entities (across all users)
 * Used by the background worker to process all entities
 */
export async function getActiveEntities(): Promise<Entity[]> {
  return db
    .select()
    .from(entities)
    .where(eq(entities.status, "active"))
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
    systemPrompt?: string;
    status?: EntityStatus;
  },
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
  status: EntityStatus,
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
  await updateEntityStatus(entityId, "active");
}

/**
 * Delete an entity (cascades to conversations, etc.)
 */
export async function deleteEntity(entityId: string): Promise<void> {
  await db.delete(entities).where(eq(entities.id, entityId));
}

/**
 * Get the user ID for an entity
 */
export async function getEntityUserId(
  entityId: string,
): Promise<string | null> {
  const result = await db
    .select({ userId: entities.userId })
    .from(entities)
    .where(eq(entities.id, entityId))
    .limit(1);

  return result[0]?.userId ?? null;
}
