/**
 * Worker Runner
 *
 * Main loop that polls for active team leads and triggers their run cycles.
 * This runs continuously in the background, checking every 5 seconds.
 */

import { Agent } from '@/lib/agents/agent';
import { getActiveTeamLeads } from '@/lib/db/queries/agents';
import {
  getCompletedTasksDelegatedBy,
  getActionableTasksForAgent,
  updateTaskStatus,
  archiveCompletedTasks,
} from '@/lib/db/queries/agentTasks';

// ============================================================================
// Configuration
// ============================================================================

const POLL_INTERVAL_MS = 5000; // 5 seconds

// Shutdown flag
let isShuttingDown = false;

export function stopRunner(): void {
  isShuttingDown = true;
}

// ============================================================================
// Utility Functions
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message: string, ...args: unknown[]): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [Worker] ${message}`, ...args);
}

function logError(message: string, error: unknown): void {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [Worker] ${message}`, error);
}

// ============================================================================
// Team Lead Cycle
// ============================================================================

/**
 * Run a proactive cycle for a team lead agent
 */
async function runTeamLeadCycle(agent: Agent): Promise<void> {
  log(`Running cycle for team lead: ${agent.name} (${agent.id})`);

  try {
    // 1. Check for completed tasks from workers
    const completedTasks = await getCompletedTasksDelegatedBy(agent.id);

    if (completedTasks.length > 0) {
      log(`Found ${completedTasks.length} completed tasks to process`);

      // Process each completed task - in a full implementation,
      // this would send the results to the agent for processing
      for (const task of completedTasks) {
        log(
          `Processing completed task: ${task.id} - Status: ${task.status}`
        );

        // For now, just log the completion
        // The agent would typically incorporate this into its context
      }

      // Archive the processed tasks
      await archiveCompletedTasks(completedTasks.map((t) => t.id));
    }

    // 2. Run the agent's proactive cycle
    await agent.runCycle();

    log(`Completed cycle for team lead: ${agent.name}`);
  } catch (error) {
    logError(`Error in team lead cycle for ${agent.name}:`, error);
  }
}

// ============================================================================
// Worker Agent Processing
// ============================================================================

/**
 * Process pending tasks for worker agents
 * This is called when a team lead has delegated work
 */
export async function processWorkerTasks(workerId: string): Promise<void> {
  log(`Processing tasks for worker: ${workerId}`);

  try {
    const tasks = await getActionableTasksForAgent(workerId);

    if (tasks.length === 0) {
      log(`No actionable tasks for worker: ${workerId}`);
      return;
    }

    // Get the first pending task
    const pendingTasks = tasks.filter((t) => t.status === 'pending');
    if (pendingTasks.length === 0) {
      log(`No pending tasks for worker: ${workerId}`);
      return;
    }

    const task = pendingTasks[0];
    log(`Executing task: ${task.id} - "${task.task.substring(0, 50)}..."`);

    // Mark task as in progress
    await updateTaskStatus(task.id, 'in_progress');

    // Create the worker agent
    const workerAgent = await Agent.fromId(workerId);
    if (!workerAgent) {
      logError(`Worker agent not found: ${workerId}`, null);
      await updateTaskStatus(task.id, 'failed');
      return;
    }

    // Execute the task by sending it as a message to the agent
    // The agent will process it and use the reportToLead tool to report back
    const response = await workerAgent.handleMessageSync(
      `Execute this task: ${task.task}\n\nWhen complete, use the reportToLead tool to send your results back.`
    );

    log(`Worker response: ${response.substring(0, 100)}...`);

    // Note: The actual task completion happens via the reportToLead tool
    // If the agent didn't use the tool, we leave the task in_progress
    // for manual intervention
  } catch (error) {
    logError(`Error processing worker tasks for ${workerId}:`, error);
  }
}

// ============================================================================
// Main Runner Loop
// ============================================================================

/**
 * The main runner loop that polls for active team leads
 */
export async function startRunner(): Promise<void> {
  log('Worker runner started');

  // Register all tools before starting
  const { registerTeamLeadTools } = await import(
    '@/lib/agents/tools/team-lead-tools'
  );
  const { registerWorkerTools } = await import(
    '@/lib/agents/tools/worker-tools'
  );
  const { registerTavilyTools } = await import(
    '@/lib/agents/tools/tavily-tools'
  );

  registerTeamLeadTools();
  registerWorkerTools();
  registerTavilyTools();
  log('Tools registered');

  while (!isShuttingDown) {
    try {
      // Get all active team leads
      const teamLeads = await getActiveTeamLeads();

      if (teamLeads.length > 0) {
        log(`Found ${teamLeads.length} active team lead(s)`);

        // Process each team lead
        for (const agentData of teamLeads) {
          if (isShuttingDown) break;
          const agent = new Agent(agentData);
          await runTeamLeadCycle(agent);
        }
      }
    } catch (error) {
      logError('Runner error:', error);
    }

    // Wait before next poll (unless shutting down)
    if (!isShuttingDown) {
      await sleep(POLL_INTERVAL_MS);
    }
  }

  log('Runner loop stopped');
}

/**
 * Run a single cycle (useful for testing)
 */
export async function runSingleCycle(): Promise<void> {
  log('Running single cycle');

  try {
    const teamLeads = await getActiveTeamLeads();

    for (const agentData of teamLeads) {
      const agent = new Agent(agentData);
      await runTeamLeadCycle(agent);
    }

    log('Single cycle complete');
  } catch (error) {
    logError('Single cycle error:', error);
  }
}
