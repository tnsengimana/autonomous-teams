import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { createEntity, getEntitiesByUserId } from "@/lib/db/queries/entities";
import { createAgent, getAgentsByEntityId } from "@/lib/db/queries/agents";
import { queueSystemTask } from "@/lib/agents/taskQueue";
import { generateEntityConfiguration } from "@/lib/entities/configuration";
import { z } from "zod";
import type { EntityType } from "@/lib/types";

const createEntitySchema = z.object({
  name: z.string().min(1, "Name is required"),
  purpose: z.string().min(1, "Purpose is required"),
  type: z.enum(["team", "aide"]),
});

/**
 * GET /api/entities - List all entities for the current user
 * Optionally filter by type with ?type=team or ?type=aide
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const typeFilter = searchParams.get("type") as EntityType | null;

    const entities = await getEntitiesByUserId(
      session.user.id,
      typeFilter || undefined
    );

    // Fetch agent counts for each entity
    const entitiesWithAgentCount = await Promise.all(
      entities.map(async (entity) => {
        const agents = await getAgentsByEntityId(entity.id);
        return {
          ...entity,
          agentCount: agents.length,
        };
      })
    );

    return NextResponse.json(entitiesWithAgentCount);
  } catch (error) {
    console.error("Error fetching entities:", error);
    return NextResponse.json(
      { error: "Failed to fetch entities" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/entities - Create a new entity with a lead agent
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validation = createEntitySchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const { name, purpose, type } = validation.data;

    // Generate entity configuration using LLM
    const config = await generateEntityConfiguration(name, purpose, type, {
      userId: session.user.id,
    });

    // Create the entity with generated description
    const entity = await createEntity({
      userId: session.user.id,
      type,
      name,
      purpose: `${config.entityDescription}\n\nPurpose: ${purpose}`,
      status: "active",
    });

    // Create the lead agent with generated name and prompt
    const lead = await createAgent({
      entityId: entity.id,
      parentAgentId: null,
      name: config.leadAgentName,
      type: "lead",
      systemPrompt: config.leadAgentSystemPrompt,
      status: "idle",
    });

    // Queue bootstrap task to get the entity started
    const bootstrapMessage =
      type === "team"
        ? "Get to work on your mission. Review your purpose, come up with a plan on how to make it happen, and start taking actions to fulfill it."
        : "Get to work on your purpose. Review your role, understand what the user needs, and start taking actions to fulfill your purpose.";

    await queueSystemTask(lead.id, { entityId: entity.id }, bootstrapMessage);

    return NextResponse.json(entity, { status: 201 });
  } catch (error) {
    console.error("Error creating entity:", error);
    return NextResponse.json(
      { error: "Failed to create entity" },
      { status: 500 }
    );
  }
}
