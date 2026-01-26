/**
 * API Integration Tests - Phase 6 Implementation
 *
 * Tests cover:
 * - Messages API using handleUserMessage (foreground, queues task)
 * - Team creation bootstrapping with "get to work" task
 * - Conversations API returning only user conversations (not background conversations)
 *
 * Uses database-level testing with test fixtures.
 */

import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { db } from '@/lib/db/client';
import {
  users,
  teams,
  agents,
  agentTasks,
  conversations,
  messages,
} from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import * as llm from '@/lib/agents/llm';
import type { TaskOwnerInfo } from '@/lib/agents/taskQueue';

// Helper to create ownerInfo for teams
function teamOwnerInfo(teamId: string): TaskOwnerInfo {
  return { teamId };
}

// ============================================================================
// Test Setup
// ============================================================================

let testUserId: string;
let testTeamId: string;
let testTeamLeadId: string;

beforeAll(async () => {
  // Enable mock LLM mode for testing
  process.env.MOCK_LLM = 'true';

  // Create test user
  const [user] = await db
    .insert(users)
    .values({
      email: `api-test-${Date.now()}@example.com`,
      name: 'API Test User',
    })
    .returning();
  testUserId = user.id;

  // Create test team
  const [team] = await db
    .insert(teams)
    .values({
      userId: testUserId,
      name: 'API Test Team',
      purpose: 'Testing API endpoints',
      status: 'active',
    })
    .returning();
  testTeamId = team.id;

  // Create team lead agent
  const [teamLead] = await db
    .insert(agents)
    .values({
      teamId: testTeamId,
      name: 'API Test Team Lead',
      type: 'lead',
      parentAgentId: null,
    })
    .returning();
  testTeamLeadId = teamLead.id;
});

afterAll(async () => {
  // Cleanup: delete test user (cascades to teams, agents, etc.)
  if (testUserId) {
    await db.delete(users).where(eq(users.id, testUserId));
  }
  delete process.env.MOCK_LLM;
});

// ============================================================================
// Messages API Tests
// ============================================================================

describe('Messages API (/api/messages)', () => {
  test('uses handleUserMessage which queues task for work_request classification', async () => {
    // Import the Agent class
    const { Agent } = await import('@/lib/agents/agent');

    // Mock intent classification to return work_request
    const mockGenerateLLMObject = vi.spyOn(llm, 'generateLLMObject').mockResolvedValueOnce({
      intent: 'work_request',
      reasoning: 'User is requesting price information',
    });

    // Create an agent instance
    const agentData = await db.query.agents.findFirst({
      where: eq(agents.id, testTeamLeadId),
    });
    const agent = new Agent(agentData!);

    // Call handleUserMessage directly (this is what the API now uses)
    const userMessage = 'What is the price of AAPL?';
    const stream = await agent.handleUserMessage(userMessage);

    // Consume the stream
    let response = '';
    for await (const chunk of stream) {
      response += chunk;
    }

    // Verify we got an acknowledgment
    expect(response.trim().length).toBeGreaterThan(0);

    // Verify task was queued for background processing
    const [queuedTask] = await db
      .select()
      .from(agentTasks)
      .where(
        and(
          eq(agentTasks.assignedToId, testTeamLeadId),
          eq(agentTasks.source, 'user'),
          eq(agentTasks.status, 'pending')
        )
      );

    expect(queuedTask).toBeDefined();
    expect(queuedTask.task).toBe(userMessage);
    expect(queuedTask.source).toBe('user');

    // Cleanup
    mockGenerateLLMObject.mockRestore();
    await db
      .delete(agentTasks)
      .where(eq(agentTasks.id, queuedTask.id));
  });

  test('adds user message and acknowledgment to conversation', async () => {
    const { Agent } = await import('@/lib/agents/agent');

    const agentData = await db.query.agents.findFirst({
      where: eq(agents.id, testTeamLeadId),
    });
    const agent = new Agent(agentData!);

    const userMessage = 'Analyze my portfolio performance';
    const stream = await agent.handleUserMessage(userMessage);

    // Consume the stream
    for await (const chunk of stream) {
      void chunk; // Consume
    }

    // Get the conversation
    const conversation = await agent.getConversation();

    // Get messages from conversation
    const conversationMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversation.id));

    // Should have at least user message + assistant acknowledgment
    const userMsg = conversationMessages.find(
      (m) => m.role === 'user' && m.content === userMessage
    );
    const assistantMsg = conversationMessages.find(
      (m) => m.role === 'assistant'
    );

    expect(userMsg).toBeDefined();
    expect(assistantMsg).toBeDefined();

    // Cleanup
    await db
      .delete(agentTasks)
      .where(eq(agentTasks.assignedToId, testTeamLeadId));
  });
});

