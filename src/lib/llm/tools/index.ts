/**
 * Agent Tools Infrastructure
 *
 * This module provides the tool system for agents, including:
 * - Tool schema definitions (similar to OpenAI function calling)
 * - Tool registry for looking up tools
 * - Tool execution engine
 */

// ============================================================================
// Tool Schema Types
// ============================================================================

export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required?: boolean;
  enum?: string[];
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: ToolParameter[];
}

export interface ToolContext {
  agentId: string;
  conversationId?: string;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export type ToolHandler = (
  params: Record<string, unknown>,
  context: ToolContext,
) => Promise<ToolResult>;

export interface Tool {
  schema: ToolSchema;
  handler: ToolHandler;
}

// ============================================================================
// Tool Registry
// ============================================================================

const toolRegistry = new Map<string, Tool>();

/**
 * Register a tool in the registry
 */
export function registerTool(tool: Tool): void {
  toolRegistry.set(tool.schema.name, tool);
}

/**
 * Get a tool by name
 */
export function getTool(name: string): Tool | undefined {
  return toolRegistry.get(name);
}

/**
 * Get all registered tools
 */
export function getAllTools(): Tool[] {
  return Array.from(toolRegistry.values());
}

// ============================================================================
// Phase-Specific Tool Sets
// ============================================================================

/**
 * Get tools for the Conversation phase (user chat interactions)
 * Tools: queryGraph (for answering questions from knowledge)
 * Note: Memory tools would be added here when implemented
 */
export function getConversationTools(): Tool[] {
  return getAllTools().filter((tool) =>
    [
      "queryGraph",
      // Memory CRUD tools would go here when implemented
    ].includes(tool.schema.name),
  );
}

/**
 * Get tools for the Analysis Generation phase (creating analyses from existing knowledge)
 * Tools: queryGraph, addAgentAnalysisNode, addGraphEdge
 */
export function getAnalysisGenerationTools(): Tool[] {
  return getAllTools().filter((tool) =>
    ["queryGraph", "addAgentAnalysisNode", "addGraphEdge"].includes(
      tool.schema.name,
    ),
  );
}

/**
 * Get tools for the Advice Generation phase (creating actionable recommendations)
 * Tools: queryGraph, addAgentAdviceNode, addGraphEdge
 */
export function getAdviceGenerationTools(): Tool[] {
  return getAllTools().filter((tool) =>
    ["queryGraph", "addAgentAdviceNode", "addGraphEdge"].includes(
      tool.schema.name,
    ),
  );
}

/**
 * Get tools for the Knowledge Acquisition phase (gathering raw information)
 * Tools: tavilySearch, tavilyExtract, tavilyResearch
 */
export function getKnowledgeAcquisitionTools(): Tool[] {
  return getAllTools().filter((tool) =>
    ["tavilySearch", "tavilyExtract"].includes(tool.schema.name),
  );
}

/**
 * Get tools for the Graph Construction phase (structuring acquired knowledge into the graph)
 * Tools: queryGraph, addGraphNode, addGraphEdge, listNodeTypes, listEdgeTypes, createNodeType, createEdgeType
 * Note: Tavily tools are now in the separate Knowledge Acquisition phase
 */
export function getGraphConstructionTools(): Tool[] {
  return getAllTools().filter((tool) =>
    [
      "queryGraph",
      "addGraphNode",
      "addGraphEdge",
      "listNodeTypes",
      "listEdgeTypes",
      "createNodeType",
      "createEdgeType",
    ].includes(tool.schema.name),
  );
}

/**
 * Get tool schemas for LLM function calling
 */
export function getToolSchemas(tools: Tool[]): ToolSchema[] {
  return tools.map((tool) => tool.schema);
}

// ============================================================================
// Tool Execution
// ============================================================================

/**
 * Execute a tool by name
 */
export async function executeTool(
  name: string,
  params: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const tool = getTool(name);

  if (!tool) {
    return {
      success: false,
      error: `Tool not found: ${name}`,
    };
  }

  try {
    return await tool.handler(params, context);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

// ============================================================================
// Tool Format Conversion
// ============================================================================

/**
 * Convert tool schemas to OpenAI function format
 */
export function toolSchemasToOpenAIFunctions(schemas: ToolSchema[]): Array<{
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}> {
  return schemas.map((schema) => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const param of schema.parameters) {
      properties[param.name] = {
        type: param.type,
        description: param.description,
        ...(param.enum ? { enum: param.enum } : {}),
      };
      if (param.required !== false) {
        required.push(param.name);
      }
    }

    return {
      type: "function" as const,
      function: {
        name: schema.name,
        description: schema.description,
        parameters: {
          type: "object",
          properties,
          required,
        },
      },
    };
  });
}
