import { eq, desc, ilike, and, count } from 'drizzle-orm';
import { db } from '../client';
import { insights } from '../schema';
import type { Insight, InsightType } from '@/lib/types';

/**
 * Create a new insight
 */
export async function createInsight(
  agentId: string,
  type: InsightType,
  content: string,
  sourceThreadId?: string,
  confidence?: number
): Promise<Insight> {
  const result = await db
    .insert(insights)
    .values({
      agentId,
      type,
      content,
      sourceThreadId: sourceThreadId ?? null,
      confidence: confidence ?? null,
    })
    .returning();

  return result[0];
}

/**
 * Get an insight by ID
 */
export async function getInsightById(insightId: string): Promise<Insight | null> {
  const result = await db
    .select()
    .from(insights)
    .where(eq(insights.id, insightId))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Get all insights for an agent
 */
export async function getInsightsByAgentId(agentId: string): Promise<Insight[]> {
  return db
    .select()
    .from(insights)
    .where(eq(insights.agentId, agentId))
    .orderBy(desc(insights.createdAt));
}

/**
 * Get most recent insights for an agent
 */
export async function getRecentInsights(
  agentId: string,
  limit: number
): Promise<Insight[]> {
  return db
    .select()
    .from(insights)
    .where(eq(insights.agentId, agentId))
    .orderBy(desc(insights.createdAt))
    .limit(limit);
}

/**
 * Delete an insight
 */
export async function deleteInsight(insightId: string): Promise<void> {
  await db.delete(insights).where(eq(insights.id, insightId));
}

/**
 * Search insights by content (case-insensitive)
 */
export async function searchInsights(
  agentId: string,
  query: string
): Promise<Insight[]> {
  return db
    .select()
    .from(insights)
    .where(and(eq(insights.agentId, agentId), ilike(insights.content, `%${query}%`)))
    .orderBy(desc(insights.createdAt));
}

/**
 * Get insights filtered by type
 */
export async function getInsightsByType(
  agentId: string,
  type: InsightType
): Promise<Insight[]> {
  return db
    .select()
    .from(insights)
    .where(and(eq(insights.agentId, agentId), eq(insights.type, type)))
    .orderBy(desc(insights.createdAt));
}

/**
 * Update an existing insight
 */
export async function updateInsight(
  insightId: string,
  updates: {
    content?: string;
    type?: InsightType;
    confidence?: number | null;
  }
): Promise<Insight | null> {
  const result = await db
    .update(insights)
    .set(updates)
    .where(eq(insights.id, insightId))
    .returning();

  return result[0] ?? null;
}

/**
 * Get all insights from a specific source thread
 */
export async function getInsightsBySourceThread(
  threadId: string
): Promise<Insight[]> {
  return db
    .select()
    .from(insights)
    .where(eq(insights.sourceThreadId, threadId))
    .orderBy(desc(insights.createdAt));
}

/**
 * Get the count of insights for an agent
 */
export async function getInsightsCount(agentId: string): Promise<number> {
  const result = await db
    .select({ count: count() })
    .from(insights)
    .where(eq(insights.agentId, agentId));

  return result[0]?.count ?? 0;
}
