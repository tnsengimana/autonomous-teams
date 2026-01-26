import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { getAideById, updateAide, deleteAide, getAideWithAgents } from '@/lib/db/queries/aides';
import { z } from 'zod';

const updateAideSchema = z.object({
  name: z.string().min(1).optional(),
  purpose: z.string().optional(),
  status: z.enum(['active', 'paused', 'archived']).optional(),
});

/**
 * GET /api/aides/[id] - Get aide details with agents
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const aide = await getAideWithAgents(id);

    if (!aide) {
      return NextResponse.json({ error: 'Aide not found' }, { status: 404 });
    }

    if (aide.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json(aide);
  } catch (error) {
    console.error('Error fetching aide:', error);
    return NextResponse.json(
      { error: 'Failed to fetch aide' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/aides/[id] - Update aide details
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    // Verify aide exists and belongs to user
    const aide = await getAideById(id);
    if (!aide) {
      return NextResponse.json({ error: 'Aide not found' }, { status: 404 });
    }

    if (aide.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const validation = updateAideSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    await updateAide(id, validation.data);

    // Return updated aide
    const updatedAide = await getAideById(id);
    return NextResponse.json(updatedAide);
  } catch (error) {
    console.error('Error updating aide:', error);
    return NextResponse.json(
      { error: 'Failed to update aide' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/aides/[id] - Delete an aide
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    // Verify aide exists and belongs to user
    const aide = await getAideById(id);
    if (!aide) {
      return NextResponse.json({ error: 'Aide not found' }, { status: 404 });
    }

    if (aide.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await deleteAide(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting aide:', error);
    return NextResponse.json(
      { error: 'Failed to delete aide' },
      { status: 500 }
    );
  }
}
