/**
 * Graph Tools
 *
 * Tools for agents to manipulate the knowledge graph:
 * - Add/update nodes
 * - Add edges
 * - Query the graph
 * - List available node/edge types
 * - Create new types
 */

import {
  registerTool,
  type Tool,
  type ToolResult,
  type ToolContext,
} from "./index";
import { z } from "zod";

// ============================================================================
// Extended Tool Context (includes conversationId for graph tools)
// ============================================================================

export interface GraphToolContext extends ToolContext {
  conversationId?: string;
}

// ============================================================================
// Zod Schemas for Graph Tool Parameters
// ============================================================================

export const AddGraphNodeParamsSchema = z.object({
  type: z
    .string()
    .min(1)
    .describe('Node type (must be an existing type, e.g., "Company", "Asset")'),
  name: z.string().min(1).describe("Human-readable identifier for this node"),
  properties: z
    .record(z.string(), z.unknown())
    .optional()
    .default({})
    .describe(
      "Properties for this node (must match type schema, including any temporal fields)",
    ),
});

export const AddGraphEdgeParamsSchema = z.object({
  type: z.string().min(1).describe('Edge type (e.g., "affects", "issued_by")'),
  sourceName: z.string().min(1).describe("Name of the source node"),
  sourceType: z.string().min(1).describe("Type of the source node"),
  targetName: z.string().min(1).describe("Name of the target node"),
  targetType: z.string().min(1).describe("Type of the target node"),
  properties: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Optional properties for this edge"),
});

export const QueryGraphParamsSchema = z.object({
  nodeType: z.string().optional().describe("Filter by node type"),
  searchTerm: z.string().optional().describe("Search in node names"),
  limit: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe("Maximum nodes to return"),
});

export const CreateNodeTypeParamsSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      'Capitalized node type name (spaces allowed), e.g., "Regulation", "Market Event"',
    ),
  description: z
    .string()
    .min(1)
    .describe("Clear explanation of what this type represents"),
  propertiesSchema: z
    .record(z.string(), z.unknown())
    .describe("JSON Schema defining allowed properties"),
  exampleProperties: z
    .record(z.string(), z.unknown())
    .describe("Example property values for few-shot learning"),
  justification: z
    .string()
    .min(1)
    .describe("Why existing types are insufficient"),
});

export const CreateEdgeTypeParamsSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      'snake_case name for the relationship (e.g., "regulates", "competes_with")',
    ),
  description: z
    .string()
    .min(1)
    .describe("Clear explanation of what this relationship represents"),
  propertiesSchema: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Optional JSON Schema for edge properties"),
  exampleProperties: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Example property values"),
  justification: z
    .string()
    .min(1)
    .describe("Why existing edge types are insufficient"),
});

export type AddGraphNodeParams = z.infer<typeof AddGraphNodeParamsSchema>;
export type AddGraphEdgeParams = z.infer<typeof AddGraphEdgeParamsSchema>;
export type QueryGraphParams = z.infer<typeof QueryGraphParamsSchema>;
export type CreateNodeTypeParams = z.infer<typeof CreateNodeTypeParamsSchema>;
export type CreateEdgeTypeParams = z.infer<typeof CreateEdgeTypeParamsSchema>;

// ============================================================================
// Naming Convention Validators
// ============================================================================

const CAPITALIZED_TYPE_NAME_REGEX = /^[A-Z][A-Za-z0-9]*(?: [A-Za-z0-9]+)*$/;
const SNAKE_CASE_REGEX = /^[a-z][a-z_]*$/;

function isCapitalizedTypeName(name: string): boolean {
  return CAPITALIZED_TYPE_NAME_REGEX.test(name);
}

function isSnakeCase(name: string): boolean {
  return SNAKE_CASE_REGEX.test(name);
}

function formatAvailableTypeNames(typeNames: string[]): string {
  if (typeNames.length === 0) {
    return "(none)";
  }
  return [...typeNames].sort((a, b) => a.localeCompare(b)).join(", ");
}

// ============================================================================
// Node Properties Schema Validation Helpers
// ============================================================================

type JsonSchemaLike = {
  type?: string | string[];
  properties?: Record<string, unknown>;
  required?: string[];
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  format?: string;
  items?: unknown;
};

