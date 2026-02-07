import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { getAgentById } from '@/lib/db/queries/agents';
import { getNodesByAgent, getEdgesByAgent } from '@/lib/db/queries/graph-data';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: agentId } = await params;
  const agent = await getAgentById(agentId);

  if (!agent || agent.userId !== session.user.id) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  }

  // Fetch all nodes and edges for this agent
  const [dbNodes, dbEdges] = await Promise.all([
    getNodesByAgent(agentId),
    getEdgesByAgent(agentId),
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
