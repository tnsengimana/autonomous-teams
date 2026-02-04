import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { getEntityById } from '@/lib/db/queries/entities';
import { getNodesByEntity, getEdgesByEntity } from '@/lib/db/queries/graph-data';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: entityId } = await params;
  const entity = await getEntityById(entityId);

  if (!entity || entity.userId !== session.user.id) {
    return NextResponse.json({ error: 'Entity not found' }, { status: 404 });
  }

  // Fetch all nodes and edges for this entity
  const [dbNodes, dbEdges] = await Promise.all([
    getNodesByEntity(entityId),
    getEdgesByEntity(entityId),
  ]);

  // Transform to Reagraph format
  const nodes = dbNodes.map((node) => ({
    id: node.id,
    label: node.name,
    type: node.type,
    data: {
      type: node.type,
      properties: node.properties,
      createdAt: node.createdAt,
    },
  }));

  const edges = dbEdges.map((edge) => ({
    id: edge.id,
    source: edge.sourceId,
    target: edge.targetId,
    label: edge.type,
    data: {
      type: edge.type,
      properties: edge.properties,
      createdAt: edge.createdAt,
    },
  }));

  return NextResponse.json({ nodes, edges });
}
