import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db/client';
import {
  users, teams, agents, conversations, messages, knowledgeItems, agentTasks
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

// Test utilities
let testUserId: string;
let testTeamId: string;
let testAgentId: string;

beforeAll(async () => {
  // Create test user
  const [user] = await db.insert(users).values({
    email: `test-${Date.now()}@example.com`,
    name: 'Test User',
  }).returning();
  testUserId = user.id;

  // Create test team
  const [team] = await db.insert(teams).values({
    userId: testUserId,
    name: 'Test Team',
    purpose: 'Testing',
  }).returning();
  testTeamId = team.id;

  // Create test agent
  const [agent] = await db.insert(agents).values({
    teamId: testTeamId,
    name: 'Test Agent',
    type: 'lead',
  }).returning();
  testAgentId = agent.id;
});

afterAll(async () => {
  // Cleanup: delete test user (cascades to teams, agents, etc.)
  await db.delete(users).where(eq(users.id, testUserId));
});

describe('conversations schema', () => {
  test('creates conversation for agent', async () => {
    const [conversation] = await db.insert(conversations).values({
      agentId: testAgentId,
      mode: 'foreground',
    }).returning();

    expect(conversation.agentId).toBe(testAgentId);
    expect(conversation.mode).toBe('foreground');
    expect(conversation.createdAt).toBeDefined();

    // Cleanup
    await db.delete(conversations).where(eq(conversations.id, conversation.id));
  });

  test('cascades delete when agent deleted', async () => {
    // Create a separate agent for this test
    const [tempAgent] = await db.insert(agents).values({
      teamId: testTeamId,
      name: 'Temp Agent',
      type: 'subordinate',
    }).returning();

    const [conversation] = await db.insert(conversations).values({
      agentId: tempAgent.id,
      mode: 'background',
    }).returning();

    // Delete the agent
    await db.delete(agents).where(eq(agents.id, tempAgent.id));

    // Conversation should be gone
    const remainingConversations = await db.select().from(conversations).where(eq(conversations.id, conversation.id));
    expect(remainingConversations).toHaveLength(0);
  });

  test('supports foreground and background modes', async () => {
    const [foreground] = await db.insert(conversations).values({
      agentId: testAgentId,
      mode: 'foreground',
    }).returning();

    const [background] = await db.insert(conversations).values({
      agentId: testAgentId,
      mode: 'background',
    }).returning();

    expect(foreground.mode).toBe('foreground');
    expect(background.mode).toBe('background');

    // Cleanup
    await db.delete(conversations).where(eq(conversations.id, foreground.id));
    await db.delete(conversations).where(eq(conversations.id, background.id));
  });
});

describe('messages schema', () => {
  test('creates message in conversation', async () => {
    const [conversation] = await db.insert(conversations).values({
      agentId: testAgentId,
    }).returning();

    const [message] = await db.insert(messages).values({
      conversationId: conversation.id,
      role: 'user',
      content: 'Test message',
    }).returning();

    expect(message.conversationId).toBe(conversation.id);
    expect(message.role).toBe('user');
    expect(message.content).toBe('Test message');

    // Cleanup
    await db.delete(conversations).where(eq(conversations.id, conversation.id));
  });

  test('cascades delete when conversation deleted', async () => {
    const [conversation] = await db.insert(conversations).values({
      agentId: testAgentId,
    }).returning();

    await db.insert(messages).values({
      conversationId: conversation.id,
      role: 'assistant',
      content: 'Response',
    });

    // Delete conversation
    await db.delete(conversations).where(eq(conversations.id, conversation.id));

    // Messages should be gone
    const remainingMessages = await db.select().from(messages).where(eq(messages.conversationId, conversation.id));
    expect(remainingMessages).toHaveLength(0);
  });

  test('stores toolCalls in jsonb field', async () => {
    const [conversation] = await db.insert(conversations).values({
      agentId: testAgentId,
    }).returning();

    const toolCalls = [
      { id: 'call_1', type: 'function', function: { name: 'search', arguments: '{"query":"test"}' } },
      { id: 'call_2', type: 'function', function: { name: 'browse', arguments: '{"url":"https://example.com"}' } },
    ];

    const [message] = await db.insert(messages).values({
      conversationId: conversation.id,
      role: 'assistant',
      content: 'Let me search for that.',
      toolCalls,
    }).returning();

    expect(message.toolCalls).toEqual(toolCalls);

    // Verify retrieval from database
    const [retrieved] = await db.select().from(messages).where(eq(messages.id, message.id));
    expect(retrieved.toolCalls).toEqual(toolCalls);

    // Cleanup
    await db.delete(conversations).where(eq(conversations.id, conversation.id));
  });

  test('links tool results via toolCallId', async () => {
    const [conversation] = await db.insert(conversations).values({
      agentId: testAgentId,
    }).returning();

    const toolCalls = [
      { id: 'call_123', type: 'function', function: { name: 'search', arguments: '{"query":"test"}' } },
    ];

    const [assistantMessage] = await db.insert(messages).values({
      conversationId: conversation.id,
      role: 'assistant',
      content: 'Let me search for that.',
      toolCalls,
    }).returning();

    const [toolResult] = await db.insert(messages).values({
      conversationId: conversation.id,
      role: 'tool',
      content: '{"results": ["result1", "result2"]}',
      toolCallId: 'call_123',
    }).returning();

    expect(toolResult.role).toBe('tool');
    expect(toolResult.toolCallId).toBe('call_123');

    // Cleanup
    await db.delete(conversations).where(eq(conversations.id, conversation.id));
  });

  test('supports summary messages with previousMessageId', async () => {
    const [conversation] = await db.insert(conversations).values({
      agentId: testAgentId,
    }).returning();

    // Create some messages
    const [msg1] = await db.insert(messages).values({
      conversationId: conversation.id,
      role: 'user',
      content: 'Hello',
    }).returning();

    const [msg2] = await db.insert(messages).values({
      conversationId: conversation.id,
      role: 'assistant',
      content: 'Hi there!',
    }).returning();

    // Create summary pointing to last summarized message
    const [summary] = await db.insert(messages).values({
      conversationId: conversation.id,
      role: 'summary',
      content: 'User greeted the assistant and received a friendly response.',
      previousMessageId: msg2.id,
    }).returning();

    expect(summary.role).toBe('summary');
    expect(summary.previousMessageId).toBe(msg2.id);

    // Cleanup
    await db.delete(conversations).where(eq(conversations.id, conversation.id));
  });
});

describe('knowledgeItems schema', () => {
  test('creates knowledge item for agent', async () => {
    const [knowledgeItem] = await db.insert(knowledgeItems).values({
      agentId: testAgentId,
      type: 'fact',
      content: 'NVIDIA reports earnings in February',
    }).returning();

    expect(knowledgeItem.agentId).toBe(testAgentId);
    expect(knowledgeItem.type).toBe('fact');
    expect(knowledgeItem.content).toBe('NVIDIA reports earnings in February');
    expect(knowledgeItem.sourceConversationId).toBeNull();

    // Cleanup
    await db.delete(knowledgeItems).where(eq(knowledgeItems.id, knowledgeItem.id));
  });

  test('links knowledge item to source conversation', async () => {
    const [conversation] = await db.insert(conversations).values({
      agentId: testAgentId,
      mode: 'background',
    }).returning();

    const [knowledgeItem] = await db.insert(knowledgeItems).values({
      agentId: testAgentId,
      type: 'technique',
      content: 'Check SEC filings first',
      sourceConversationId: conversation.id,
    }).returning();

    expect(knowledgeItem.sourceConversationId).toBe(conversation.id);

    // Cleanup
    await db.delete(conversations).where(eq(conversations.id, conversation.id));
  });

  test('nullifies sourceConversationId when conversation deleted', async () => {
    const [conversation] = await db.insert(conversations).values({
      agentId: testAgentId,
      mode: 'background',
    }).returning();

    const [knowledgeItem] = await db.insert(knowledgeItems).values({
      agentId: testAgentId,
      type: 'pattern',
      content: 'Market volatility increases before earnings',
      sourceConversationId: conversation.id,
    }).returning();

    // Delete conversation
    await db.delete(conversations).where(eq(conversations.id, conversation.id));

    // Knowledge item should remain but with null sourceConversationId
    const [updated] = await db.select().from(knowledgeItems).where(eq(knowledgeItems.id, knowledgeItem.id));
    expect(updated).toBeDefined();
    expect(updated.sourceConversationId).toBeNull();

    // Cleanup
    await db.delete(knowledgeItems).where(eq(knowledgeItems.id, knowledgeItem.id));
  });

  test('stores confidence as real number', async () => {
    const [knowledgeItem] = await db.insert(knowledgeItems).values({
      agentId: testAgentId,
      type: 'fact',
      content: 'Tech stocks tend to rally in Q4',
      confidence: 0.85,
    }).returning();

    expect(knowledgeItem.confidence).toBeCloseTo(0.85, 2);

    // Verify retrieval from database
    const [retrieved] = await db.select().from(knowledgeItems).where(eq(knowledgeItems.id, knowledgeItem.id));
    expect(retrieved.confidence).toBeCloseTo(0.85, 2);

    // Cleanup
    await db.delete(knowledgeItems).where(eq(knowledgeItems.id, knowledgeItem.id));
  });

  test('confidence defaults to null when not provided', async () => {
    const [knowledgeItem] = await db.insert(knowledgeItems).values({
      agentId: testAgentId,
      type: 'lesson',
      content: 'Always verify data sources',
    }).returning();

    expect(knowledgeItem.confidence).toBeNull();

    // Cleanup
    await db.delete(knowledgeItems).where(eq(knowledgeItems.id, knowledgeItem.id));
  });
});

describe('agentTasks schema', () => {
  test('creates task with source field', async () => {
    const [task] = await db.insert(agentTasks).values({
      teamId: testTeamId,
      assignedToId: testAgentId,
      assignedById: testAgentId,
      task: 'Test task',
      source: 'user',
    }).returning();

    expect(task.source).toBe('user');
    expect(task.status).toBe('pending');

    // Cleanup
    await db.delete(agentTasks).where(eq(agentTasks.id, task.id));
  });

  test('source defaults to delegation', async () => {
    const [task] = await db.insert(agentTasks).values({
      teamId: testTeamId,
      assignedToId: testAgentId,
      assignedById: testAgentId,
      task: 'Delegated task',
    }).returning();

    expect(task.source).toBe('delegation');

    // Cleanup
    await db.delete(agentTasks).where(eq(agentTasks.id, task.id));
  });

  test('supports all source types', async () => {
    const sourceTypes = ['delegation', 'user', 'system', 'self'] as const;
    const createdTaskIds: string[] = [];

    for (const source of sourceTypes) {
      const [task] = await db.insert(agentTasks).values({
        teamId: testTeamId,
        assignedToId: testAgentId,
        assignedById: testAgentId,
        task: `Task from ${source}`,
        source,
      }).returning();

      expect(task.source).toBe(source);
      createdTaskIds.push(task.id);
    }

    // Cleanup
    for (const taskId of createdTaskIds) {
      await db.delete(agentTasks).where(eq(agentTasks.id, taskId));
    }
  });

  test('supports status transitions', async () => {
    const [task] = await db.insert(agentTasks).values({
      teamId: testTeamId,
      assignedToId: testAgentId,
      assignedById: testAgentId,
      task: 'Status transition test',
      source: 'system',
    }).returning();

    expect(task.status).toBe('pending');

    // Transition to completed
    const completedAt = new Date();
    await db.update(agentTasks)
      .set({ status: 'completed', completedAt, result: 'Task completed successfully' })
      .where(eq(agentTasks.id, task.id));

    const [updated] = await db.select().from(agentTasks).where(eq(agentTasks.id, task.id));
    expect(updated.status).toBe('completed');
    expect(updated.completedAt).toBeDefined();
    expect(updated.result).toBe('Task completed successfully');

    // Cleanup
    await db.delete(agentTasks).where(eq(agentTasks.id, task.id));
  });
});

describe('agents schema', () => {
  test('has scheduling and backoff fields', async () => {
    const now = new Date();

    await db.update(agents)
      .set({
        leadNextRunAt: now,
        backoffNextRunAt: now,
        backoffAttemptCount: 2,
        lastCompletedAt: now,
      })
      .where(eq(agents.id, testAgentId));

    const [updated] = await db.select().from(agents).where(eq(agents.id, testAgentId));

    expect(updated.leadNextRunAt).toBeDefined();
    expect(updated.backoffNextRunAt).toBeDefined();
    expect(updated.backoffAttemptCount).toBe(2);
    expect(updated.lastCompletedAt).toBeDefined();

    // Reset
    await db.update(agents)
      .set({
        leadNextRunAt: null,
        backoffNextRunAt: null,
        backoffAttemptCount: 0,
        lastCompletedAt: null,
      })
      .where(eq(agents.id, testAgentId));
  });
});
