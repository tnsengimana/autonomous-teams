/**
 * Knowledge Graph Service
 *
 * High-level operations for the INSERT/RETRIEVE loop
 * and knowledge context building.
 */

import { formatTypesForLLMContext } from "@/lib/db/queries/graph-types";
import {
  serializeGraphForLLM,
  getGraphStats,
} from "@/lib/db/queries/graph-data";

/**
 * Build knowledge graph context block for agent system prompts.
 * This is included in background work sessions to help agents understand
 * the available types and current graph state.
 */
export async function buildGraphContextBlock(agentId: string): Promise<string> {
  const [typeContext, graphData, stats] = await Promise.all([
    formatTypesForLLMContext(agentId),
    serializeGraphForLLM(agentId, 50), // Include recent graph state
    getGraphStats(agentId),
  ]);

  if (stats.nodeCount === 0) {
    return `
<knowledge_graph>
The knowledge graph is currently empty. Use the graph tools to populate it with discovered knowledge.

${typeContext}

## How to Use the Knowledge Graph

When working on tasks, follow this pattern:

1. **RETRIEVE first**: Before researching, check if the graph already has relevant information
   - Use queryGraph to search for nodes related to your task
   - If you find relevant, recent information, use it

2. **INSERT when needed**: If the graph lacks information you need:
   - Use external tools (web search, etc.) to gather information
   - Use addGraphNode to create nodes for entities you discover
   - Use addGraphEdge to create relationships between nodes
   - Include temporal properties (occurred_at, published_at) where applicable

3. **Avoid duplicates**: Before creating a node, the system checks if one with the same type+name exists
   - If it exists, properties are merged (updated)
   - Use consistent naming (e.g., "Apple Inc." not "Apple" vs "Apple Inc")

4. **Use existing types**: Prefer existing node/edge types over creating new ones
   - Use listNodeTypes/listEdgeTypes to inspect available types first
   - Only use createNodeType/createEdgeType if truly necessary
   - Provide justification when creating new types
</knowledge_graph>
`;
  }

  return `
<knowledge_graph>
Current graph has ${stats.nodeCount} nodes and ${stats.edgeCount} edges.

## Available Types
${typeContext}

## Current Graph State (most recent ${Math.min(stats.nodeCount, 50)} nodes)
${graphData}

## How to Use the Knowledge Graph

When working on tasks, follow this pattern:

1. **RETRIEVE first**: Before researching, check if the graph already has relevant information
   - Use queryGraph to search for nodes related to your task
   - Review the graph state above for relevant prior knowledge
   - If you find relevant, recent information, use it

2. **INSERT when needed**: If the graph lacks information you need:
   - Use external tools (web search, etc.) to gather information
   - Use addGraphNode to create nodes for entities you discover
   - Use addGraphEdge to create relationships between nodes
   - Include temporal properties (occurred_at, published_at) where applicable

3. **Avoid duplicates**: Before creating a node, the system checks if one with the same type+name exists
   - If it exists, properties are merged (updated)
   - Use consistent naming (e.g., "Apple Inc." not "Apple" vs "Apple Inc")

4. **Use existing types**: Prefer existing node/edge types over creating new ones
   - Use listNodeTypes/listEdgeTypes to inspect available types first
   - Only use createNodeType/createEdgeType if truly necessary
   - Provide justification when creating new types

5. **Reason about freshness**: Check temporal properties to assess data relevance
   - A signal from weeks ago may be stale
   - Recent news is more relevant than old news
</knowledge_graph>
`;
}

/**
 * Ensure agent has graph types initialized.
 * Called before building graph context.
 */
export async function ensureGraphTypesInitialized(
  agentId: string,
  agent: { name: string; type: string; purpose: string | null },
  options?: { userId?: string },
): Promise<void> {
  const { getNodeTypesByAgent } = await import("@/lib/db/queries/graph-types");

  const existingTypes = await getNodeTypesByAgent(agentId);
  if (existingTypes.length > 0) {
    return; // Already initialized
  }

  // Initialize types for this agent
  const { initializeAndPersistTypesForAgent } = await import("./graph-types");

  console.log(`[Graph] Initializing types for agent ${agent.name}`);
  await initializeAndPersistTypesForAgent(agentId, agent, options);
}
