import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { getAideById, getAideLead } from '@/lib/db/queries/aides';
import { createAgentForAide, getAgentsByAideId } from '@/lib/db/queries/agents';
import { createConversation } from '@/lib/db/queries/conversations';
import { z } from 'zod';

const createAgentSchema = z.object({
  name: z.string().min(1, 'Agent name is required'),
  type: z.literal('subordinate').default('subordinate'),
  systemPrompt: z.string().min(1, 'System prompt is required'),
});

/**
 * GET /api/aides/[id]/agents - List agents for an aide
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

    const { id: aideId } = await params;

    // Verify aide exists and belongs to user
    const aide = await getAideById(aideId);
    if (!aide) {
      return NextResponse.json({ error: 'Aide not found' }, { status: 404 });
    }

    if (aide.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const agents = await getAgentsByAideId(aideId);

    return NextResponse.json(agents);
  } catch (error) {
    console.error('Error fetching aide agents:', error);
    return NextResponse.json(
      { error: 'Failed to fetch agents' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/aides/[id]/agents - Create a new subordinate agent for an aide
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: aideId } = await params;

    // Verify aide exists and belongs to user
    const aide = await getAideById(aideId);
    if (!aide) {
      return NextResponse.json({ error: 'Aide not found' }, { status: 404 });
    }

    if (aide.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get the aide lead to set as parent
    const aideLead = await getAideLead(aideId);
    if (!aideLead) {
      return NextResponse.json(
        { error: 'Aide lead not found. Cannot create subordinate agent without an aide lead.' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const validation = createAgentSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const { name, type, systemPrompt } = validation.data;

    // Create the subordinate agent
    const agent = await createAgentForAide({
      aideId,
      parentAgentId: aideLead.id,
      name,
      type,
      systemPrompt,
      status: 'idle',
    });

    // Create a conversation for the new agent
    await createConversation(agent.id);

    return NextResponse.json(agent, { status: 201 });
  } catch (error) {
    console.error('Error creating agent:', error);
    return NextResponse.json(
      { error: 'Failed to create agent' },
      { status: 500 }
    );
  }
}