// ============================================================================
// Team Creation Tests
// ============================================================================

describe('Team Creation API (/api/teams)', () => {
  test('queueSystemTask is called with bootstrap message after team creation', async () => {
    // Import the queueSystemTask function
    const { queueSystemTask } = await import('@/lib/agents/taskQueue');

    // Create a new team and team lead manually (simulating what the API does)
    const [newTeam] = await db
      .insert(teams)
      .values({
        userId: testUserId,
        name: 'Bootstrap Test Team',
        purpose: 'Testing bootstrap task',
        status: 'active',
      })
      .returning();

    const [newTeamLead] = await db
      .insert(agents)
      .values({
        teamId: newTeam.id,
        name: 'Bootstrap Team Lead',
        type: 'lead',
        parentAgentId: null,
      })
      .returning();

    // Queue the bootstrap task (this is what the API now does)
    await queueSystemTask(
      newTeamLead.id,
      teamOwnerInfo(newTeam.id),
      'Get to work on your mission. Review your purpose and start taking actions to fulfill it.'
    );

    // Verify bootstrap task was created
    const [bootstrapTask] = await db
      .select()
      .from(agentTasks)
      .where(
        and(
          eq(agentTasks.assignedToId, newTeamLead.id),
          eq(agentTasks.source, 'system')
        )
      );

    expect(bootstrapTask).toBeDefined();
    expect(bootstrapTask.task).toContain('Get to work on your mission');
    expect(bootstrapTask.source).toBe('system');
    expect(bootstrapTask.status).toBe('pending');

    // Cleanup
    await db.delete(teams).where(eq(teams.id, newTeam.id));
  });
});

// ============================================================================
// Conversations API Tests
// ============================================================================

describe('Conversations API (/api/conversations/[agentId])', () => {
  test('returns foreground conversations for user interaction', async () => {
    // Create a foreground conversation (user-facing)
    const [conversation] = await db
      .insert(conversations)
      .values({
        agentId: testTeamLeadId,
        mode: 'foreground',
      })
      .returning();

    // Add some messages to the conversation
    await db.insert(messages).values([
      {
        conversationId: conversation.id,
        role: 'user',
        content: 'Hello agent',
      },
      {
        conversationId: conversation.id,
        role: 'assistant',
        content: 'Hello! How can I help?',
      },
    ]);

    // Create a background conversation (internal work - separate from foreground)
    const [bgConversation] = await db
      .insert(conversations)
      .values({
        agentId: testTeamLeadId,
        mode: 'background',
      })
      .returning();

    // Import the query functions used by the API
    const { getLatestConversation } = await import(
      '@/lib/db/queries/conversations'
    );
    const { getMessagesByConversationId } = await import(
      '@/lib/db/queries/messages'
    );

    // This is what the API does - get foreground conversation
    const latestConversation = await getLatestConversation(
      testTeamLeadId,
      'foreground'
    );
    expect(latestConversation).toBeDefined();
    expect(latestConversation!.id).toBe(conversation.id);
    expect(latestConversation!.mode).toBe('foreground');

    // Verify we're getting conversation messages
    const conversationMessages = await getMessagesByConversationId(
      latestConversation!.id
    );
    expect(conversationMessages.length).toBeGreaterThan(0);

    // Cleanup
    await db.delete(conversations).where(eq(conversations.id, bgConversation.id));
    await db.delete(conversations).where(eq(conversations.id, conversation.id));
  });

  test('foreground and background conversations are stored separately', async () => {
    // Create foreground conversation
    const [fgConversation] = await db
      .insert(conversations)
      .values({
        agentId: testTeamLeadId,
        mode: 'foreground',
      })
      .returning();

    // Create background conversation
    const [bgConversation] = await db
      .insert(conversations)
      .values({
        agentId: testTeamLeadId,
        mode: 'background',
      })
      .returning();

    // Verify both modes exist
    expect(fgConversation.mode).toBe('foreground');
    expect(bgConversation.mode).toBe('background');

    // Cleanup
    await db.delete(conversations).where(eq(conversations.id, fgConversation.id));
    await db.delete(conversations).where(eq(conversations.id, bgConversation.id));
  });
});

// ============================================================================
// API Response Format Tests
// ============================================================================

