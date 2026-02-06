/**
 * Graph Type Queries
 *
 * CRUD operations for dynamic node and edge type definitions.
 * Types can be global (agentId=null) or agent-specific.
 */

import { eq, and, or, isNull, inArray } from "drizzle-orm";
import { db } from "../client";
import {
  graphNodeTypes,
  graphEdgeTypes,
  graphEdgeTypeSourceTypes,
  graphEdgeTypeTargetTypes,
} from "../schema";
import type {
  GraphNodeType,
  GraphEdgeType,
  GraphEdgeTypeWithConstraints,
  GraphTypeCreator as GraphTypeCreator,
} from "@/lib/types";

// Re-export types for convenience
export type {
  GraphNodeType,
  GraphEdgeType,
  GraphEdgeTypeWithConstraints,
  GraphTypeCreator,
};

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
 * Create a new edge type definition with optional source/target node type constraints
 */
export async function createEdgeType(data: {
  agentId?: string | null;
  name: string;
  description: string;
  sourceNodeTypeNames?: string[];
  targetNodeTypeNames?: string[];
  propertiesSchema?: object;
  exampleProperties?: object;
  createdBy?: GraphTypeCreator;
}): Promise<GraphEdgeType> {
  const agentId = data.agentId ?? null;

  // Create the edge type
  const [edgeType] = await db
    .insert(graphEdgeTypes)
    .values({
      agentId,
      name: data.name,
      description: data.description,
      propertiesSchema: data.propertiesSchema ?? null,
      exampleProperties: data.exampleProperties ?? null,
      createdBy: data.createdBy ?? "system",
    })
    .returning();

  // Add source node type constraints
  if (data.sourceNodeTypeNames && data.sourceNodeTypeNames.length > 0) {
    for (const nodeTypeName of data.sourceNodeTypeNames) {
      const nodeType = agentId
        ? await getNodeTypeByName(agentId, nodeTypeName)
        : await getGlobalNodeTypeByName(nodeTypeName);
      if (nodeType) {
        await addSourceNodeTypeToEdgeType(edgeType.id, nodeType.id);
      }
    }
  }

  // Add target node type constraints
  if (data.targetNodeTypeNames && data.targetNodeTypeNames.length > 0) {
    for (const nodeTypeName of data.targetNodeTypeNames) {
      const nodeType = agentId
        ? await getNodeTypeByName(agentId, nodeTypeName)
        : await getGlobalNodeTypeByName(nodeTypeName);
      if (nodeType) {
        await addTargetNodeTypeToEdgeType(edgeType.id, nodeType.id);
      }
    }
  }

  return edgeType;
}

/**
 * Helper to get a global node type by name
 */
async function getGlobalNodeTypeByName(
  name: string,
): Promise<GraphNodeType | null> {
  const result = await db
    .select()
    .from(graphNodeTypes)
    .where(and(isNull(graphNodeTypes.agentId), eq(graphNodeTypes.name, name)))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Get all edge types available to an agent with their source/target constraints populated
 */
export async function getEdgeTypesByAgent(
  agentId: string,
): Promise<GraphEdgeTypeWithConstraints[]> {
  // Get edge types (agent-specific + global)
  const edgeTypes = await db
    .select()
    .from(graphEdgeTypes)
    .where(
      or(
        eq(graphEdgeTypes.agentId, agentId),
        isNull(graphEdgeTypes.agentId),
      ),
    );

  // For each edge type, populate source and target node types
  const result: GraphEdgeTypeWithConstraints[] = [];

  for (const edgeType of edgeTypes) {
    // Get source node types
    const sourceTypeLinks = await db
      .select()
      .from(graphEdgeTypeSourceTypes)
      .where(eq(graphEdgeTypeSourceTypes.edgeTypeId, edgeType.id));

    const sourceNodeTypes: GraphNodeType[] = [];
    if (sourceTypeLinks.length > 0) {
      const sourceNodeTypeIds = sourceTypeLinks.map((link) => link.nodeTypeId);
      const sourceTypes = await db
        .select()
        .from(graphNodeTypes)
        .where(inArray(graphNodeTypes.id, sourceNodeTypeIds));
      sourceNodeTypes.push(...sourceTypes);
    }

    // Get target node types
    const targetTypeLinks = await db
      .select()
      .from(graphEdgeTypeTargetTypes)
      .where(eq(graphEdgeTypeTargetTypes.edgeTypeId, edgeType.id));

    const targetNodeTypes: GraphNodeType[] = [];
    if (targetTypeLinks.length > 0) {
      const targetNodeTypeIds = targetTypeLinks.map((link) => link.nodeTypeId);
      const targetTypes = await db
        .select()
        .from(graphNodeTypes)
        .where(inArray(graphNodeTypes.id, targetNodeTypeIds));
      targetNodeTypes.push(...targetTypes);
    }

    result.push({
      ...edgeType,
      sourceNodeTypes,
      targetNodeTypes,
    });
  }

  return result;
}

/**
 * Add a source node type constraint to an edge type
 */
export async function addSourceNodeTypeToEdgeType(
  edgeTypeId: string,
  nodeTypeId: string,
): Promise<void> {
  await db.insert(graphEdgeTypeSourceTypes).values({
    edgeTypeId,
    nodeTypeId,
  });
}

/**
 * Add a target node type constraint to an edge type
 */
export async function addTargetNodeTypeToEdgeType(
  edgeTypeId: string,
  nodeTypeId: string,
): Promise<void> {
  await db.insert(graphEdgeTypeTargetTypes).values({
    edgeTypeId,
    nodeTypeId,
  });
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
      // Build constraint description
      const sourceNames = edgeType.sourceNodeTypes.map((t) => t.name);
      const targetNames = edgeType.targetNodeTypes.map((t) => t.name);

      let constraintDesc = "";
      if (sourceNames.length > 0 || targetNames.length > 0) {
        const sourceStr = sourceNames.length > 0 ? sourceNames.join("|") : "*";
        const targetStr = targetNames.length > 0 ? targetNames.join("|") : "*";
        constraintDesc = `: ${sourceStr} -> ${targetStr}`;
      }

      lines.push(`- **${edgeType.name}**${constraintDesc}`);
      lines.push(`  Description: ${edgeType.description}`);
    }
  }

  return lines.join("\n");
}
