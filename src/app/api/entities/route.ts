import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { createEntity, getEntitiesByUserId } from "@/lib/db/queries/entities";
import { generateEntityConfiguration } from "@/lib/entities/configuration";
import { z } from "zod";

const createEntitySchema = z.object({
  purpose: z.string().min(1, "Mission/purpose is required"),
});

/**
 * GET /api/entities - List all entities for the current user
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const entities = await getEntitiesByUserId(session.user.id);

    return NextResponse.json(entities);
  } catch (error) {
    console.error("Error fetching entities:", error);
    return NextResponse.json(
      { error: "Failed to fetch entities" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/entities - Create a new entity
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

    const { purpose } = validation.data;

    // Generate name and system prompt from mission/purpose
    const config = await generateEntityConfiguration(purpose, {
      userId: session.user.id,
    });

    // Create the entity with generated name and systemPrompt
    const entity = await createEntity({
      userId: session.user.id,
      name: config.name,
      purpose,
      systemPrompt: config.systemPrompt,
      status: "active",
    });

    return NextResponse.json(entity, { status: 201 });
  } catch (error) {
    console.error("Error creating entity:", error);
    return NextResponse.json(
      { error: "Failed to create entity" },
      { status: 500 }
    );
  }
}
