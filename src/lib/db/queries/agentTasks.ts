import { eq, and, asc } from 'drizzle-orm';
import { db } from '../client';
import { agentTasks } from '../schema';
import type { AgentTask, AgentTaskStatus, AgentTaskSource } from '@/lib/types';

/**
 * Owner info type for tasks - exactly one of teamId or aideId must be set
 */
export type TaskOwnerInfo = { teamId: string } | { aideId: string };

/**
 * Create a new agent task
 */
export async function createAgentTask(data: {
  assignedToId: string;
  assignedById: string;
  task: string;
  source?: AgentTaskSource;
} & TaskOwnerInfo): Promise<AgentTask> {
  const result = await db
    .insert(agentTasks)
    .values({
      teamId: 'teamId' in data ? data.teamId : null,
      aideId: 'aideId' in data ? data.aideId : null,
      assignedToId: data.assignedToId,
      assignedById: data.assignedById,
      task: data.task,
      status: 'pending',
      source: data.source ?? 'delegation',
    })
    .returning();

  return result[0];
}

/**
 * Queue a task to an agent's own queue
 * When an agent queues to itself: assignedToId = agentId, assignedById = agentId
 */
export async function queueTask(
  agentId: string,
  ownerInfo: TaskOwnerInfo,
  task: string,
  source: AgentTaskSource
): Promise<AgentTask> {
  const result = await db
    .insert(agentTasks)
    .values({
      teamId: 'teamId' in ownerInfo ? ownerInfo.teamId : null,
      aideId: 'aideId' in ownerInfo ? ownerInfo.aideId : null,
      assignedToId: agentId,
      assignedById: agentId,
      task,
      status: 'pending',
      source,
    })
    .returning();

  return result[0];
}

/**
 * Get an agent task by ID
 */
export async function getAgentTaskById(
  taskId: string
): Promise<AgentTask | null> {
  const result = await db
    .select()
    .from(agentTasks)
    .where(eq(agentTasks.id, taskId))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Get all pending tasks for an agent
 */
export async function getPendingTasksForAgent(
  agentId: string
): Promise<AgentTask[]> {
  return db
    .select()
    .from(agentTasks)
    .where(
      and(
        eq(agentTasks.assignedToId, agentId),
        eq(agentTasks.status, 'pending')
      )
    );
}

/**
 * Get pending tasks for an agent (tasks assigned TO this agent), ordered by creation time (FIFO)
 */
export async function getOwnPendingTasks(agentId: string): Promise<AgentTask[]> {
  return db
    .select()
    .from(agentTasks)
    .where(
      and(
        eq(agentTasks.assignedToId, agentId),
        eq(agentTasks.status, 'pending')
      )
    )
    .orderBy(asc(agentTasks.createdAt));
}

/**
 * Check if agent has any queued work (pending tasks)
 */
export async function hasQueuedWork(agentId: string): Promise<boolean> {
  const result = await db
    .select()
    .from(agentTasks)
    .where(
      and(
        eq(agentTasks.assignedToId, agentId),
        eq(agentTasks.status, 'pending')
      )
    )
    .limit(1);

  return result.length > 0;
}

/**
 * Get next task to process (oldest pending task) - FIFO
 * Assumes a single worker per agent queue; no concurrent claim locking.
 */
export async function getNextTask(agentId: string): Promise<AgentTask | null> {
  const result = await db
    .select()
    .from(agentTasks)
    .where(
      and(
        eq(agentTasks.assignedToId, agentId),
        eq(agentTasks.status, 'pending')
      )
    )
    .orderBy(asc(agentTasks.createdAt))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Complete a task with result (returns the updated task)
 */
export async function completeTaskWithResult(
  taskId: string,
  result: string
): Promise<AgentTask> {
  const updated = await db
    .update(agentTasks)
    .set({
      status: 'completed',
      result,
      completedAt: new Date(),
    })
    .where(eq(agentTasks.id, taskId))
    .returning();

  return updated[0];
}

/**
 * Get all actionable tasks for an agent (pending)
 */
export async function getActionableTasksForAgent(
  agentId: string
): Promise<AgentTask[]> {
  return db
    .select()
    .from(agentTasks)
    .where(
      and(
        eq(agentTasks.assignedToId, agentId),
        eq(agentTasks.status, 'pending')
      )
    );
}

/**
 * Get completed tasks delegated by an agent that haven't been processed
 */
export async function getCompletedTasksDelegatedBy(
  agentId: string
): Promise<AgentTask[]> {
  return db
    .select()
    .from(agentTasks)
    .where(
      and(
        eq(agentTasks.assignedById, agentId),
        eq(agentTasks.status, 'completed')
      )
    );
}

/**
 * Get all tasks for a team
 */
export async function getTasksByTeamId(teamId: string): Promise<AgentTask[]> {
  return db.select().from(agentTasks).where(eq(agentTasks.teamId, teamId));
}

/**
 * Get all tasks for an aide
 */
export async function getTasksByAideId(aideId: string): Promise<AgentTask[]> {
  return db.select().from(agentTasks).where(eq(agentTasks.aideId, aideId));
}

/**
 * Update task status
 */
export async function updateTaskStatus(
  taskId: string,
  status: AgentTaskStatus
): Promise<void> {
  const updates: Partial<{
    status: AgentTaskStatus;
    completedAt: Date | null;
  }> = { status };

  if (status === 'completed') {
    updates.completedAt = new Date();
  }

  await db.update(agentTasks).set(updates).where(eq(agentTasks.id, taskId));
}

/**
 * Complete a task with a result
 */
export async function completeTask(
  taskId: string,
  result: string,
  status: 'completed' = 'completed'
): Promise<void> {
  await db
    .update(agentTasks)
    .set({
      status,
      result,
      completedAt: new Date(),
    })
    .where(eq(agentTasks.id, taskId));
}

/**
 * Delete a task
 */
export async function deleteAgentTask(taskId: string): Promise<void> {
  await db.delete(agentTasks).where(eq(agentTasks.id, taskId));
}

/**
 * Archive processed completed tasks (mark them as processed by deleting)
 */
export async function archiveCompletedTasks(taskIds: string[]): Promise<void> {
  if (taskIds.length === 0) return;

  for (const taskId of taskIds) {
    await db.delete(agentTasks).where(eq(agentTasks.id, taskId));
  }
}
