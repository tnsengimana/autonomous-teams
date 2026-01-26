import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { getAgentById } from "@/lib/db/queries/agents";
import { getTeamById } from "@/lib/db/queries/teams";
import { getAideById } from "@/lib/db/queries/aides";
import { getLatestConversation } from "@/lib/db/queries/conversations";
import { getMessagesByConversationId } from "@/lib/db/queries/messages";

/**
 * GET /api/conversations/[agentId]
 *
 * Returns the conversation for an agent.
 * Supports ?mode=background to fetch internal work session logs.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    // 1. Verify user is authenticated
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { agentId } = await params;

    // 2. Get the agent
    const agent = await getAgentById(agentId);
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    // 3. Verify user owns the team or aide
    if (agent.teamId) {
      const team = await getTeamById(agent.teamId);
      if (!team || team.userId !== session.user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else if (agent.aideId) {
      const aide = await getAideById(agent.aideId);
      if (!aide || aide.userId !== session.user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else {
      return NextResponse.json({ error: "Agent has no owner" }, { status: 500 });
    }

    // 4. Get the conversation and messages
    const url = new URL(_request.url);
    const modeParam = url.searchParams.get("mode");
    const mode = modeParam === "background" ? "background" : "foreground";

    const conversation = await getLatestConversation(agentId, mode);
    if (!conversation) {
      return NextResponse.json({ messages: [] });
    }

    const messages = await getMessagesByConversationId(conversation.id);

    // 5. Filter out system messages and format response
    const filteredMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      }));

    return NextResponse.json({
      conversationId: conversation.id,
      messages: filteredMessages,
    });
  } catch (error) {
    console.error("Conversation API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
