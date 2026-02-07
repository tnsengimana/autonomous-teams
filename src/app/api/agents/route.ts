import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { getAgentsByUserId } from "@/lib/db/queries/agents";
import { initializeAgent } from "@/lib/llm/agent-initialization";
import { z } from "zod";

const createAgentSchema = z.object({
  purpose: z.string().min(1, "Mission/purpose is required"),
  iterationIntervalMs: z
    .number()
    .int()
    .positive("Iteration interval must be a positive number"),
});

/**
 * GET /api/agents - List all agents for the current user
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const agents = await getAgentsByUserId(session.user.id);

    return NextResponse.json(agents);
  } catch (error) {
    console.error("Error fetching agents:", error);
    return NextResponse.json(
      { error: "Failed to fetch agents" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/agents - Create a new agent
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validation = createAgentSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.issues[0].message },
        { status: 400 },
      );
    }

    const { purpose, iterationIntervalMs } = validation.data;

    // Generate name and all seven system prompts from mission/purpose
    const agent = await initializeAgent(purpose, iterationIntervalMs, {
      userId: session.user.id,
    });

    return NextResponse.json(agent, { status: 201 });
  } catch (error) {
    console.error("Error creating agent:", error);
    return NextResponse.json(
      { error: "Failed to create agent" },
      { status: 500 },
    );
  }
}
