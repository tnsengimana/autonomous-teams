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
      if (!(await nodeTypeExists(ctx.agentId, type))) {
        return {
          success: false,
          error: `Node type "${type}" does not exist. Use createNodeType first or use an existing type.`,
        };
      }

      // Check for existing node (upsert semantics)
      const existing = await findNodeByTypeAndName(ctx.agentId, type, name);
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
        agentId: ctx.agentId,
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
      if (!(await edgeTypeExists(ctx.agentId, type))) {
        return {
          success: false,
          error: `Edge type "${type}" does not exist.`,
        };
      }

      // Find source and target nodes
      const sourceNode = await findNodeByTypeAndName(ctx.agentId, sourceType, sourceName);
      const targetNode = await findNodeByTypeAndName(ctx.agentId, targetType, targetName);

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
      const existing = await findEdge(ctx.agentId, type, sourceNode.id, targetNode.id);
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
        agentId: ctx.agentId,
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
      const { getNodesByAgent, getEdgesByNode } = await import('@/lib/db/queries/graph-data');

      let nodes = await getNodesByAgent(ctx.agentId, { type: nodeType, limit });

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
      const stats = await getGraphStats(ctx.agentId);

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
      if (await edgeTypeExists(ctx.agentId, name)) {
        return {
          success: false,
          error: `Edge type "${name}" already exists.`,
        };
      }

      // Validate that all source node types exist
      for (const nodeTypeName of sourceNodeTypeNames) {
        if (!(await nodeTypeExists(ctx.agentId, nodeTypeName))) {
          return {
            success: false,
            error: `Source node type "${nodeTypeName}" does not exist.`,
          };
        }
      }

      // Validate that all target node types exist
      for (const nodeTypeName of targetNodeTypeNames) {
        if (!(await nodeTypeExists(ctx.agentId, nodeTypeName))) {
          return {
            success: false,
            error: `Target node type "${nodeTypeName}" does not exist.`,
          };
        }
      }

      // Create the edge type
      const edgeType = await createEdgeType({
        agentId: ctx.agentId,
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
// addAgentAnalysisNode Tool
// ============================================================================

export const AddAgentAnalysisNodeParamsSchema = z.object({
  name: z.string().min(1).describe('Name for the analysis node (e.g., "Services Revenue Growth Pattern")'),
  properties: z.object({
    type: z.enum(['observation', 'pattern']).describe('observation=notable trend or development, pattern=recurring behavior or relationship'),
    summary: z.string().min(1).describe('Brief 1-2 sentence summary of the analysis'),
    content: z.string().min(1).describe('Detailed analysis with [node:uuid] or [edge:uuid] citations'),
    confidence: z.number().min(0).max(1).optional().describe('Confidence level (0=low, 1=high)'),
    generated_at: z.string().describe('When this analysis was derived (ISO datetime)'),
  }),
});

export type AddAgentAnalysisNodeParams = z.infer<typeof AddAgentAnalysisNodeParamsSchema>;

const addAgentAnalysisNodeTool: Tool = {
  schema: {
    name: 'addAgentAnalysisNode',
    description: 'Create an AgentAnalysis node for observations or patterns. This does NOT notify users - it is for internal analysis only.',
    parameters: [
      {
        name: 'name',
        type: 'string',
        description: 'Descriptive name for the analysis',
        required: true,
      },
      {
        name: 'properties',
        type: 'object',
        description: 'Properties: type (observation|pattern), summary (1-2 sentences), content (detailed analysis with [node:uuid] citations), confidence (0-1, optional), generated_at (ISO datetime)',
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
      const { createNode } = await import('@/lib/db/queries/graph-data');
      const { nodeTypeExists } = await import('@/lib/db/queries/graph-types');

      // Validate AgentAnalysis type exists
      if (!(await nodeTypeExists(ctx.agentId, 'AgentAnalysis'))) {
        return {
          success: false,
          error: 'AgentAnalysis node type does not exist. This should have been created during agent initialization.',
        };
      }

      // Create the AgentAnalysis node in the graph
      // NO inbox item creation - AgentAnalysis nodes are internal analysis
      // NO conversation message - these don't notify users
      const node = await createNode({
        agentId: ctx.agentId,
        type: 'AgentAnalysis',
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
        error: error instanceof Error ? error.message : 'Failed to add AgentAnalysis node',
      };
    }
  },
};

// ============================================================================
// addAgentAdviceNode Tool
// ============================================================================

export const AddAgentAdviceNodeParamsSchema = z.object({
  name: z.string().min(1).describe('Name for the advice node (e.g., "AAPL Buy Recommendation")'),
  properties: z.object({
    action: z.enum(['BUY', 'SELL', 'HOLD']).describe('The recommended action'),
    summary: z.string().min(1).describe('Executive summary of the recommendation (1-2 sentences)'),
    content: z.string().min(1).describe('Detailed reasoning citing ONLY AgentAnalysis nodes via [node:uuid] format'),
    confidence: z.number().min(0).max(1).optional().describe('Confidence level (0=low, 1=high)'),
    generated_at: z.string().describe('When this advice was generated (ISO datetime)'),
  }),
});

export type AddAgentAdviceNodeParams = z.infer<typeof AddAgentAdviceNodeParamsSchema>;

const addAgentAdviceNodeTool: Tool = {
  schema: {
    name: 'addAgentAdviceNode',
    description: 'Create an AgentAdvice node with an actionable recommendation. This WILL notify the user via inbox and append to conversation.',
    parameters: [
      {
        name: 'name',
        type: 'string',
        description: 'Descriptive name (e.g., "AAPL Buy Recommendation")',
        required: true,
      },
      {
        name: 'properties',
        type: 'object',
        description: 'Properties: action (BUY|SELL|HOLD), summary (1-2 sentence executive summary), content (detailed reasoning citing AgentAnalysis nodes via [node:uuid]), confidence (0-1, optional), generated_at (ISO datetime)',
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
      const { createNode } = await import('@/lib/db/queries/graph-data');
      const { nodeTypeExists } = await import('@/lib/db/queries/graph-types');
      const { getAgentById } = await import('@/lib/db/queries/agents');
      const { createInboxItem } = await import('@/lib/db/queries/inboxItems');
      const { getOrCreateConversation } = await import('@/lib/db/queries/conversations');
      const { appendLLMMessage } = await import('@/lib/db/queries/messages');

      // Validate AgentAdvice type exists
      if (!(await nodeTypeExists(ctx.agentId, 'AgentAdvice'))) {
        return {
          success: false,
          error: 'AgentAdvice node type does not exist. This should have been created during agent initialization.',
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
        type: 'AgentAdvice',
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

      const confidenceText = properties.confidence !== undefined
        ? ` (confidence: ${Math.round(properties.confidence * 100)}%)`
        : '';

      const conversationMessage = `**New Advice: ${name}**\n\n` +
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
        error: error instanceof Error ? error.message : 'Failed to add AgentAdvice node',
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
  registerTool(addAgentAnalysisNodeTool);
  registerTool(addAgentAdviceNodeTool);
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
    'addAgentAnalysisNode',
    'addAgentAdviceNode',
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
  addAgentAnalysisNodeTool,
  addAgentAdviceNodeTool,
};
