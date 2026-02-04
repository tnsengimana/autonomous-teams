/**
 * Tests for Agent Lifecycle - Phase 4 Implementation
 *
 * Tests cover:
 * - handleUserMessage flow (queue task, return ack)
 * - runWorkSession flow (background conversation creation, task processing, knowledge graph)
 * - decideBriefing (team lead vs subordinate)
 *
 * Uses MOCK_LLM=true for testing without real API calls.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { db } from '@/lib/db/client';
import {
  users,
  entities,
  agents,
  agentTasks,
  conversations,
  messages,
  briefings,
  inboxItems,
} from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

// Import the Agent class and related functions
import { createAgent, createAgentFromData } from '@/lib/agents/agent';
import { queueUserTask, getQueueStatus, type TaskEntityInfo } from '@/lib/agents/taskQueue';

// Helper to create entityInfo for entities
function entityInfo(entityId: string): TaskEntityInfo {
  return { entityId };
}
import { executeTool, type ToolContext } from '@/lib/agents/tools';
import { getOrCreateConversation } from '@/lib/db/queries/conversations';
import * as llm from '@/lib/agents/llm';
import { registerLeadTools } from '@/lib/agents/tools/lead-tools';

// ============================================================================
// Test Setup
// ============================================================================

let testUserId: string;
let testEntityId: string;
let testTeamLeadId: string;
let testSubordinateId: string;

beforeAll(async () => {
  // Enable mock LLM mode for testing
  process.env.MOCK_LLM = 'true';

  // Create test user
  const [user] = await db.insert(users).values({
    email: `agent-lifecycle-test-${Date.now()}@example.com`,
    name: 'Agent Lifecycle Test User',
  }).returning();
  testUserId = user.id;

  // Create test entity (active status for runWorkSession)
  const [entity] = await db.insert(entities).values({
    userId: testUserId,
    type: 'team',
    name: 'Agent Lifecycle Test Team',
    purpose: 'Testing agent lifecycle methods',
    status: 'active',
  }).returning();
  testEntityId = entity.id;

  // Create lead agent (no parent)
  const [leadAgent] = await db.insert(agents).values({
    entityId: testEntityId,
    name: 'Test Lead',
    type: 'lead',
    parentAgentId: null,
  }).returning();
  testTeamLeadId = leadAgent.id;

  // Create subordinate agent (has parent)
  const [subordinate] = await db.insert(agents).values({
    entityId: testEntityId,
    name: 'Test Subordinate',
    type: 'subordinate',
    parentAgentId: testTeamLeadId,
  }).returning();
  testSubordinateId = subordinate.id;

  // Register tools
  registerLeadTools();
});

afterAll(async () => {
  // Cleanup: delete test user (cascades to teams, agents, tasks, etc.)
  await db.delete(users).where(eq(users.id, testUserId));
  delete process.env.MOCK_LLM;
});

// Helper to cleanup data created during tests
async function cleanupTestData() {
  // Clean up tasks, conversations for test agents
  await db.delete(agentTasks).where(eq(agentTasks.entityId, testEntityId));
  await db.delete(inboxItems).where(eq(inboxItems.userId, testUserId));
  await db.delete(briefings).where(eq(briefings.userId, testUserId));
  await db.delete(conversations).where(eq(conversations.agentId, testTeamLeadId));
  await db.delete(conversations).where(eq(conversations.agentId, testSubordinateId));
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
    expect(agent!.name).toBe('Test Lead');
    expect(agent!.type).toBe('lead');
  });

  test('returns null for non-existent agent ID', async () => {
    const agent = await createAgent('00000000-0000-0000-0000-000000000000');
    expect(agent).toBeNull();
  });

  test('isLead() returns true for team lead', async () => {
    const agent = await createAgent(testTeamLeadId);
    expect(agent!.isLead()).toBe(true);
  });

  test('isLead() returns false for subordinate', async () => {
    const agent = await createAgent(testSubordinateId);
    expect(agent!.isLead()).toBe(false);
  });

  test('creates agent from data object', () => {
    const data = {
      id: 'test-id',
      entityId: testEntityId,
      name: 'Direct Agent',
      type: 'lead',
      parentAgentId: null,
      systemPrompt: null,
      status: 'idle' as const,
      leadNextRunAt: null,
      lastCompletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const agent = createAgentFromData(data);
    expect(agent.id).toBe('test-id');
    expect(agent.name).toBe('Direct Agent');
    expect(agent.isLead()).toBe(true);
  });
});

// ============================================================================
// handleUserMessage Tests (legacy tests - updated for intent classification)
// ============================================================================

describe('handleUserMessage', () => {
  test('queues task with source=user when classified as work_request', async () => {
    const agent = await createAgent(testTeamLeadId);
    const userMessage = 'What is the current price of NVDA?';

    // Mock intent classification to return work_request
    const mockGenerateLLMObject = vi.spyOn(llm, 'generateLLMObject').mockResolvedValueOnce({
      intent: 'work_request',
      reasoning: 'User is requesting price information',
    });

    // Call handleUserMessage
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

    mockGenerateLLMObject.mockRestore();
  });

  test('returns response stream', async () => {
    const agent = await createAgent(testTeamLeadId);

    // Mock intent classification to return regular_chat
    const mockGenerateLLMObject = vi.spyOn(llm, 'generateLLMObject').mockResolvedValueOnce({
      intent: 'regular_chat',
      reasoning: 'User is asking about something',
    });

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

    mockGenerateLLMObject.mockRestore();
  });

  test('adds user message and assistant response to conversation', async () => {
    const agent = await createAgent(testTeamLeadId);
    const userMessage = 'Check my portfolio';

    // Mock intent classification to return regular_chat
    const mockGenerateLLMObject = vi.spyOn(llm, 'generateLLMObject').mockResolvedValueOnce({
      intent: 'regular_chat',
      reasoning: 'User is checking something',
    });

    // Call handleUserMessage
    const stream = await agent!.handleUserMessage(userMessage);
    for await (const _ of stream) { /* consume stream */ }

    // Get conversation and messages
    const conversation = await agent!.getConversation();
    const conversationMessages = await db.select().from(messages)
      .where(eq(messages.conversationId, conversation.id));

    // Should have at least 2 messages (user + assistant response)
    expect(conversationMessages.length).toBeGreaterThanOrEqual(2);

    // Find user message
    const userMsg = conversationMessages.find(m => m.role === 'user' && m.content === userMessage);
    expect(userMsg).toBeDefined();

    // Find assistant response
    const assistantMsg = conversationMessages.find(m => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();

    mockGenerateLLMObject.mockRestore();
  });

  test('loads memories before generating response', async () => {
    const agent = await createAgent(testTeamLeadId);

    // Mock intent classification to return regular_chat
    const mockGenerateLLMObject = vi.spyOn(llm, 'generateLLMObject').mockResolvedValueOnce({
      intent: 'regular_chat',
      reasoning: 'Test message',
    });

    // Initially no memories loaded
    expect(agent!.getMemories()).toHaveLength(0);

    const stream = await agent!.handleUserMessage('Test message');
    for await (const _ of stream) { /* consume stream */ }

    // Memories should now be loaded (empty array, but loaded)
    expect(agent!.getMemories()).toEqual([]);

    mockGenerateLLMObject.mockRestore();
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

    // Run work session - should complete without adding messages to background conversation
    await agent!.runWorkSession();

    // Get background conversation
    const bgConversation = await getOrCreateConversation(testTeamLeadId, 'background');

    // Verify no messages were added (empty session)
    const bgMessages = await db.select().from(messages)
      .where(eq(messages.conversationId, bgConversation.id));
    expect(bgMessages.length).toBe(0);
  });

  test('uses background conversation for session', async () => {
    // Queue a task first
    await queueUserTask(testTeamLeadId, entityInfo(testEntityId), 'Test task');

    const agent = await createAgent(testTeamLeadId);
    await agent!.runWorkSession();

    // Verify background conversation was used
    const bgConversation = await getOrCreateConversation(testTeamLeadId, 'background');
    const bgMessages = await db.select().from(messages)
      .where(eq(messages.conversationId, bgConversation.id));
    expect(bgMessages.length).toBeGreaterThan(0);
  });

  test('processes pending tasks in queue', async () => {
    // Queue multiple tasks
    await queueUserTask(testTeamLeadId, entityInfo(testEntityId), 'Task 1');
    await queueUserTask(testTeamLeadId, entityInfo(testEntityId), 'Task 2');

    const statusBefore = await getQueueStatus(testTeamLeadId);
    expect(statusBefore.pendingCount).toBe(2);

    const agent = await createAgent(testTeamLeadId);
    await agent!.runWorkSession();

    // All tasks should be processed (no pending)
    const statusAfter = await getQueueStatus(testTeamLeadId);
    expect(statusAfter.pendingCount).toBe(0);
  });

  test('uses knowledge graph context for background work', async () => {
    // Queue a task
    await queueUserTask(testTeamLeadId, entityInfo(testEntityId), 'Analyze market');

    const agent = await createAgent(testTeamLeadId);

    // Run work session - this will initialize graph types and build graph context
    await agent!.runWorkSession();

    // The knowledge graph context is now used instead of knowledge items
    // This test verifies the session completes successfully with the new system
    const statusAfter = await getQueueStatus(testTeamLeadId);
    expect(statusAfter.pendingCount).toBe(0);
  });

  test('team lead schedules next run after session', async () => {
    // Queue a task
    await queueUserTask(testTeamLeadId, entityInfo(testEntityId), 'Test task');

    const agent = await createAgent(testTeamLeadId);
    await agent!.runWorkSession();

    // Check that leadNextRunAt was set
    const [updatedAgent] = await db.select().from(agents)
      .where(eq(agents.id, testTeamLeadId));
    expect(updatedAgent.leadNextRunAt).not.toBeNull();

    // Should be approximately 1 day (24 hours) in the future
    const nextRun = new Date(updatedAgent.leadNextRunAt!);
    const now = new Date();
    const diffHours = (nextRun.getTime() - now.getTime()) / (1000 * 60 * 60);
    expect(diffHours).toBeGreaterThan(23.9);
    expect(diffHours).toBeLessThan(24.1);
  });

  test('subordinate does not schedule next run', async () => {
    // Queue a task for subordinate
    await queueUserTask(testSubordinateId, entityInfo(testEntityId), 'Subordinate task');

    const agent = await createAgent(testSubordinateId);
    await agent!.runWorkSession();

    // Subordinate should not have leadNextRunAt set
    const [updatedAgent] = await db.select().from(agents)
      .where(eq(agents.id, testSubordinateId));
    expect(updatedAgent.leadNextRunAt).toBeNull();
  });
});

