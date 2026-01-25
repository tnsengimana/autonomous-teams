/**
 * Tests for agent task queue queries
 *
 * These tests verify the task queue management system that supports
 * agent task processing with FIFO ordering.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/db/client';
import { users, teams, agents, agentTasks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

// Import task queries
import {
  queueTask,
  getOwnPendingTasks,
  hasQueuedWork,
  getNextTask,
  startTask,
  completeTaskWithResult,
  failTask,
  createAgentTask,
  getAgentTaskById,
  getInProgressTasksForAgent,
  getActionableTasksForAgent,
} from '@/lib/db/queries/agentTasks';

// ============================================================================
// Test Setup
// ============================================================================

let testUserId: string;
let testTeamId: string;
let testAgentId: string;
let testAgent2Id: string;

beforeAll(async () => {
  // Create test user
  const [user] = await db.insert(users).values({
    email: `task-queue-test-${Date.now()}@example.com`,
    name: 'Task Queue Test User',
  }).returning();
  testUserId = user.id;

  // Create test team
  const [team] = await db.insert(teams).values({
    userId: testUserId,
    name: 'Task Queue Test Team',
    purpose: 'Testing task queue management',
  }).returning();
  testTeamId = team.id;

  // Create test agents
  const [agent] = await db.insert(agents).values({
    teamId: testTeamId,
    name: 'Task Queue Test Agent',
    role: 'Tester',
  }).returning();
  testAgentId = agent.id;

  const [agent2] = await db.insert(agents).values({
    teamId: testTeamId,
    name: 'Task Queue Test Agent 2',
    role: 'Secondary Tester',
  }).returning();
  testAgent2Id = agent2.id;

  // Clean up any orphaned tasks for these agents (from previous test runs)
  await db.delete(agentTasks).where(eq(agentTasks.assignedToId, testAgentId));
  await db.delete(agentTasks).where(eq(agentTasks.assignedToId, testAgent2Id));
});

afterAll(async () => {
  // Cleanup: delete test user (cascades to teams, agents, tasks, etc.)
  await db.delete(users).where(eq(users.id, testUserId));
});

// Helper to cleanup tasks created during tests
async function cleanupTasks(taskIds: string[]) {
  for (const taskId of taskIds) {
    await db.delete(agentTasks).where(eq(agentTasks.id, taskId));
  }
}

// ============================================================================
// queueTask Tests
// ============================================================================

describe('queueTask', () => {
  test('queues a task with user source', async () => {
    const task = await queueTask(testAgentId, testTeamId, 'Process user request', 'user');

    expect(task.id).toBeDefined();
    expect(task.assignedToId).toBe(testAgentId);
    expect(task.assignedById).toBe(testAgentId); // Self-assigned when using queueTask
    expect(task.teamId).toBe(testTeamId);
    expect(task.task).toBe('Process user request');
    expect(task.source).toBe('user');
    expect(task.status).toBe('pending');

    await cleanupTasks([task.id]);
  });

  test('queues a task with system source', async () => {
    const task = await queueTask(testAgentId, testTeamId, 'Bootstrap initialization', 'system');

    expect(task.source).toBe('system');
    expect(task.status).toBe('pending');

    await cleanupTasks([task.id]);
  });

  test('queues a task with self source', async () => {
    const task = await queueTask(testAgentId, testTeamId, 'Proactive monitoring', 'self');

    expect(task.source).toBe('self');
    expect(task.status).toBe('pending');

    await cleanupTasks([task.id]);
  });

  test('queues a task with delegation source', async () => {
    const task = await queueTask(testAgentId, testTeamId, 'Delegated work', 'delegation');

    expect(task.source).toBe('delegation');
    expect(task.status).toBe('pending');

    await cleanupTasks([task.id]);
  });

  test('supports all source types', async () => {
    const sourceTypes = ['delegation', 'user', 'system', 'self'] as const;
    const createdTaskIds: string[] = [];

    for (const source of sourceTypes) {
      const task = await queueTask(testAgentId, testTeamId, `Task from ${source}`, source);
      expect(task.source).toBe(source);
      createdTaskIds.push(task.id);
    }

    await cleanupTasks(createdTaskIds);
  });

  test('creates tasks with unique IDs', async () => {
    const task1 = await queueTask(testAgentId, testTeamId, 'Task 1', 'user');
    const task2 = await queueTask(testAgentId, testTeamId, 'Task 2', 'user');

    expect(task1.id).not.toBe(task2.id);

    await cleanupTasks([task1.id, task2.id]);
  });

  test('sets createdAt timestamp', async () => {
    const task = await queueTask(testAgentId, testTeamId, 'Timestamped task', 'user');

    expect(task.createdAt).toBeDefined();
    expect(task.createdAt instanceof Date).toBe(true);
    // Verify timestamp is recent (within last minute)
    const oneMinuteAgo = new Date(Date.now() - 60000);
    expect(task.createdAt.getTime()).toBeGreaterThan(oneMinuteAgo.getTime());

    await cleanupTasks([task.id]);
  });
});

// ============================================================================
// getOwnPendingTasks Tests
// ============================================================================

describe('getOwnPendingTasks', () => {
  test('returns empty array when no tasks exist', async () => {
    const tasks = await getOwnPendingTasks(testAgentId);
    expect(tasks).toEqual([]);
  });

  test('returns pending tasks for agent', async () => {
    const task1 = await queueTask(testAgentId, testTeamId, 'Pending task 1', 'user');
    const task2 = await queueTask(testAgentId, testTeamId, 'Pending task 2', 'user');

    const tasks = await getOwnPendingTasks(testAgentId);

    expect(tasks.length).toBeGreaterThanOrEqual(2);
    expect(tasks.some(t => t.id === task1.id)).toBe(true);
    expect(tasks.some(t => t.id === task2.id)).toBe(true);

    await cleanupTasks([task1.id, task2.id]);
  });

  test('returns tasks in FIFO order (oldest first)', async () => {
    // Create tasks with small delays to ensure different timestamps
    const task1 = await queueTask(testAgentId, testTeamId, 'First task', 'user');
    await new Promise(resolve => setTimeout(resolve, 10));
    const task2 = await queueTask(testAgentId, testTeamId, 'Second task', 'user');
    await new Promise(resolve => setTimeout(resolve, 10));
    const task3 = await queueTask(testAgentId, testTeamId, 'Third task', 'user');

    const tasks = await getOwnPendingTasks(testAgentId);

    // Find the indices of our tasks
    const idx1 = tasks.findIndex(t => t.id === task1.id);
    const idx2 = tasks.findIndex(t => t.id === task2.id);
    const idx3 = tasks.findIndex(t => t.id === task3.id);

    // Verify FIFO ordering
    expect(idx1).toBeLessThan(idx2);
    expect(idx2).toBeLessThan(idx3);

    await cleanupTasks([task1.id, task2.id, task3.id]);
  });

  test('excludes in_progress tasks', async () => {
    const pendingTask = await queueTask(testAgentId, testTeamId, 'Pending', 'user');
    const inProgressTask = await queueTask(testAgentId, testTeamId, 'In progress', 'user');
    await startTask(inProgressTask.id);

    const tasks = await getOwnPendingTasks(testAgentId);

    expect(tasks.some(t => t.id === pendingTask.id)).toBe(true);
    expect(tasks.some(t => t.id === inProgressTask.id)).toBe(false);

    await cleanupTasks([pendingTask.id, inProgressTask.id]);
  });

  test('excludes completed tasks', async () => {
    const pendingTask = await queueTask(testAgentId, testTeamId, 'Pending', 'user');
    const completedTask = await queueTask(testAgentId, testTeamId, 'Completed', 'user');
    await startTask(completedTask.id);
    await completeTaskWithResult(completedTask.id, 'Done');

    const tasks = await getOwnPendingTasks(testAgentId);

    expect(tasks.some(t => t.id === pendingTask.id)).toBe(true);
    expect(tasks.some(t => t.id === completedTask.id)).toBe(false);

    await cleanupTasks([pendingTask.id, completedTask.id]);
  });

  test('excludes failed tasks', async () => {
    const pendingTask = await queueTask(testAgentId, testTeamId, 'Pending', 'user');
    const failedTask = await queueTask(testAgentId, testTeamId, 'Failed', 'user');
    await startTask(failedTask.id);
    await failTask(failedTask.id, 'Error occurred');

    const tasks = await getOwnPendingTasks(testAgentId);

    expect(tasks.some(t => t.id === pendingTask.id)).toBe(true);
    expect(tasks.some(t => t.id === failedTask.id)).toBe(false);

    await cleanupTasks([pendingTask.id, failedTask.id]);
  });

  test('only returns tasks assigned to the specific agent', async () => {
    const agent1Task = await queueTask(testAgentId, testTeamId, 'Agent 1 task', 'user');
    const agent2Task = await queueTask(testAgent2Id, testTeamId, 'Agent 2 task', 'user');

    const agent1Tasks = await getOwnPendingTasks(testAgentId);
    const agent2Tasks = await getOwnPendingTasks(testAgent2Id);

    expect(agent1Tasks.some(t => t.id === agent1Task.id)).toBe(true);
    expect(agent1Tasks.some(t => t.id === agent2Task.id)).toBe(false);
    expect(agent2Tasks.some(t => t.id === agent2Task.id)).toBe(true);
    expect(agent2Tasks.some(t => t.id === agent1Task.id)).toBe(false);

    await cleanupTasks([agent1Task.id, agent2Task.id]);
  });
});

// ============================================================================
// hasQueuedWork Tests
// ============================================================================

describe('hasQueuedWork', () => {
  test('returns false when no tasks exist', async () => {
    const hasWork = await hasQueuedWork(testAgentId);
    expect(hasWork).toBe(false);
  });

  test('returns true when pending tasks exist', async () => {
    const task = await queueTask(testAgentId, testTeamId, 'Pending task', 'user');

    const hasWork = await hasQueuedWork(testAgentId);
    expect(hasWork).toBe(true);

    await cleanupTasks([task.id]);
  });

  test('returns true when in_progress tasks exist', async () => {
    const task = await queueTask(testAgentId, testTeamId, 'In progress task', 'user');
    await startTask(task.id);

    const hasWork = await hasQueuedWork(testAgentId);
    expect(hasWork).toBe(true);

    await cleanupTasks([task.id]);
  });

  test('returns true when both pending and in_progress tasks exist', async () => {
    const pendingTask = await queueTask(testAgentId, testTeamId, 'Pending', 'user');
    const inProgressTask = await queueTask(testAgentId, testTeamId, 'In progress', 'user');
    await startTask(inProgressTask.id);

    const hasWork = await hasQueuedWork(testAgentId);
    expect(hasWork).toBe(true);

    await cleanupTasks([pendingTask.id, inProgressTask.id]);
  });

  test('returns false when only completed tasks exist', async () => {
    const task = await queueTask(testAgentId, testTeamId, 'Completed task', 'user');
    await startTask(task.id);
    await completeTaskWithResult(task.id, 'Done');

    const hasWork = await hasQueuedWork(testAgentId);
    expect(hasWork).toBe(false);

    await cleanupTasks([task.id]);
  });

  test('returns false when only failed tasks exist', async () => {
    const task = await queueTask(testAgentId, testTeamId, 'Failed task', 'user');
    await startTask(task.id);
    await failTask(task.id, 'Error');

    const hasWork = await hasQueuedWork(testAgentId);
    expect(hasWork).toBe(false);

    await cleanupTasks([task.id]);
  });

  test('only considers tasks for the specific agent', async () => {
    const agent2Task = await queueTask(testAgent2Id, testTeamId, 'Agent 2 task', 'user');

    const hasWorkAgent1 = await hasQueuedWork(testAgentId);
    const hasWorkAgent2 = await hasQueuedWork(testAgent2Id);

    expect(hasWorkAgent1).toBe(false);
    expect(hasWorkAgent2).toBe(true);

    await cleanupTasks([agent2Task.id]);
  });
});

// ============================================================================
// Task Lifecycle Tests (pending -> in_progress -> completed/failed)
// ============================================================================

describe('Task Lifecycle', () => {
  test('task starts in pending status', async () => {
    const task = await queueTask(testAgentId, testTeamId, 'New task', 'user');

    expect(task.status).toBe('pending');
    expect(task.completedAt).toBeNull();
    expect(task.result).toBeNull();

    await cleanupTasks([task.id]);
  });

  test('startTask transitions task to in_progress', async () => {
    const task = await queueTask(testAgentId, testTeamId, 'Task to start', 'user');
    const started = await startTask(task.id);

    expect(started.status).toBe('in_progress');
    expect(started.completedAt).toBeNull();

    await cleanupTasks([task.id]);
  });

  test('completeTaskWithResult transitions task to completed with result', async () => {
    const task = await queueTask(testAgentId, testTeamId, 'Task to complete', 'user');
    await startTask(task.id);
    const completed = await completeTaskWithResult(task.id, 'Task completed successfully');

    expect(completed.status).toBe('completed');
    expect(completed.result).toBe('Task completed successfully');
    expect(completed.completedAt).not.toBeNull();

    await cleanupTasks([task.id]);
  });

  test('failTask transitions task to failed with error message', async () => {
    const task = await queueTask(testAgentId, testTeamId, 'Task to fail', 'user');
    await startTask(task.id);
    const failed = await failTask(task.id, 'An error occurred');

    expect(failed.status).toBe('failed');
    expect(failed.result).toBe('An error occurred');
    expect(failed.completedAt).not.toBeNull();

    await cleanupTasks([task.id]);
  });

  test('full lifecycle: pending -> in_progress -> completed', async () => {
    const task = await queueTask(testAgentId, testTeamId, 'Full lifecycle task', 'user');
    expect(task.status).toBe('pending');

    const started = await startTask(task.id);
    expect(started.status).toBe('in_progress');

    const completed = await completeTaskWithResult(task.id, 'Done');
    expect(completed.status).toBe('completed');
    expect(completed.result).toBe('Done');

    await cleanupTasks([task.id]);
  });

  test('full lifecycle: pending -> in_progress -> failed', async () => {
    const task = await queueTask(testAgentId, testTeamId, 'Failing lifecycle task', 'user');
    expect(task.status).toBe('pending');

    const started = await startTask(task.id);
    expect(started.status).toBe('in_progress');

    const failed = await failTask(task.id, 'Something went wrong');
    expect(failed.status).toBe('failed');
    expect(failed.result).toBe('Something went wrong');

    await cleanupTasks([task.id]);
  });
});

// ============================================================================
// getNextTask Tests
// ============================================================================

describe('getNextTask', () => {
  test('returns null when no pending tasks exist', async () => {
    const nextTask = await getNextTask(testAgentId);
    expect(nextTask).toBeNull();
  });

  test('returns oldest pending task (FIFO)', async () => {
    const task1 = await queueTask(testAgentId, testTeamId, 'First task', 'user');
    await new Promise(resolve => setTimeout(resolve, 10));
    const task2 = await queueTask(testAgentId, testTeamId, 'Second task', 'user');

    const nextTask = await getNextTask(testAgentId);

    expect(nextTask).not.toBeNull();
    expect(nextTask!.id).toBe(task1.id);

    await cleanupTasks([task1.id, task2.id]);
  });

  test('skips in_progress tasks', async () => {
    const inProgressTask = await queueTask(testAgentId, testTeamId, 'In progress', 'user');
    await startTask(inProgressTask.id);
    await new Promise(resolve => setTimeout(resolve, 10));
    const pendingTask = await queueTask(testAgentId, testTeamId, 'Pending', 'user');

    const nextTask = await getNextTask(testAgentId);

    expect(nextTask).not.toBeNull();
    expect(nextTask!.id).toBe(pendingTask.id);

    await cleanupTasks([inProgressTask.id, pendingTask.id]);
  });

  test('skips completed tasks', async () => {
    const completedTask = await queueTask(testAgentId, testTeamId, 'Completed', 'user');
    await startTask(completedTask.id);
    await completeTaskWithResult(completedTask.id, 'Done');
    await new Promise(resolve => setTimeout(resolve, 10));
    const pendingTask = await queueTask(testAgentId, testTeamId, 'Pending', 'user');

    const nextTask = await getNextTask(testAgentId);

    expect(nextTask).not.toBeNull();
    expect(nextTask!.id).toBe(pendingTask.id);

    await cleanupTasks([completedTask.id, pendingTask.id]);
  });
});

// ============================================================================
// createAgentTask Tests (for delegation with different assignedById)
// ============================================================================

describe('createAgentTask', () => {
  test('creates task with different assignedById (delegation)', async () => {
    const task = await createAgentTask({
      teamId: testTeamId,
      assignedToId: testAgentId,
      assignedById: testAgent2Id,
      task: 'Delegated from agent 2',
      source: 'delegation',
    });

    expect(task.assignedToId).toBe(testAgentId);
    expect(task.assignedById).toBe(testAgent2Id);
    expect(task.source).toBe('delegation');

    await cleanupTasks([task.id]);
  });

  test('defaults to delegation source when not specified', async () => {
    const task = await createAgentTask({
      teamId: testTeamId,
      assignedToId: testAgentId,
      assignedById: testAgent2Id,
      task: 'Implicit delegation',
    });

    expect(task.source).toBe('delegation');

    await cleanupTasks([task.id]);
  });
});

// ============================================================================
// getInProgressTasksForAgent Tests
// ============================================================================

describe('getInProgressTasksForAgent', () => {
  test('returns empty array when no in_progress tasks', async () => {
    const tasks = await getInProgressTasksForAgent(testAgentId);
    expect(tasks).toEqual([]);
  });

  test('returns only in_progress tasks', async () => {
    const pending = await queueTask(testAgentId, testTeamId, 'Pending', 'user');
    const inProgress = await queueTask(testAgentId, testTeamId, 'In progress', 'user');
    await startTask(inProgress.id);

    const tasks = await getInProgressTasksForAgent(testAgentId);

    expect(tasks.some(t => t.id === inProgress.id)).toBe(true);
    expect(tasks.some(t => t.id === pending.id)).toBe(false);

    await cleanupTasks([pending.id, inProgress.id]);
  });
});

// ============================================================================
// getActionableTasksForAgent Tests
// ============================================================================

describe('getActionableTasksForAgent', () => {
  test('returns empty array when no actionable tasks', async () => {
    const tasks = await getActionableTasksForAgent(testAgentId);
    expect(tasks).toEqual([]);
  });

  test('returns both pending and in_progress tasks', async () => {
    const pending = await queueTask(testAgentId, testTeamId, 'Pending', 'user');
    const inProgress = await queueTask(testAgentId, testTeamId, 'In progress', 'user');
    await startTask(inProgress.id);
    const completed = await queueTask(testAgentId, testTeamId, 'Completed', 'user');
    await startTask(completed.id);
    await completeTaskWithResult(completed.id, 'Done');

    const tasks = await getActionableTasksForAgent(testAgentId);

    expect(tasks.some(t => t.id === pending.id)).toBe(true);
    expect(tasks.some(t => t.id === inProgress.id)).toBe(true);
    expect(tasks.some(t => t.id === completed.id)).toBe(false);

    await cleanupTasks([pending.id, inProgress.id, completed.id]);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  test('handles empty task description', async () => {
    const task = await queueTask(testAgentId, testTeamId, '', 'user');

    expect(task.task).toBe('');

    await cleanupTasks([task.id]);
  });

  test('handles very long task description', async () => {
    const longDescription = 'A'.repeat(10000);
    const task = await queueTask(testAgentId, testTeamId, longDescription, 'user');

    expect(task.task).toBe(longDescription);

    const retrieved = await getAgentTaskById(task.id);
    expect(retrieved!.task).toBe(longDescription);

    await cleanupTasks([task.id]);
  });

  test('handles special characters in task description', async () => {
    const specialChars = '`~!@#$%^&*()_+-=[]{}|;:\'"<>,.?/\\n\\t\u1234\u2603';
    const task = await queueTask(testAgentId, testTeamId, specialChars, 'user');

    expect(task.task).toBe(specialChars);

    await cleanupTasks([task.id]);
  });

  test('handles unicode in task description', async () => {
    const unicodeTask = 'Task with emoji and unicode: \ud83d\ude00\ud83c\udf1f\u4e2d\u6587\u65e5\u672c\u8a9e';
    const task = await queueTask(testAgentId, testTeamId, unicodeTask, 'user');

    expect(task.task).toBe(unicodeTask);

    await cleanupTasks([task.id]);
  });

  test('handles empty result on complete', async () => {
    const task = await queueTask(testAgentId, testTeamId, 'Task', 'user');
    await startTask(task.id);
    const completed = await completeTaskWithResult(task.id, '');

    expect(completed.result).toBe('');

    await cleanupTasks([task.id]);
  });

  test('handles empty error on fail', async () => {
    const task = await queueTask(testAgentId, testTeamId, 'Task', 'user');
    await startTask(task.id);
    const failed = await failTask(task.id, '');

    expect(failed.result).toBe('');

    await cleanupTasks([task.id]);
  });

  test('getAgentTaskById returns null for non-existent task', async () => {
    const task = await getAgentTaskById('00000000-0000-0000-0000-000000000000');
    expect(task).toBeNull();
  });
});

// ============================================================================
// Concurrent Claims Documentation
// ============================================================================

describe('Concurrent Claims', () => {
  /**
   * Note: The current implementation uses a simple getNextTask + startTask pattern
   * which is NOT atomic. In a concurrent environment, two workers could potentially:
   * 1. Both call getNextTask and get the same task
   * 2. Both try to start it
   *
   * For production use with multiple workers, consider:
   * 1. Using database-level locking (SELECT FOR UPDATE SKIP LOCKED)
   * 2. Using atomic compare-and-swap updates (UPDATE WHERE status = 'pending')
   * 3. Using a distributed lock mechanism
   *
   * Current behavior: Last writer wins, which may cause duplicate processing
   */
  test('documents non-atomic claim behavior', async () => {
    // This test documents the current behavior, not ideal behavior
    const task = await queueTask(testAgentId, testTeamId, 'Concurrent test', 'user');

    // Simulate two "workers" getting the same task
    const worker1Task = await getNextTask(testAgentId);
    const worker2Task = await getNextTask(testAgentId);

    // Both see the same task
    expect(worker1Task!.id).toBe(task.id);
    expect(worker2Task!.id).toBe(task.id);

    // Both can start it (last writer wins)
    await startTask(worker1Task!.id);
    await startTask(worker2Task!.id);

    // Task is in_progress
    const retrieved = await getAgentTaskById(task.id);
    expect(retrieved!.status).toBe('in_progress');

    await cleanupTasks([task.id]);
  });
});