function valueTypeLabel(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

function matchesSchemaType(value: unknown, schemaType: string): boolean {
  if (schemaType === "null") {
    return value === null;
  }
  if (schemaType === "array") {
    return Array.isArray(value);
  }
  if (schemaType === "object") {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  if (schemaType === "integer") {
    return typeof value === "number" && Number.isInteger(value);
  }
  return typeof value === schemaType;
}

function validateValueAgainstSchema(
  value: unknown,
  schema: unknown,
  path: string,
  errors: string[],
): void {
  if (
    !schema ||
    typeof schema !== "object" ||
    Array.isArray(schema)
  ) {
    return;
  }

  const typedSchema = schema as JsonSchemaLike;
  const schemaTypes = Array.isArray(typedSchema.type)
    ? typedSchema.type
    : typedSchema.type
      ? [typedSchema.type]
      : [];

  if (schemaTypes.length > 0) {
    const matches = schemaTypes.some((schemaType) =>
      matchesSchemaType(value, schemaType),
    );
    if (!matches) {
      errors.push(
        `${path} expected ${schemaTypes.join("|")}, got ${valueTypeLabel(value)} (${JSON.stringify(value)})`,
      );
      return;
    }
  }

  if (typedSchema.enum && !typedSchema.enum.includes(value)) {
    errors.push(
      `${path} must be one of ${typedSchema.enum.map((v) => JSON.stringify(v)).join(", ")}`,
    );
  }

  if (typeof value === "number") {
    if (
      typeof typedSchema.minimum === "number" &&
      value < typedSchema.minimum
    ) {
      errors.push(`${path} must be >= ${typedSchema.minimum}, got ${value}`);
    }
    if (
      typeof typedSchema.maximum === "number" &&
      value > typedSchema.maximum
    ) {
      errors.push(`${path} must be <= ${typedSchema.maximum}, got ${value}`);
    }
  }

  if (typeof value === "string") {
    if (
      typeof typedSchema.minLength === "number" &&
      value.length < typedSchema.minLength
    ) {
      errors.push(
        `${path} must have length >= ${typedSchema.minLength}, got ${value.length}`,
      );
    }
    if (
      typeof typedSchema.maxLength === "number" &&
      value.length > typedSchema.maxLength
    ) {
      errors.push(
        `${path} must have length <= ${typedSchema.maxLength}, got ${value.length}`,
      );
    }
    if (typedSchema.pattern) {
      try {
        const regex = new RegExp(typedSchema.pattern);
        if (!regex.test(value)) {
          errors.push(
            `${path} must match pattern ${typedSchema.pattern}, got ${JSON.stringify(value)}`,
          );
        }
      } catch {
        // Ignore invalid regex patterns in dynamic schemas.
      }
    }
    if (typedSchema.format === "date-time" && Number.isNaN(Date.parse(value))) {
      errors.push(`${path} must be a valid date-time string, got ${JSON.stringify(value)}`);
    }
  }

  if (Array.isArray(value)) {
    if (
      typeof typedSchema.minItems === "number" &&
      value.length < typedSchema.minItems
    ) {
      errors.push(
        `${path} must have at least ${typedSchema.minItems} items, got ${value.length}`,
      );
    }
    if (
      typeof typedSchema.maxItems === "number" &&
      value.length > typedSchema.maxItems
    ) {
      errors.push(
        `${path} must have at most ${typedSchema.maxItems} items, got ${value.length}`,
      );
    }
    if (typedSchema.items) {
      value.forEach((item, index) => {
        validateValueAgainstSchema(item, typedSchema.items, `${path}[${index}]`, errors);
      });
    }
  }

  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    const record = value as Record<string, unknown>;
    const required = typedSchema.required ?? [];
    for (const requiredKey of required) {
      if (!(requiredKey in record)) {
        errors.push(`${path}.${requiredKey} is required`);
      }
    }

    const properties = typedSchema.properties ?? {};
    for (const [key, propertyValue] of Object.entries(record)) {
      if (key in properties) {
        validateValueAgainstSchema(
          propertyValue,
          properties[key],
          `${path}.${key}`,
          errors,
        );
      }
    }
  }
}

function validatePropertiesAgainstSchema(
  properties: Record<string, unknown>,
  schema: unknown,
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (schema == null) {
    return { isValid: true, errors };
  }
  validateValueAgainstSchema(properties, schema, "properties", errors);
  return { isValid: errors.length === 0, errors };
}

// ============================================================================
// Citation Validation Helpers
// ============================================================================

const ANALYSIS_CITATION_REGEX = /\[(node|edge):([^\]]+)\]/gi;
const UUID_V4_LIKE_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ParsedCitation = {
  kind: "node" | "edge";
  id: string;
  raw: string;
};

function parseGraphCitations(content: string): ParsedCitation[] {
  const citations: ParsedCitation[] = [];
  let match = ANALYSIS_CITATION_REGEX.exec(content);

  while (match) {
    const kind = match[1].toLowerCase() as "node" | "edge";
    const id = match[2].trim();
    citations.push({
      kind,
      id,
      raw: match[0],
    });
    match = ANALYSIS_CITATION_REGEX.exec(content);
  }

  ANALYSIS_CITATION_REGEX.lastIndex = 0;
  return citations;
}

function isUuidLike(value: string): boolean {
  return UUID_V4_LIKE_REGEX.test(value);
}

