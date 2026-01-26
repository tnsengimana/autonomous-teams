import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { createTeam, getTeamsByUserId } from "@/lib/db/queries/teams";
import { createAgent, getAgentsByTeamId } from "@/lib/db/queries/agents";
import { queueSystemTask } from "@/lib/agents/taskQueue";
import { generateTeamConfiguration } from "@/lib/agents/team-configuration";
import { z } from "zod";

const createTeamSchema = z.object({
  name: z.string().min(1, "Team name is required"),
  mission: z.string().min(1, "Mission is required"),
});

/**
 * GET /api/teams - List all teams for the current user
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const teams = await getTeamsByUserId(session.user.id);

    // Fetch agent counts for each team
    const teamsWithAgentCount = await Promise.all(
      teams.map(async (team) => {
        const agents = await getAgentsByTeamId(team.id);
        return {
          ...team,
          agentCount: agents.length,
        };
      }),
    );

    return NextResponse.json(teamsWithAgentCount);
  } catch (error) {
    console.error("Error fetching teams:", error);
    return NextResponse.json(
      { error: "Failed to fetch teams" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/teams - Create a new team with a team lead agent
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validation = createTeamSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.issues[0].message },
        { status: 400 },
      );
    }

    const { name, mission } = validation.data;

    // Generate team configuration using LLM
    const config = await generateTeamConfiguration(name, mission, {
      userId: session.user.id,
    });

    // Create the team with generated description
    const team = await createTeam({
      userId: session.user.id,
      name,
      purpose: `${config.teamDescription}\n\nMission: ${mission}`,
      status: "active",
    });

    // Create the team lead agent with generated name and prompt
    const teamLead = await createAgent({
      teamId: team.id,
      parentAgentId: null,
      name: config.leadAgentName,
      type: "lead",
      systemPrompt: config.leadAgentSystemPrompt,
      status: "idle",
    });

    // Queue bootstrap task to get the team started
    // This triggers the agent to review its mission and start working
    await queueSystemTask(
      teamLead.id,
      { teamId: team.id },
      "Get to work on your mission. Review your purpose, come up with a plan on how to make it happen, and start taking actions to fulfill it.",
    );

    return NextResponse.json(team, { status: 201 });
  } catch (error) {
    console.error("Error creating team:", error);
    return NextResponse.json(
      { error: "Failed to create team" },
      { status: 500 },
    );
  }
}
