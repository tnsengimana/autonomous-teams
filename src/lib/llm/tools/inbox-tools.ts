/**
 * Inbox Tools
 *
 * Tools for agents to communicate with users via the inbox:
 * - Request user input/feedback
 */

import {
  registerTool,
  type Tool,
  type ToolResult,
  type ToolContext,
} from "./index";
import { z } from "zod";
import { getAgentById } from "@/lib/db/queries/agents";
import { createInboxItem } from "@/lib/db/queries/inboxItems";
import { getOrCreateConversation } from "@/lib/db/queries/conversations";
import { appendLLMMessage } from "@/lib/db/queries/messages";

// ============================================================================
// Zod Schemas for Inbox Tool Parameters
// ============================================================================

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

export type RequestUserInputParams = z.infer<
  typeof RequestUserInputParamsSchema
>;

// ============================================================================
// requestUserInput Tool
// ============================================================================

const requestUserInputTool: Tool = {
  schema: {
    name: "requestUserInput",
    description:
      "Request feedback from the user by creating a concise inbox item and appending the full message to the conversation. Use this when you need clarification, want to confirm a decision, or need information only the user can provide.",
    parameters: [
      {
        name: "title",
        type: "string",
        description: "A concise title for the feedback request",
        required: true,
      },
      {
        name: "summary",
        type: "string",
        description:
          "A brief summary for the inbox notification (1-2 sentences)",
        required: true,
      },
      {
        name: "fullMessage",
        type: "string",
        description:
          "The full message content to be added to the conversation",
        required: true,
      },
    ],
  },
  handler: async (
    params: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> => {
    // Validate parameters
    const parseResult = RequestUserInputParamsSchema.safeParse(params);
    if (!parseResult.success) {
      return {
        success: false,
        error: `Invalid parameters: ${parseResult.error.message}`,
      };
    }

    const { title, summary, fullMessage } = parseResult.data;

    // Get the agent to find the userId
    const agent = await getAgentById(context.agentId);
    if (!agent) {
      return {
        success: false,
        error: `Agent not found: ${context.agentId}`,
      };
    }

    // 1. Create the inbox item with summary
    const inboxItem = await createInboxItem({
      userId: agent.userId,
      agentId: context.agentId,
      title,
      content: summary,
    });

    // 2. Append full message to agent's conversation
    const conversation = await getOrCreateConversation(context.agentId);
    await appendLLMMessage(conversation.id, { text: fullMessage });

    return {
      success: true,
      data: {
        inboxItemId: inboxItem.id,
        message: `Requested user feedback and added message to conversation: ${title}`,
      },
    };
  },
};

// ============================================================================
// Tool Registration
// ============================================================================

export function registerInboxTools(): void {
  registerTool(requestUserInputTool);
}
