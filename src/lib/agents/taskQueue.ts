/**
 * Task Queue Management
 *
 * Higher-level functions for managing agent task queues.
 * Tasks can come from: delegation (other agents), user (user messages),
 * system (bootstrap tasks), or self (proactive work).
 */

import {
  queueTask,
  getOwnPendingTasks,
  getInProgressTasksForAgent,
  getNextTask,
  startTask,
} from '@/lib/db/queries/agentTasks';
import type { AgentTask } from '@/lib/types';

/**
 * Queue a task from a user message
 * This is called when a user sends a message to an agent
 */
export async function queueUserTask(
  agentId: string,
  teamId: string,
  userMessage: string
): Promise<AgentTask> {
  return queueTask(agentId, teamId, userMessage, 'user');
}

/**
 * Queue a system task (e.g., bootstrap "get to work" task)
 */
export async function queueSystemTask(
  agentId: string,
  teamId: string,
  task: string
): Promise<AgentTask> {
  return queueTask(agentId, teamId, task, 'system');
}

/**
 * Queue a self-assigned task (proactive work)
 */
export async function queueSelfTask(
  agentId: string,
  teamId: string,
  task: string
): Promise<AgentTask> {
  return queueTask(agentId, teamId, task, 'self');
}

/**
 * Queue a delegation task (from another agent)
 */
export async function queueDelegationTask(
  agentId: string,
  teamId: string,
  task: string,
  assignedById: string
): Promise<AgentTask> {
  // For delegation, we need to use createAgentTask with the correct assignedById
  const { createAgentTask } = await import('@/lib/db/queries/agentTasks');
  return createAgentTask({
    teamId,
    assignedToId: agentId,
    assignedById,
    task,
    source: 'delegation',
  });
}

/**
 * Get queue status for an agent
 */
export async function getQueueStatus(agentId: string): Promise<{
  hasPendingWork: boolean;
  pendingCount: number;
  inProgressCount: number;
}> {
  const [pendingTasks, inProgressTasks] = await Promise.all([
    getOwnPendingTasks(agentId),
    getInProgressTasksForAgent(agentId),
  ]);

  return {
    hasPendingWork: pendingTasks.length > 0 || inProgressTasks.length > 0,
    pendingCount: pendingTasks.length,
    inProgressCount: inProgressTasks.length,
  };
}

/**
 * Process next task in queue (returns task if available, null if empty)
 * Claims the task by marking it as in_progress
 */
export async function claimNextTask(agentId: string): Promise<AgentTask | null> {
  const nextTask = await getNextTask(agentId);

  if (!nextTask) {
    return null;
  }

  // Mark as in_progress and return the updated task
  return startTask(nextTask.id);
}
