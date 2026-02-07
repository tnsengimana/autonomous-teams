/**
 * Graph Data Queries
 *
 * CRUD operations for knowledge graph nodes and edges.
 */

import { eq, and, or, count } from 'drizzle-orm';
import { db } from '../client';
import { graphNodes, graphEdges } from '../schema';
import type {
  GraphNode,
  GraphEdge,
  GraphNeighbors,
  GraphStats,
} from '@/lib/types';

// Re-export types for convenience
export type {
  GraphNode,
  GraphEdge,
  GraphNeighbors,
  GraphStats,
};

// ============================================================================
// Node Operations
// ============================================================================

/**
 * Create a new node in the knowledge graph
 */
export async function createNode(data: {
  agentId: string;
  type: string;
  name: string;
  properties?: object;
}): Promise<GraphNode> {
  const result = await db
    .insert(graphNodes)
    .values({
      agentId: data.agentId,
      type: data.type,
      name: data.name,
      properties: data.properties ?? {},
    })
    .returning();

  return result[0];
}

/**
 * Get a node by ID
 */
export async function getNodeById(nodeId: string): Promise<GraphNode | null> {
  const result = await db
    .select()
    .from(graphNodes)
    .where(eq(graphNodes.id, nodeId))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Get all nodes for an agent with optional filtering
 */
export async function getNodesByAgent(
  agentId: string,
  options?: { type?: string; limit?: number }
): Promise<GraphNode[]> {
  let query = db
    .select()
    .from(graphNodes)
    .where(
      options?.type
        ? and(
            eq(graphNodes.agentId, agentId),
            eq(graphNodes.type, options.type)
          )
        : eq(graphNodes.agentId, agentId)
    );

  if (options?.limit) {
    query = query.limit(options.limit) as typeof query;
  }

  return query;
}

/**
 * Find a node by type and name within an agent
 */
export async function findNodeByTypeAndName(
  agentId: string,
  type: string,
  name: string
): Promise<GraphNode | null> {
  const result = await db
    .select()
    .from(graphNodes)
    .where(
      and(
        eq(graphNodes.agentId, agentId),
        eq(graphNodes.type, type),
        eq(graphNodes.name, name)
      )
    )
    .limit(1);

  return result[0] ?? null;
}

/**
 * Update the properties of a node (merges with existing properties)
 */
export async function updateNodeProperties(
  nodeId: string,
  properties: object
): Promise<void> {
  // Get existing node
  const existing = await getNodeById(nodeId);
  if (!existing) {
    throw new Error(`Node not found: ${nodeId}`);
  }

  // Merge properties
  const existingProps = (existing.properties as object) ?? {};
  const mergedProperties = { ...existingProps, ...properties };

  await db
    .update(graphNodes)
    .set({ properties: mergedProperties })
    .where(eq(graphNodes.id, nodeId));
}

/**
 * Delete a node (cascades to connected edges)
 */
export async function deleteNode(nodeId: string): Promise<void> {
  await db.delete(graphNodes).where(eq(graphNodes.id, nodeId));
}

// ============================================================================
// Edge Operations
// ============================================================================

/**
 * Create a new edge between nodes
 */
export async function createEdge(data: {
  agentId: string;
  type: string;
  sourceId: string;
  targetId: string;
  properties?: object;
}): Promise<GraphEdge> {
  const result = await db
    .insert(graphEdges)
    .values({
      agentId: data.agentId,
      type: data.type,
      sourceId: data.sourceId,
      targetId: data.targetId,
      properties: data.properties ?? {},
    })
    .returning();

  return result[0];
}

/**
 * Get all edges for an agent
 */
export async function getEdgesByAgent(agentId: string): Promise<GraphEdge[]> {
  return db
    .select()
    .from(graphEdges)
    .where(eq(graphEdges.agentId, agentId));
}

/**
 * Get an edge by ID
 */
export async function getEdgeById(edgeId: string): Promise<GraphEdge | null> {
  const result = await db
    .select()
    .from(graphEdges)
    .where(eq(graphEdges.id, edgeId))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Get all edges connected to a node
 */
export async function getEdgesByNode(
  nodeId: string,
  direction: 'incoming' | 'outgoing' | 'both'
): Promise<GraphEdge[]> {
  if (direction === 'incoming') {
    return db
      .select()
      .from(graphEdges)
      .where(eq(graphEdges.targetId, nodeId));
  } else if (direction === 'outgoing') {
    return db
      .select()
      .from(graphEdges)
      .where(eq(graphEdges.sourceId, nodeId));
  } else {
    return db
      .select()
      .from(graphEdges)
      .where(
        or(
          eq(graphEdges.sourceId, nodeId),
          eq(graphEdges.targetId, nodeId)
        )
      );
  }
}

/**
 * Find a specific edge between two nodes of a given type
 */
export async function findEdge(
  agentId: string,
  type: string,
  sourceId: string,
  targetId: string
): Promise<GraphEdge | null> {
  const result = await db
    .select()
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.agentId, agentId),
        eq(graphEdges.type, type),
        eq(graphEdges.sourceId, sourceId),
        eq(graphEdges.targetId, targetId)
      )
    )
    .limit(1);

  return result[0] ?? null;
}

