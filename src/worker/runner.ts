/**
 * Worker Runner
 *
 * Event-driven + timer-based execution for agent work sessions.
 *
 * Execution triggers:
 * 1. Event-driven: When tasks are queued to any agent
 * 2. Timer-based: Lead agents (team leads AND aide leads) run once per day (scheduled via leadNextRunAt)
 *
 * Subordinates are purely reactive - they only run when they have queued tasks.
 * Lead agents get scheduled for 1 day after each work session completion.
 */

import { Agent } from '@/lib/agents/agent';
import {
  getAgentsWithPendingTasks,
  getLeadsDueToRun,
  getAgentsReadyForWork,
} from '@/lib/db/queries/agents';

// ============================================================================
// Configuration
// ============================================================================

// Poll interval - longer since we have event-driven triggers
const POLL_INTERVAL_MS = 30000; // 30 seconds

// Shutdown flag
let isShuttingDown = false;

// Set of agent IDs that have been notified and need immediate processing
const pendingNotifications = new Set<string>();

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
// Event-Driven Task Notification
// ============================================================================

/**
 * Notify the worker that a task has been queued for an agent.
 * This triggers immediate processing of the agent's queue.
 *
 * Called from taskQueue.ts after queueing tasks.
 */
export function notifyTaskQueued(agentId: string): void {
  log(`Task queued notification for agent: ${agentId}`);
  pendingNotifications.add(agentId);
}

// ============================================================================
// Agent Work Session Processing
// ============================================================================

/**
 * Process one agent's work session.
 *
 * Work sessions use the agent's background conversation (mode='background')
 * for all LLM interactions. Tasks are processed sequentially, knowledge is
 * extracted, and team leads may decide to brief the user.
 */
async function processAgentWorkSession(agentId: string): Promise<void> {
  log(`Processing work session for agent: ${agentId}`);

  try {
    const agent = await Agent.fromId(agentId);
    if (!agent) {
      logError(`Agent not found: ${agentId}`, null);
      return;
    }

    // Run work session (processes queue, extracts knowledge, maybe briefing)
    await agent.runWorkSession();

    log(`Completed work session for agent: ${agent.name}`);
  } catch (error) {
    logError(`Error in work session for agent ${agentId}:`, error);
  }
}

// ============================================================================
// Main Runner Loop
// ============================================================================

/**
 * Get all agents that need to run work sessions
 * Combines: agents with pending tasks + all leads (team AND aide) due for scheduled run
 */
async function getAgentsNeedingWork(): Promise<string[]> {
  // 1. Get agents with pending tasks (from notifications or database)
  const agentsWithTasks = await getAgentsWithPendingTasks();

  // 2. Get all leads (team AND aide) due for scheduled proactive run
  const leadsDue = await getLeadsDueToRun();

  // 3. Add any agents from pending notifications
  const notifiedAgents = Array.from(pendingNotifications);
  pendingNotifications.clear();

  // 4. Combine and dedupe
  const allAgentIds = new Set([
    ...agentsWithTasks,
    ...leadsDue,
    ...notifiedAgents,
  ]);

  return getAgentsReadyForWork(Array.from(allAgentIds));
}

/**
 * The main runner loop
 *
 * Polling strategy:
 * - Check for agents with pending work (hasQueuedWork)
 * - Check for lead agents where leadNextRunAt <= now
 * - Process each agent's work session
 * - Sleep with longer interval since we have event-driven triggers
 *
 * NOTE: This runner assumes a single worker process per agent queue.
 * Introducing multiple workers would require coordination/locking changes.
 */
export async function startRunner(): Promise<void> {
  log('Worker runner started (event-driven + timer-based)');

  // Register all tools before starting
  const { registerLeadTools } = await import(
    '@/lib/agents/tools/lead-tools'
  );
  const { registerSubordinateTools } = await import(
    '@/lib/agents/tools/subordinate-tools'
  );
  const { registerTavilyTools } = await import(
    '@/lib/agents/tools/tavily-tools'
  );

  registerLeadTools();
  registerSubordinateTools();
  registerTavilyTools();
  log('Tools registered');

  while (!isShuttingDown) {
    try {
      // Get all agents that need work
      const agentIds = await getAgentsNeedingWork();

      if (agentIds.length > 0) {
        log(`Found ${agentIds.length} agent(s) needing work`);

        // Process each agent's work session
        for (const agentId of agentIds) {
          if (isShuttingDown) break;
          await processAgentWorkSession(agentId);
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
    const agentIds = await getAgentsNeedingWork();

    for (const agentId of agentIds) {
      await processAgentWorkSession(agentId);
    }

    log('Single cycle complete');
  } catch (error) {
    logError('Single cycle error:', error);
  }
}

/**
 * Process pending tasks for a specific subordinate agent
 * This is called when a team lead has delegated work
 *
 * @deprecated Use notifyTaskQueued instead - work sessions handle task processing
 */
export async function processSubordinateTasks(subordinateId: string): Promise<void> {
  log(`Processing tasks for subordinate: ${subordinateId} (via notifyTaskQueued)`);
  notifyTaskQueued(subordinateId);
}
