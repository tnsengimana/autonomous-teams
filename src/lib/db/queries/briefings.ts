/**
 * Briefings Database Queries
 */

import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { db } from '../client';
import { briefings, entities } from '../schema';
import type { Briefing } from '@/lib/types';

export async function createBriefing(data: {
  userId: string;
  entityId: string;
  agentId: string;
  title: string;
  summary: string;
  content: string;
}): Promise<Briefing> {
  const result = await db
    .insert(briefings)
    .values({
      userId: data.userId,
      entityId: data.entityId,
      agentId: data.agentId,
      title: data.title,
      summary: data.summary,
      content: data.content,
    })
    .returning();

  return result[0] as Briefing;
}

export async function getBriefingById(
  briefingId: string
): Promise<Briefing | null> {
  const result = await db
    .select()
    .from(briefings)
    .where(eq(briefings.id, briefingId))
    .limit(1);

  return (result[0] as Briefing) ?? null;
}

export async function getBriefingWithSource(briefingId: string): Promise<{
  briefing: Briefing;
  entityName: string | null;
} | null> {
  const result = await db
    .select({
      briefing: briefings,
      entityName: entities.name,
    })
    .from(briefings)
    .leftJoin(entities, eq(briefings.entityId, entities.id))
    .where(eq(briefings.id, briefingId))
    .limit(1);

  if (!result[0]) {
    return null;
  }

  return {
    briefing: result[0].briefing as Briefing,
    entityName: result[0].entityName,
  };
}

export async function getRecentBriefingsByEntity(
  data: { userId: string; entityId: string },
  limit = 5
): Promise<Briefing[]> {
  const result = await db
    .select()
    .from(briefings)
    .where(
      and(
        eq(briefings.userId, data.userId),
        eq(briefings.entityId, data.entityId)
      )
    )
    .orderBy(desc(briefings.createdAt))
    .limit(limit);

  return result as Briefing[];
}

export async function listBriefingsByEntity(
  data: { userId: string; entityId: string; query?: string },
  limit = 20
): Promise<Briefing[]> {
  const searchQuery = data.query?.trim();
  const searchFilter = searchQuery
    ? or(
        ilike(briefings.title, `%${searchQuery}%`),
        ilike(briefings.summary, `%${searchQuery}%`)
      )
    : null;

  const filters = [
    eq(briefings.userId, data.userId),
    eq(briefings.entityId, data.entityId),
  ];
  if (searchFilter) {
    filters.push(searchFilter);
  }

  const result = await db
    .select()
    .from(briefings)
    .where(and(...filters))
    .orderBy(desc(briefings.createdAt))
    .limit(limit);

  return result as Briefing[];
}

export async function getBriefingByIdForEntity(data: {
  briefingId: string;
  userId: string;
  entityId: string;
}): Promise<Briefing | null> {
  const result = await db
    .select()
    .from(briefings)
    .where(
      and(
        eq(briefings.id, data.briefingId),
        eq(briefings.userId, data.userId),
        eq(briefings.entityId, data.entityId)
      )
    )
    .limit(1);

  return (result[0] as Briefing) ?? null;
}
