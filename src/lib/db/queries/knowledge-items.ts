import { eq, desc, ilike, and, count } from 'drizzle-orm';
import { db } from '../client';
import { knowledgeItems } from '../schema';
import type { KnowledgeItem, KnowledgeItemType } from '@/lib/types';

/**
 * Create a new knowledge item
 */
export async function createKnowledgeItem(
  agentId: string,
  type: KnowledgeItemType,
  content: string,
  sourceConversationId?: string,
  confidence?: number
): Promise<KnowledgeItem> {
  const result = await db
    .insert(knowledgeItems)
    .values({
      agentId,
      type,
      content,
      sourceConversationId: sourceConversationId ?? null,
      confidence: confidence ?? null,
    })
    .returning();

  return result[0];
}

/**
 * Get a knowledge item by ID
 */
export async function getKnowledgeItemById(knowledgeItemId: string): Promise<KnowledgeItem | null> {
  const result = await db
    .select()
    .from(knowledgeItems)
    .where(eq(knowledgeItems.id, knowledgeItemId))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Get all knowledge items for an agent
 */
export async function getKnowledgeItemsByAgentId(agentId: string): Promise<KnowledgeItem[]> {
  return db
    .select()
    .from(knowledgeItems)
    .where(eq(knowledgeItems.agentId, agentId))
    .orderBy(desc(knowledgeItems.createdAt));
}

/**
 * Get most recent knowledge items for an agent
 */
export async function getRecentKnowledgeItems(
  agentId: string,
  limit: number
): Promise<KnowledgeItem[]> {
  return db
    .select()
    .from(knowledgeItems)
    .where(eq(knowledgeItems.agentId, agentId))
    .orderBy(desc(knowledgeItems.createdAt))
    .limit(limit);
}

/**
 * Delete a knowledge item
 */
export async function deleteKnowledgeItem(knowledgeItemId: string): Promise<void> {
  await db.delete(knowledgeItems).where(eq(knowledgeItems.id, knowledgeItemId));
}

/**
 * Search knowledge items by content (case-insensitive)
 */
export async function searchKnowledgeItems(
  agentId: string,
  query: string
): Promise<KnowledgeItem[]> {
  return db
    .select()
    .from(knowledgeItems)
    .where(and(eq(knowledgeItems.agentId, agentId), ilike(knowledgeItems.content, `%${query}%`)))
    .orderBy(desc(knowledgeItems.createdAt));
}

/**
 * Get knowledge items filtered by type
 */
export async function getKnowledgeItemsByType(
  agentId: string,
  type: KnowledgeItemType
): Promise<KnowledgeItem[]> {
  return db
    .select()
    .from(knowledgeItems)
    .where(and(eq(knowledgeItems.agentId, agentId), eq(knowledgeItems.type, type)))
    .orderBy(desc(knowledgeItems.createdAt));
}

/**
 * Update an existing knowledge item
 */
export async function updateKnowledgeItem(
  knowledgeItemId: string,
  updates: {
    content?: string;
    type?: KnowledgeItemType;
    confidence?: number | null;
  }
): Promise<KnowledgeItem | null> {
  const result = await db
    .update(knowledgeItems)
    .set(updates)
    .where(eq(knowledgeItems.id, knowledgeItemId))
    .returning();

  return result[0] ?? null;
}

/**
 * Get all knowledge items from a specific source conversation
 */
export async function getKnowledgeItemsBySourceConversation(
  conversationId: string
): Promise<KnowledgeItem[]> {
  return db
    .select()
    .from(knowledgeItems)
    .where(eq(knowledgeItems.sourceConversationId, conversationId))
    .orderBy(desc(knowledgeItems.createdAt));
}

/**
 * Get the count of knowledge items for an agent
 */
export async function getKnowledgeItemsCount(agentId: string): Promise<number> {
  const result = await db
    .select({ count: count() })
    .from(knowledgeItems)
    .where(eq(knowledgeItems.agentId, agentId));

  return result[0]?.count ?? 0;
}