async function validateAgentAnalysisCitations(
  agentId: string,
  content: string,
): Promise<{ isValid: boolean; error?: string }> {
  const citations = parseGraphCitations(content);

  if (citations.length === 0) {
    return {
      isValid: false,
      error:
        "AgentAnalysis content must include at least one citation using [node:uuid] or [edge:uuid].",
    };
  }

  const malformed = citations.filter((citation) => !isUuidLike(citation.id));
  if (malformed.length > 0) {
    const examples = malformed.slice(0, 5).map((citation) => citation.raw);
    return {
      isValid: false,
      error: `Invalid citation format in AgentAnalysis content. Use [node:uuid] or [edge:uuid] only. Invalid citations: ${examples.join(", ")}`,
    };
  }

  const uniqueNodeIds = [
    ...new Set(
      citations
        .filter((citation) => citation.kind === "node")
        .map((citation) => citation.id),
    ),
  ];
  const uniqueEdgeIds = [
    ...new Set(
      citations
        .filter((citation) => citation.kind === "edge")
        .map((citation) => citation.id),
    ),
  ];

  const { getNodeById, getEdgeById } = await import("@/lib/db/queries/graph-data");

  const missingNodeIds: string[] = [];
  const wrongAgentNodeIds: string[] = [];
  for (const nodeId of uniqueNodeIds) {
    const node = await getNodeById(nodeId);
    if (!node) {
      missingNodeIds.push(nodeId);
      continue;
    }
    if (node.agentId !== agentId) {
      wrongAgentNodeIds.push(nodeId);
    }
  }

  const missingEdgeIds: string[] = [];
  const wrongAgentEdgeIds: string[] = [];
  for (const edgeId of uniqueEdgeIds) {
    const edge = await getEdgeById(edgeId);
    if (!edge) {
      missingEdgeIds.push(edgeId);
      continue;
    }
    if (edge.agentId !== agentId) {
      wrongAgentEdgeIds.push(edgeId);
    }
  }

  if (
    missingNodeIds.length > 0 ||
    wrongAgentNodeIds.length > 0 ||
    missingEdgeIds.length > 0 ||
    wrongAgentEdgeIds.length > 0
  ) {
    const parts: string[] = [];
    if (missingNodeIds.length > 0) {
      parts.push(`missing nodes: ${missingNodeIds.join(", ")}`);
    }
    if (wrongAgentNodeIds.length > 0) {
      parts.push(`cross-agent nodes: ${wrongAgentNodeIds.join(", ")}`);
    }
    if (missingEdgeIds.length > 0) {
      parts.push(`missing edges: ${missingEdgeIds.join(", ")}`);
    }
    if (wrongAgentEdgeIds.length > 0) {
      parts.push(`cross-agent edges: ${wrongAgentEdgeIds.join(", ")}`);
    }

    return {
      isValid: false,
      error: `AgentAnalysis content cites unknown or unauthorized graph references (${parts.join("; ")}).`,
    };
  }

  return { isValid: true };
}

// ============================================================================
// addGraphNode Tool
// ============================================================================

const addGraphNodeTool: Tool = {
  schema: {
    name: "addGraphNode",
    description:
      "Add a node to the knowledge graph. Use existing node types when possible. Temporal fields (occurred_at, published_at, etc.) should be included in properties per the type schema.",
    parameters: [
      {
        name: "type",
        type: "string",
        description:
          'Node type (must be an existing type, e.g., "Company", "Asset")',
        required: true,
      },
      {
        name: "name",
        type: "string",
        description: "Human-readable identifier for this node",
        required: true,
      },
      {
        name: "properties",
        type: "object",
        description:
          "Properties for this node (must match type schema, including any temporal fields)",
        required: false,
      },
    ],
  },
  handler: async (params, context): Promise<ToolResult> => {
    const parsed = AddGraphNodeParamsSchema.safeParse(params);
    if (!parsed.success) {
      return {
        success: false,
        error: `Invalid parameters: ${parsed.error.message}`,
      };
    }

    const { type, name, properties } = parsed.data;
    const ctx = context as GraphToolContext;

    try {
      const { createNode, findNodeByTypeAndName, updateNodeProperties } =
        await import("@/lib/db/queries/graph-data");
      const { nodeTypeExists, getNodeTypesByAgent, getNodeTypeByName } = await import(
        "@/lib/db/queries/graph-types"
      );

      // Validate type exists
      if (!(await nodeTypeExists(ctx.agentId, type))) {
        const availableNodeTypes = await getNodeTypesByAgent(ctx.agentId);
        const availableNodeTypeNames = availableNodeTypes.map((t) => t.name);

        console.warn(
          `[GraphTools][WARN][addGraphNode] Missing node type for requested node create/update`,
          {
            agentId: ctx.agentId,
            requestedNodeType: type,
            requestedNodeName: name,
            availableNodeTypes: availableNodeTypeNames,
          },
        );

        return {
          success: false,
          error: `NODE_TYPE_NOT_FOUND: Node type "${type}" does not exist. Available node types: ${formatAvailableTypeNames(availableNodeTypeNames)}. Use listNodeTypes first, then createNodeType only if necessary.`,
        };
      }

      const nodeType = await getNodeTypeByName(ctx.agentId, type);
      if (!nodeType) {
        return {
          success: false,
          error: `NODE_TYPE_NOT_FOUND: Node type "${type}" could not be loaded for validation.`,
        };
      }

      // Check for existing node (upsert semantics)
      const existing = await findNodeByTypeAndName(ctx.agentId, type, name);
      if (existing) {
        const mergedProperties = {
          ...(existing.properties as object),
          ...properties,
        } as Record<string, unknown>;

        const validation = validatePropertiesAgainstSchema(
          mergedProperties,
          nodeType.propertiesSchema,
        );

        if (!validation.isValid) {
          console.warn(
            `[GraphTools][WARN][addGraphNode] Node property schema validation failed on update`,
            {
              agentId: ctx.agentId,
              requestedNodeType: type,
              requestedNodeName: name,
              properties: mergedProperties,
              validationErrors: validation.errors,
            },
          );

          return {
            success: false,
            error: `NODE_PROPERTIES_SCHEMA_VALIDATION_FAILED: ${validation.errors.join("; ")}`,
          };
        }

        await updateNodeProperties(existing.id, mergedProperties);
        return {
          success: true,
          data: {
            nodeId: existing.id,
            action: "updated",
          },
        };
      }

      const createProperties = properties as Record<string, unknown>;
      const createValidation = validatePropertiesAgainstSchema(
        createProperties,
        nodeType.propertiesSchema,
      );

      if (!createValidation.isValid) {
        console.warn(
          `[GraphTools][WARN][addGraphNode] Node property schema validation failed on create`,
          {
            agentId: ctx.agentId,
            requestedNodeType: type,
            requestedNodeName: name,
            properties: createProperties,
            validationErrors: createValidation.errors,
          },
        );

        return {
          success: false,
          error: `NODE_PROPERTIES_SCHEMA_VALIDATION_FAILED: ${createValidation.errors.join("; ")}`,
        };
      }

      // Create new node
      const node = await createNode({
        agentId: ctx.agentId,
        type,
        name,
        properties: createProperties,
      });

      return {
        success: true,
        data: {
          nodeId: node.id,
          action: "created",
        },
      };
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Failed to add graph node";
      console.warn(
        `[GraphTools][WARN][addGraphNode] Unexpected failure while adding/updating node`,
        {
          agentId: ctx.agentId,
          requestedNodeType: type,
          requestedNodeName: name,
          error: detail,
        },
      );

      return {
        success: false,
        error: `Failed to add graph node "${name}" (type "${type}"): ${detail}`,
      };
    }
  },
};

