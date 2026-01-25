/**
 * GET /api/inbox/unread-count - Get unread inbox count for authenticated user
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { getUnreadCount } from '@/lib/db/queries/inboxItems';

export async function GET() {
  try {
    // 1. Verify user is authenticated
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Get unread count
    const unreadCount = await getUnreadCount(session.user.id);

    return NextResponse.json({ unreadCount });
  } catch (error) {
    console.error('Unread count API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
