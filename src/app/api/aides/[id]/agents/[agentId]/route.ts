import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { getAideById } from '@/lib/db/queries/aides';
import { getAgentById, updateAgent } from '@/lib/db/queries/agents';
import { z } from 'zod';

const updateAgentSchema = z.object({
  name: z.string().min(1, 'Agent name is required').optional(),
  type: z.enum(['lead', 'subordinate']).optional(),
  systemPrompt: z.string().min(1, 'System prompt is required').optional(),
});

/**
 * GET /api/aides/[id]/agents/[agentId] - Get a specific agent
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; agentId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: aideId, agentId } = await params;

    // Verify aide exists and belongs to user
    const aide = await getAideById(aideId);
    if (!aide) {
      return NextResponse.json({ error: 'Aide not found' }, { status: 404 });
    }
    if (aide.userId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Get the agent
    const agent = await getAgentById(agentId);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }
    if (agent.aideId !== aideId) {
      return NextResponse.json({ error: 'Agent does not belong to this aide' }, { status: 403 });
    }

    return NextResponse.json(agent);
  } catch (error) {
    console.error('Error fetching agent:', error);
    return NextResponse.json(
      { error: 'Failed to fetch agent' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/aides/[id]/agents/[agentId] - Update an agent
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; agentId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: aideId, agentId } = await params;

    // Verify aide exists and belongs to user
    const aide = await getAideById(aideId);
    if (!aide) {
      return NextResponse.json({ error: 'Aide not found' }, { status: 404 });
    }
    if (aide.userId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Get the agent
    const agent = await getAgentById(agentId);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }
    if (agent.aideId !== aideId) {
      return NextResponse.json({ error: 'Agent does not belong to this aide' }, { status: 403 });
    }

    const body = await request.json();
    const validation = updateAgentSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const updateData = validation.data;

    // Update the agent
    await updateAgent(agentId, updateData);

    // Fetch and return the updated agent
    const updatedAgent = await getAgentById(agentId);
    return NextResponse.json(updatedAgent);
  } catch (error) {
    console.error('Error updating agent:', error);
    return NextResponse.json(
      { error: 'Failed to update agent' },
      { status: 500 }
    );
  }
}