// ============================================================================
// addGraphEdge Tool
// ============================================================================

const addGraphEdgeTool: Tool = {
  schema: {
    name: "addGraphEdge",
    description:
      "Add a relationship (edge) between two nodes in the knowledge graph.",
    parameters: [
      {
        name: "type",
        type: "string",
        description: 'Edge type (e.g., "affects", "issued_by")',
        required: true,
      },
      {
        name: "sourceName",
        type: "string",
        description: "Name of the source node",
        required: true,
      },
      {
        name: "sourceType",
        type: "string",
        description: "Type of the source node",
        required: true,
      },
      {
        name: "targetName",
        type: "string",
        description: "Name of the target node",
        required: true,
      },
      {
        name: "targetType",
        type: "string",
        description: "Type of the target node",
        required: true,
      },
      {
        name: "properties",
        type: "object",
        description: "Optional properties for this edge",
        required: false,
      },
    ],
  },
  handler: async (params, context): Promise<ToolResult> => {
    const parsed = AddGraphEdgeParamsSchema.safeParse(params);
    if (!parsed.success) {
      return {
        success: false,
        error: `Invalid parameters: ${parsed.error.message}`,
      };
    }

    const { type, sourceName, sourceType, targetName, targetType, properties } =
      parsed.data;
    const ctx = context as GraphToolContext;
    const edgeDescriptor = `${sourceType}:${sourceName} -[${type}]-> ${targetType}:${targetName}`;

    try {
      const { findNodeByTypeAndName, createEdge, findEdge } =
        await import("@/lib/db/queries/graph-data");
      const { edgeTypeExists, getEdgeTypesByAgent, getEdgeTypeByName } = await import(
        "@/lib/db/queries/graph-types"
      );

      // Validate edge type exists
      if (!(await edgeTypeExists(ctx.agentId, type))) {
        const availableEdgeTypes = await getEdgeTypesByAgent(ctx.agentId);
        const availableEdgeTypeNames = availableEdgeTypes.map((t) => t.name);

        console.warn(`[GraphTools][WARN][addGraphEdge] Missing edge type`, {
          agentId: ctx.agentId,
          attemptedEdge: edgeDescriptor,
          availableEdgeTypes: availableEdgeTypeNames,
        });

        return {
          success: false,
          error: `EDGE_TYPE_NOT_FOUND: Edge type "${type}" does not exist. Available edge types: ${formatAvailableTypeNames(availableEdgeTypeNames)}. Use listEdgeTypes first and select an existing type.`,
        };
      }

      const edgeType = await getEdgeTypeByName(ctx.agentId, type);
      if (!edgeType) {
        return {
          success: false,
          error: `EDGE_TYPE_NOT_FOUND: Edge type "${type}" could not be loaded for validation.`,
        };
      }

      const edgeProperties = (properties || {}) as Record<string, unknown>;
      const edgePropertyValidation = validatePropertiesAgainstSchema(
        edgeProperties,
        edgeType.propertiesSchema,
      );

      if (!edgePropertyValidation.isValid) {
        console.warn(
          `[GraphTools][WARN][addGraphEdge] Edge property schema validation failed`,
          {
            agentId: ctx.agentId,
            attemptedEdge: edgeDescriptor,
            properties: edgeProperties,
            validationErrors: edgePropertyValidation.errors,
          },
        );

        return {
          success: false,
          error: `EDGE_PROPERTIES_SCHEMA_VALIDATION_FAILED: ${edgePropertyValidation.errors.join("; ")}`,
        };
      }

      // Find source and target nodes
      const sourceNode = await findNodeByTypeAndName(
        ctx.agentId,
        sourceType,
        sourceName,
      );
      const targetNode = await findNodeByTypeAndName(
        ctx.agentId,
        targetType,
        targetName,
      );

      if (!sourceNode) {
        console.warn(`[GraphTools][WARN][addGraphEdge] Source node missing`, {
          agentId: ctx.agentId,
          attemptedEdge: edgeDescriptor,
        });

        return {
          success: false,
          error: `Source node "${sourceName}" of type "${sourceType}" not found. Create it first.`,
        };
      }
      if (!targetNode) {
        console.warn(`[GraphTools][WARN][addGraphEdge] Target node missing`, {
          agentId: ctx.agentId,
          attemptedEdge: edgeDescriptor,
        });

        return {
          success: false,
          error: `Target node "${targetName}" of type "${targetType}" not found. Create it first.`,
        };
      }

      // Check for existing edge (avoid duplicates)
      const existing = await findEdge(
        ctx.agentId,
        type,
        sourceNode.id,
        targetNode.id,
      );
      if (existing) {
        return {
          success: true,
          data: {
            edgeId: existing.id,
            action: "already_exists",
          },
        };
      }

      console.warn(`[GraphTools][WARN][addGraphEdge] Creating edge`, {
        agentId: ctx.agentId,
        edge: edgeDescriptor,
      });

      // Create edge
      const edge = await createEdge({
        agentId: ctx.agentId,
        type,
        sourceId: sourceNode.id,
        targetId: targetNode.id,
        properties: edgeProperties,
      });

      return {
        success: true,
        data: {
          edgeId: edge.id,
          action: "created",
        },
      };
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Failed to add graph edge";
      console.warn(
        `[GraphTools][WARN][addGraphEdge] Unexpected failure while adding edge`,
        {
          agentId: ctx.agentId,
          attemptedEdge: edgeDescriptor,
          error: detail,
        },
      );

      return {
        success: false,
        error: `Failed to add graph edge ${edgeDescriptor}: ${detail}`,
      };
    }
  },
};

