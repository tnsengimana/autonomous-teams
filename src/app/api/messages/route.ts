import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { getEntityById, getEntityLead } from '@/lib/db/queries/entities';
import { getAgentById } from '@/lib/db/queries/agents';
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
    const { entityId, agentId, content } = body;

    if (!entityId || typeof entityId !== 'string') {
      return NextResponse.json(
        { error: 'entityId is required' },
        { status: 400 }
      );
    }

    if (!content || typeof content !== 'string') {
      return NextResponse.json(
        { error: 'content is required' },
        { status: 400 }
      );
    }

    // 3. Verify entity ownership
    const entity = await getEntityById(entityId);
    if (!entity) {
      return NextResponse.json({ error: 'Entity not found' }, { status: 404 });
    }

    if (entity.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 4. Get the agent (entity lead or specific agent)
    let agentData;
    if (agentId) {
      agentData = await getAgentById(agentId);
      if (!agentData || agentData.entityId !== entityId) {
        return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
      }
    } else {
      agentData = await getEntityLead(entityId);
      if (!agentData) {
        return NextResponse.json(
          { error: 'No lead agent found' },
          { status: 404 }
        );
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