/**
 * Delete an edge
 */
export async function deleteEdge(edgeId: string): Promise<void> {
  await db.delete(graphEdges).where(eq(graphEdges.id, edgeId));
}

// ============================================================================
// Graph Traversal
// ============================================================================

/**
 * Get neighboring nodes and edges for a node, up to a specified depth
 */
export async function getNodeNeighbors(
  nodeId: string,
  depth: number = 1
): Promise<GraphNeighbors> {
  const visitedNodeIds = new Set<string>([nodeId]);
  const visitedEdgeIds = new Set<string>();
  const resultNodes: GraphNode[] = [];
  const resultEdges: GraphEdge[] = [];

  // Get the starting node
  const startNode = await getNodeById(nodeId);
  if (!startNode) {
    return { nodes: [], edges: [] };
  }
  resultNodes.push(startNode);

  // BFS traversal
  let currentLevel = [nodeId];

  for (let d = 0; d < depth; d++) {
    const nextLevel: string[] = [];

    for (const currentNodeId of currentLevel) {
      // Get all edges for this node
      const edges = await getEdgesByNode(currentNodeId, 'both');

      for (const edge of edges) {
        if (!visitedEdgeIds.has(edge.id)) {
          visitedEdgeIds.add(edge.id);
          resultEdges.push(edge);

          // Find the neighbor node
          const neighborId = edge.sourceId === currentNodeId
            ? edge.targetId
            : edge.sourceId;

          if (!visitedNodeIds.has(neighborId)) {
            visitedNodeIds.add(neighborId);
            const neighborNode = await getNodeById(neighborId);
            if (neighborNode) {
              resultNodes.push(neighborNode);
              nextLevel.push(neighborId);
            }
          }
        }
      }
    }

    currentLevel = nextLevel;
  }

  return { nodes: resultNodes, edges: resultEdges };
}

// ============================================================================
// Serialization
// ============================================================================

/**
 * Serialize the graph for LLM context
 * Returns a human-readable format showing nodes and relationships
 */
export async function serializeGraphForLLM(
  agentId: string,
  maxNodes: number = 100
): Promise<string> {
  // Get nodes
  const nodes = await getNodesByAgent(agentId, { limit: maxNodes });

  if (nodes.length === 0) {
    return 'No knowledge graph data available.';
  }

  // Get edges for these nodes
  const nodeIds = nodes.map(n => n.id);
  const allEdges: GraphEdge[] = [];

  for (const nodeId of nodeIds) {
    const edges = await getEdgesByNode(nodeId, 'outgoing');
    // Only include edges where target is also in our node set
    const validEdges = edges.filter(e => nodeIds.includes(e.targetId));
    for (const edge of validEdges) {
      if (!allEdges.some(e => e.id === edge.id)) {
        allEdges.push(edge);
      }
    }
  }

  // Build node lookup for edges
  const nodeById = new Map(nodes.map(n => [n.id, n]));

  const lines: string[] = [];

  // Format nodes
  lines.push('Nodes:');
  for (const node of nodes) {
    const propsStr = JSON.stringify(node.properties);
    lines.push(`- [${node.type}] ${node.name} (id: ${node.id}): ${propsStr}`);
  }

  // Format relationships
  if (allEdges.length > 0) {
    lines.push('');
    lines.push('Relationships:');
    for (const edge of allEdges) {
      const source = nodeById.get(edge.sourceId);
      const target = nodeById.get(edge.targetId);
      if (source && target) {
        lines.push(
          `- [edge:${edge.id}] ${source.name} --${edge.type}--> ${target.name}`
        );
      }
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * Get statistics about the graph for an agent
 */
export async function getGraphStats(agentId: string): Promise<GraphStats> {
  // Count nodes
  const nodeCountResult = await db
    .select({ count: count() })
    .from(graphNodes)
    .where(eq(graphNodes.agentId, agentId));
  const nodeCount = nodeCountResult[0]?.count ?? 0;

  // Count edges
  const edgeCountResult = await db
    .select({ count: count() })
    .from(graphEdges)
    .where(eq(graphEdges.agentId, agentId));
  const edgeCount = edgeCountResult[0]?.count ?? 0;

  // Count nodes by type
  const nodesByTypeResult = await db
    .select({
      type: graphNodes.type,
      count: count(),
    })
    .from(graphNodes)
    .where(eq(graphNodes.agentId, agentId))
    .groupBy(graphNodes.type);

  const nodesByType: Record<string, number> = {};
  for (const row of nodesByTypeResult) {
    nodesByType[row.type] = row.count;
  }

  // Count edges by type
  const edgesByTypeResult = await db
    .select({
      type: graphEdges.type,
      count: count(),
    })
    .from(graphEdges)
    .where(eq(graphEdges.agentId, agentId))
    .groupBy(graphEdges.type);

  const edgesByType: Record<string, number> = {};
  for (const row of edgesByTypeResult) {
    edgesByType[row.type] = row.count;
  }

  return {
    nodeCount,
    edgeCount,
    nodesByType,
    edgesByType,
  };
}