// ============================================================================
// queryGraph Tool
// ============================================================================

const queryGraphTool: Tool = {
  schema: {
    name: "queryGraph",
    description:
      "Query the knowledge graph to find relevant information. Returns nodes and relationships with node/edge IDs for precise [node:uuid] / [edge:uuid] citations.",
    parameters: [
      {
        name: "nodeType",
        type: "string",
        description: "Filter by node type",
        required: false,
      },
      {
        name: "searchTerm",
        type: "string",
        description: "Search in node names",
        required: false,
      },
      {
        name: "limit",
        type: "number",
        description: "Maximum nodes to return (default 20)",
        required: false,
      },
    ],
  },
  handler: async (params, context): Promise<ToolResult> => {
    const parsed = QueryGraphParamsSchema.safeParse(params);
    if (!parsed.success) {
      return {
        success: false,
        error: `Invalid parameters: ${parsed.error.message}`,
      };
    }

    const { nodeType, searchTerm, limit } = parsed.data;
    const ctx = context as GraphToolContext;

    try {
      const { getNodesByAgent, getEdgesByNode } =
        await import("@/lib/db/queries/graph-data");

      let nodes = await getNodesByAgent(ctx.agentId, { type: nodeType, limit });

      // Filter by search term if provided
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        nodes = nodes.filter((n) => n.name.toLowerCase().includes(term));
      }

      // Get edges for these nodes
      const edgePromises = nodes.map((n) => getEdgesByNode(n.id, "both"));
      const edgeResults = await Promise.all(edgePromises);
      const allEdges = edgeResults.flat();

      // Deduplicate edges by id
      const edgeMap = new Map(allEdges.map((e) => [e.id, e]));
      const edges = Array.from(edgeMap.values());

      return {
        success: true,
        data: {
          nodes: nodes.map((n) => ({
            id: n.id,
            type: n.type,
            name: n.name,
            properties: n.properties,
          })),
          edges: edges.map((e) => ({
            id: e.id,
            type: e.type,
            sourceId: e.sourceId,
            targetId: e.targetId,
            properties: e.properties,
          })),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to query graph",
      };
    }
  },
};

// ============================================================================
// getGraphSummary Tool
// ============================================================================

const getGraphSummaryTool: Tool = {
  schema: {
    name: "getGraphSummary",
    description:
      "Get a summary of the current knowledge graph state (node counts, edge counts by type).",
    parameters: [],
  },
  handler: async (_params, context): Promise<ToolResult> => {
    const ctx = context as GraphToolContext;

    try {
      const { getGraphStats } = await import("@/lib/db/queries/graph-data");
      const stats = await getGraphStats(ctx.agentId);

      return {
        success: true,
        data: stats,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to get graph summary",
      };
    }
  },
};

