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

    // 2. Get inbox items with agent names
    const itemsWithSources = await getInboxItemsWithSources(userId);
    const unreadCount = await getUnreadCount(userId);

    // 3. Format response
    const items = itemsWithSources.map(
      ({ item, agentId, agentName }) => ({
        id: item.id,
        title: item.title,
        content: item.content,
        agentId,
        agentName,
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
