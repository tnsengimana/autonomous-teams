import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { getAgentById } from "@/lib/db/queries/agents";
import { getNodeTypesByAgent } from "@/lib/db/queries/graph-types";

/**
 * GET /api/agents/[id]/graph-node-types - List graph node types for an agent
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

    // Get graph node types for the agent
    const nodeTypes = await getNodeTypesByAgent(agentId);

    return NextResponse.json(nodeTypes);
  } catch (error) {
    console.error("Error fetching graph node types:", error);
    return NextResponse.json(
      { error: "Failed to fetch graph node types" },
      { status: 500 }
    );
  }
}
