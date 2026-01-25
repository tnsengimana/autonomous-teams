/**
 * Tests for Agent Lifecycle - Phase 4 Implementation
 *
 * Tests cover:
 * - handleUserMessage flow (queue task, return ack)
 * - runWorkSession flow (thread creation, task processing, insight extraction)
 * - decideBriefing (team lead vs worker)
 * - Insight tools (add, list, remove)
 *
 * Uses MOCK_LLM=true for testing without real API calls.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '@/lib/db/client';
import { users, teams, agents, agentTasks, insights, threads, threadMessages, messages } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

// Import the Agent class and related functions
import { createAgent, createAgentFromData } from '@/lib/agents/agent';
import { queueUserTask, getQueueStatus } from '@/lib/agents/taskQueue';
import { registerInsightTools } from '@/lib/agents/tools/insight-tools';
import { getTool, executeTool, type ToolContext } from '@/lib/agents/tools';
import { createInsight, getInsightsByAgentId, deleteInsight } from '@/lib/db/queries/insights';
import { createThread } from '@/lib/db/queries/threads';

// ============================================================================
// Test Setup
// ============================================================================

let testUserId: string;
let testTeamId: string;
let testTeamLeadId: string;
let testWorkerId: string;

beforeAll(async () => {
  // Enable mock LLM mode for testing
  process.env.MOCK_LLM = 'true';

  // Create test user
  const [user] = await db.insert(users).values({
    email: `agent-lifecycle-test-${Date.now()}@example.com`,
    name: 'Agent Lifecycle Test User',
  }).returning();
  testUserId = user.id;

  // Create test team (active status for runWorkSession)
  const [team] = await db.insert(teams).values({
    userId: testUserId,
    name: 'Agent Lifecycle Test Team',
    purpose: 'Testing agent lifecycle methods',
    status: 'active',
  }).returning();
  testTeamId = team.id;

  // Create team lead agent (no parent)
  const [teamLead] = await db.insert(agents).values({
    teamId: testTeamId,
    name: 'Test Team Lead',
    role: 'Financial Analyst',
    parentAgentId: null,
  }).returning();
  testTeamLeadId = teamLead.id;

  // Create worker agent (has parent)
  const [worker] = await db.insert(agents).values({
    teamId: testTeamId,
    name: 'Test Worker',
    role: 'Research Assistant',
    parentAgentId: testTeamLeadId,
  }).returning();
  testWorkerId = worker.id;

  // Register insight tools
  registerInsightTools();
});

afterAll(async () => {
  // Cleanup: delete test user (cascades to teams, agents, tasks, etc.)
  await db.delete(users).where(eq(users.id, testUserId));
  delete process.env.MOCK_LLM;
});

// Helper to cleanup data created during tests
async function cleanupTestData() {
  // Clean up tasks, insights, threads, messages for test agents
  await db.delete(agentTasks).where(eq(agentTasks.teamId, testTeamId));
  await db.delete(insights).where(eq(insights.agentId, testTeamLeadId));
  await db.delete(insights).where(eq(insights.agentId, testWorkerId));
  await db.delete(threads).where(eq(threads.agentId, testTeamLeadId));
  await db.delete(threads).where(eq(threads.agentId, testWorkerId));
}

beforeEach(async () => {
  await cleanupTestData();
});

// ============================================================================
// Agent Class Basic Tests
// ============================================================================

describe('Agent Class', () => {
  test('creates agent from database ID', async () => {
    const agent = await createAgent(testTeamLeadId);

    expect(agent).not.toBeNull();
    expect(agent!.id).toBe(testTeamLeadId);
    expect(agent!.name).toBe('Test Team Lead');
    expect(agent!.role).toBe('Financial Analyst');
  });

  test('returns null for non-existent agent ID', async () => {
    const agent = await createAgent('00000000-0000-0000-0000-000000000000');
    expect(agent).toBeNull();
  });

  test('isTeamLead() returns true for team lead', async () => {
    const agent = await createAgent(testTeamLeadId);
    expect(agent!.isTeamLead()).toBe(true);
  });

  test('isTeamLead() returns false for worker', async () => {
    const agent = await createAgent(testWorkerId);
    expect(agent!.isTeamLead()).toBe(false);
  });

  test('creates agent from data object', () => {
    const data = {
      id: 'test-id',
      teamId: testTeamId,
      name: 'Direct Agent',
      role: 'Tester',
      parentAgentId: null,
      systemPrompt: null,
      status: 'idle' as const,
      nextRunAt: null,
      lastCompletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const agent = createAgentFromData(data);
    expect(agent.id).toBe('test-id');
    expect(agent.name).toBe('Direct Agent');
    expect(agent.isTeamLead()).toBe(true);
  });
});

// ============================================================================
// handleUserMessage Tests
// ============================================================================

describe('handleUserMessage', () => {
  test('queues task with source=user', async () => {
    const agent = await createAgent(testTeamLeadId);
    const userMessage = 'What is the current price of NVDA?';

    // Call handleUserMessage (uses mock LLM)
    const stream = await agent!.handleUserMessage(userMessage);

    // Consume the stream
    for await (const _ of stream) { /* consume */ }

    // Verify task was queued
    const status = await getQueueStatus(testTeamLeadId);
    expect(status.hasPendingWork).toBe(true);
    expect(status.pendingCount).toBe(1);

    // Verify task has correct source
    const [task] = await db.select().from(agentTasks)
      .where(and(
        eq(agentTasks.assignedToId, testTeamLeadId),
        eq(agentTasks.status, 'pending')
      ));
    expect(task.source).toBe('user');
    expect(task.task).toBe(userMessage);
  });

  test('returns acknowledgment stream', async () => {
    const agent = await createAgent(testTeamLeadId);
    const stream = await agent!.handleUserMessage('Tell me about NVIDIA');

    // Consume the stream and verify it yields chunks
    let fullResponse = '';
    let chunkCount = 0;
    for await (const chunk of stream) {
      fullResponse += chunk;
      chunkCount++;
    }

    // Should have yielded multiple chunks (word by word)
    expect(chunkCount).toBeGreaterThan(1);
    // Content should be non-empty (mock response)
    expect(fullResponse.trim().length).toBeGreaterThan(0);
  });

  test('adds user message and acknowledgment to conversation', async () => {
    const agent = await createAgent(testTeamLeadId);
    const userMessage = 'Check my portfolio';

    // Call handleUserMessage
    const stream = await agent!.handleUserMessage(userMessage);
    for await (const _ of stream) { /* consume stream */ }

    // Get conversation and messages
    const conversation = await agent!.getConversation();
    const conversationMessages = await db.select().from(messages)
      .where(eq(messages.conversationId, conversation.id));

    // Should have at least 2 messages (user + assistant acknowledgment)
    expect(conversationMessages.length).toBeGreaterThanOrEqual(2);

    // Find user message
    const userMsg = conversationMessages.find(m => m.role === 'user' && m.content === userMessage);
    expect(userMsg).toBeDefined();

    // Find assistant acknowledgment
    const assistantMsg = conversationMessages.find(m => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
  });

  test('loads memories before generating acknowledgment', async () => {
    const agent = await createAgent(testTeamLeadId);

    // Initially no memories loaded
    expect(agent!.getMemories()).toHaveLength(0);

    const stream = await agent!.handleUserMessage('Test message');
    for await (const _ of stream) { /* consume stream */ }

    // Memories should now be loaded (empty array, but loaded)
    expect(agent!.getMemories()).toEqual([]);
  });
});

