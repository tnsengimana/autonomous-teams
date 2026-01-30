/**
 * Task Queue Management
 *
 * Higher-level functions for managing agent task queues.
 * Tasks can come from: delegation (other agents), user (user messages),
 * system (bootstrap tasks), or self (proactive work).
 *
 * After queueing tasks, the worker runner is notified for immediate processing.
 */

import {
  queueTask,
  getOwnPendingTasks,
  getNextTask,
  type TaskEntityInfo,
} from '@/lib/db/queries/agentTasks';
import type { AgentTask } from '@/lib/types';

// Re-export TaskEntityInfo for convenience
export type { TaskEntityInfo };

/**
 * Notify the worker runner that a task has been queued.
 * This triggers immediate processing instead of waiting for the next poll.
 */
async function notifyWorkerRunner(agentId: string): Promise<void> {
  try {
    // Dynamic import to avoid circular dependencies
    const { notifyTaskQueued } = await import('@/worker/runner');
    notifyTaskQueued(agentId);
  } catch (error) {
    // Worker runner might not be running (e.g., in dev mode without worker)
    // This is fine - tasks will be picked up on the next poll
    console.debug(`[TaskQueue] Could not notify worker runner: ${error}`);
  }
}

/**
 * Queue a task from a user message
 * This is called when a user sends a message to an agent
 */
export async function queueUserTask(
  agentId: string,
  entityInfo: TaskEntityInfo,
  userMessage: string
): Promise<AgentTask> {
  const task = await queueTask(agentId, entityInfo, userMessage, 'user');
  await notifyWorkerRunner(agentId);
  return task;
}

/**
 * Queue a system task (e.g., bootstrap "get to work" task)
 */
export async function queueSystemTask(
  agentId: string,
  entityInfo: TaskEntityInfo,
  taskContent: string
): Promise<AgentTask> {
  const task = await queueTask(agentId, entityInfo, taskContent, 'system');
  await notifyWorkerRunner(agentId);
  return task;
}

/**
 * Queue a self-assigned task (proactive work)
 */
export async function queueSelfTask(
  agentId: string,
  entityInfo: TaskEntityInfo,
  taskContent: string
): Promise<AgentTask> {
  const task = await queueTask(agentId, entityInfo, taskContent, 'self');
  await notifyWorkerRunner(agentId);
  return task;
}

/**
 * Queue a delegation task (from another agent)
 */
export async function queueDelegationTask(
  agentId: string,
  entityInfo: TaskEntityInfo,
  taskContent: string,
  assignedById: string
): Promise<AgentTask> {
  // For delegation, we need to use createAgentTask with the correct assignedById
  const { createAgentTask } = await import('@/lib/db/queries/agentTasks');
  const task = await createAgentTask({
    ...entityInfo,
    assignedToId: agentId,
    assignedById,
    task: taskContent,
    source: 'delegation',
  });
  await notifyWorkerRunner(agentId);
  return task;
}

/**
 * Get queue status for an agent
 */
export async function getQueueStatus(agentId: string): Promise<{
  hasPendingWork: boolean;
  pendingCount: number;
}> {
  const pendingTasks = await getOwnPendingTasks(agentId);

  return {
    hasPendingWork: pendingTasks.length > 0,
    pendingCount: pendingTasks.length,
  };
}

/**
 * Process next task in queue (returns task if available, null if empty)
 * Assumes a single worker per agent queue; no cross-worker locking.
 * Returns the oldest pending task without mutating status.
 */
export async function claimNextTask(agentId: string): Promise<AgentTask | null> {
  const nextTask = await getNextTask(agentId);

  if (!nextTask) {
    return null;
  }

  return nextTask;
}