// ============================================================================
// listNodeTypes Tool
// ============================================================================

const listNodeTypesTool: Tool = {
  schema: {
    name: "listNodeTypes",
    description:
      "List all available node types (agent-specific and global) with descriptions and schemas. Use this before creating new node types.",
    parameters: [],
  },
  handler: async (_params, context): Promise<ToolResult> => {
    const ctx = context as GraphToolContext;

    try {
      const { getNodeTypesByAgent } =
        await import("@/lib/db/queries/graph-types");
      const nodeTypes = await getNodeTypesByAgent(ctx.agentId);

      return {
        success: true,
        data: {
          nodeTypes: nodeTypes.map((nodeType) => ({
            id: nodeType.id,
            name: nodeType.name,
            description: nodeType.description,
            justification: nodeType.justification,
            propertiesSchema: nodeType.propertiesSchema,
            exampleProperties: nodeType.exampleProperties,
            createdBy: nodeType.createdBy,
          })),
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to list node types",
      };
    }
  },
};

// ============================================================================
// listEdgeTypes Tool
// ============================================================================

const listEdgeTypesTool: Tool = {
  schema: {
    name: "listEdgeTypes",
    description:
      "List all available edge types (agent-specific and global) with descriptions and schemas. Use this before creating new edge types.",
    parameters: [],
  },
  handler: async (_params, context): Promise<ToolResult> => {
    const ctx = context as GraphToolContext;

    try {
      const { getEdgeTypesByAgent } =
        await import("@/lib/db/queries/graph-types");
      const edgeTypes = await getEdgeTypesByAgent(ctx.agentId);

      return {
        success: true,
        data: {
          edgeTypes: edgeTypes.map((edgeType) => ({
            id: edgeType.id,
            name: edgeType.name,
            description: edgeType.description,
            justification: edgeType.justification,
            propertiesSchema: edgeType.propertiesSchema,
            exampleProperties: edgeType.exampleProperties,
            createdBy: edgeType.createdBy,
          })),
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to list edge types",
      };
    }
  },
};

// ============================================================================
// createNodeType Tool
// ============================================================================

const createNodeTypeTool: Tool = {
  schema: {
    name: "createNodeType",
    description:
      "Create a new node type when you discover knowledge that does not fit existing types. Use sparingly - prefer existing types.",
    parameters: [
      {
        name: "name",
        type: "string",
        description:
          'Capitalized node type name (spaces allowed), e.g., "Regulation", "Market Event"',
        required: true,
      },
      {
        name: "description",
        type: "string",
        description: "Clear explanation of what this type represents",
        required: true,
      },
      {
        name: "propertiesSchema",
        type: "object",
        description: "JSON Schema defining allowed properties",
        required: true,
      },
      {
        name: "exampleProperties",
        type: "object",
        description: "Example property values for few-shot learning",
        required: true,
      },
      {
        name: "justification",
        type: "string",
        description: "Why existing types are insufficient",
        required: true,
      },
    ],
  },
  handler: async (params, context): Promise<ToolResult> => {
    const parsed = CreateNodeTypeParamsSchema.safeParse(params);
    if (!parsed.success) {
      return {
        success: false,
        error: `Invalid parameters: ${parsed.error.message}`,
      };
    }

    const {
      name,
      description,
      propertiesSchema,
      exampleProperties,
      justification,
    } = parsed.data;
    const ctx = context as GraphToolContext;

    // Validate node type naming: must start with capital letter; spaces are allowed.
    if (!isCapitalizedTypeName(name)) {
      return {
        success: false,
        error: `Node type name must start with a capital letter and may contain spaces (e.g., "Regulation", "Market Event"). Got: "${name}"`,
      };
    }

    try {
      const { nodeTypeExists, createNodeType } =
        await import("@/lib/db/queries/graph-types");

      // Check if type already exists
      if (await nodeTypeExists(ctx.agentId, name)) {
        return {
          success: false,
          error: `Node type "${name}" already exists.`,
        };
      }

      // Create the node type
      const nodeType = await createNodeType({
        agentId: ctx.agentId,
        name,
        description,
        justification,
        propertiesSchema,
        exampleProperties,
        createdBy: "agent",
      });

      return {
        success: true,
        data: {
          nodeTypeId: nodeType.id,
          name: nodeType.name,
          justification,
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to create node type",
      };
    }
  },
};

// ============================================================================
// createEdgeType Tool
// ============================================================================

const createEdgeTypeTool: Tool = {
  schema: {
    name: "createEdgeType",
    description:
      "Create a new edge (relationship) type when you need to express a relationship not covered by existing types.",
    parameters: [
      {
        name: "name",
        type: "string",
        description:
          'snake_case name for the relationship (e.g., "regulates", "competes_with")',
        required: true,
      },
      {
        name: "description",
        type: "string",
        description: "Clear explanation of what this relationship represents",
        required: true,
      },
      {
        name: "propertiesSchema",
        type: "object",
        description: "Optional JSON Schema for edge properties",
        required: false,
      },
      {
        name: "exampleProperties",
        type: "object",
        description: "Example property values",
        required: false,
      },
      {
        name: "justification",
        type: "string",
        description: "Why existing edge types are insufficient",
        required: true,
      },
    ],
  },
  handler: async (params, context): Promise<ToolResult> => {
    const parsed = CreateEdgeTypeParamsSchema.safeParse(params);
    if (!parsed.success) {
      return {
        success: false,
        error: `Invalid parameters: ${parsed.error.message}`,
      };
    }

    const {
      name,
      description,
      propertiesSchema,
      exampleProperties,
      justification,
    } = parsed.data;
    const ctx = context as GraphToolContext;

    // Validate snake_case naming
    if (!isSnakeCase(name)) {
      return {
        success: false,
        error: `Edge type name must be snake_case (e.g., "regulates", "competes_with"). Got: "${name}"`,
      };
    }

    try {
      const { edgeTypeExists, createEdgeType } =
        await import("@/lib/db/queries/graph-types");

      // Check if type already exists
      if (await edgeTypeExists(ctx.agentId, name)) {
        return {
          success: false,
          error: `Edge type "${name}" already exists.`,
        };
      }

      // Create the edge type
      const edgeType = await createEdgeType({
        agentId: ctx.agentId,
        name,
        description,
        justification,
        propertiesSchema,
        exampleProperties,
        createdBy: "agent",
      });

      return {
        success: true,
        data: {
          edgeTypeId: edgeType.id,
          name: edgeType.name,
          justification,
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to create edge type",
      };
    }
  },
};

// ============================================================================
// addAgentAnalysisNode Tool
// ============================================================================

export const AddAgentAnalysisNodeParamsSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      'Name for the analysis node (e.g., "Services Revenue Growth Pattern")',
    ),
  properties: z.object({
    type: z
      .enum(["observation", "pattern"])
      .describe(
        "observation=notable trend or development, pattern=recurring behavior or relationship",
      ),
    summary: z
      .string()
      .min(1)
      .describe("Brief 1-2 sentence summary of the analysis"),
    content: z
      .string()
      .min(1)
      .describe("Detailed analysis with [node:uuid] or [edge:uuid] citations"),
    confidence: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Confidence level (0=low, 1=high)"),
    generated_at: z
      .string()
      .describe("When this analysis was derived (ISO datetime)"),
  }),
});

export type AddAgentAnalysisNodeParams = z.infer<
  typeof AddAgentAnalysisNodeParamsSchema
>;

const addAgentAnalysisNodeTool: Tool = {
  schema: {
    name: "addAgentAnalysisNode",
    description:
      "Create an AgentAnalysis node for observations or patterns. Citations in content must use [node:uuid] or [edge:uuid] with existing graph IDs. This does NOT notify users - it is for internal analysis only.",
    parameters: [
      {
        name: "name",
        type: "string",
        description: "Descriptive name for the analysis",
        required: true,
      },
      {
        name: "properties",
        type: "object",
        description:
          "Properties: type (observation|pattern), summary (1-2 sentences), content (detailed analysis with [node:uuid] citations), confidence (0-1, optional), generated_at (ISO datetime)",
        required: true,
      },
    ],
  },
  handler: async (params, context): Promise<ToolResult> => {
    const parsed = AddAgentAnalysisNodeParamsSchema.safeParse(params);
    if (!parsed.success) {
      return {
        success: false,
        error: `Invalid parameters: ${parsed.error.message}`,
      };
    }

    const { name, properties } = parsed.data;
    const ctx = context as GraphToolContext;

    try {
      const { createNode } = await import("@/lib/db/queries/graph-data");
      const { nodeTypeExists } = await import("@/lib/db/queries/graph-types");

      // Validate AgentAnalysis type exists
      if (!(await nodeTypeExists(ctx.agentId, "AgentAnalysis"))) {
        return {
          success: false,
          error:
            "AgentAnalysis node type does not exist. This should have been created during agent initialization.",
        };
      }

      const citationValidation = await validateAgentAnalysisCitations(
        ctx.agentId,
        properties.content,
      );
      if (!citationValidation.isValid) {
        return {
          success: false,
          error: citationValidation.error,
        };
      }

      // Create the AgentAnalysis node in the graph
      // NO inbox item creation - AgentAnalysis nodes are internal analysis
      // NO conversation message - these don't notify users
      const node = await createNode({
        agentId: ctx.agentId,
        type: "AgentAnalysis",
        name,
        properties,
      });

      return {
        success: true,
        data: {
          nodeId: node.id,
          message: `Created AgentAnalysis "${name}"`,
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to add AgentAnalysis node",
      };
    }
  },
};

// ============================================================================
// addAgentAdviceNode Tool
// ============================================================================

export const AddAgentAdviceNodeParamsSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe('Name for the advice node (e.g., "AAPL Buy Recommendation")'),
  properties: z.object({
    action: z.enum(["BUY", "SELL", "HOLD"]).describe("The recommended action"),
    summary: z
      .string()
      .min(1)
      .describe("Executive summary of the recommendation (1-2 sentences)"),
    content: z
      .string()
      .min(1)
      .describe(
        "Detailed reasoning citing ONLY AgentAnalysis nodes via [node:uuid] format",
      ),
    confidence: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Confidence level (0=low, 1=high)"),
    generated_at: z
      .string()
      .describe("When this advice was generated (ISO datetime)"),
  }),
});

