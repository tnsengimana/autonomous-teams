import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { getAgentById } from "@/lib/db/queries/agents";
import { getWorkerIterationsWithInteractions } from "@/lib/db/queries/worker-iterations";

/**
 * GET /api/agents/[id]/worker-iterations - List worker iterations with LLM interactions for an agent
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

    // Get worker iterations with their interactions
    const iterations = await getWorkerIterationsWithInteractions(agentId);

    return NextResponse.json(iterations);
  } catch (error) {
    console.error("Error fetching worker iterations:", error);
    return NextResponse.json(
      { error: "Failed to fetch iterations" },
      { status: 500 }
    );
  }
}