// ============================================================================
// runWorkSession Tests
// ============================================================================

describe('runWorkSession', () => {
  test('skips session when no pending work', async () => {
    const agent = await createAgent(testTeamLeadId);

    // Verify no pending work
    const statusBefore = await getQueueStatus(testTeamLeadId);
    expect(statusBefore.hasPendingWork).toBe(false);

    // Run work session - should complete without creating thread
    await agent!.runWorkSession();

    // Verify no thread was created
    const threadList = await db.select().from(threads)
      .where(eq(threads.agentId, testTeamLeadId));
    expect(threadList.length).toBe(0);
  });

  test('creates new thread for session', async () => {
    // Queue a task first
    await queueUserTask(testTeamLeadId, testTeamId, 'Test task');

    const agent = await createAgent(testTeamLeadId);
    await agent!.runWorkSession();

    // Verify thread was created
    const threadList = await db.select().from(threads)
      .where(eq(threads.agentId, testTeamLeadId));
    expect(threadList.length).toBeGreaterThan(0);
  });

  test('processes pending tasks in queue', async () => {
    // Queue multiple tasks
    await queueUserTask(testTeamLeadId, testTeamId, 'Task 1');
    await queueUserTask(testTeamLeadId, testTeamId, 'Task 2');

    const statusBefore = await getQueueStatus(testTeamLeadId);
    expect(statusBefore.pendingCount).toBe(2);

    const agent = await createAgent(testTeamLeadId);
    await agent!.runWorkSession();

    // All tasks should be processed (no pending)
    const statusAfter = await getQueueStatus(testTeamLeadId);
    expect(statusAfter.pendingCount).toBe(0);
    expect(statusAfter.inProgressCount).toBe(0);
  });

  test('loads insights not memories for background work', async () => {
    // Create some insights for the agent
    await createInsight(testTeamLeadId, 'fact', 'NVIDIA is a GPU company', undefined, 0.9);
    await createInsight(testTeamLeadId, 'pattern', 'Tech stocks rise in Q4', undefined, 0.7);

    // Queue a task
    await queueUserTask(testTeamLeadId, testTeamId, 'Analyze market');

    const agent = await createAgent(testTeamLeadId);

    // Before session, no insights loaded
    expect(agent!.getInsights()).toHaveLength(0);

    await agent!.runWorkSession();

    // After session, insights should be loaded
    expect(agent!.getInsights()).toHaveLength(2);
  });

  test('team lead schedules next run after session', async () => {
    // Queue a task
    await queueUserTask(testTeamLeadId, testTeamId, 'Test task');

    const agent = await createAgent(testTeamLeadId);
    await agent!.runWorkSession();

    // Check that nextRunAt was set
    const [updatedAgent] = await db.select().from(agents)
      .where(eq(agents.id, testTeamLeadId));
    expect(updatedAgent.nextRunAt).not.toBeNull();

    // Should be approximately 1 hour in the future
    const nextRun = new Date(updatedAgent.nextRunAt!);
    const now = new Date();
    const diffHours = (nextRun.getTime() - now.getTime()) / (1000 * 60 * 60);
    expect(diffHours).toBeGreaterThan(0.9);
    expect(diffHours).toBeLessThan(1.1);
  });

  test('worker does not schedule next run', async () => {
    // Queue a task for worker
    await queueUserTask(testWorkerId, testTeamId, 'Worker task');

    const agent = await createAgent(testWorkerId);
    await agent!.runWorkSession();

    // Worker should not have nextRunAt set
    const [updatedAgent] = await db.select().from(agents)
      .where(eq(agents.id, testWorkerId));
    expect(updatedAgent.nextRunAt).toBeNull();
  });
});

