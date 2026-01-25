import { eq, desc, and, inArray } from 'drizzle-orm';
import { db } from '../client';
import { memories } from '../schema';
import type { Memory, MemoryType, ExtractedMemory } from '@/lib/types';

/**
 * Get a memory by ID
 */
export async function getMemoryById(memoryId: string): Promise<Memory | null> {
  const result = await db
    .select()
    .from(memories)
    .where(eq(memories.id, memoryId))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Get all memories for an agent
 */
export async function getMemoriesByAgentId(agentId: string): Promise<Memory[]> {
  return db
    .select()
    .from(memories)
    .where(eq(memories.agentId, agentId))
    .orderBy(desc(memories.createdAt));
}

/**
 * Get memories for an agent filtered by type
 */
export async function getMemoriesByType(
  agentId: string,
  type: MemoryType
): Promise<Memory[]> {
  return db
    .select()
    .from(memories)
    .where(and(eq(memories.agentId, agentId), eq(memories.type, type)))
    .orderBy(desc(memories.createdAt));
}

/**
 * Get memories for an agent filtered by multiple types
 */
export async function getMemoriesByTypes(
  agentId: string,
  types: MemoryType[]
): Promise<Memory[]> {
  return db
    .select()
    .from(memories)
    .where(and(eq(memories.agentId, agentId), inArray(memories.type, types)))
    .orderBy(desc(memories.createdAt));
}

/**
 * Get the most recent N memories for an agent
 */
export async function getRecentMemories(
  agentId: string,
  limit: number
): Promise<Memory[]> {
  return db
    .select()
    .from(memories)
    .where(eq(memories.agentId, agentId))
    .orderBy(desc(memories.createdAt))
    .limit(limit);
}

/**
 * Create a new memory
 */
export async function createMemory(data: {
  agentId: string;
  type: MemoryType;
  content: string;
  sourceMessageId?: string | null;
}): Promise<Memory> {
  const result = await db
    .insert(memories)
    .values({
      agentId: data.agentId,
      type: data.type,
      content: data.content,
      sourceMessageId: data.sourceMessageId ?? null,
    })
    .returning();

  return result[0];
}

/**
 * Create multiple memories at once
 */
export async function createMemories(
  agentId: string,
  extractedMemories: ExtractedMemory[],
  sourceMessageId?: string | null
): Promise<Memory[]> {
  if (extractedMemories.length === 0) {
    return [];
  }

  const result = await db
    .insert(memories)
    .values(
      extractedMemories.map((m) => ({
        agentId,
        type: m.type,
        content: m.content,
        sourceMessageId: sourceMessageId ?? null,
      }))
    )
    .returning();

  return result;
}

/**
 * Update a memory's content
 */
export async function updateMemory(
  memoryId: string,
  content: string
): Promise<void> {
  await db
    .update(memories)
    .set({ content, updatedAt: new Date() })
    .where(eq(memories.id, memoryId));
}

/**
 * Delete a memory
 */
export async function deleteMemory(memoryId: string): Promise<void> {
  await db.delete(memories).where(eq(memories.id, memoryId));
}

/**
 * Delete all memories for an agent
 */
export async function deleteAgentMemories(agentId: string): Promise<void> {
  await db.delete(memories).where(eq(memories.agentId, agentId));
}
