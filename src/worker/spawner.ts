/**
 * Worker Spawner
 *
 * Handles on-demand spawning of subordinate agents when a team lead delegates tasks.
 * Currently uses a polling-based approach, but could be extended to use
 * event-driven notifications.
 */

import { Agent } from '@/lib/agents/agent';
import { getAgentById, updateAgentStatus } from '@/lib/db/queries/agents';
import {
  getPendingTasksForAgent,
  completeTask,
} from '@/lib/db/queries/agentTasks';

// ============================================================================
// Utility Functions
// ============================================================================

function log(message: string, ...args: unknown[]): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [Spawner] ${message}`, ...args);
}

function logError(message: string, error: unknown): void {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [Spawner] ${message}`, error);
}

// ============================================================================
// Worker Spawning
// ============================================================================

/**
 * Spawn a subordinate agent to execute a specific task
 */
export async function spawnSubordinate(
  agentId: string,
  taskDescription: string
): Promise<{ success: boolean; result?: string; error?: string }> {
  log(`Spawning subordinate: ${agentId}`);

  try {
    // Get the agent data
    const agentData = await getAgentById(agentId);
    if (!agentData) {
      return {
        success: false,
        error: `Agent not found: ${agentId}`,
      };
    }

    // Set agent status to running
    await updateAgentStatus(agentId, 'running');

    // Create the agent instance
    const agent = new Agent(agentData);

    // Execute the task
    log(`Executing task for ${agent.name}: ${taskDescription.substring(0, 50)}...`);

    const response = await agent.handleMessageSync(
      `You have been assigned a task. Please complete it and report back:\n\n${taskDescription}`
    );

    // Set agent status back to idle
    await updateAgentStatus(agentId, 'idle');

    log(`Task completed for ${agent.name}`);

    return {
      success: true,
      result: response,
    };
  } catch (error) {
    logError(`Error spawning subordinate ${agentId}:`, error);

    // Try to reset agent status
    try {
      await updateAgentStatus(agentId, 'idle');
    } catch {
      // Ignore status update errors
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Process all pending tasks for a subordinate agent
 */
export async function processSubordinatePendingTasks(
  agentId: string
): Promise<void> {
  log(`Processing pending tasks for subordinate: ${agentId}`);

  try {
    const pendingTasks = await getPendingTasksForAgent(agentId);

    if (pendingTasks.length === 0) {
      log(`No pending tasks for subordinate: ${agentId}`);
      return;
    }

    log(`Found ${pendingTasks.length} pending tasks`);

    // Process tasks sequentially
    for (const task of pendingTasks) {
      log(`Starting task: ${task.id}`);

      // Execute the task
      const result = await spawnSubordinate(agentId, task.task);

      // Complete the task with the result
      if (result.success) {
        await completeTask(task.id, result.result ?? 'Task completed', 'completed');
        log(`Task ${task.id} completed successfully`);
      } else {
        log(`Task ${task.id} failed: ${result.error}`);
      }
    }

    log(`Finished processing tasks for subordinate: ${agentId}`);
  } catch (error) {
    logError(`Error processing pending tasks for ${agentId}:`, error);
  }
}

/**
 * Spawn subordinates for all pending tasks in a team
 * This can be called periodically or triggered by task creation
 */
export async function processTeamPendingTasks(teamId: string): Promise<void> {
  log(`Processing pending tasks for team: ${teamId}`);

  try {
    // Get all agents for the team
    const { getAgentsByTeamId } = await import('@/lib/db/queries/agents');
    const agents = await getAgentsByTeamId(teamId);

    // Filter to subordinate agents (those with a parent)
    const subordinates = agents.filter((a) => a.parentAgentId !== null);

    // Process pending tasks for each subordinate
    for (const subordinate of subordinates) {
      await processSubordinatePendingTasks(subordinate.id);
    }

    log(`Finished processing team: ${teamId}`);
  } catch (error) {
    logError(`Error processing team ${teamId}:`, error);
  }
}

// ============================================================================
// Task Notification (for future event-driven implementation)
// ============================================================================

/**
 * Notify that a new task has been created
 * For now this triggers immediate processing, but could be
 * implemented with a message queue in the future
 */
export async function notifyNewTask(taskId: string): Promise<void> {
  log(`New task notification: ${taskId}`);

  try {
    const { getAgentTaskById } = await import('@/lib/db/queries/agentTasks');
    const task = await getAgentTaskById(taskId);

    if (!task) {
      logError(`Task not found: ${taskId}`, null);
      return;
    }

    // Process the task immediately
    await processSubordinatePendingTasks(task.assignedToId);
  } catch (error) {
    logError(`Error handling task notification ${taskId}:`, error);
  }
}
