/**
 * Lead Tools
 *
 * Tools available to lead agents for delegation and coordination.
 */

import {
  registerTool,
  type Tool,
  type ToolResult,
  type ToolContext,
  DelegateToAgentParamsSchema,
  CreateBriefingParamsSchema,
  RequestUserInputParamsSchema,
} from './index';
import { createAgentTask } from '@/lib/db/queries/agentTasks';
import { getChildAgents } from '@/lib/db/queries/agents';
import { getTeamUserId } from '@/lib/db/queries/teams';
import { getAideUserId } from '@/lib/db/queries/aides';
import { getOrCreateConversation } from '@/lib/db/queries/conversations';
import { appendMessage } from '@/lib/db/queries/messages';
import { db } from '@/lib/db/client';
import { briefings, inboxItems } from '@/lib/db/schema';

/**
 * Helper to get owner info from context
 */
function getOwnerInfo(context: ToolContext): { teamId: string } | { aideId: string } {
  if (context.teamId) return { teamId: context.teamId };
  if (context.aideId) return { aideId: context.aideId };
  throw new Error('Tool context has no team or aide');
}

/**
 * Helper to get user ID from context's owner
 */
async function getOwnerUserId(context: ToolContext): Promise<string | null> {
  if (context.teamId) {
    return getTeamUserId(context.teamId);
  }
  if (context.aideId) {
    return getAideUserId(context.aideId);
  }
  return null;
}

// ============================================================================
// delegateToAgent
// ============================================================================

const delegateToAgentTool: Tool = {
  schema: {
    name: 'delegateToAgent',
    description:
      'Assign a task to a subordinate agent on your team. The subordinate will execute the task and report back.',
    parameters: [
      {
        name: 'agentId',
        type: 'string',
        description: 'The UUID of the subordinate agent to delegate the task to',
        required: true,
      },
      {
        name: 'task',
        type: 'string',
        description:
          'A clear description of the task for the subordinate to complete',
        required: true,
      },
    ],
  },
  handler: async (params, context): Promise<ToolResult> => {
    // Validate params
    const parsed = DelegateToAgentParamsSchema.safeParse(params);
    if (!parsed.success) {
      return {
        success: false,
        error: `Invalid parameters: ${parsed.error.message}`,
      };
    }

    const { agentId, task } = parsed.data;

    // Verify the agent is a lead
    if (!context.isLead) {
      return {
        success: false,
        error: 'Only leads can delegate tasks',
      };
    }

    // Verify the target agent is a child of this lead
    const childAgents = await getChildAgents(context.agentId);
    const isChild = childAgents.some((child) => child.id === agentId);

    if (!isChild) {
      return {
        success: false,
        error: 'Can only delegate to agents on your team',
      };
    }

    // Create the task with appropriate owner
    const agentTask = await createAgentTask({
      ...getOwnerInfo(context),
      assignedToId: agentId,
      assignedById: context.agentId,
      task,
    });

    return {
      success: true,
      data: {
        taskId: agentTask.id,
        message: `Task delegated successfully to agent ${agentId}`,
      },
    };
  },
};

// ============================================================================
// getTeamStatus
// ============================================================================

const getTeamStatusTool: Tool = {
  schema: {
    name: 'getTeamStatus',
    description:
      'Get the current status of all subordinate agents in your team, including their active tasks.',
    parameters: [],
  },
  handler: async (_params, context): Promise<ToolResult> => {
    // Verify the agent is a lead
    if (!context.isLead) {
      return {
        success: false,
        error: 'Only leads can check team status',
      };
    }

    // Get all child agents
    const childAgents = await getChildAgents(context.agentId);

    // Get task counts for each agent
    const agentStatuses = await Promise.all(
      childAgents.map(async (agent) => {
        const { getPendingTasksForAgent } = await import(
          '@/lib/db/queries/agentTasks'
        );
        const tasks = await getPendingTasksForAgent(agent.id);

        return {
          agentId: agent.id,
          name: agent.name,
          type: agent.type,
          status: agent.status,
          pendingTasks: tasks.filter((t) => t.status === 'pending').length,
          inProgressTasks: 0,
        };
      })
    );

    return {
      success: true,
      data: {
        // Include whichever owner type exists
        ...(context.teamId ? { teamId: context.teamId } : {}),
        ...(context.aideId ? { aideId: context.aideId } : {}),
        agents: agentStatuses,
        summary: {
          totalAgents: agentStatuses.length,
          idleAgents: agentStatuses.filter((a) => a.status === 'idle').length,
          runningAgents: agentStatuses.filter((a) => a.status === 'running')
            .length,
        },
      },
    };
  },
};