// ============================================================================
// processTask Tests
// ============================================================================

describe('processTask', () => {
  test('adds task as user message to background conversation', async () => {
    // Get background conversation
    const bgConversation = await getOrCreateConversation(testTeamLeadId, 'background');

    // Queue a task
    const task = await queueUserTask(testTeamLeadId, entityInfo(testEntityId), 'Analyze TSLA stock');

    const agent = await createAgent(testTeamLeadId);
    await agent!.processTask(bgConversation.id, task);

    // Verify conversation has messages
    const conversationMsgs = await db.select().from(messages)
      .where(eq(messages.conversationId, bgConversation.id));

    expect(conversationMsgs.length).toBeGreaterThanOrEqual(2);

    // First message should be user (task)
    const userMsg = conversationMsgs.find(m => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).toContain('TSLA');

    // Should have assistant response
    const assistantMsg = conversationMsgs.find(m => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
  });

  test('marks task complete with result', async () => {
    const bgConversation = await getOrCreateConversation(testTeamLeadId, 'background');
    const task = await queueUserTask(testTeamLeadId, entityInfo(testEntityId), 'Complete this');

    const agent = await createAgent(testTeamLeadId);
    const result = await agent!.processTask(bgConversation.id, task);

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
  test('team lead decideBriefing does not error with empty conversation', async () => {
    // Create a background conversation with no messages
    const bgConversation = await getOrCreateConversation(testTeamLeadId, 'background');

    const agent = await createAgent(testTeamLeadId);

    // Should not throw - just return early
    await expect(agent!.decideBriefing(bgConversation.id)).resolves.not.toThrow();
  });

  test('subordinate agent does not create briefings', async () => {
    const bgConversation = await getOrCreateConversation(testSubordinateId, 'background');
    await db.insert(messages).values({
      conversationId: bgConversation.id,
      role: 'assistant',
      content: 'Subordinate completed task with important info.',
    });

    const agent = await createAgent(testSubordinateId);

    // Get foreground conversation before
    const fgConversation = await agent!.getConversation();
    const messagesBefore = await db.select().from(messages)
      .where(eq(messages.conversationId, fgConversation.id));
    const countBefore = messagesBefore.length;

    await agent!.decideBriefing(bgConversation.id);

    // Subordinate should not add any messages (decideBriefing returns early for subordinates)
    const messagesAfter = await db.select().from(messages)
      .where(eq(messages.conversationId, fgConversation.id));
    expect(messagesAfter.length).toBe(countBefore);
  });

  test('lead decideBriefing appends a decision turn to background conversation', async () => {
    const bgConversation = await getOrCreateConversation(testTeamLeadId, 'background');
    await db.insert(messages).values({
      conversationId: bgConversation.id,
      role: 'assistant',
      content: 'Completed a research sweep on the market.',
    });

    const agent = await createAgent(testTeamLeadId);

    const beforeMessages = await db.select().from(messages)
      .where(eq(messages.conversationId, bgConversation.id));

    await agent!.decideBriefing(bgConversation.id);

    const afterMessages = await db.select().from(messages)
      .where(eq(messages.conversationId, bgConversation.id));

    expect(afterMessages.length).toBe(beforeMessages.length + 2);
  });

  test('isTeamLead check works in decideBriefing', async () => {
    const subordinateAgent = await createAgent(testSubordinateId);
    const teamLeadAgent = await createAgent(testTeamLeadId);

    expect(subordinateAgent!.isLead()).toBe(false);
    expect(teamLeadAgent!.isLead()).toBe(true);
  });
});

// ============================================================================
// createBriefing Tool Tests
// ============================================================================

describe('createBriefing tool', () => {
  test('creates briefing + inbox item without touching foreground conversation', async () => {
    const toolContext: ToolContext = {
      agentId: testTeamLeadId,
      entityId: testEntityId,
      isLead: true,
    };

    const fgConversation = await getOrCreateConversation(testTeamLeadId, 'foreground');
    const beforeMessages = await db.select().from(messages)
      .where(eq(messages.conversationId, fgConversation.id));

    const result = await executeTool('createBriefing', {
      title: 'Market Update: Key Movement',
      summary: 'A notable shift was detected in the market.',
      fullMessage: 'Full briefing details for the user.',
    }, toolContext);

    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('briefingId');
    expect(result.data).toHaveProperty('inboxItemId');

    const [briefing] = await db.select().from(briefings)
      .where(eq(briefings.userId, testUserId));
    const [inboxItem] = await db.select().from(inboxItems)
      .where(eq(inboxItems.userId, testUserId));

    expect(briefing).toBeDefined();
    expect(inboxItem).toBeDefined();
    expect(inboxItem.briefingId).toBe(briefing.id);

    const afterMessages = await db.select().from(messages)
      .where(eq(messages.conversationId, fgConversation.id));
    expect(afterMessages.length).toBe(beforeMessages.length);
  });
});

// ============================================================================
// briefing query tools
// ============================================================================

describe('briefing query tools', () => {
  test('listBriefings returns metadata only and supports search', async () => {
    const [briefingA] = await db.insert(briefings).values({
      userId: testUserId,
      entityId: testEntityId,
      agentId: testTeamLeadId,
      title: 'Market Update: Chips',
      summary: 'A notable shift in chip stocks.',
      content: 'Full details about chip stocks.',
    }).returning();
    await db.insert(briefings).values({
      userId: testUserId,
      entityId: testEntityId,
      agentId: testTeamLeadId,
      title: 'Energy Briefing',
      summary: 'Energy sector summary.',
      content: 'Full details about energy.',
    }).returning();

    const toolContext: ToolContext = {
      agentId: testTeamLeadId,
      entityId: testEntityId,
      isLead: true,
    };

    const result = await executeTool(
      'listBriefings',
      { query: 'chips', limit: 10 },
      toolContext
    );

    expect(result.success).toBe(true);
    const data = result.data as { briefings: Array<Record<string, unknown>> };
    expect(data.briefings.length).toBe(1);
    expect(data.briefings[0].id).toBe(briefingA.id);
    expect(data.briefings[0]).not.toHaveProperty('content');
  });

  test('getBriefing returns full content for a matching briefing', async () => {
    const [briefing] = await db.insert(briefings).values({
      userId: testUserId,
      entityId: testEntityId,
      agentId: testTeamLeadId,
      title: 'Research Briefing',
      summary: 'A concise summary.',
      content: 'Full briefing content.',
    }).returning();

    const toolContext: ToolContext = {
      agentId: testTeamLeadId,
      entityId: testEntityId,
      isLead: true,
    };

    const result = await executeTool(
      'getBriefing',
      { briefingId: briefing.id },
      toolContext
    );

    expect(result.success).toBe(true);
    const data = result.data as { briefing: { content: string } };
    expect(data.briefing.content).toBe('Full briefing content.');
  });
});

// ============================================================================
// requestUserInput Tool Tests
// ============================================================================

describe('requestUserInput tool', () => {
  test('creates feedback inbox item and appends foreground message', async () => {
    const toolContext: ToolContext = {
      agentId: testTeamLeadId,
      entityId: testEntityId,
      isLead: true,
    };

    const fgConversation = await getOrCreateConversation(
      testTeamLeadId,
      'foreground'
    );
    const beforeMessages = await db.select().from(messages)
      .where(eq(messages.conversationId, fgConversation.id));

    const result = await executeTool('requestUserInput', {
      title: 'Need your preference',
      summary: 'Please confirm which option you prefer.',
      fullMessage: 'I need your input on which option you prefer before proceeding.',
    }, toolContext);

    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('inboxItemId');

    const [inboxItem] = await db.select().from(inboxItems)
      .where(eq(inboxItems.userId, testUserId));
    expect(inboxItem).toBeDefined();
    expect(inboxItem.type).toBe('feedback');
    expect(inboxItem.briefingId).toBeNull();

    const afterMessages = await db.select().from(messages)
      .where(eq(messages.conversationId, fgConversation.id));
    expect(afterMessages.length).toBe(beforeMessages.length + 1);
  });
});

// ============================================================================
// Knowledge Context Building Tests
// ============================================================================

describe('Knowledge Graph Context', () => {
  test('buildBackgroundSystemPromptWithGraph includes knowledge graph context', async () => {
    const agent = await createAgent(testTeamLeadId);

    // This will initialize graph types and build context
    const systemPrompt = await agent!.buildBackgroundSystemPromptWithGraph();

    // Should contain knowledge graph block
    expect(systemPrompt).toContain('knowledge_graph');
    expect(systemPrompt).toContain('How to Use the Knowledge Graph');
    expect(systemPrompt).toContain('RETRIEVE first');
    expect(systemPrompt).toContain('INSERT when needed');
  });

  test('buildBackgroundSystemPromptWithGraph includes entity types after initialization', async () => {
    const agent = await createAgent(testTeamLeadId);

    // First call initializes types
    const systemPrompt = await agent!.buildBackgroundSystemPromptWithGraph();

    // Should contain Node Types and Edge Types sections (initialized by mock LLM)
    expect(systemPrompt).toContain('Node Types');
    expect(systemPrompt).toContain('Edge Types');
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
    await queueUserTask(testTeamLeadId, entityInfo(testEntityId), 'Test task');

    const agent = await createAgent(testTeamLeadId);
    await agent!.runWorkSession();

    // After session, status should be idle
    const [updated] = await db.select().from(agents)
      .where(eq(agents.id, testTeamLeadId));
    expect(updated.status).toBe('idle');
  });
});

// ============================================================================
// Intent Classification Tests
// ============================================================================

describe('Intent Classification', () => {
  test('classifyUserIntent returns work_request when LLM classifies as work_request', async () => {
    const agent = await createAgent(testTeamLeadId);

    // Mock generateLLMObject to return work_request
    const mockGenerateLLMObject = vi.spyOn(llm, 'generateLLMObject').mockResolvedValueOnce({
      intent: 'work_request',
      reasoning: 'User is requesting research',
    });

    // Access the private method via type assertion for testing
    const classifyIntent = (agent as unknown as { classifyUserIntent: (content: string) => Promise<'work_request' | 'regular_chat'> }).classifyUserIntent.bind(agent);

    const intent = await classifyIntent('Research NVIDIA earnings');
    expect(intent).toBe('work_request');

    mockGenerateLLMObject.mockRestore();
  });

  test('classifyUserIntent returns work_request for analysis requests', async () => {
    const agent = await createAgent(testTeamLeadId);

    const mockGenerateLLMObject = vi.spyOn(llm, 'generateLLMObject').mockResolvedValueOnce({
      intent: 'work_request',
      reasoning: 'User is requesting portfolio analysis',
    });

    const classifyIntent = (agent as unknown as { classifyUserIntent: (content: string) => Promise<'work_request' | 'regular_chat'> }).classifyUserIntent.bind(agent);

    const intent = await classifyIntent('Analyze my portfolio performance over the last quarter');
    expect(intent).toBe('work_request');

    mockGenerateLLMObject.mockRestore();
  });

  test('classifyUserIntent returns regular_chat when LLM classifies as regular_chat', async () => {
    const agent = await createAgent(testTeamLeadId);

    // Mock mode already returns regular_chat, but let's be explicit
    const mockGenerateLLMObject = vi.spyOn(llm, 'generateLLMObject').mockResolvedValueOnce({
      intent: 'regular_chat',
      reasoning: 'User is greeting',
    });

    const classifyIntent = (agent as unknown as { classifyUserIntent: (content: string) => Promise<'work_request' | 'regular_chat'> }).classifyUserIntent.bind(agent);

    const intent = await classifyIntent('Hi');
    expect(intent).toBe('regular_chat');

    mockGenerateLLMObject.mockRestore();
  });

  test('classifyUserIntent returns regular_chat for simple questions', async () => {
    const agent = await createAgent(testTeamLeadId);

    const mockGenerateLLMObject = vi.spyOn(llm, 'generateLLMObject').mockResolvedValueOnce({
      intent: 'regular_chat',
      reasoning: 'User is asking for opinion',
    });

    const classifyIntent = (agent as unknown as { classifyUserIntent: (content: string) => Promise<'work_request' | 'regular_chat'> }).classifyUserIntent.bind(agent);

    const intent = await classifyIntent('What do you think?');
    expect(intent).toBe('regular_chat');

    mockGenerateLLMObject.mockRestore();
  });

  test('classifyUserIntent returns regular_chat for thank you messages', async () => {
    const agent = await createAgent(testTeamLeadId);

    const mockGenerateLLMObject = vi.spyOn(llm, 'generateLLMObject').mockResolvedValueOnce({
      intent: 'regular_chat',
      reasoning: 'User is expressing gratitude',
    });

    const classifyIntent = (agent as unknown as { classifyUserIntent: (content: string) => Promise<'work_request' | 'regular_chat'> }).classifyUserIntent.bind(agent);

    const intent = await classifyIntent('Thanks!');
    expect(intent).toBe('regular_chat');

    mockGenerateLLMObject.mockRestore();
  });
});

// ============================================================================
// handleUserMessage Flow Tests (Intent-Based Routing)
// ============================================================================

describe('handleUserMessage Flow', () => {
  test('work_request: queues task AND returns acknowledgment', async () => {
    const agent = await createAgent(testTeamLeadId);
    const workRequest = 'Research the latest NVIDIA earnings report';

    // Mock to return work_request classification
    const mockGenerateLLMObject = vi.spyOn(llm, 'generateLLMObject').mockResolvedValueOnce({
      intent: 'work_request',
      reasoning: 'User is requesting research',
    });

    // Call handleUserMessage
    const stream = await agent!.handleUserMessage(workRequest);

    // Consume the stream
    let response = '';
    for await (const chunk of stream) {
      response += chunk;
    }

    // Verify task was queued
    const status = await getQueueStatus(testTeamLeadId);
    expect(status.hasPendingWork).toBe(true);
    expect(status.pendingCount).toBe(1);

    // Verify task content
    const [task] = await db.select().from(agentTasks)
      .where(and(
        eq(agentTasks.assignedToId, testTeamLeadId),
        eq(agentTasks.status, 'pending')
      ));
    expect(task.task).toBe(workRequest);
    expect(task.source).toBe('user');

    // Verify response is non-empty
    expect(response.trim().length).toBeGreaterThan(0);

    mockGenerateLLMObject.mockRestore();
  });

  test('regular_chat: does NOT queue task, returns full response', async () => {
    const agent = await createAgent(testTeamLeadId);
    const chatMessage = 'Hi, how are you?';

    // Mock to return regular_chat classification
    const mockGenerateLLMObject = vi.spyOn(llm, 'generateLLMObject').mockResolvedValueOnce({
      intent: 'regular_chat',
      reasoning: 'User is greeting',
    });

    // Call handleUserMessage
    const stream = await agent!.handleUserMessage(chatMessage);

    // Consume the stream
    let response = '';
    for await (const chunk of stream) {
      response += chunk;
    }

    // Verify NO task was queued
    const status = await getQueueStatus(testTeamLeadId);
    expect(status.hasPendingWork).toBe(false);
    expect(status.pendingCount).toBe(0);

    // Verify response is non-empty
    expect(response.trim().length).toBeGreaterThan(0);

    mockGenerateLLMObject.mockRestore();
  });

  test('regular_chat with question: does NOT queue task', async () => {
    const agent = await createAgent(testTeamLeadId);
    const question = 'What do you think about the current market conditions?';

    // Mock to return regular_chat classification
    const mockGenerateLLMObject = vi.spyOn(llm, 'generateLLMObject').mockResolvedValueOnce({
      intent: 'regular_chat',
      reasoning: 'User is asking for opinion',
    });

    // Call handleUserMessage
    const stream = await agent!.handleUserMessage(question);
    for await (const _ of stream) { /* consume */ }

    // Verify NO task was queued
    const status = await getQueueStatus(testTeamLeadId);
    expect(status.hasPendingWork).toBe(false);

    mockGenerateLLMObject.mockRestore();
  });

  test('work_request adds both user message and assistant ack to conversation', async () => {
    const agent = await createAgent(testTeamLeadId);
    const workRequest = 'Analyze TSLA stock performance';

    // Mock to return work_request classification
    const mockGenerateLLMObject = vi.spyOn(llm, 'generateLLMObject').mockResolvedValueOnce({
      intent: 'work_request',
      reasoning: 'User is requesting analysis',
    });

    const stream = await agent!.handleUserMessage(workRequest);
    for await (const _ of stream) { /* consume */ }

    // Get conversation messages
    const conversation = await agent!.getConversation();
    const conversationMessages = await db.select().from(messages)
      .where(eq(messages.conversationId, conversation.id));

    // Should have user message and assistant acknowledgment
    expect(conversationMessages.length).toBeGreaterThanOrEqual(2);

    const userMsg = conversationMessages.find(m => m.role === 'user' && m.content === workRequest);
    expect(userMsg).toBeDefined();

    const assistantMsg = conversationMessages.find(m => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();

    mockGenerateLLMObject.mockRestore();
  });

  test('regular_chat adds both user message and assistant response to conversation', async () => {
    const agent = await createAgent(testTeamLeadId);
    const chatMessage = 'Thanks for your help!';

    // Mock to return regular_chat classification
    const mockGenerateLLMObject = vi.spyOn(llm, 'generateLLMObject').mockResolvedValueOnce({
      intent: 'regular_chat',
      reasoning: 'User is expressing gratitude',
    });

    const stream = await agent!.handleUserMessage(chatMessage);
    for await (const _ of stream) { /* consume */ }

    // Get conversation messages
    const conversation = await agent!.getConversation();
    const conversationMessages = await db.select().from(messages)
      .where(eq(messages.conversationId, conversation.id));

    // Should have user message and assistant response
    expect(conversationMessages.length).toBeGreaterThanOrEqual(2);

    const userMsg = conversationMessages.find(m => m.role === 'user' && m.content === chatMessage);
    expect(userMsg).toBeDefined();

    const assistantMsg = conversationMessages.find(m => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();

    mockGenerateLLMObject.mockRestore();
  });
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases', () => {
  test('handleUserMessage handles empty message with regular_chat', async () => {
    const agent = await createAgent(testTeamLeadId);

    // Mock to return regular_chat classification
    const mockGenerateLLMObject = vi.spyOn(llm, 'generateLLMObject').mockResolvedValueOnce({
      intent: 'regular_chat',
      reasoning: 'Empty message defaults to regular chat',
    });

    const stream = await agent!.handleUserMessage('');

    let response = '';
    for await (const chunk of stream) {
      response += chunk;
    }

    expect(response).toBeTruthy();

    // Regular chat does NOT queue task
    const status = await getQueueStatus(testTeamLeadId);
    expect(status.pendingCount).toBe(0);

    mockGenerateLLMObject.mockRestore();
  });

  test('handleUserMessage handles empty message with work_request', async () => {
    const agent = await createAgent(testTeamLeadId);

    // Mock to return work_request classification
    const mockGenerateLLMObject = vi.spyOn(llm, 'generateLLMObject').mockResolvedValueOnce({
      intent: 'work_request',
      reasoning: 'Classified as work request',
    });

    const stream = await agent!.handleUserMessage('');

    let response = '';
    for await (const chunk of stream) {
      response += chunk;
    }

    expect(response).toBeTruthy();

    // Work request queues task
    const status = await getQueueStatus(testTeamLeadId);
    expect(status.pendingCount).toBe(1);

    mockGenerateLLMObject.mockRestore();
  });

  test('multiple concurrent handleUserMessage calls with work_request queue tasks correctly', async () => {
    const agent = await createAgent(testTeamLeadId);

    // Mock to always return work_request for intent classification
    // Use mockImplementation to handle all concurrent calls and memory extraction
    const mockGenerateLLMObject = vi.spyOn(llm, 'generateLLMObject')
      .mockImplementation(async (_messages, schema) => {
        // Check if this is an intent classification call by checking the schema structure
        const schemaStr = JSON.stringify(schema);
        if (schemaStr.includes('work_request') || schemaStr.includes('regular_chat')) {
          return { intent: 'work_request', reasoning: 'Work request' };
        }
        // For memory extraction, return empty memories
        return { memories: [] };
      });

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

    // All tasks should be queued (since all classified as work_request)
    const status = await getQueueStatus(testTeamLeadId);
    expect(status.pendingCount).toBe(3);

    mockGenerateLLMObject.mockRestore();
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
      name: 'Agent Test Aide',
      status: 'active',
    }).returning();
    testAideEntityId = aideEntity.id;

    // Create a lead agent for the aide entity (no parent)
    const [aideAgent] = await db.insert(agents).values({
      entityId: testAideEntityId,
      name: 'Test Aide Lead',
      type: 'lead',
      parentAgentId: null,
    }).returning();
    testAideAgentId = aideAgent.id;
  });

  afterAll(async () => {
    // Cleanup aide entity (cascades to agents)
    await db.delete(entities).where(eq(entities.id, testAideEntityId));
  });

  beforeEach(async () => {
    // Clean up tasks for aide agent
    await db.delete(agentTasks).where(eq(agentTasks.entityId, testAideEntityId));
    await db.delete(conversations).where(eq(conversations.agentId, testAideAgentId));
  });

  test('createAgent loads aide entity agent correctly', async () => {
    const agent = await createAgent(testAideAgentId);

    expect(agent).not.toBeNull();
    expect(agent!.id).toBe(testAideAgentId);
    expect(agent!.name).toBe('Test Aide Lead');
  });

  test('createAgentFromData with aide entityId works correctly', () => {
    const data = {
      id: 'test-aide-agent-id',
      entityId: testAideEntityId,
      name: 'Aide Agent',
      type: 'lead',
      parentAgentId: null,
      systemPrompt: null,
      status: 'idle' as const,
      leadNextRunAt: null,
      lastCompletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const agent = createAgentFromData(data);
    expect(agent.id).toBe('test-aide-agent-id');
    expect(agent.name).toBe('Aide Agent');
    expect(agent.isLead()).toBe(true); // Aide lead (no parent)
  });

  test('aide entity agent isLead returns true for lead (no parent)', async () => {
    const agent = await createAgent(testAideAgentId);
    expect(agent!.isLead()).toBe(true);
  });

  test('aide entity agent can handle user messages', async () => {
    const agent = await createAgent(testAideAgentId);

    // Mock intent classification to return regular_chat
    const mockGenerateLLMObject = vi.spyOn(llm, 'generateLLMObject').mockResolvedValueOnce({
      intent: 'regular_chat',
      reasoning: 'User is greeting',
    });

    const stream = await agent!.handleUserMessage('Hello aide!');

    let response = '';
    for await (const chunk of stream) {
      response += chunk;
    }

    expect(response.trim().length).toBeGreaterThan(0);

    mockGenerateLLMObject.mockRestore();
  });

  test('aide entity agent handleUserMessage queues task with entityId', async () => {
    const agent = await createAgent(testAideAgentId);

    // Mock intent classification to return work_request
    const mockGenerateLLMObject = vi.spyOn(llm, 'generateLLMObject').mockResolvedValueOnce({
      intent: 'work_request',
      reasoning: 'User is requesting work',
    });

    const stream = await agent!.handleUserMessage('Research something for me');
    for await (const _ of stream) { /* consume */ }

    // Verify task was queued with entityId
    const status = await getQueueStatus(testAideAgentId);
    expect(status.hasPendingWork).toBe(true);

    // Get the task and verify entityId
    const [task] = await db.select().from(agentTasks)
      .where(and(
        eq(agentTasks.assignedToId, testAideAgentId),
        eq(agentTasks.status, 'pending')
      ));
    expect(task.entityId).toBe(testAideEntityId);

    mockGenerateLLMObject.mockRestore();
  });

  test('aide entity agent can run work session', async () => {
    // Queue a task for the aide agent
    const { queueUserTask: importedQueueUserTask } = await import('@/lib/agents/taskQueue');
    await importedQueueUserTask(testAideAgentId, { entityId: testAideEntityId }, 'Aide task to process');

    const agent = await createAgent(testAideAgentId);
    await agent!.runWorkSession();

    // Task should be processed
    const status = await getQueueStatus(testAideAgentId);
    expect(status.pendingCount).toBe(0);
  });

  test('aide lead schedules next run after session', async () => {
    // Queue a task
    const { queueUserTask: importedQueueUserTask } = await import('@/lib/agents/taskQueue');
    await importedQueueUserTask(testAideAgentId, { entityId: testAideEntityId }, 'Aide task');

    const agent = await createAgent(testAideAgentId);
    await agent!.runWorkSession();

    // Check that leadNextRunAt was set (aide lead is like team lead)
    const [updatedAgent] = await db.select().from(agents)
      .where(eq(agents.id, testAideAgentId));
    expect(updatedAgent.leadNextRunAt).not.toBeNull();
  });

  test('ToolContext includes entityId for aide entity agents', async () => {
    const agent = await createAgent(testAideAgentId);

    // Access private method to build context
    const buildContext = (agent as unknown as {
      buildToolContext: () => { agentId: string; entityId: string; isLead: boolean }
    }).buildToolContext?.bind(agent);

    // If buildToolContext exists, test it
    if (buildContext) {
      const context = buildContext();
      expect(context.entityId).toBe(testAideEntityId);
    }
  });
});
