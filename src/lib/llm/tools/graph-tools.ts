/**
 * Graph Tools
 *
 * Tools for agents to manipulate the knowledge graph:
 * - Add/update nodes
 * - Add edges
 * - Query the graph
 * - Create new types
 */

import {
  registerTool,
  type Tool,
  type ToolResult,
  type ToolContext,
} from './index';
import { z } from 'zod';

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
  type: z.string().min(1).describe('Node type (must be an existing type, e.g., "Company", "Asset")'),
  name: z.string().min(1).describe('Human-readable identifier for this node'),
  properties: z.record(z.string(), z.unknown()).optional().default({}).describe('Properties for this node (must match type schema, including any temporal fields)'),
});

export const AddGraphEdgeParamsSchema = z.object({
  type: z.string().min(1).describe('Edge type (e.g., "affects", "issued_by")'),
  sourceName: z.string().min(1).describe('Name of the source node'),
  sourceType: z.string().min(1).describe('Type of the source node'),
  targetName: z.string().min(1).describe('Name of the target node'),
  targetType: z.string().min(1).describe('Type of the target node'),
  properties: z.record(z.string(), z.unknown()).optional().describe('Optional properties for this edge'),
});

export const QueryGraphParamsSchema = z.object({
  nodeType: z.string().optional().describe('Filter by node type'),
  searchTerm: z.string().optional().describe('Search in node names'),
  limit: z.number().min(1).max(100).optional().default(20).describe('Maximum nodes to return'),
});

export const CreateNodeTypeParamsSchema = z.object({
  name: z.string().min(1).describe('PascalCase name for the new type (e.g., "Regulation", "Patent")'),
  description: z.string().min(1).describe('Clear explanation of what this type represents'),
  propertiesSchema: z.record(z.string(), z.unknown()).describe('JSON Schema defining allowed properties'),
  exampleProperties: z.record(z.string(), z.unknown()).describe('Example property values for few-shot learning'),
  justification: z.string().min(1).describe('Why existing types are insufficient'),
});

export const CreateEdgeTypeParamsSchema = z.object({
  name: z.string().min(1).describe('snake_case name for the relationship (e.g., "regulates", "competes_with")'),
  description: z.string().min(1).describe('Clear explanation of what this relationship represents'),
  sourceNodeTypeNames: z.array(z.string()).describe('Names of node types allowed as source'),
  targetNodeTypeNames: z.array(z.string()).describe('Names of node types allowed as target'),
  propertiesSchema: z.record(z.string(), z.unknown()).optional().describe('Optional JSON Schema for edge properties'),
  exampleProperties: z.record(z.string(), z.unknown()).optional().describe('Example property values'),
  justification: z.string().min(1).describe('Why existing edge types are insufficient'),
});

export type AddGraphNodeParams = z.infer<typeof AddGraphNodeParamsSchema>;
export type AddGraphEdgeParams = z.infer<typeof AddGraphEdgeParamsSchema>;
export type QueryGraphParams = z.infer<typeof QueryGraphParamsSchema>;
export type CreateNodeTypeParams = z.infer<typeof CreateNodeTypeParamsSchema>;
export type CreateEdgeTypeParams = z.infer<typeof CreateEdgeTypeParamsSchema>;

// ============================================================================
// Naming Convention Validators
// ============================================================================

const PASCAL_CASE_REGEX = /^[A-Z][a-zA-Z]*$/;
const SNAKE_CASE_REGEX = /^[a-z][a-z_]*$/;

function isPascalCase(name: string): boolean {
  return PASCAL_CASE_REGEX.test(name);
}

function isSnakeCase(name: string): boolean {
  return SNAKE_CASE_REGEX.test(name);
}

// ============================================================================
// addGraphNode Tool
// ============================================================================