// ============================================================================
// processTaskInThread Tests
// ============================================================================

describe('processTaskInThread', () => {
  test('adds task as user message to thread', async () => {
    // Create a thread manually
    const thread = await createThread(testTeamLeadId);

    // Queue a task
    const task = await queueUserTask(testTeamLeadId, testTeamId, 'Analyze TSLA stock');

    // Claim the task
    const { startTask } = await import('@/lib/db/queries/agentTasks');
    const claimedTask = await startTask(task.id);

    const agent = await createAgent(testTeamLeadId);
    await agent!.processTaskInThread(thread.id, claimedTask);

    // Verify thread has messages
    const threadMsgs = await db.select().from(threadMessages)
      .where(eq(threadMessages.threadId, thread.id));

    expect(threadMsgs.length).toBeGreaterThanOrEqual(2);

    // First message should be user (task)
    const userMsg = threadMsgs.find(m => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).toContain('TSLA');

    // Should have assistant response
    const assistantMsg = threadMsgs.find(m => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
  });

  test('marks task complete with result', async () => {
    const thread = await createThread(testTeamLeadId);
    const task = await queueUserTask(testTeamLeadId, testTeamId, 'Complete this');

    const { startTask } = await import('@/lib/db/queries/agentTasks');
    const claimedTask = await startTask(task.id);

    const agent = await createAgent(testTeamLeadId);
    const result = await agent!.processTaskInThread(thread.id, claimedTask);

    // Result should be non-empty (mock response)
    expect(result.length).toBeGreaterThan(0);

    // Verify task is completed
    const [updatedTask] = await db.select().from(agentTasks)
      .where(eq(agentTasks.id, task.id));
    expect(updatedTask.status).toBe('completed');
    expect(updatedTask.result).not.toBeNull();
  });
});

// ============================================================================
// decideBriefing Tests
// ============================================================================

describe('decideBriefing', () => {
  test('team lead decideBriefing does not error with empty thread', async () => {
    // Create a thread with no messages
    const thread = await createThread(testTeamLeadId);

    const agent = await createAgent(testTeamLeadId);

    // Should not throw - just return early
    await expect(agent!.decideBriefing(thread.id)).resolves.not.toThrow();
  });

  test('worker agent does not create briefings', async () => {
    const thread = await createThread(testWorkerId);
    await db.insert(threadMessages).values({
      threadId: thread.id,
      role: 'assistant',
      content: 'Worker completed task with important info.',
      sequenceNumber: 1,
    });

    const agent = await createAgent(testWorkerId);

    // Get conversation before
    const conversationBefore = await agent!.getConversation();
    const messagesBefore = await db.select().from(messages)
      .where(eq(messages.conversationId, conversationBefore.id));
    const countBefore = messagesBefore.length;

    await agent!.decideBriefing(thread.id);

    // Worker should not add any messages (decideBriefing returns early for workers)
    const messagesAfter = await db.select().from(messages)
      .where(eq(messages.conversationId, conversationBefore.id));
    expect(messagesAfter.length).toBe(countBefore);
  });

  test('isTeamLead check works in decideBriefing', async () => {
    const workerAgent = await createAgent(testWorkerId);
    const teamLeadAgent = await createAgent(testTeamLeadId);

    expect(workerAgent!.isTeamLead()).toBe(false);
    expect(teamLeadAgent!.isTeamLead()).toBe(true);
  });
});

// ============================================================================
// Insight Tools Tests
// ============================================================================

describe('Insight Tools', () => {
  const toolContext: ToolContext = {
    agentId: '',
    teamId: '',
    isTeamLead: true,
  };

  beforeEach(() => {
    toolContext.agentId = testTeamLeadId;
    toolContext.teamId = testTeamId;
  });

  describe('addInsight', () => {
    test('stores fact insight successfully', async () => {
      const tool = getTool('addInsight');
      expect(tool).toBeDefined();

      const result = await executeTool('addInsight', {
        type: 'fact',
        content: 'NVIDIA dominates the AI chip market',
        confidence: 0.95,
      }, toolContext);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('insightId');

      // Verify in database
      const agentInsights = await getInsightsByAgentId(testTeamLeadId);
      expect(agentInsights.some(i => i.content === 'NVIDIA dominates the AI chip market')).toBe(true);
    });

    test('stores technique insight successfully', async () => {
      const result = await executeTool('addInsight', {
        type: 'technique',
        content: 'Use RSI indicators for timing entries',
      }, toolContext);

      expect(result.success).toBe(true);

      const agentInsights = await getInsightsByAgentId(testTeamLeadId);
      const technique = agentInsights.find(i => i.type === 'technique');
      expect(technique).toBeDefined();
      expect(technique!.content).toContain('RSI');
    });

    test('stores pattern insight successfully', async () => {
      const result = await executeTool('addInsight', {
        type: 'pattern',
        content: 'Tech stocks rally after earnings beats',
        confidence: 0.8,
      }, toolContext);

      expect(result.success).toBe(true);

      const agentInsights = await getInsightsByAgentId(testTeamLeadId);
      const pattern = agentInsights.find(i => i.type === 'pattern');
      expect(pattern).toBeDefined();
      expect(pattern!.confidence).toBe(0.8);
    });

    test('stores lesson insight successfully', async () => {
      const result = await executeTool('addInsight', {
        type: 'lesson',
        content: 'Never chase momentum after major news',
      }, toolContext);

      expect(result.success).toBe(true);

      const agentInsights = await getInsightsByAgentId(testTeamLeadId);
      const lesson = agentInsights.find(i => i.type === 'lesson');
      expect(lesson).toBeDefined();
    });

    test('fails with invalid type', async () => {
      const result = await executeTool('addInsight', {
        type: 'invalid_type',
        content: 'Some content',
      }, toolContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid parameters');
    });

    test('fails with empty content', async () => {
      const result = await executeTool('addInsight', {
        type: 'fact',
        content: '',
      }, toolContext);

      expect(result.success).toBe(false);
    });
  });

  describe('listInsights', () => {
    test('lists all insights for agent', async () => {
      // Create some insights
      await createInsight(testTeamLeadId, 'fact', 'Fact 1', undefined, 0.9);
      await createInsight(testTeamLeadId, 'technique', 'Technique 1', undefined, 0.8);
      await createInsight(testTeamLeadId, 'pattern', 'Pattern 1', undefined, 0.7);

      const result = await executeTool('listInsights', {}, toolContext);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('count');
      expect(result.data).toHaveProperty('insights');
      expect((result.data as { count: number }).count).toBe(3);
    });

    test('filters by type', async () => {
      await createInsight(testTeamLeadId, 'fact', 'Fact A');
      await createInsight(testTeamLeadId, 'fact', 'Fact B');
      await createInsight(testTeamLeadId, 'technique', 'Technique A');

      const result = await executeTool('listInsights', {
        type: 'fact',
      }, toolContext);

      expect(result.success).toBe(true);
      const data = result.data as { count: number; insights: Array<{ type: string }> };
      expect(data.count).toBe(2);
      expect(data.insights.every(i => i.type === 'fact')).toBe(true);
    });

    test('respects limit parameter', async () => {
      // Create 5 insights
      for (let i = 0; i < 5; i++) {
        await createInsight(testTeamLeadId, 'fact', `Fact ${i}`);
      }

      const result = await executeTool('listInsights', {
        limit: 3,
      }, toolContext);

      expect(result.success).toBe(true);
      const data = result.data as { count: number };
      expect(data.count).toBe(3);
    });

    test('returns empty array when no insights', async () => {
      const result = await executeTool('listInsights', {}, toolContext);

      expect(result.success).toBe(true);
      const data = result.data as { count: number; insights: unknown[] };
      expect(data.count).toBe(0);
      expect(data.insights).toEqual([]);
    });
  });

  describe('removeInsight', () => {
    test('removes existing insight', async () => {
      const insight = await createInsight(testTeamLeadId, 'fact', 'To be deleted');

      const result = await executeTool('removeInsight', {
        insightId: insight.id,
      }, toolContext);

      expect(result.success).toBe(true);

      // Verify deleted
      const agentInsights = await getInsightsByAgentId(testTeamLeadId);
      expect(agentInsights.find(i => i.id === insight.id)).toBeUndefined();
    });

    test('fails for non-existent insight', async () => {
      const result = await executeTool('removeInsight', {
        insightId: '00000000-0000-0000-0000-000000000000',
      }, toolContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    test('fails for insight belonging to another agent', async () => {
      // Create insight for worker
      const insight = await createInsight(testWorkerId, 'fact', 'Worker insight');

      // Try to delete from team lead context
      const result = await executeTool('removeInsight', {
        insightId: insight.id,
      }, toolContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('other agents');

      // Cleanup
      await deleteInsight(insight.id);
    });

    test('fails with invalid UUID format', async () => {
      const result = await executeTool('removeInsight', {
        insightId: 'not-a-uuid',
      }, toolContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid parameters');
    });
  });
});

// ============================================================================
// Insights Context Building Tests
// ============================================================================

describe('Insights Context', () => {
  test('buildBackgroundSystemPrompt includes insights', async () => {
    // Create some insights
    await createInsight(testTeamLeadId, 'fact', 'Important domain fact');
    await createInsight(testTeamLeadId, 'technique', 'Useful technique');

    const agent = await createAgent(testTeamLeadId);
    await agent!.loadInsights();

    const systemPrompt = agent!.buildBackgroundSystemPrompt();

    expect(systemPrompt).toContain('professional_knowledge');
    expect(systemPrompt).toContain('Important domain fact');
    expect(systemPrompt).toContain('Useful technique');
  });

  test('buildBackgroundSystemPrompt handles no insights', async () => {
    const agent = await createAgent(testTeamLeadId);
    await agent!.loadInsights();

    const systemPrompt = agent!.buildBackgroundSystemPrompt();

    // Should just be the base system prompt without insights block
    expect(systemPrompt).not.toContain('professional_knowledge');
  });
});

// ============================================================================
// Agent Status Tests
// ============================================================================

describe('Agent Status', () => {
  test('setStatus updates agent status', async () => {
    const agent = await createAgent(testTeamLeadId);

    await agent!.setStatus('running');

    const [updated] = await db.select().from(agents)
      .where(eq(agents.id, testTeamLeadId));
    expect(updated.status).toBe('running');

    await agent!.setStatus('idle');

    const [final] = await db.select().from(agents)
      .where(eq(agents.id, testTeamLeadId));
    expect(final.status).toBe('idle');
  });

  test('runWorkSession sets status to running then idle', async () => {
    await queueUserTask(testTeamLeadId, testTeamId, 'Test task');

    const agent = await createAgent(testTeamLeadId);
    await agent!.runWorkSession();

    // After session, status should be idle
    const [updated] = await db.select().from(agents)
      .where(eq(agents.id, testTeamLeadId));
    expect(updated.status).toBe('idle');
  });
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases', () => {
  test('handleUserMessage handles empty message', async () => {
    const agent = await createAgent(testTeamLeadId);
    const stream = await agent!.handleUserMessage('');

    let response = '';
    for await (const chunk of stream) {
      response += chunk;
    }

    expect(response).toBeTruthy();

    // Task should still be queued
    const status = await getQueueStatus(testTeamLeadId);
    expect(status.pendingCount).toBe(1);
  });

  test('multiple concurrent handleUserMessage calls queue tasks correctly', async () => {
    const agent = await createAgent(testTeamLeadId);

    // Send multiple messages concurrently
    const promises = [
      agent!.handleUserMessage('Message 1'),
      agent!.handleUserMessage('Message 2'),
      agent!.handleUserMessage('Message 3'),
    ];

    const streams = await Promise.all(promises);

    // Consume all streams
    for (const stream of streams) {
      for await (const _ of stream) { /* consume */ }
    }

    // All tasks should be queued
    const status = await getQueueStatus(testTeamLeadId);
    expect(status.pendingCount).toBe(3);
  });
});
