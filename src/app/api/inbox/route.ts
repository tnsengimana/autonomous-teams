/**
 * GET /api/inbox - Get all inbox items for authenticated user
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import {
  getInboxItemsWithSources,
  getUnreadCount,
} from '@/lib/db/queries/inboxItems';

export async function GET() {
  try {
    // 1. Verify user is authenticated
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    // 2. Get inbox items with team/aide names
    const itemsWithSources = await getInboxItemsWithSources(userId);
    const unreadCount = await getUnreadCount(userId);

    // 3. Format response
    const items = itemsWithSources.map(
      ({ item, entityId, entityName, entityType }) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      content: item.content,
      entityId,
      entityName,
      entityType,
      agentId: item.agentId,
      briefingId: item.briefingId,
      read: item.readAt !== null,
      readAt: item.readAt,
      createdAt: item.createdAt,
      })
    );

    return NextResponse.json({
      items,
      unreadCount,
      total: items.length,
    });
  } catch (error) {
    console.error('Inbox API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
