import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { getAgentById } from "@/lib/db/queries/agents";
import { getEdgeTypesByAgent } from "@/lib/db/queries/graph-types";

/**
 * GET /api/agents/[id]/graph-edge-types - List graph edge types for an agent
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: agentId } = await params;

    // Verify agent exists and belongs to user
    const agent = await getAgentById(agentId);
    if (!agent || agent.userId !== session.user.id) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    // Get graph edge types for the agent
    const edgeTypes = await getEdgeTypesByAgent(agentId);

    return NextResponse.json(edgeTypes);
  } catch (error) {
    console.error("Error fetching graph edge types:", error);
    return NextResponse.json(
      { error: "Failed to fetch graph edge types" },
      { status: 500 }
    );
  }
}
