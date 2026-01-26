import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { getTeamById } from '@/lib/db/queries/teams';
import { getAideById, getAideLead } from '@/lib/db/queries/aides';
import { getLead, getAgentById } from '@/lib/db/queries/agents';
import { Agent } from '@/lib/agents/agent';

/**
 * POST /api/messages
 *
 * Handles user messages to agents using the new foreground/background architecture:
 * 1. User sends message
 * 2. Agent generates quick contextual acknowledgment (foreground)
 * 3. Task is queued for background processing
 * 4. Returns acknowledgment stream immediately
 *
 * The actual work happens in background via worker runner.
 *
 * Supports both teams and aides:
 * - Provide teamId for team agents
 * - Provide aideId for aide agents
 * - Exactly one of teamId or aideId is required
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Verify user is authenticated
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Parse request body
    const body = await request.json();
    const { teamId, aideId, agentId, content } = body;

    // Validate: exactly one of teamId or aideId is required
    if ((!teamId && !aideId) || (teamId && aideId)) {
      return NextResponse.json(
        { error: 'Exactly one of teamId or aideId is required' },
        { status: 400 }
      );
    }

    if (!content || typeof content !== 'string') {
      return NextResponse.json(
        { error: 'content is required' },
        { status: 400 }
      );
    }

    // 3. Verify ownership based on which owner type was provided
    let agentData;

    if (teamId) {
      // Team-based message
      if (typeof teamId !== 'string') {
        return NextResponse.json(
          { error: 'teamId must be a string' },
          { status: 400 }
        );
      }

      const team = await getTeamById(teamId);
      if (!team) {
        return NextResponse.json({ error: 'Team not found' }, { status: 404 });
      }

      if (team.userId !== session.user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      // Get the agent (team lead or specific agent)
      if (agentId) {
        agentData = await getAgentById(agentId);
        if (!agentData || agentData.teamId !== teamId) {
          return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
        }
      } else {
        agentData = await getLead(teamId);
        if (!agentData) {
          return NextResponse.json(
            { error: 'No team lead found' },
            { status: 404 }
          );
        }
      }
    } else {
      // Aide-based message
      if (typeof aideId !== 'string') {
        return NextResponse.json(
          { error: 'aideId must be a string' },
          { status: 400 }
        );
      }

      const aide = await getAideById(aideId);
      if (!aide) {
        return NextResponse.json({ error: 'Aide not found' }, { status: 404 });
      }

      if (aide.userId !== session.user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      // Get the agent (aide lead or specific agent)
      if (agentId) {
        agentData = await getAgentById(agentId);
        if (!agentData || agentData.aideId !== aideId) {
          return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
        }
      } else {
        agentData = await getAideLead(aideId);
        if (!agentData) {
          return NextResponse.json(
            { error: 'No aide lead found' },
            { status: 404 }
          );
        }
      }
    }

    // 5. Create agent instance and handle user message (foreground)
    // This uses the new handleUserMessage which:
    // - Generates a quick acknowledgment
    // - Queues the task for background processing
    // - Returns the acknowledgment stream
    const agent = new Agent(agentData);
    const responseStream = await agent.handleUserMessage(content);

    // 6. Create a ReadableStream from the async iterable
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const chunk of responseStream) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        } catch (error) {
          console.error('Stream error:', error);
          controller.error(error);
        }
      },
    });

    // 7. Return streaming response
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Message API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
