/**
 * Inbox Items Database Queries
 *
 * CRUD operations for inbox items (briefings and feedback).
 */

import { eq, desc, and, isNull, count } from 'drizzle-orm';
import { db } from '../client';
import { inboxItems, teams, aides, agents } from '../schema';
import type { InboxItem } from '@/lib/types';

/**
 * Get all inbox items for a user, sorted by creation date (newest first)
 */
export async function getInboxItemsByUserId(userId: string): Promise<InboxItem[]> {
  const result = await db
    .select()
    .from(inboxItems)
    .where(eq(inboxItems.userId, userId))
    .orderBy(desc(inboxItems.createdAt));

  return result as InboxItem[];
}

/**
 * Get inbox items for a specific team
 */
export async function getInboxItemsByTeamId(
  userId: string,
  teamId: string
): Promise<InboxItem[]> {
  const result = await db
    .select()
    .from(inboxItems)
    .innerJoin(agents, eq(inboxItems.agentId, agents.id))
    .where(and(eq(inboxItems.userId, userId), eq(agents.teamId, teamId)))
    .orderBy(desc(inboxItems.createdAt));

  return result.map((row) => row.inbox_items as InboxItem);
}

/**
 * Get inbox items for a specific aide
 */
export async function getInboxItemsByAideId(
  userId: string,
  aideId: string
): Promise<InboxItem[]> {
  const result = await db
    .select()
    .from(inboxItems)
    .innerJoin(agents, eq(inboxItems.agentId, agents.id))
    .where(and(eq(inboxItems.userId, userId), eq(agents.aideId, aideId)))
    .orderBy(desc(inboxItems.createdAt));

  return result.map((row) => row.inbox_items as InboxItem);
}

/**
 * Get unread inbox items count for a user
 */
export async function getUnreadCount(userId: string): Promise<number> {
  const result = await db
    .select({ count: count() })
    .from(inboxItems)
    .where(and(eq(inboxItems.userId, userId), isNull(inboxItems.readAt)));

  return result[0]?.count ?? 0;
}

/**
 * Get a single inbox item by ID
 */
export async function getInboxItemById(itemId: string): Promise<InboxItem | null> {
  const result = await db
    .select()
    .from(inboxItems)
    .where(eq(inboxItems.id, itemId))
    .limit(1);

  return (result[0] as InboxItem) ?? null;
}

/**
 * Get an inbox item with its team/aide info
 */
export async function getInboxItemWithSource(itemId: string): Promise<{
  item: InboxItem;
  teamName: string | null;
  aideName: string | null;
  teamId: string | null;
  aideId: string | null;
} | null> {
  const result = await db
    .select({
      item: inboxItems,
      teamId: agents.teamId,
      teamName: teams.name,
      aideId: agents.aideId,
      aideName: aides.name,
    })
    .from(inboxItems)
    .leftJoin(agents, eq(inboxItems.agentId, agents.id))
    .leftJoin(teams, eq(agents.teamId, teams.id))
    .leftJoin(aides, eq(agents.aideId, aides.id))
    .where(eq(inboxItems.id, itemId))
    .limit(1);

  if (!result[0]) {
    return null;
  }

  return {
    item: result[0].item as InboxItem,
    teamId: result[0].teamId,
    teamName: result[0].teamName,
    aideId: result[0].aideId,
    aideName: result[0].aideName,
  };
}

/**
 * Get an inbox item with its team info
 * @deprecated Use getInboxItemWithSource instead
 */
export async function getInboxItemWithTeam(itemId: string): Promise<{
  item: InboxItem;
  teamName: string;
} | null> {
  const result = await db
    .select({
      item: inboxItems,
      teamName: teams.name,
    })
    .from(inboxItems)
    .innerJoin(agents, eq(inboxItems.agentId, agents.id))
    .innerJoin(teams, eq(agents.teamId, teams.id))
    .where(eq(inboxItems.id, itemId))
    .limit(1);

  if (!result[0]) {
    return null;
  }

  return {
    item: result[0].item as InboxItem,
    teamName: result[0].teamName,
  };
}

/**
 * Create a new inbox item
 */
export async function createInboxItem(data: {
  userId: string;
  agentId: string;
  type: string;
  title: string;
  content: string;
  briefingId?: string | null;
}): Promise<InboxItem> {
  const result = await db
    .insert(inboxItems)
    .values({
      userId: data.userId,
      agentId: data.agentId,
      briefingId: data.briefingId ?? null,
      type: data.type,
      title: data.title,
      content: data.content,
    })
    .returning();

  return result[0] as InboxItem;
}

/**
 * Mark an inbox item as read
 */
export async function markAsRead(itemId: string): Promise<void> {
  await db
    .update(inboxItems)
    .set({ readAt: new Date() })
    .where(eq(inboxItems.id, itemId));
}

/**
 * Mark an inbox item as unread
 */
export async function markAsUnread(itemId: string): Promise<void> {
  await db
    .update(inboxItems)
    .set({ readAt: null })
    .where(eq(inboxItems.id, itemId));
}

/**
 * Delete an inbox item
 */
export async function deleteInboxItem(itemId: string): Promise<void> {
  await db.delete(inboxItems).where(eq(inboxItems.id, itemId));
}

/**
 * Mark all inbox items as read for a user
 */
export async function markAllAsRead(userId: string): Promise<void> {
  await db
    .update(inboxItems)
    .set({ readAt: new Date() })
    .where(and(eq(inboxItems.userId, userId), isNull(inboxItems.readAt)));
}

/**
 * Get recent inbox items for a user (for inbox preview)
 */
export async function getRecentInboxItems(
  userId: string,
  limit: number = 5
): Promise<InboxItem[]> {
  const result = await db
    .select()
    .from(inboxItems)
    .where(eq(inboxItems.userId, userId))
    .orderBy(desc(inboxItems.createdAt))
    .limit(limit);

  return result as InboxItem[];
}

/**
 * Get inbox items with team/aide names
 * Uses LEFT JOINs to support items from both teams and aides
 */
export async function getInboxItemsWithSources(userId: string): Promise<
  Array<{
    item: InboxItem;
    teamName: string | null;
    aideName: string | null;
    teamId: string | null;
    aideId: string | null;
  }>
> {
  const result = await db
    .select({
      item: inboxItems,
      teamId: agents.teamId,
      teamName: teams.name,
      aideId: agents.aideId,
      aideName: aides.name,
    })
    .from(inboxItems)
    .leftJoin(agents, eq(inboxItems.agentId, agents.id))
    .leftJoin(teams, eq(agents.teamId, teams.id))
    .leftJoin(aides, eq(agents.aideId, aides.id))
    .where(eq(inboxItems.userId, userId))
    .orderBy(desc(inboxItems.createdAt));

  return result.map((r) => ({
    item: r.item as InboxItem,
    teamId: r.teamId,
    teamName: r.teamName,
    aideId: r.aideId,
    aideName: r.aideName,
  }));
}

/**
 * Get inbox items with team names
 * @deprecated Use getInboxItemsWithSources instead
 */
export async function getInboxItemsWithTeams(userId: string): Promise<
  Array<{
    item: InboxItem;
    teamName: string;
  }>
> {
  const result = await db
    .select({
      item: inboxItems,
      teamName: teams.name,
    })
    .from(inboxItems)
    .innerJoin(agents, eq(inboxItems.agentId, agents.id))
    .innerJoin(teams, eq(agents.teamId, teams.id))
    .where(eq(inboxItems.userId, userId))
    .orderBy(desc(inboxItems.createdAt));

  return result.map((r) => ({
    item: r.item as InboxItem,
    teamName: r.teamName,
  }));
}