const addGraphNodeTool: Tool = {
  schema: {
    name: 'addGraphNode',
    description: 'Add a node to the knowledge graph. Use existing node types when possible. Temporal fields (occurred_at, published_at, etc.) should be included in properties per the type schema.',
    parameters: [
      {
        name: 'type',
        type: 'string',
        description: 'Node type (must be an existing type, e.g., "Company", "Asset")',
        required: true,
      },
      {
        name: 'name',
        type: 'string',
        description: 'Human-readable identifier for this node',
        required: true,
      },
      {
        name: 'properties',
        type: 'object',
        description: 'Properties for this node (must match type schema, including any temporal fields)',
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
      const { createNode, findNodeByTypeAndName, updateNodeProperties } = await import('@/lib/db/queries/graph-data');
      const { nodeTypeExists } = await import('@/lib/db/queries/graph-types');

      // Validate type exists
      if (!(await nodeTypeExists(ctx.entityId, type))) {
        return {
          success: false,
          error: `Node type "${type}" does not exist. Use createNodeType first or use an existing type.`,
        };
      }

      // Check for existing node (upsert semantics)
      const existing = await findNodeByTypeAndName(ctx.entityId, type, name);
      if (existing) {
        await updateNodeProperties(existing.id, { ...(existing.properties as object), ...properties });
        return {
          success: true,
          data: {
            nodeId: existing.id,
            action: 'updated',
          },
        };
      }

      // Create new node
      const node = await createNode({
        entityId: ctx.entityId,
        type,
        name,
        properties,
      });

      return {
        success: true,
        data: {
          nodeId: node.id,
          action: 'created',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add graph node',
      };
    }
  },
};

// ============================================================================
// addGraphEdge Tool
// ============================================================================

const addGraphEdgeTool: Tool = {
  schema: {
    name: 'addGraphEdge',
    description: 'Add a relationship (edge) between two nodes in the knowledge graph.',
    parameters: [
      {
        name: 'type',
        type: 'string',
        description: 'Edge type (e.g., "affects", "issued_by")',
        required: true,
      },
      {
        name: 'sourceName',
        type: 'string',
        description: 'Name of the source node',
        required: true,
      },
      {
        name: 'sourceType',
        type: 'string',
        description: 'Type of the source node',
        required: true,
      },
      {
        name: 'targetName',
        type: 'string',
        description: 'Name of the target node',
        required: true,
      },
      {
        name: 'targetType',
        type: 'string',
        description: 'Type of the target node',
        required: true,
      },
      {
        name: 'properties',
        type: 'object',
        description: 'Optional properties for this edge',
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

    const { type, sourceName, sourceType, targetName, targetType, properties } = parsed.data;
    const ctx = context as GraphToolContext;

    try {
      const { findNodeByTypeAndName, createEdge, findEdge } = await import('@/lib/db/queries/graph-data');
      const { edgeTypeExists } = await import('@/lib/db/queries/graph-types');

      // Validate edge type exists
      if (!(await edgeTypeExists(ctx.entityId, type))) {
        return {
          success: false,
          error: `Edge type "${type}" does not exist.`,
        };
      }

      // Find source and target nodes
      const sourceNode = await findNodeByTypeAndName(ctx.entityId, sourceType, sourceName);
      const targetNode = await findNodeByTypeAndName(ctx.entityId, targetType, targetName);

      if (!sourceNode) {
        return {
          success: false,
          error: `Source node "${sourceName}" of type "${sourceType}" not found. Create it first.`,
        };
      }
      if (!targetNode) {
        return {
          success: false,
          error: `Target node "${targetName}" of type "${targetType}" not found. Create it first.`,
        };
      }

      // Check for existing edge (avoid duplicates)
      const existing = await findEdge(ctx.entityId, type, sourceNode.id, targetNode.id);
      if (existing) {
        return {
          success: true,
          data: {
            edgeId: existing.id,
            action: 'already_exists',
          },
        };
      }

      // Create edge
      const edge = await createEdge({
        entityId: ctx.entityId,
        type,
        sourceId: sourceNode.id,
        targetId: targetNode.id,
        properties: properties || {},
      });

      return {
        success: true,
        data: {
          edgeId: edge.id,
          action: 'created',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add graph edge',
      };
    }
  },
};

// ============================================================================
// queryGraph Tool
// ============================================================================

const queryGraphTool: Tool = {
  schema: {
    name: 'queryGraph',
    description: 'Query the knowledge graph to find relevant information. Returns nodes and their relationships.',
    parameters: [
      {
        name: 'nodeType',
        type: 'string',
        description: 'Filter by node type',
        required: false,
      },
      {
        name: 'searchTerm',
        type: 'string',
        description: 'Search in node names',
        required: false,
      },
      {
        name: 'limit',
        type: 'number',
        description: 'Maximum nodes to return (default 20)',
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
      const { getNodesByEntity, getEdgesByNode } = await import('@/lib/db/queries/graph-data');

      let nodes = await getNodesByEntity(ctx.entityId, { type: nodeType, limit });

      // Filter by search term if provided
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        nodes = nodes.filter(n => n.name.toLowerCase().includes(term));
      }

      // Get edges for these nodes
      const edgePromises = nodes.map(n => getEdgesByNode(n.id, 'both'));
      const edgeResults = await Promise.all(edgePromises);
      const allEdges = edgeResults.flat();

      // Deduplicate edges by id
      const edgeMap = new Map(allEdges.map(e => [e.id, e]));
      const edges = Array.from(edgeMap.values());

      return {
        success: true,
        data: {
          nodes: nodes.map(n => ({
            id: n.id,
            type: n.type,
            name: n.name,
            properties: n.properties,
          })),
          edges: edges.map(e => ({
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
        error: error instanceof Error ? error.message : 'Failed to query graph',
      };
    }
  },
};

// ============================================================================
// getGraphSummary Tool
// ============================================================================

const getGraphSummaryTool: Tool = {
  schema: {
    name: 'getGraphSummary',
    description: 'Get a summary of the current knowledge graph state (node counts, edge counts by type).',
    parameters: [],
  },
  handler: async (_params, context): Promise<ToolResult> => {
    const ctx = context as GraphToolContext;

    try {
      const { getGraphStats } = await import('@/lib/db/queries/graph-data');
      const stats = await getGraphStats(ctx.entityId);

      return {
        success: true,
        data: stats,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get graph summary',
      };
    }
  },
};

// ============================================================================
// createNodeType Tool
// ============================================================================

const createNodeTypeTool: Tool = {
  schema: {
    name: 'createNodeType',
    description: 'Create a new node type when you discover knowledge that does not fit existing types. Use sparingly - prefer existing types.',
    parameters: [
      {
        name: 'name',
        type: 'string',
        description: 'PascalCase name for the new type (e.g., "Regulation", "Patent")',
        required: true,
      },
      {
        name: 'description',
        type: 'string',
        description: 'Clear explanation of what this type represents',
        required: true,
      },
      {
        name: 'propertiesSchema',
        type: 'object',
        description: 'JSON Schema defining allowed properties',
        required: true,
      },
      {
        name: 'exampleProperties',
        type: 'object',
        description: 'Example property values for few-shot learning',
        required: true,
      },
      {
        name: 'justification',
        type: 'string',
        description: 'Why existing types are insufficient',
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

    const { name, description, propertiesSchema, exampleProperties, justification } = parsed.data;
    const ctx = context as GraphToolContext;

    // Validate PascalCase naming
    if (!isPascalCase(name)) {
      return {
        success: false,
        error: `Node type name must be PascalCase (e.g., "Regulation", "Patent"). Got: "${name}"`,
      };
    }

    try {
      const { nodeTypeExists, createNodeType } = await import('@/lib/db/queries/graph-types');

      // Check if type already exists
      if (await nodeTypeExists(ctx.entityId, name)) {
        return {
          success: false,
          error: `Node type "${name}" already exists.`,
        };
      }

      // Create the node type
      const nodeType = await createNodeType({
        entityId: ctx.entityId,
        name,
        description,
        propertiesSchema,
        exampleProperties,
        createdBy: 'agent',
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
        error: error instanceof Error ? error.message : 'Failed to create node type',
      };
    }
  },
};

// ============================================================================
// createEdgeType Tool
// ============================================================================

const createEdgeTypeTool: Tool = {
  schema: {
    name: 'createEdgeType',
    description: 'Create a new edge (relationship) type when you need to express a relationship not covered by existing types.',
    parameters: [
      {
        name: 'name',
        type: 'string',
        description: 'snake_case name for the relationship (e.g., "regulates", "competes_with")',
        required: true,
      },
      {
        name: 'description',
        type: 'string',
        description: 'Clear explanation of what this relationship represents',
        required: true,
      },
      {
        name: 'sourceNodeTypeNames',
        type: 'array',
        description: 'Names of node types allowed as source',
        required: true,
      },
      {
        name: 'targetNodeTypeNames',
        type: 'array',
        description: 'Names of node types allowed as target',
        required: true,
      },
      {
        name: 'propertiesSchema',
        type: 'object',
        description: 'Optional JSON Schema for edge properties',
        required: false,
      },
      {
        name: 'exampleProperties',
        type: 'object',
        description: 'Example property values',
        required: false,
      },
      {
        name: 'justification',
        type: 'string',
        description: 'Why existing edge types are insufficient',
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

    const { name, description, sourceNodeTypeNames, targetNodeTypeNames, propertiesSchema, exampleProperties, justification } = parsed.data;
    const ctx = context as GraphToolContext;

    // Validate snake_case naming
    if (!isSnakeCase(name)) {
      return {
        success: false,
        error: `Edge type name must be snake_case (e.g., "regulates", "competes_with"). Got: "${name}"`,
      };
    }

    try {
      const { edgeTypeExists, createEdgeType, nodeTypeExists } = await import('@/lib/db/queries/graph-types');

      // Check if type already exists
      if (await edgeTypeExists(ctx.entityId, name)) {
        return {
          success: false,
          error: `Edge type "${name}" already exists.`,
        };
      }

      // Validate that all source node types exist
      for (const nodeTypeName of sourceNodeTypeNames) {
        if (!(await nodeTypeExists(ctx.entityId, nodeTypeName))) {
          return {
            success: false,
            error: `Source node type "${nodeTypeName}" does not exist.`,
          };
        }
      }

      // Validate that all target node types exist
      for (const nodeTypeName of targetNodeTypeNames) {
        if (!(await nodeTypeExists(ctx.entityId, nodeTypeName))) {
          return {
            success: false,
            error: `Target node type "${nodeTypeName}" does not exist.`,
          };
        }
      }

      // Create the edge type
      const edgeType = await createEdgeType({
        entityId: ctx.entityId,
        name,
        description,
        sourceNodeTypeNames,
        targetNodeTypeNames,
        propertiesSchema,
        exampleProperties,
        createdBy: 'agent',
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
        error: error instanceof Error ? error.message : 'Failed to create edge type',
      };
    }
  },
};

// ============================================================================
// addInsightNode Tool
// ============================================================================

export const AddInsightNodeParamsSchema = z.object({
  name: z.string().min(1).describe('Name for the insight node (e.g., "AAPL Buy Signal")'),
  properties: z.object({
    type: z.enum(['signal', 'observation', 'pattern']).describe('signal=actionable, observation=notable trend, pattern=recurring behavior'),
    summary: z.string().min(1).describe('The explanation/reasoning for this insight'),
    action: z.enum(['buy', 'sell', 'hold']).optional().describe('Recommended action (only for signals)'),
    strength: z.number().min(0).max(1).optional().describe('Confidence level (0=low, 1=high)'),
    generated_at: z.string().describe('When this insight was derived (ISO datetime)'),
  }),
});

export type AddInsightNodeParams = z.infer<typeof AddInsightNodeParamsSchema>;

const addInsightNodeTool: Tool = {
  schema: {
    name: 'addInsightNode',
    description: 'Create an Insight node in the knowledge graph. This also creates an inbox notification and appends the insight to the conversation for user discussion. Use this for derived analysis including signals, observations, and patterns.',
    parameters: [
      {
        name: 'name',
        type: 'string',
        description: 'Name for the insight node (e.g., "AAPL Buy Signal")',
        required: true,
      },
      {
        name: 'properties',
        type: 'object',
        description: 'Properties for the insight: type (signal|observation|pattern), summary (string), action (buy|sell|hold, optional), strength (0-1, optional), generated_at (ISO datetime)',
        required: true,
      },
    ],
  },
  handler: async (params, context): Promise<ToolResult> => {
    const parsed = AddInsightNodeParamsSchema.safeParse(params);
    if (!parsed.success) {
      return {
        success: false,
        error: `Invalid parameters: ${parsed.error.message}`,
      };
    }

    const { name, properties } = parsed.data;
    const ctx = context as GraphToolContext;

    try {
      const { createNode } = await import('@/lib/db/queries/graph-data');
      const { nodeTypeExists } = await import('@/lib/db/queries/graph-types');
      const { getEntityById } = await import('@/lib/db/queries/entities');
      const { createInboxItem } = await import('@/lib/db/queries/inboxItems');
      const { getOrCreateConversation } = await import('@/lib/db/queries/conversations');
      const { appendLLMMessage } = await import('@/lib/db/queries/messages');

      // Validate Insight type exists
      if (!(await nodeTypeExists(ctx.entityId, 'Insight'))) {
        return {
          success: false,
          error: 'Insight node type does not exist. This should have been created during entity initialization.',
        };
      }

      // Get the entity to find the userId
      const entity = await getEntityById(ctx.entityId);
      if (!entity) {
        return {
          success: false,
          error: `Entity not found: ${ctx.entityId}`,
        };
      }

      // 1. Create the Insight node in the graph
      const node = await createNode({
        entityId: ctx.entityId,
        type: 'Insight',
        name,
        properties,
      });

      // 2. Create inbox item to notify the user
      const insightTypeLabel = properties.type === 'signal'
        ? (properties.action ? `${properties.action.toUpperCase()} Signal` : 'Signal')
        : properties.type.charAt(0).toUpperCase() + properties.type.slice(1);

      const inboxItem = await createInboxItem({
        userId: entity.userId,
        entityId: ctx.entityId,
        type: 'insight',
        title: `${insightTypeLabel}: ${name}`,
        content: properties.summary,
      });

      // 3. Append insight as a message to the entity's conversation
      const conversation = await getOrCreateConversation(ctx.entityId);

      // Format the insight message for conversation
      const strengthText = properties.strength !== undefined
        ? ` (confidence: ${Math.round(properties.strength * 100)}%)`
        : '';
      const actionText = properties.action
        ? `\n\n**Recommended Action:** ${properties.action.toUpperCase()}`
        : '';

      const conversationMessage = `**New Insight: ${name}**\n\n` +
        `**Type:** ${insightTypeLabel}${strengthText}\n\n` +
        `${properties.summary}${actionText}`;

      await appendLLMMessage(conversation.id, { text: conversationMessage });

      return {
        success: true,
        data: {
          nodeId: node.id,
          inboxItemId: inboxItem.id,
          message: `Created insight "${name}" and notified user`,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add insight node',
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
  registerTool(createNodeTypeTool);
  registerTool(createEdgeTypeTool);
  registerTool(addInsightNodeTool);
}

/**
 * Get all graph tool names for filtering
 */
export function getGraphToolNames(): string[] {
  return [
    'addGraphNode',
    'addGraphEdge',
    'queryGraph',
    'getGraphSummary',
    'createNodeType',
    'createEdgeType',
    'addInsightNode',
  ];
}

// Export individual tools for testing
export {
  addGraphNodeTool,
  addGraphEdgeTool,
  queryGraphTool,
  getGraphSummaryTool,
  createNodeTypeTool,
  createEdgeTypeTool,
  addInsightNodeTool,
};