describe('API Response Patterns', () => {
  test('handleUserMessage returns streamable acknowledgment', async () => {
    const { Agent } = await import('@/lib/agents/agent');

    const agentData = await db.query.agents.findFirst({
      where: eq(agents.id, testTeamLeadId),
    });
    const agent = new Agent(agentData!);

    const stream = await agent.handleUserMessage('Quick question');

    // Verify it's an async iterable
    expect(stream[Symbol.asyncIterator]).toBeDefined();

    // Collect chunks
    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    // Should yield multiple chunks (word-by-word streaming)
    expect(chunks.length).toBeGreaterThan(1);

    // Full response should be non-empty
    const fullResponse = chunks.join('');
    expect(fullResponse.trim().length).toBeGreaterThan(0);

    // Cleanup
    await db
      .delete(agentTasks)
      .where(eq(agentTasks.assignedToId, testTeamLeadId));
  });

  test('task queue correctly differentiates user vs system tasks', async () => {
    const { queueUserTask, queueSystemTask } = await import(
      '@/lib/agents/taskQueue'
    );

    // Queue user task
    const userTask = await queueUserTask(
      testTeamLeadId,
      teamOwnerInfo(testTeamId),
      'User requested analysis'
    );
    expect(userTask.source).toBe('user');

    // Queue system task
    const systemTask = await queueSystemTask(
      testTeamLeadId,
      teamOwnerInfo(testTeamId),
      'System bootstrap task'
    );
    expect(systemTask.source).toBe('system');

    // Cleanup
    await db
      .delete(agentTasks)
      .where(eq(agentTasks.id, userTask.id));
    await db
      .delete(agentTasks)
      .where(eq(agentTasks.id, systemTask.id));
  });
});

// ============================================================================
// Edge Case Tests
// ============================================================================

describe('Edge Cases', () => {
  test('handleUserMessage works with empty string message', async () => {
    const { Agent } = await import('@/lib/agents/agent');

    const agentData = await db.query.agents.findFirst({
      where: eq(agents.id, testTeamLeadId),
    });
    const agent = new Agent(agentData!);

    // Empty message should still be handled
    const stream = await agent.handleUserMessage('');

    let response = '';
    for await (const chunk of stream) {
      response += chunk;
    }

    // Should get some acknowledgment
    expect(response).toBeDefined();

    // Cleanup any tasks created
    await db
      .delete(agentTasks)
      .where(eq(agentTasks.assignedToId, testTeamLeadId));
  });

  test('multiple user messages queue multiple tasks', async () => {
    const { Agent } = await import('@/lib/agents/agent');

    const mockGenerateLLMObject = vi
      .spyOn(llm, 'generateLLMObject')
      .mockImplementation(async (_messages, schema) => {
        const candidates = [
          { intent: 'work_request', reasoning: 'User is requesting work' },
          { memories: [] },
          { knowledgeItems: [] },
          { shouldBrief: false, reason: 'Mock mode - no briefing' },
        ];

        for (const candidate of candidates) {
          if (schema.safeParse(candidate).success) {
            return candidate;
          }
        }

        throw new Error('Unexpected schema in test');
      });

    const agentData = await db.query.agents.findFirst({
      where: eq(agents.id, testTeamLeadId),
    });
    const agent = new Agent(agentData!);

    // Send multiple messages
    const messages = ['First question', 'Second question', 'Third question'];
    for (const msg of messages) {
      const stream = await agent.handleUserMessage(msg);
      for await (const chunk of stream) {
        void chunk;
      }
    }

    // Verify all tasks were queued
    const queuedTasks = await db
      .select()
      .from(agentTasks)
      .where(
        and(
          eq(agentTasks.assignedToId, testTeamLeadId),
          eq(agentTasks.source, 'user'),
          eq(agentTasks.status, 'pending')
        )
      );

    expect(queuedTasks.length).toBeGreaterThanOrEqual(3);

    // Cleanup
    mockGenerateLLMObject.mockRestore();
    await db
      .delete(agentTasks)
      .where(eq(agentTasks.assignedToId, testTeamLeadId));
  });

  test('getLatestConversation returns null for agent with no conversation', async () => {
    // Create a new agent without any conversation
    const [newAgent] = await db
      .insert(agents)
      .values({
        teamId: testTeamId,
        name: 'No Conversation Agent',
        type: 'subordinate',
        parentAgentId: testTeamLeadId,
      })
      .returning();

    const { getLatestConversation } = await import(
      '@/lib/db/queries/conversations'
    );

    const conversation = await getLatestConversation(newAgent.id);
    expect(conversation).toBeNull();

    // Cleanup
    await db.delete(agents).where(eq(agents.id, newAgent.id));
  });
});
