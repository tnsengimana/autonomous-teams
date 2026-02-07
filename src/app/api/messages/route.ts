import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { getAgentById } from '@/lib/db/queries/agents';
import { getOrCreateConversation } from '@/lib/db/queries/conversations';
import { createTurnMessages } from '@/lib/db/queries/messages';
import { streamLLMResponse, type StreamOptions } from '@/lib/llm/providers';
import { buildMessageContext } from '@/lib/llm/conversation';
import { buildGraphContextBlock } from '@/lib/llm/knowledge-graph';
import { getMemoriesByAgentId } from '@/lib/db/queries/memories';
import { buildMemoryContextBlock } from '@/lib/llm/memory';

/**
 * POST /api/messages
 *
 * Handles user messages to agents:
 * 1. User sends message
 * 2. Get or create conversation for agent
 * 3. Build context (memories, graph, conversation history)
 * 4. Stream LLM response
 * 5. Save turn atomically
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
    const { agentId, content } = body;

    if (!agentId || typeof agentId !== 'string') {
      return NextResponse.json(
        { error: 'agentId is required' },
        { status: 400 }
      );
    }

    if (!content || typeof content !== 'string') {
      return NextResponse.json(
        { error: 'content is required' },
        { status: 400 }
      );
    }

    // 3. Verify agent ownership
    const agent = await getAgentById(agentId);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    if (agent.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 4. Get or create conversation
    const conversation = await getOrCreateConversation(agentId);

    // 5. Build context
    const [memories, graphContext, conversationHistory] = await Promise.all([
      getMemoriesByAgentId(agentId),
      buildGraphContextBlock(agentId),
      buildMessageContext(conversation.id),
    ]);

    const memoryContext = buildMemoryContextBlock(memories);

    // Build system prompt with agent context
    const systemPrompt = `${agent.conversationSystemPrompt}

${memoryContext}

${graphContext}`;

    // Add user message to conversation history for LLM
    const messagesForLLM = [
      ...conversationHistory,
      { role: 'user' as const, content },
    ];

    // 6. Stream LLM response
    const streamOptions: StreamOptions = {
      userId: session.user.id,
      agentId,
    };

    // Collect the full response while streaming
    let fullResponse = '';

    // Create a TransformStream to collect the response while streaming
    const { readable, writable } = new TransformStream<string, string>();
    const writer = writable.getWriter();

    // Start streaming in the background
    (async () => {
      try {
        const responseStream = await streamLLMResponse(
          messagesForLLM,
          systemPrompt,
          streamOptions
        );

        for await (const chunk of responseStream) {
          fullResponse += chunk;
          await writer.write(chunk);
        }

        // Save the turn atomically after streaming completes
        await createTurnMessages(
          conversation.id,
          { role: 'user', content: { text: content } },
          { role: 'llm', content: { text: fullResponse } }
        );

        await writer.close();
      } catch (error) {
        console.error('Stream error:', error);
        await writer.abort(error);
      }
    })();

    // 7. Return streaming response
    const stream = readable.pipeThrough(new TextEncoderStream());

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
