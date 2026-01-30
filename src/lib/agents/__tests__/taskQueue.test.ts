/**
 * Tests for task queue management module
 *
 * These tests verify the high-level task queue functions that
 * wrap the lower-level database queries.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db/client';
import { users, entities, agents, agentTasks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

// Import task queue functions
import {
  queueUserTask,
  queueSystemTask,
  queueSelfTask,
  queueDelegationTask,
  getQueueStatus,
  claimNextTask,
  type TaskEntityInfo,
} from '@/lib/agents/taskQueue';

// Import lower-level functions for verification
import { completeTaskWithResult } from '@/lib/db/queries/agentTasks';

// Helper to create entityInfo for entities
function entityInfo(entityId: string): TaskEntityInfo {
  return { entityId };
}

// ============================================================================
// Test Setup
// ============================================================================

let testUserId: string;
let testEntityId: string;
let testAgentId: string;
let testAgent2Id: string;

beforeAll(async () => {
  // Create test user
  const [user] = await db.insert(users).values({
    email: `taskqueue-module-test-${Date.now()}@example.com`,
    name: 'TaskQueue Module Test User',
  }).returning();
  testUserId = user.id;

  // Create test entity
  const [entity] = await db.insert(entities).values({
    userId: testUserId,
    type: 'team',
    name: 'TaskQueue Module Test Team',
    purpose: 'Testing task queue module',
  }).returning();
  testEntityId = entity.id;

  // Create test agents
  const [agent] = await db.insert(agents).values({
    entityId: testEntityId,
    name: 'TaskQueue Module Test Agent',
    type: 'lead',
  }).returning();
  testAgentId = agent.id;

  const [agent2] = await db.insert(agents).values({
    entityId: testEntityId,
    name: 'TaskQueue Module Test Agent 2',
    type: 'lead',
  }).returning();
  testAgent2Id = agent2.id;
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
// queueUserTask Tests
// ============================================================================

describe('queueUserTask', () => {
  test('creates a task with user source', async () => {
    const task = await queueUserTask(testAgentId, entityInfo(testEntityId), 'User message content');

    expect(task.id).toBeDefined();
    expect(task.assignedToId).toBe(testAgentId);
    expect(task.entityId).toBe(testEntityId);
    expect(task.task).toBe('User message content');
    expect(task.source).toBe('user');
    expect(task.status).toBe('pending');

    await cleanupTasks([task.id]);
  });

  test('preserves full user message', async () => {
    const longMessage = 'This is a detailed user message with multiple sentences. It contains specific instructions. The agent should process all of it.';
    const task = await queueUserTask(testAgentId, entityInfo(testEntityId), longMessage);

    expect(task.task).toBe(longMessage);

    await cleanupTasks([task.id]);
  });

  test('handles multiline user messages', async () => {
    const multilineMessage = `Line 1
Line 2
Line 3`;
    const task = await queueUserTask(testAgentId, entityInfo(testEntityId), multilineMessage);

    expect(task.task).toBe(multilineMessage);

    await cleanupTasks([task.id]);
  });
});

// ============================================================================
// queueSystemTask Tests
// ============================================================================

describe('queueSystemTask', () => {
  test('creates a task with system source', async () => {
    const task = await queueSystemTask(testAgentId, entityInfo(testEntityId), 'Bootstrap: Get to work');

    expect(task.id).toBeDefined();
    expect(task.source).toBe('system');
    expect(task.status).toBe('pending');
    expect(task.task).toBe('Bootstrap: Get to work');

    await cleanupTasks([task.id]);
  });

  test('typical bootstrap task', async () => {
    const bootstrapMessage = 'Your team has been activated. Review your mission and begin proactive work.';
    const task = await queueSystemTask(testAgentId, entityInfo(testEntityId), bootstrapMessage);

    expect(task.source).toBe('system');
    expect(task.task).toBe(bootstrapMessage);

    await cleanupTasks([task.id]);
  });
});

// ============================================================================
// queueSelfTask Tests
// ============================================================================

describe('queueSelfTask', () => {
  test('creates a task with self source', async () => {
    const task = await queueSelfTask(testAgentId, entityInfo(testEntityId), 'Proactive monitoring check');

    expect(task.id).toBeDefined();
    expect(task.source).toBe('self');
    expect(task.status).toBe('pending');
    expect(task.assignedToId).toBe(testAgentId);
    expect(task.assignedById).toBe(testAgentId); // Self-assigned

    await cleanupTasks([task.id]);
  });

  test('agent can queue multiple self tasks', async () => {
    const task1 = await queueSelfTask(testAgentId, entityInfo(testEntityId), 'Check market data');
    const task2 = await queueSelfTask(testAgentId, entityInfo(testEntityId), 'Analyze trends');
    const task3 = await queueSelfTask(testAgentId, entityInfo(testEntityId), 'Generate report');

    expect(task1.source).toBe('self');
    expect(task2.source).toBe('self');
    expect(task3.source).toBe('self');

    await cleanupTasks([task1.id, task2.id, task3.id]);
  });
});

// ============================================================================
// queueDelegationTask Tests
// ============================================================================

describe('queueDelegationTask', () => {
  test('creates a task with delegation source and correct assignedById', async () => {
    const task = await queueDelegationTask(
      testAgentId,  // assigned TO
      entityInfo(testEntityId),
      'Research this topic',
      testAgent2Id  // assigned BY
    );

    expect(task.id).toBeDefined();
    expect(task.source).toBe('delegation');
    expect(task.status).toBe('pending');
    expect(task.assignedToId).toBe(testAgentId);
    expect(task.assignedById).toBe(testAgent2Id);

    await cleanupTasks([task.id]);
  });

  test('delegation tracks the delegating agent', async () => {
    const task = await queueDelegationTask(
      testAgentId,
      entityInfo(testEntityId),
      'Delegated work item',
      testAgent2Id
    );

    // The assignedById is different from assignedToId
    expect(task.assignedById).not.toBe(task.assignedToId);
    expect(task.assignedById).toBe(testAgent2Id);
    expect(task.assignedToId).toBe(testAgentId);

    await cleanupTasks([task.id]);
  });
});

// ============================================================================
// getQueueStatus Tests
// ============================================================================

describe('getQueueStatus', () => {
  test('returns empty status when no tasks', async () => {
    const status = await getQueueStatus(testAgentId);

    expect(status.hasPendingWork).toBe(false);
    expect(status.pendingCount).toBe(0);
  });

  test('counts pending tasks correctly', async () => {
    const task1 = await queueUserTask(testAgentId, entityInfo(testEntityId), 'Task 1');
    const task2 = await queueUserTask(testAgentId, entityInfo(testEntityId), 'Task 2');
    const task3 = await queueUserTask(testAgentId, entityInfo(testEntityId), 'Task 3');

    const status = await getQueueStatus(testAgentId);

    expect(status.hasPendingWork).toBe(true);
    expect(status.pendingCount).toBe(3);

    await cleanupTasks([task1.id, task2.id, task3.id]);
  });

  test('excludes completed tasks from counts', async () => {
    const pending = await queueUserTask(testAgentId, entityInfo(testEntityId), 'Pending');
    const completed = await queueUserTask(testAgentId, entityInfo(testEntityId), 'Completed');
    await completeTaskWithResult(completed.id, 'Done');

    const status = await getQueueStatus(testAgentId);

    expect(status.pendingCount).toBe(1);

    await cleanupTasks([pending.id, completed.id]);
  });

  test('hasPendingWork is true with any actionable task', async () => {
    // Only pending
    const pending = await queueUserTask(testAgentId, entityInfo(testEntityId), 'Pending');

    const status = await getQueueStatus(testAgentId);
    expect(status.hasPendingWork).toBe(true);

    await cleanupTasks([pending.id]);
  });

  test('returns status for specific agent only', async () => {
    const agent1Task = await queueUserTask(testAgentId, entityInfo(testEntityId), 'Agent 1 task');
    const agent2Task = await queueUserTask(testAgent2Id, entityInfo(testEntityId), 'Agent 2 task');

    const agent1Status = await getQueueStatus(testAgentId);
    const agent2Status = await getQueueStatus(testAgent2Id);

    expect(agent1Status.pendingCount).toBe(1);
    expect(agent2Status.pendingCount).toBe(1);

    await cleanupTasks([agent1Task.id, agent2Task.id]);
  });
});

// ============================================================================
// claimNextTask Tests
// ============================================================================

describe('claimNextTask', () => {
  test('returns null when no pending tasks', async () => {
    const claimed = await claimNextTask(testAgentId);
    expect(claimed).toBeNull();
  });

  test('claims oldest pending task (FIFO)', async () => {
    const task1 = await queueUserTask(testAgentId, entityInfo(testEntityId), 'First task');
    await new Promise(resolve => setTimeout(resolve, 10));
    const task2 = await queueUserTask(testAgentId, entityInfo(testEntityId), 'Second task');

    const claimed = await claimNextTask(testAgentId);

    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe(task1.id);

    await cleanupTasks([task1.id, task2.id]);
  });

  test('subsequent claims get next pending task', async () => {
    const task1 = await queueUserTask(testAgentId, entityInfo(testEntityId), 'First');
    await new Promise(resolve => setTimeout(resolve, 10));
    const task2 = await queueUserTask(testAgentId, entityInfo(testEntityId), 'Second');
    await new Promise(resolve => setTimeout(resolve, 10));
    const task3 = await queueUserTask(testAgentId, entityInfo(testEntityId), 'Third');

    const claimed1 = await claimNextTask(testAgentId);
    expect(claimed1!.id).toBe(task1.id);
    await completeTaskWithResult(task1.id, 'Done 1');

    const claimed2 = await claimNextTask(testAgentId);
    expect(claimed2!.id).toBe(task2.id);
    await completeTaskWithResult(task2.id, 'Done 2');

    const claimed3 = await claimNextTask(testAgentId);
    expect(claimed3!.id).toBe(task3.id);
    await completeTaskWithResult(task3.id, 'Done 3');

    const claimed4 = await claimNextTask(testAgentId);
    expect(claimed4).toBeNull();

    await cleanupTasks([task1.id, task2.id, task3.id]);
  });

  test('does not claim completed tasks', async () => {
    const completed = await queueUserTask(testAgentId, entityInfo(testEntityId), 'Completed');
    await completeTaskWithResult(completed.id, 'Done');

    const pending = await queueUserTask(testAgentId, entityInfo(testEntityId), 'Pending');

    const claimed = await claimNextTask(testAgentId);

    expect(claimed!.id).toBe(pending.id);

    await cleanupTasks([completed.id, pending.id]);
  });

  test('only claims tasks for the specific agent', async () => {
    const agent2Task = await queueUserTask(testAgent2Id, entityInfo(testEntityId), 'Agent 2 task');

    const claimedAgent1 = await claimNextTask(testAgentId);
    expect(claimedAgent1).toBeNull();

    const claimedAgent2 = await claimNextTask(testAgent2Id);
    expect(claimedAgent2).not.toBeNull();
    expect(claimedAgent2!.id).toBe(agent2Task.id);

    await cleanupTasks([agent2Task.id]);
  });
});

// ============================================================================
// Integration Tests - Full Workflow
// ============================================================================

describe('Full Workflow', () => {
  test('user task workflow: queue -> claim -> complete', async () => {
    // 1. User sends message
    const task = await queueUserTask(testAgentId, entityInfo(testEntityId), 'User: What is 2+2?');
    expect(task.source).toBe('user');
    expect(task.status).toBe('pending');

    // 2. Check queue status
    let status = await getQueueStatus(testAgentId);
    expect(status.hasPendingWork).toBe(true);
    expect(status.pendingCount).toBe(1);

    // 3. Claim task
    const claimed = await claimNextTask(testAgentId);
    expect(claimed!.id).toBe(task.id);

    // 4. Check status during processing
    status = await getQueueStatus(testAgentId);
    expect(status.pendingCount).toBe(1);
    expect(status.hasPendingWork).toBe(true);

    // 5. Complete task
    await completeTaskWithResult(task.id, 'The answer is 4');

    // 6. Final status
    status = await getQueueStatus(testAgentId);
    expect(status.hasPendingWork).toBe(false);

    await cleanupTasks([task.id]);
  });

  test('system bootstrap workflow', async () => {
    // 1. System queues bootstrap task when team activated
    const task = await queueSystemTask(
      testAgentId,
      entityInfo(testEntityId),
      'Your team has been activated. Review your mission and begin proactive work.'
    );
    expect(task.source).toBe('system');

    // 2. Claim and process
    const claimed = await claimNextTask(testAgentId);
    expect(claimed!.source).toBe('system');

    await completeTaskWithResult(task.id, 'Initialized and ready');

    await cleanupTasks([task.id]);
  });

  test('proactive self-task workflow', async () => {
    // 1. Agent queues proactive work
    const task = await queueSelfTask(testAgentId, entityInfo(testEntityId), 'Check for new market data');
    expect(task.source).toBe('self');
    expect(task.assignedById).toBe(testAgentId);

    // 2. Process
    const claimed = await claimNextTask(testAgentId);
    expect(claimed!.source).toBe('self');

    await completeTaskWithResult(task.id, 'No significant changes detected');

    await cleanupTasks([task.id]);
  });

  test('delegation workflow', async () => {
    // 1. Team lead delegates to subordinate
    const task = await queueDelegationTask(
      testAgentId,    // subordinate
      entityInfo(testEntityId),
      'Research NVIDIA earnings report',
      testAgent2Id    // team lead
    );
    expect(task.source).toBe('delegation');
    expect(task.assignedById).toBe(testAgent2Id);

    // 2. Subordinate claims and processes
    const claimed = await claimNextTask(testAgentId);
    expect(claimed!.id).toBe(task.id);

    await completeTaskWithResult(task.id, 'NVIDIA reported $X billion revenue');

    await cleanupTasks([task.id]);
  });

  test('mixed task sources maintain FIFO ordering', async () => {
    // Queue tasks from different sources
    const userTask = await queueUserTask(testAgentId, entityInfo(testEntityId), 'User task');
    await new Promise(resolve => setTimeout(resolve, 10));
    const systemTask = await queueSystemTask(testAgentId, entityInfo(testEntityId), 'System task');
    await new Promise(resolve => setTimeout(resolve, 10));
    const selfTask = await queueSelfTask(testAgentId, entityInfo(testEntityId), 'Self task');

    // Claim in FIFO order regardless of source
    const claim1 = await claimNextTask(testAgentId);
    expect(claim1!.id).toBe(userTask.id);
    await completeTaskWithResult(userTask.id, 'Done user');

    const claim2 = await claimNextTask(testAgentId);
    expect(claim2!.id).toBe(systemTask.id);
    await completeTaskWithResult(systemTask.id, 'Done system');

    const claim3 = await claimNextTask(testAgentId);
    expect(claim3!.id).toBe(selfTask.id);
    await completeTaskWithResult(selfTask.id, 'Done self');

    await cleanupTasks([userTask.id, systemTask.id, selfTask.id]);
  });

});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  test('handles rapid task creation', async () => {
    const tasks = await Promise.all([
      queueUserTask(testAgentId, entityInfo(testEntityId), 'Task 1'),
      queueUserTask(testAgentId, entityInfo(testEntityId), 'Task 2'),
      queueUserTask(testAgentId, entityInfo(testEntityId), 'Task 3'),
    ]);

    const status = await getQueueStatus(testAgentId);
    expect(status.pendingCount).toBe(3);

    await cleanupTasks(tasks.map(t => t.id));
  });

  test('handles empty task content', async () => {
    const task = await queueUserTask(testAgentId, entityInfo(testEntityId), '');

    expect(task.task).toBe('');

    await cleanupTasks([task.id]);
  });

  test('handles agent with no team context', async () => {
    // Create a task for an agent and verify team association
    const task = await queueUserTask(testAgentId, entityInfo(testEntityId), 'Task with team');

    expect(task.entityId).toBe(testEntityId);

    await cleanupTasks([task.id]);
  });
});

// ============================================================================
// Aide Entity Type Tests
// ============================================================================

describe('Aide Entity Type', () => {
  let testAideEntityId: string;
  let testAideAgentId: string;

  beforeAll(async () => {
    // Create an aide entity for testing
    const [aideEntity] = await db.insert(entities).values({
      userId: testUserId,
      type: 'aide',
      name: 'Task Queue Test Aide',
      status: 'active',
    }).returning();
    testAideEntityId = aideEntity.id;

    // Create an agent for the aide entity
    const [aideAgent] = await db.insert(agents).values({
      entityId: testAideEntityId,
      name: 'Task Queue Test Aide Agent',
      type: 'lead',
    }).returning();
    testAideAgentId = aideAgent.id;
  });

  afterAll(async () => {
    // Cleanup aide entity (cascades to agents)
    await db.delete(entities).where(eq(entities.id, testAideEntityId));
  });

  test('queueUserTask with aide entity sets entityId correctly', async () => {
    const task = await queueUserTask(testAideAgentId, entityInfo(testAideEntityId), 'Aide user task');

    expect(task.entityId).toBe(testAideEntityId);
    expect(task.source).toBe('user');

    await cleanupTasks([task.id]);
  });

  test('queueSystemTask with aide entity sets entityId correctly', async () => {
    const task = await queueSystemTask(testAideAgentId, entityInfo(testAideEntityId), 'Aide system task');

    expect(task.entityId).toBe(testAideEntityId);
    expect(task.source).toBe('system');

    await cleanupTasks([task.id]);
  });

  test('queueSelfTask with aide entity sets entityId correctly', async () => {
    const task = await queueSelfTask(testAideAgentId, entityInfo(testAideEntityId), 'Aide self task');

    expect(task.entityId).toBe(testAideEntityId);
    expect(task.source).toBe('self');

    await cleanupTasks([task.id]);
  });

  test('queueDelegationTask with aide entity sets entityId correctly', async () => {
    const task = await queueDelegationTask(
      testAideAgentId,
      entityInfo(testAideEntityId),
      'Aide delegation task',
      testAideAgentId
    );

    expect(task.entityId).toBe(testAideEntityId);
    expect(task.source).toBe('delegation');

    await cleanupTasks([task.id]);
  });

  test('aide entity tasks can be claimed and processed', async () => {
    const task = await queueUserTask(testAideAgentId, entityInfo(testAideEntityId), 'Claimable aide task');

    const claimed = await claimNextTask(testAideAgentId);

    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe(task.id);
    expect(claimed!.entityId).toBe(testAideEntityId);

    await cleanupTasks([task.id]);
  });

  test('getQueueStatus works for aide entity agents', async () => {
    const task1 = await queueUserTask(testAideAgentId, entityInfo(testAideEntityId), 'Aide task 1');
    const task2 = await queueUserTask(testAideAgentId, entityInfo(testAideEntityId), 'Aide task 2');

    const status = await getQueueStatus(testAideAgentId);

    expect(status.hasPendingWork).toBe(true);
    expect(status.pendingCount).toBe(2);

    await cleanupTasks([task1.id, task2.id]);
  });

  test('full workflow with aide entity', async () => {
    // 1. Queue task
    const task = await queueUserTask(testAideAgentId, entityInfo(testAideEntityId), 'Full workflow aide task');
    expect(task.entityId).toBe(testAideEntityId);

    // 2. Check status
    let status = await getQueueStatus(testAideAgentId);
    expect(status.hasPendingWork).toBe(true);

    // 3. Claim
    const claimed = await claimNextTask(testAideAgentId);
    expect(claimed!.id).toBe(task.id);

    // 4. Complete
    await completeTaskWithResult(task.id, 'Done');

    // 5. Verify completion
    status = await getQueueStatus(testAideAgentId);
    expect(status.hasPendingWork).toBe(false);

    await cleanupTasks([task.id]);
  });
});
