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
  agentId: string;
  teamId: string | null;
  aideId: string | null;
  isLead: boolean;
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
 * Get tools available for leads
 */
export function getLeadTools(): Tool[] {
  return getAllTools().filter((tool) =>
    [
      "delegateToAgent",
      "getTeamStatus",
      "createBriefing",
      "requestUserInput",
      "tavilySearch",
      "tavilyExtract",
      "tavilyResearch",
    ].includes(tool.schema.name),
  );
}

/**
 * Get knowledge item management tools (available in user conversations)
 */
export function getKnowledgeItemTools(): Tool[] {
  return getAllTools().filter((tool) =>
    ["addKnowledgeItem", "listKnowledgeItems", "removeKnowledgeItem"].includes(
      tool.schema.name,
    ),
  );
}

/**
 * Get tools available during user conversations (foreground)
 * These help agents manage knowledge shared by users
 */
export function getForegroundTools(): Tool[] {
  // All tools except background coordination tools
  const backgroundOnlyTools = [
    "delegateToAgent",
    "createBriefing",
    "requestUserInput",
    "reportToLead",
    "requestLeadInput",
  ];

  return getAllTools().filter(
    (tool) => !backgroundOnlyTools.includes(tool.schema.name),
  );
}

/**
 * Get tools available during background work sessions (background conversations)
 * Leads get full tools, subordinates get limited set
 */
export function getBackgroundTools(isLead: boolean): Tool[] {
  if (isLead) {
    return [...getLeadTools(), ...getKnowledgeItemTools()];
  }
  return [...getSubordinateTools(), ...getKnowledgeItemTools()];
}

/**
 * Get tools available for subordinates
 */
export function getSubordinateTools(): Tool[] {
  return getAllTools().filter((tool) =>
    ["reportToLead", "requestLeadInput"].includes(tool.schema.name),
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

export const DelegateToAgentParamsSchema = z.object({
  agentId: z
    .string()
    .uuid()
    .describe("The subordinate agent ID to delegate to"),
  task: z.string().min(1).describe("The task description"),
});

export const RequestUserInputParamsSchema = z.object({
  title: z.string().min(1).describe("A concise title for the feedback request"),
  summary: z
    .string()
    .min(1)
    .describe("A brief summary for the inbox notification (1-2 sentences)"),
  fullMessage: z
    .string()
    .min(1)
    .describe("The full message content to be added to the conversation"),
});

export const CreateBriefingParamsSchema = z.object({
  title: z.string().min(1).describe("The title of the briefing"),
  summary: z
    .string()
    .min(1)
    .describe("A brief summary for the inbox notification (1-2 sentences)"),
  fullMessage: z
    .string()
    .min(1)
    .describe("The full briefing content for the user"),
});

export const ReportToLeadParamsSchema = z.object({
  result: z.string().min(1).describe("The result of the task"),
  status: z.enum(["success"]).describe("Whether the task succeeded"),
});

export const RequestLeadInputParamsSchema = z.object({
  question: z.string().min(1).describe("The question to ask the lead"),
});

export type DelegateToAgentParams = z.infer<typeof DelegateToAgentParamsSchema>;
export type CreateBriefingParams = z.infer<typeof CreateBriefingParamsSchema>;
export type RequestUserInputParams = z.infer<
  typeof RequestUserInputParamsSchema
>;
export type ReportToLeadParams = z.infer<typeof ReportToLeadParamsSchema>;
export type RequestLeadInputParams = z.infer<
  typeof RequestLeadInputParamsSchema
>;

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
