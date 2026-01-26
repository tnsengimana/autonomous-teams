import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { getTeamById } from '@/lib/db/queries/teams';
import { createAgent, getLead } from '@/lib/db/queries/agents';
import { createConversation } from '@/lib/db/queries/conversations';
import { z } from 'zod';

const createAgentSchema = z.object({
  name: z.string().min(1, 'Agent name is required'),
  type: z.literal('subordinate').default('subordinate'),
  systemPrompt: z.string().min(1, 'System prompt is required'),
});

/**
 * POST /api/teams/[id]/agents - Create a new subordinate agent for a team
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

    const { id: teamId } = await params;

    // Verify team exists and belongs to user
    const team = await getTeamById(teamId);
    if (!team) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }
    if (team.userId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Get the team lead to set as parent
    const teamLead = await getLead(teamId);
    if (!teamLead) {
      return NextResponse.json(
        { error: 'Team lead not found. Cannot create subordinate agent without a team lead.' },
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
    const agent = await createAgent({
      teamId,
      parentAgentId: teamLead.id,
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
