/**
 * /api/inbox/[id] - Individual inbox item operations
 *
 * GET    - Get item (marks as read)
 * PATCH  - Update read status
 * DELETE - Delete item
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import {
  getInboxItemWithSource,
  markAsRead,
  markAsUnread,
  deleteInboxItem,
} from '@/lib/db/queries/inboxItems';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/inbox/[id] - Get a single inbox item and mark as read
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    // 1. Verify user is authenticated
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    // 2. Get the inbox item with agent info
    const result = await getInboxItemWithSource(id);
    if (!result) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    const { item, agentId, agentName } = result;

    // 3. Verify user owns this item
    if (item.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 4. Mark as read
    if (!item.readAt) {
      await markAsRead(id);
    }

    // 5. Return item
    return NextResponse.json({
      id: item.id,
      title: item.title,
      content: item.content,
      agentId,
      agentName,
      read: true,
      readAt: item.readAt || new Date(),
      createdAt: item.createdAt,
    });
  } catch (error) {
    console.error('Get inbox item error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/inbox/[id] - Update read status
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    // 1. Verify user is authenticated
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    // 2. Get the inbox item
    const result = await getInboxItemWithSource(id);
    if (!result) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    const { item } = result;

    // 3. Verify user owns this item
    if (item.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 4. Parse request body
    const body = await request.json();
    const { read } = body;

    if (typeof read !== 'boolean') {
      return NextResponse.json(
        { error: 'read field must be a boolean' },
        { status: 400 }
      );
    }

    // 5. Update read status
    if (read) {
      await markAsRead(id);
    } else {
      await markAsUnread(id);
    }

    return NextResponse.json({
      id,
      read,
      message: read ? 'Marked as read' : 'Marked as unread',
    });
  } catch (error) {
    console.error('Update inbox item error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/inbox/[id] - Delete an inbox item
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    // 1. Verify user is authenticated
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    // 2. Get the inbox item
    const result = await getInboxItemWithSource(id);
    if (!result) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    const { item } = result;

    // 3. Verify user owns this item
    if (item.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 4. Delete the item
    await deleteInboxItem(id);

    return NextResponse.json({
      id,
      message: 'Item deleted',
    });
  } catch (error) {
    console.error('Delete inbox item error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
