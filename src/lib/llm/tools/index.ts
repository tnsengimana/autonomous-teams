/**
 * Agent Tools Infrastructure
 *
 * This module provides the tool system for agents, including:
 * - Tool schema definitions (similar to OpenAI function calling)
 * - Tool registry for looking up tools
 * - Tool execution engine
 */

import { z } from "zod";

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
  entityId: string;
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

/**
 * Get tools available during user conversations (foreground)
 * These include graph tools, tavily tools, briefings tools for answering questions
 */
export function getForegroundTools(): Tool[] {
  return getAllTools().filter((tool) =>
    [
      // Graph tools
      "addGraphNode",
      "addGraphEdge",
      "queryGraph",
      "getGraphSummary",
      "createNodeType",
      "createEdgeType",
      // Tavily tools
      "tavilySearch",
      "tavilyExtract",
      "tavilyResearch",
      // Briefings tools for answering user questions
      "listBriefings",
      "getBriefing",
    ].includes(tool.schema.name),
  );
}

/**
 * Get tools available during background work sessions
 * Returns graph tools, tavily tools, and inbox tools for knowledge graph manipulation
 * and user communication
 */
export function getBackgroundTools(): Tool[] {
  return [...getGraphTools(), ...getTavilyTools(), ...getInboxTools()];
}

/**
 * Get Tavily web search tools
 */
export function getTavilyTools(): Tool[] {
  return getAllTools().filter((tool) =>
    ["tavilySearch", "tavilyExtract", "tavilyResearch"].includes(
      tool.schema.name,
    ),
  );
}

/**
 * Get graph manipulation tools (available in background work sessions)
 */
export function getGraphTools(): Tool[] {
  return getAllTools().filter((tool) =>
    [
      "addGraphNode",
      "addGraphEdge",
      "queryGraph",
      "getGraphSummary",
      "createNodeType",
      "createEdgeType",
    ].includes(tool.schema.name),
  );
}

/**
 * Get inbox tools for user communication (available in background work sessions)
 */
export function getInboxTools(): Tool[] {
  return getAllTools().filter((tool) =>
    ["requestUserInput"].includes(tool.schema.name),
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
// Zod Schemas for Tool Parameters
// ============================================================================

export const ListBriefingsParamsSchema = z.object({
  query: z
    .string()
    .min(1)
    .optional()
    .describe("Optional search query for briefing title or summary"),
  limit: z
    .number()
    .min(1)
    .max(50)
    .optional()
    .describe("Maximum number of briefings to return (default: 20)"),
});

export const GetBriefingParamsSchema = z.object({
  briefingId: z.string().uuid().describe("The briefing ID to retrieve"),
});

export type ListBriefingsParams = z.infer<typeof ListBriefingsParamsSchema>;
export type GetBriefingParams = z.infer<typeof GetBriefingParamsSchema>;

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
