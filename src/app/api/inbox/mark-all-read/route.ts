/**
 * POST /api/inbox/mark-all-read - Mark all inbox items as read
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { markAllAsRead } from '@/lib/db/queries/inboxItems';

export async function POST() {
  try {
    // 1. Verify user is authenticated
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Mark all as read
    await markAllAsRead(session.user.id);

    return NextResponse.json({
      message: 'All items marked as read',
    });
  } catch (error) {
    console.error('Mark all read error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
