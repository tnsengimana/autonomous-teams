/**
 * Team Lead Tools
 *
 * Tools available to team lead agents for delegation and coordination.
 */

import {
  registerTool,
  type Tool,
  type ToolResult,
  DelegateToAgentParamsSchema,
  CreateInboxItemParamsSchema,
} from './index';
import { createAgentTask } from '@/lib/db/queries/agentTasks';
import { getChildAgents } from '@/lib/db/queries/agents';
import { getTeamUserId } from '@/lib/db/queries/teams';
import { getOrCreateConversation } from '@/lib/db/queries/conversations';
import { appendMessage } from '@/lib/db/queries/messages';
import { db } from '@/lib/db/client';
import { inboxItems } from '@/lib/db/schema';

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

    // Verify the agent is a team lead
    if (!context.isTeamLead) {
      return {
        success: false,
        error: 'Only team leads can delegate tasks',
      };
    }

    // Verify the target agent is a child of this team lead
    const childAgents = await getChildAgents(context.agentId);
    const isChild = childAgents.some((child) => child.id === agentId);

    if (!isChild) {
      return {
        success: false,
        error: 'Can only delegate to agents on your team',
      };
    }

    // Create the task
    const agentTask = await createAgentTask({
      teamId: context.teamId,
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
    // Verify the agent is a team lead
    if (!context.isTeamLead) {
      return {
        success: false,
        error: 'Only team leads can check team status',
      };
    }

    // Get all child agents
    const childAgents = await getChildAgents(context.agentId);

    // Get task counts for each agent
    const agentStatuses = await Promise.all(
      childAgents.map(async (agent) => {
        const { getActionableTasksForAgent } = await import(
          '@/lib/db/queries/agentTasks'
        );
        const tasks = await getActionableTasksForAgent(agent.id);

        return {
          agentId: agent.id,
          name: agent.name,
          role: agent.role,
          status: agent.status,
          pendingTasks: tasks.filter((t) => t.status === 'pending').length,
          inProgressTasks: tasks.filter((t) => t.status === 'in_progress')
            .length,
        };
      })
    );

    return {
      success: true,
      data: {
        teamId: context.teamId,
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
// createInboxItem
// ============================================================================

const createInboxItemTool: Tool = {
  schema: {
    name: 'createInboxItem',
    description:
      "Push a notification to the user's inbox and add the full message to your conversation. The inbox shows a summary that links to the conversation where the user can reply.",
    parameters: [
      {
        name: 'type',
        type: 'string',
        description: 'The type of inbox item',
        required: true,
        enum: ['briefing', 'signal', 'alert'],
      },
      {
        name: 'title',
        type: 'string',
        description: 'A concise title for the inbox item',
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
    const parsed = CreateInboxItemParamsSchema.safeParse(params);
    if (!parsed.success) {
      return {
        success: false,
        error: `Invalid parameters: ${parsed.error.message}`,
      };
    }

    const { type, title, summary, fullMessage } = parsed.data;

    // Get the user ID for this team
    const userId = await getTeamUserId(context.teamId);
    if (!userId) {
      return {
        success: false,
        error: 'Could not find user for this team',
      };
    }

    // 1. Create the inbox item with summary
    const result = await db
      .insert(inboxItems)
      .values({
        userId,
        teamId: context.teamId,
        agentId: context.agentId,
        type,
        title,
        content: summary,
      })
      .returning();

    // 2. Append full message to agent's conversation
    const conversation = await getOrCreateConversation(context.agentId);
    await appendMessage(conversation.id, 'assistant', fullMessage);

    return {
      success: true,
      data: {
        inboxItemId: result[0].id,
        message: `Created ${type} notification and added message to conversation: ${title}`,
      },
    };
  },
};

// ============================================================================
// Registration
// ============================================================================

/**
 * Register all team lead tools
 */
export function registerTeamLeadTools(): void {
  registerTool(delegateToAgentTool);
  registerTool(getTeamStatusTool);
  registerTool(createInboxItemTool);
}

// Export individual tools for testing
export { delegateToAgentTool, getTeamStatusTool, createInboxItemTool };
