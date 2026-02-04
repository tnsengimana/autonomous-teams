import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { getEntityById } from "@/lib/db/queries/entities";
import { getLLMInteractionsByEntity } from "@/lib/db/queries/llm-interactions";

/**
 * GET /api/entities/[id]/interactions - List LLM interactions for an entity
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

    const { id: entityId } = await params;

    // Verify entity exists and belongs to user
    const entity = await getEntityById(entityId);
    if (!entity || entity.userId !== session.user.id) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    // Get interactions
    const interactions = await getLLMInteractionsByEntity(entityId);

    return NextResponse.json(interactions);
  } catch (error) {
    console.error("Error fetching LLM interactions:", error);
    return NextResponse.json(
      { error: "Failed to fetch interactions" },
      { status: 500 }
    );
  }
}
