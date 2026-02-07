/**
 * Graph Type Queries
 *
 * CRUD operations for dynamic node and edge type definitions.
 * Types can be global (agentId=null) or agent-specific.
 */

import { eq, and, or, isNull } from "drizzle-orm";
import { db } from "../client";
import { graphNodeTypes, graphEdgeTypes } from "../schema";
import type {
  GraphNodeType,
  GraphEdgeType,
  GraphTypeCreator as GraphTypeCreator,
} from "@/lib/types";

// Re-export types for convenience
export type { GraphNodeType, GraphEdgeType, GraphTypeCreator };

// ============================================================================
// Node Type Operations
// ============================================================================

/**
 * Create a new node type definition
 */
export async function createNodeType(data: {
  agentId?: string | null;
  name: string;
  description: string;
  justification: string;
  propertiesSchema: object;
  exampleProperties?: object;
  createdBy?: GraphTypeCreator;
}): Promise<GraphNodeType> {
  const result = await db
    .insert(graphNodeTypes)
    .values({
      agentId: data.agentId ?? null,
      name: data.name,
      description: data.description,
      justification: data.justification,
      propertiesSchema: data.propertiesSchema,
      exampleProperties: data.exampleProperties ?? null,
      createdBy: data.createdBy ?? "system",
    })
    .returning();

  return result[0];
}

/**
 * Get all node types available to an agent (agent-specific + global types)
 */
export async function getNodeTypesByAgent(
  agentId: string,
): Promise<GraphNodeType[]> {
  return db
    .select()
    .from(graphNodeTypes)
    .where(
      or(
        eq(graphNodeTypes.agentId, agentId),
        isNull(graphNodeTypes.agentId),
      ),
    );
}

/**
 * Get a node type by name for an agent (checks agent-specific first, then global)
 */
export async function getNodeTypeByName(
  agentId: string,
  name: string,
): Promise<GraphNodeType | null> {
  // First check for agent-specific type
  const agentSpecific = await db
    .select()
    .from(graphNodeTypes)
    .where(
      and(eq(graphNodeTypes.agentId, agentId), eq(graphNodeTypes.name, name)),
    )
    .limit(1);

  if (agentSpecific.length > 0) {
    return agentSpecific[0];
  }

  // Fall back to global type
  const global = await db
    .select()
    .from(graphNodeTypes)
    .where(and(isNull(graphNodeTypes.agentId), eq(graphNodeTypes.name, name)))
    .limit(1);

  return global[0] ?? null;
}

/**
 * Check if a node type exists for an agent (agent-specific or global)
 */
export async function nodeTypeExists(
  agentId: string,
  name: string,
): Promise<boolean> {
  const nodeType = await getNodeTypeByName(agentId, name);
  return nodeType !== null;
}

// ============================================================================
// Edge Type Operations
// ============================================================================

/**
 * Create a new edge type definition
 */
export async function createEdgeType(data: {
  agentId?: string | null;
  name: string;
  description: string;
  justification: string;
  propertiesSchema?: object;
  exampleProperties?: object;
  createdBy?: GraphTypeCreator;
}): Promise<GraphEdgeType> {
  const [edgeType] = await db
    .insert(graphEdgeTypes)
    .values({
      agentId: data.agentId ?? null,
      name: data.name,
      description: data.description,
      justification: data.justification,
      propertiesSchema: data.propertiesSchema ?? null,
      exampleProperties: data.exampleProperties ?? null,
      createdBy: data.createdBy ?? "system",
    })
    .returning();

  return edgeType;
}

/**
 * Get all edge types available to an agent (agent-specific + global types)
 */
export async function getEdgeTypesByAgent(
  agentId: string,
): Promise<GraphEdgeType[]> {
  return db
    .select()
    .from(graphEdgeTypes)
    .where(
      or(
        eq(graphEdgeTypes.agentId, agentId),
        isNull(graphEdgeTypes.agentId),
      ),
    );
}

/**
 * Get an edge type by name for an agent (checks agent-specific first, then global)
 */
export async function getEdgeTypeByName(
  agentId: string,
  name: string,
): Promise<GraphEdgeType | null> {
  // First check for agent-specific type
  const agentSpecific = await db
    .select()
    .from(graphEdgeTypes)
    .where(
      and(eq(graphEdgeTypes.agentId, agentId), eq(graphEdgeTypes.name, name)),
    )
    .limit(1);

  if (agentSpecific.length > 0) {
    return agentSpecific[0];
  }

  // Fall back to global type
  const global = await db
    .select()
    .from(graphEdgeTypes)
    .where(and(isNull(graphEdgeTypes.agentId), eq(graphEdgeTypes.name, name)))
    .limit(1);

  return global[0] ?? null;
}

/**
 * Check if an edge type exists for an agent (agent-specific or global)
 */
export async function edgeTypeExists(
  agentId: string,
  name: string,
): Promise<boolean> {
  const edgeType = await getEdgeTypeByName(agentId, name);
  return edgeType !== null;
}

// ============================================================================
// LLM Context Formatting
// ============================================================================

/**
 * Format all types available to an agent for LLM context
 * Returns a human-readable format that helps the LLM understand available types
 */
export async function formatTypesForLLMContext(
  agentId: string,
): Promise<string> {
  const nodeTypes = await getNodeTypesByAgent(agentId);
  const edgeTypes = await getEdgeTypesByAgent(agentId);

  const lines: string[] = [];

  // Format node types
  lines.push("### Node Types");
  if (nodeTypes.length === 0) {
    lines.push("No node types defined.");
  } else {
    for (const nodeType of nodeTypes) {
      const schema = nodeType.propertiesSchema as {
        required?: string[];
        properties?: Record<string, unknown>;
      };

      // Build property description
      const properties = schema.properties ?? {};
      const required = schema.required ?? [];
      const optional = Object.keys(properties).filter(
        (p) => !required.includes(p),
      );

      let propDesc = "";
      if (required.length > 0) {
        propDesc += `\n  Required: ${required.join(", ")}`;
      }
      if (optional.length > 0) {
        propDesc += `\n  Optional: ${optional.join(", ")}`;
      }

      // Add example if available
      let exampleDesc = "";
      if (nodeType.exampleProperties) {
        exampleDesc = `\n  Example: ${JSON.stringify(nodeType.exampleProperties)}`;
      }

      lines.push(
        `- **${nodeType.name}**: ${nodeType.description}${propDesc}${exampleDesc}`,
      );
    }
  }

  lines.push("");

  // Format edge types
  lines.push("### Edge Types");
  if (edgeTypes.length === 0) {
    lines.push("No edge types defined.");
  } else {
    for (const edgeType of edgeTypes) {
      lines.push(`- **${edgeType.name}**: ${edgeType.description}`);
    }
  }

  return lines.join("\n");
}