export type AddAgentAdviceNodeParams = z.infer<
  typeof AddAgentAdviceNodeParamsSchema
>;

const addAgentAdviceNodeTool: Tool = {
  schema: {
    name: "addAgentAdviceNode",
    description:
      "Create an AgentAdvice node with an actionable recommendation. This WILL notify the user via inbox and append to conversation.",
    parameters: [
      {
        name: "name",
        type: "string",
        description: 'Descriptive name (e.g., "AAPL Buy Recommendation")',
        required: true,
      },
      {
        name: "properties",
        type: "object",
        description:
          "Properties: action (BUY|SELL|HOLD), summary (1-2 sentence executive summary), content (detailed reasoning citing AgentAnalysis nodes via [node:uuid]), confidence (0-1, optional), generated_at (ISO datetime)",
        required: true,
      },
    ],
  },
  handler: async (params, context): Promise<ToolResult> => {
    const parsed = AddAgentAdviceNodeParamsSchema.safeParse(params);
    if (!parsed.success) {
      return {
        success: false,
        error: `Invalid parameters: ${parsed.error.message}`,
      };
    }

    const { name, properties } = parsed.data;
    const ctx = context as GraphToolContext;

    try {
      const { createNode } = await import("@/lib/db/queries/graph-data");
      const { nodeTypeExists } = await import("@/lib/db/queries/graph-types");
      const { getAgentById } = await import("@/lib/db/queries/agents");
      const { createInboxItem } = await import("@/lib/db/queries/inboxItems");
      const { getOrCreateConversation } =
        await import("@/lib/db/queries/conversations");
      const { appendLLMMessage } = await import("@/lib/db/queries/messages");

      // Validate AgentAdvice type exists
      if (!(await nodeTypeExists(ctx.agentId, "AgentAdvice"))) {
        return {
          success: false,
          error:
            "AgentAdvice node type does not exist. This should have been created during agent initialization.",
        };
      }

      // Get the agent to find the userId
      const agent = await getAgentById(ctx.agentId);
      if (!agent) {
        return {
          success: false,
          error: `Agent not found: ${ctx.agentId}`,
        };
      }

      // 1. Create the AgentAdvice node in the graph
      const node = await createNode({
        agentId: ctx.agentId,
        type: "AgentAdvice",
        name,
        properties,
      });

      // 2. Create inbox item to notify the user
      const inboxItem = await createInboxItem({
        userId: agent.userId,
        agentId: ctx.agentId,
        title: `${properties.action}: ${name}`,
        content: properties.summary,
      });

      // 3. Append advice as a message to the agent's conversation
      const conversation = await getOrCreateConversation(ctx.agentId);

      const confidenceText =
        properties.confidence !== undefined
          ? ` (confidence: ${Math.round(properties.confidence * 100)}%)`
          : "";

      const conversationMessage =
        `**New Advice: ${name}**\n\n` +
        `**Action:** ${properties.action}${confidenceText}\n\n` +
        `${properties.summary}\n\n---\n\n${properties.content}`;

      await appendLLMMessage(conversation.id, { text: conversationMessage });

      return {
        success: true,
        data: {
          nodeId: node.id,
          inboxItemId: inboxItem.id,
          message: `Created AgentAdvice "${name}" and notified user`,
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to add AgentAdvice node",
      };
    }
  },
};

// ============================================================================
// Registration
// ============================================================================

/**
 * Register all graph tools
 */
export function registerGraphTools(): void {
  registerTool(addGraphNodeTool);
  registerTool(addGraphEdgeTool);
  registerTool(queryGraphTool);
  registerTool(getGraphSummaryTool);
  registerTool(listNodeTypesTool);
  registerTool(listEdgeTypesTool);
  registerTool(createNodeTypeTool);
  registerTool(createEdgeTypeTool);
  registerTool(addAgentAnalysisNodeTool);
  registerTool(addAgentAdviceNodeTool);
}

/**
 * Get all graph tool names for filtering
 */
export function getGraphToolNames(): string[] {
  return [
    "addGraphNode",
    "addGraphEdge",
    "queryGraph",
    "getGraphSummary",
    "listNodeTypes",
    "listEdgeTypes",
    "createNodeType",
    "createEdgeType",
    "addAgentAnalysisNode",
    "addAgentAdviceNode",
  ];
}

// Export individual tools for testing
export {
  addGraphNodeTool,
  addGraphEdgeTool,
  queryGraphTool,
  getGraphSummaryTool,
  listNodeTypesTool,
  listEdgeTypesTool,
  createNodeTypeTool,
  createEdgeTypeTool,
  addAgentAnalysisNodeTool,
  addAgentAdviceNodeTool,
};