// ============================================================================
// createBriefing
// ============================================================================

const createBriefingTool: Tool = {
  schema: {
    name: 'createBriefing',
    description:
      "Create a briefing for the user and push a notification to the inbox. Use only when the update is material and user-facing.",
    parameters: [
      {
        name: 'title',
        type: 'string',
        description: 'A concise, specific title for the briefing',
        required: true,
      },
      {
        name: 'summary',
        type: 'string',
        description:
          'A brief summary for the inbox notification (1-2 sentences)',
        required: true,
      },
      {
        name: 'fullMessage',
        type: 'string',
        description: 'The full briefing content for the user',
        required: true,
      },
    ],
  },
  handler: async (params, context): Promise<ToolResult> => {
    const parsed = CreateBriefingParamsSchema.safeParse(params);
    if (!parsed.success) {
      return {
        success: false,
        error: `Invalid parameters: ${parsed.error.message}`,
      };
    }

    const { title, summary, fullMessage } = parsed.data;

    if (!context.isLead) {
      return {
        success: false,
        error: 'Only leads can create briefings',
      };
    }

    const userId = await getOwnerUserId(context);
    if (!userId) {
      return {
        success: false,
        error: 'Could not find user for this team/aide',
      };
    }

    const ownerInfo = getOwnerInfo(context);

    const result = await db.transaction(async (tx) => {
      const [briefing] = await tx
        .insert(briefings)
        .values({
          userId,
          teamId: 'teamId' in ownerInfo ? ownerInfo.teamId : null,
          aideId: 'aideId' in ownerInfo ? ownerInfo.aideId : null,
          agentId: context.agentId,
          title,
          summary,
          content: fullMessage,
        })
        .returning();

      const [inboxItem] = await tx
        .insert(inboxItems)
        .values({
          userId,
          agentId: context.agentId,
          briefingId: briefing.id,
          type: 'briefing',
          title,
          content: summary,
        })
        .returning();

      return { briefing, inboxItem };
    });

    return {
      success: true,
      data: {
        briefingId: result.briefing.id,
        inboxItemId: result.inboxItem.id,
        message: `Created briefing and inbox notification: ${title}`,
      },
    };
  },
};

// ============================================================================
// requestUserInput
// ============================================================================

const requestUserInputTool: Tool = {
  schema: {
    name: 'requestUserInput',
    description:
      "Request feedback from the user by creating a concise inbox item and appending the full message to the foreground conversation.",
    parameters: [
      {
        name: 'title',
        type: 'string',
        description: 'A concise title for the feedback request',
        required: true,
      },
      {
        name: 'summary',
        type: 'string',
        description: 'A brief summary for the inbox notification (1-2 sentences)',
        required: true,
      },
      {
        name: 'fullMessage',
        type: 'string',
        description: 'The full message content to be added to the conversation',
        required: true,
      },
    ],
  },
  handler: async (params, context): Promise<ToolResult> => {
    // Validate params
    const parsed = RequestUserInputParamsSchema.safeParse(params);
    if (!parsed.success) {
      return {
        success: false,
        error: `Invalid parameters: ${parsed.error.message}`,
      };
    }

    const { title, summary, fullMessage } = parsed.data;

    // Get the user ID for this team/aide
    const userId = await getOwnerUserId(context);
    if (!userId) {
      return {
        success: false,
        error: 'Could not find user for this team/aide',
      };
    }

    // 1. Create the inbox item with summary
    const result = await db
      .insert(inboxItems)
      .values({
        userId,
        agentId: context.agentId,
        type: 'feedback',
        title,
        content: summary,
      })
      .returning();

    // 2. Append full message to agent's foreground conversation (user-facing)
    const conversation = await getOrCreateConversation(
      context.agentId,
      'foreground'
    );
    await appendMessage(conversation.id, 'assistant', fullMessage);

    return {
      success: true,
      data: {
        inboxItemId: result[0].id,
        message: `Requested user feedback and added message to conversation: ${title}`,
      },
    };
  },
};

// ============================================================================
// Registration
// ============================================================================

/**
 * Register all lead tools
 */
export function registerLeadTools(): void {
  registerTool(delegateToAgentTool);
  registerTool(getTeamStatusTool);
  registerTool(createBriefingTool);
  registerTool(requestUserInputTool);
}

// Export individual tools for testing
export {
  delegateToAgentTool,
  getTeamStatusTool,
  createBriefingTool,
  requestUserInputTool,
};
