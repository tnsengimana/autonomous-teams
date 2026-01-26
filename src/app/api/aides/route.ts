import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { createAide, getAidesByUserId } from "@/lib/db/queries/aides";
import { createAgentForAide, getAgentsByAideId } from "@/lib/db/queries/agents";
import { queueSystemTask } from "@/lib/agents/taskQueue";
import { generateAideConfiguration } from "@/lib/agents/aide-configuration";
import { z } from "zod";

const createAideSchema = z.object({
  name: z.string().min(1, "Aide name is required"),
  purpose: z.string().min(1, "Purpose is required"),
});

/**
 * GET /api/aides - List all aides for the current user
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const aides = await getAidesByUserId(session.user.id);

    // Fetch agent counts for each aide
    const aidesWithAgentCount = await Promise.all(
      aides.map(async (aide) => {
        const agents = await getAgentsByAideId(aide.id);
        return {
          ...aide,
          agentCount: agents.length,
        };
      }),
    );

    return NextResponse.json(aidesWithAgentCount);
  } catch (error) {
    console.error("Error fetching aides:", error);
    return NextResponse.json(
      { error: "Failed to fetch aides" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/aides - Create a new aide with a lead agent
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validation = createAideSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.issues[0].message },
        { status: 400 },
      );
    }

    const { name, purpose } = validation.data;

    // Generate aide configuration using LLM
    const config = await generateAideConfiguration(name, purpose, {
      userId: session.user.id,
    });

    // Create the aide with generated description
    const aide = await createAide({
      userId: session.user.id,
      name,
      purpose: `${config.aideDescription}\n\nPurpose: ${purpose}`,
      status: "active",
    });

    // Create the lead agent with generated name and prompt
    const aideLead = await createAgentForAide({
      aideId: aide.id,
      parentAgentId: null,
      name: config.leadAgentName,
      type: "lead",
      systemPrompt: config.leadAgentSystemPrompt,
      status: "idle",
    });

    // Queue bootstrap task to get the aide started
    // This triggers the agent to review its purpose and start working
    await queueSystemTask(
      aideLead.id,
      { aideId: aide.id },
      "Get to work on your purpose. Review what the user needs, come up with a plan on how to make it happen, and and start serving them.",
    );

    return NextResponse.json(aide, { status: 201 });
  } catch (error) {
    console.error("Error creating aide:", error);
    return NextResponse.json(
      { error: "Failed to create aide" },
      { status: 500 },
    );
  }
}
