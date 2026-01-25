/**
 * Tests for thread queries and thread abstraction layer
 *
 * These tests verify the thread management system that supports
 * agent work sessions with context compaction.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/db/client';
import { users, teams, agents, threadMessages } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

// Import thread queries
import {
  createThread,
  getActiveThread,
  getThreadById,
  completeThread,
  markThreadCompacted,
  getThreadMessages,
  getNextThreadSequenceNumber,
  appendThreadMessage,
  createThreadMessage,
  getLastThreadMessage,
  getThreadMessageCount,
  deleteThreadMessages,
  compactThread,
  getThreadsByAgentId,
  getRecentThreads,
  getThreadsByStatus,
  deleteThread,
  getOrCreateActiveThread,
} from '@/lib/db/queries/threads';

// Import thread abstraction
import {
  startWorkSession,
  getOrStartWorkSession,
  endWorkSession,
  hasActiveSession,
  getSessionThread,
  addToThread,
  addUserMessage,
  addAssistantMessage,
  addSystemMessage,
  getMessages,
  buildThreadContext,
  threadMessagesToLLMFormat,
  estimateTokenCount,
  trimMessagesToTokenBudget,
  shouldCompact,
  compactIfNeeded,
  compactWithSummary,
  clearThread,
  getThreadStats,
  initializeThreadWithPrompt,
} from '@/lib/agents/thread';

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
    email: `threads-test-${Date.now()}@example.com`,
    name: 'Threads Test User',
  }).returning();
  testUserId = user.id;

  // Create test team
  const [team] = await db.insert(teams).values({
    userId: testUserId,
    name: 'Threads Test Team',
    purpose: 'Testing thread management',
  }).returning();
  testTeamId = team.id;

  // Create test agents
  const [agent] = await db.insert(agents).values({
    teamId: testTeamId,
    name: 'Thread Test Agent',
    role: 'Tester',
  }).returning();
  testAgentId = agent.id;

  const [agent2] = await db.insert(agents).values({
    teamId: testTeamId,
    name: 'Thread Test Agent 2',
    role: 'Secondary Tester',
  }).returning();
  testAgent2Id = agent2.id;
});

afterAll(async () => {
  // Cleanup: delete test user (cascades to teams, agents, threads, etc.)
  await db.delete(users).where(eq(users.id, testUserId));
});

// ============================================================================
// Thread Queries Tests
// ============================================================================

describe('Thread Queries', () => {
  describe('createThread', () => {
    test('creates a new thread with active status', async () => {
      const thread = await createThread(testAgentId);

      expect(thread.id).toBeDefined();
      expect(thread.agentId).toBe(testAgentId);
      expect(thread.status).toBe('active');
      expect(thread.createdAt).toBeDefined();
      expect(thread.completedAt).toBeNull();

      // Cleanup
      await deleteThread(thread.id);
    });

    test('creates independent threads for multiple agents', async () => {
      const thread1 = await createThread(testAgentId);
      const thread2 = await createThread(testAgent2Id);

      expect(thread1.id).not.toBe(thread2.id);
      expect(thread1.agentId).toBe(testAgentId);
      expect(thread2.agentId).toBe(testAgent2Id);

      // Cleanup
      await deleteThread(thread1.id);
      await deleteThread(thread2.id);
    });
  });

  describe('getActiveThread', () => {
    test('returns null when no active thread exists', async () => {
      const result = await getActiveThread(testAgentId);
      expect(result).toBeNull();
    });

    test('returns active thread when one exists', async () => {
      const created = await createThread(testAgentId);
      const active = await getActiveThread(testAgentId);

      expect(active).not.toBeNull();
      expect(active!.id).toBe(created.id);
      expect(active!.status).toBe('active');

      // Cleanup
      await deleteThread(created.id);
    });

    test('returns only active threads, not completed ones', async () => {
      const thread = await createThread(testAgentId);
      await completeThread(thread.id);

      const active = await getActiveThread(testAgentId);
      expect(active).toBeNull();

      // Cleanup
      await deleteThread(thread.id);
    });

    test('returns most recent active thread when multiple exist', async () => {
      // Note: In practice, there should only be one active thread per agent
      // This tests the ordering behavior
      const thread1 = await createThread(testAgentId);
      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
      const thread2 = await createThread(testAgentId);

      const active = await getActiveThread(testAgentId);
      expect(active!.id).toBe(thread2.id);

      // Cleanup
      await deleteThread(thread1.id);
      await deleteThread(thread2.id);
    });
  });

  describe('getThreadById', () => {
    test('returns thread by ID', async () => {
      const created = await createThread(testAgentId);
      const retrieved = await getThreadById(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);

      // Cleanup
      await deleteThread(created.id);
    });

    test('returns null for non-existent ID', async () => {
      const result = await getThreadById('00000000-0000-0000-0000-000000000000');
      expect(result).toBeNull();
    });
  });

  describe('completeThread', () => {
    test('marks thread as completed with timestamp', async () => {
      const thread = await createThread(testAgentId);
      expect(thread.status).toBe('active');

      const completed = await completeThread(thread.id);

      expect(completed.status).toBe('completed');
      expect(completed.completedAt).toBeDefined();
      expect(completed.completedAt).not.toBeNull();

      // Cleanup
      await deleteThread(thread.id);
    });
  });

  describe('markThreadCompacted', () => {
    test('marks thread as compacted', async () => {
      const thread = await createThread(testAgentId);
      const compacted = await markThreadCompacted(thread.id);

      expect(compacted.status).toBe('compacted');

      // Cleanup
      await deleteThread(thread.id);
    });
  });

  describe('Thread Messages', () => {
    let threadId: string;

    beforeEach(async () => {
      const thread = await createThread(testAgentId);
      threadId = thread.id;
    });

    afterEach(async () => {
      await deleteThread(threadId);
    });

    test('appendThreadMessage adds message with auto-incrementing sequence', async () => {
      const msg1 = await appendThreadMessage(threadId, 'user', 'Hello');
      const msg2 = await appendThreadMessage(threadId, 'assistant', 'Hi there!');
      const msg3 = await appendThreadMessage(threadId, 'user', 'How are you?');

      expect(msg1.sequenceNumber).toBe(1);
      expect(msg2.sequenceNumber).toBe(2);
      expect(msg3.sequenceNumber).toBe(3);
    });

    test('appendThreadMessage stores toolCalls', async () => {
      const toolCalls = [
        { id: 'call_1', name: 'search', input: { query: 'test' } },
      ];
      const msg = await appendThreadMessage(threadId, 'assistant', 'Searching...', toolCalls);

      expect(msg.toolCalls).toEqual(toolCalls);
    });

    test('getThreadMessages returns messages in sequence order', async () => {
      await appendThreadMessage(threadId, 'system', 'You are a helpful assistant');
      await appendThreadMessage(threadId, 'user', 'Hello');
      await appendThreadMessage(threadId, 'assistant', 'Hi!');

      const messages = await getThreadMessages(threadId);

      expect(messages).toHaveLength(3);
      expect(messages[0].role).toBe('system');
      expect(messages[1].role).toBe('user');
      expect(messages[2].role).toBe('assistant');
      expect(messages[0].sequenceNumber).toBeLessThan(messages[1].sequenceNumber);
      expect(messages[1].sequenceNumber).toBeLessThan(messages[2].sequenceNumber);
    });

    test('getThreadMessages returns empty array for empty thread', async () => {
      const messages = await getThreadMessages(threadId);
      expect(messages).toEqual([]);
    });

    test('getNextThreadSequenceNumber returns 1 for empty thread', async () => {
      const seq = await getNextThreadSequenceNumber(threadId);
      expect(seq).toBe(1);
    });

    test('getNextThreadSequenceNumber returns next number', async () => {
      await appendThreadMessage(threadId, 'user', 'First');
      await appendThreadMessage(threadId, 'assistant', 'Second');

      const seq = await getNextThreadSequenceNumber(threadId);
      expect(seq).toBe(3);
    });

    test('createThreadMessage allows explicit sequence number', async () => {
      const msg = await createThreadMessage(threadId, 'system', 'Summary', 1);
      expect(msg.sequenceNumber).toBe(1);
    });

    test('getLastThreadMessage returns most recent message', async () => {
      await appendThreadMessage(threadId, 'user', 'First');
      await appendThreadMessage(threadId, 'assistant', 'Second');
      await appendThreadMessage(threadId, 'user', 'Third');

      const last = await getLastThreadMessage(threadId);
      expect(last!.content).toBe('Third');
      expect(last!.sequenceNumber).toBe(3);
    });

    test('getLastThreadMessage returns null for empty thread', async () => {
      const last = await getLastThreadMessage(threadId);
      expect(last).toBeNull();
    });

    test('getThreadMessageCount returns correct count', async () => {
      expect(await getThreadMessageCount(threadId)).toBe(0);

      await appendThreadMessage(threadId, 'user', 'One');
      expect(await getThreadMessageCount(threadId)).toBe(1);

      await appendThreadMessage(threadId, 'assistant', 'Two');
      expect(await getThreadMessageCount(threadId)).toBe(2);
    });

    test('deleteThreadMessages removes all messages', async () => {
      await appendThreadMessage(threadId, 'user', 'One');
      await appendThreadMessage(threadId, 'assistant', 'Two');
      expect(await getThreadMessageCount(threadId)).toBe(2);

      await deleteThreadMessages(threadId);
      expect(await getThreadMessageCount(threadId)).toBe(0);
    });
  });

  describe('compactThread', () => {
    test('replaces all messages with summary and marks compacted', async () => {
      const thread = await createThread(testAgentId);

      await appendThreadMessage(thread.id, 'user', 'Hello');
      await appendThreadMessage(thread.id, 'assistant', 'Hi');
      await appendThreadMessage(thread.id, 'user', 'What is 2+2?');
      await appendThreadMessage(thread.id, 'assistant', 'The answer is 4');
      expect(await getThreadMessageCount(thread.id)).toBe(4);

      const summary = 'Previous conversation: User asked about addition, assistant answered correctly.';
      await compactThread(thread.id, summary);

      // Check messages are replaced with summary
      const messages = await getThreadMessages(thread.id);
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toBe(summary);
      expect(messages[0].sequenceNumber).toBe(1);

      // Check thread is marked compacted
      const updated = await getThreadById(thread.id);
      expect(updated!.status).toBe('compacted');

      // Cleanup
      await deleteThread(thread.id);
    });
  });

  describe('Thread Query Functions', () => {
    test('getThreadsByAgentId returns all threads for agent', async () => {
      const t1 = await createThread(testAgentId);
      const t2 = await createThread(testAgentId);
      await completeThread(t2.id);

      const threads = await getThreadsByAgentId(testAgentId);
      expect(threads.length).toBeGreaterThanOrEqual(2);
      expect(threads.some(t => t.id === t1.id)).toBe(true);
      expect(threads.some(t => t.id === t2.id)).toBe(true);

      // Cleanup
      await deleteThread(t1.id);
      await deleteThread(t2.id);
    });

    test('getRecentThreads limits results', async () => {
      const created: string[] = [];
      for (let i = 0; i < 5; i++) {
        const t = await createThread(testAgentId);
        created.push(t.id);
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      const recent = await getRecentThreads(testAgentId, 3);
      expect(recent).toHaveLength(3);

      // Cleanup
      for (const id of created) {
        await deleteThread(id);
      }
    });

    test('getThreadsByStatus filters by status', async () => {
      const active = await createThread(testAgentId);
      const completed = await createThread(testAgentId);
      await completeThread(completed.id);

      const activeThreads = await getThreadsByStatus(testAgentId, 'active');
      const completedThreads = await getThreadsByStatus(testAgentId, 'completed');

      expect(activeThreads.some(t => t.id === active.id)).toBe(true);
      expect(activeThreads.some(t => t.id === completed.id)).toBe(false);
      expect(completedThreads.some(t => t.id === completed.id)).toBe(true);
      expect(completedThreads.some(t => t.id === active.id)).toBe(false);

      // Cleanup
      await deleteThread(active.id);
      await deleteThread(completed.id);
    });

    test('getOrCreateActiveThread returns existing active thread', async () => {
      const existing = await createThread(testAgentId);
      const result = await getOrCreateActiveThread(testAgentId);

      expect(result.id).toBe(existing.id);

      // Cleanup
      await deleteThread(existing.id);
    });

    test('getOrCreateActiveThread creates new thread when none exists', async () => {
      const result = await getOrCreateActiveThread(testAgentId);
      expect(result.status).toBe('active');

      // Cleanup
      await deleteThread(result.id);
    });

    test('deleteThread removes thread and cascades to messages', async () => {
      const thread = await createThread(testAgentId);
      await appendThreadMessage(thread.id, 'user', 'Hello');

      await deleteThread(thread.id);

      expect(await getThreadById(thread.id)).toBeNull();
      // Messages should also be deleted (cascade)
      const messages = await db.select().from(threadMessages).where(eq(threadMessages.threadId, thread.id));
      expect(messages).toHaveLength(0);
    });
  });
});

// ============================================================================
// Thread Abstraction Tests
// ============================================================================

describe('Thread Abstraction', () => {
  describe('Work Session Management', () => {
    test('startWorkSession creates new thread and returns session', async () => {
      const session = await startWorkSession(testAgentId);

      expect(session.threadId).toBeDefined();
      const thread = await getThreadById(session.threadId);
      expect(thread!.status).toBe('active');

      // Cleanup
      await deleteThread(session.threadId);
    });

    test('getOrStartWorkSession returns existing session', async () => {
      const first = await startWorkSession(testAgentId);
      const second = await getOrStartWorkSession(testAgentId);

      expect(second.threadId).toBe(first.threadId);

      // Cleanup
      await deleteThread(first.threadId);
    });

    test('getOrStartWorkSession creates new when none exists', async () => {
      const session = await getOrStartWorkSession(testAgentId);
      expect(session.threadId).toBeDefined();

      // Cleanup
      await deleteThread(session.threadId);
    });

    test('endWorkSession marks thread as completed', async () => {
      const session = await startWorkSession(testAgentId);
      await endWorkSession(session.threadId);

      const thread = await getThreadById(session.threadId);
      expect(thread!.status).toBe('completed');

      // Cleanup
      await deleteThread(session.threadId);
    });

    test('hasActiveSession returns correct state', async () => {
      expect(await hasActiveSession(testAgentId)).toBe(false);

      const session = await startWorkSession(testAgentId);
      expect(await hasActiveSession(testAgentId)).toBe(true);

      await endWorkSession(session.threadId);
      expect(await hasActiveSession(testAgentId)).toBe(false);

      // Cleanup
      await deleteThread(session.threadId);
    });

    test('getSessionThread returns thread details', async () => {
      const session = await startWorkSession(testAgentId);
      const thread = await getSessionThread(session.threadId);

      expect(thread).not.toBeNull();
      expect(thread!.id).toBe(session.threadId);
      expect(thread!.status).toBe('active');

      // Cleanup
      await deleteThread(session.threadId);
    });
  });

  describe('Message Management', () => {
    let threadId: string;

    beforeEach(async () => {
      const session = await startWorkSession(testAgentId);
      threadId = session.threadId;
    });

    afterEach(async () => {
      await deleteThread(threadId);
    });

    test('addToThread adds message with correct role', async () => {
      const msg = await addToThread(threadId, 'user', 'Test message');
      expect(msg.role).toBe('user');
      expect(msg.content).toBe('Test message');
    });

    test('addUserMessage adds user role message', async () => {
      const msg = await addUserMessage(threadId, 'User input');
      expect(msg.role).toBe('user');
    });

    test('addAssistantMessage adds assistant role message', async () => {
      const msg = await addAssistantMessage(threadId, 'Assistant response');
      expect(msg.role).toBe('assistant');
    });

    test('addAssistantMessage stores toolCalls', async () => {
      const toolCalls = [{ id: 'tc1', name: 'test' }];
      const msg = await addAssistantMessage(threadId, 'Using tools', toolCalls);
      expect(msg.toolCalls).toEqual(toolCalls);
    });

    test('addSystemMessage adds system role message', async () => {
      const msg = await addSystemMessage(threadId, 'System instruction');
      expect(msg.role).toBe('system');
    });

    test('getMessages returns all thread messages', async () => {
      await addSystemMessage(threadId, 'System');
      await addUserMessage(threadId, 'User');
      await addAssistantMessage(threadId, 'Assistant');

      const messages = await getMessages(threadId);
      expect(messages).toHaveLength(3);
    });
  });

  describe('Context Building', () => {
    let threadId: string;

    beforeEach(async () => {
      const session = await startWorkSession(testAgentId);
      threadId = session.threadId;
    });

    afterEach(async () => {
      await deleteThread(threadId);
    });

    test('buildThreadContext returns messages in correct format', async () => {
      await addSystemMessage(threadId, 'You are helpful');
      await addUserMessage(threadId, 'Hello');
      await addAssistantMessage(threadId, 'Hi!');

      const context = await buildThreadContext(threadId);

      expect(context.messages).toHaveLength(3);
      expect(context.messages[0]).toEqual({ role: 'system', content: 'You are helpful' });
      expect(context.messages[1]).toEqual({ role: 'user', content: 'Hello' });
      expect(context.messages[2]).toEqual({ role: 'assistant', content: 'Hi!' });
      expect(context.messageCount).toBe(3);
      expect(context.estimatedTokens).toBeGreaterThan(0);
    });

    test('buildThreadContext returns empty for empty thread', async () => {
      const context = await buildThreadContext(threadId);
      expect(context.messages).toEqual([]);
      expect(context.messageCount).toBe(0);
      expect(context.estimatedTokens).toBe(0);
    });

    test('buildThreadContext trims to token budget', async () => {
      await addSystemMessage(threadId, 'System prompt');
      // Add many messages to exceed budget
      for (let i = 0; i < 50; i++) {
        await addUserMessage(threadId, `Message ${i} with some content to increase token count`);
        await addAssistantMessage(threadId, `Response ${i} with additional content`);
      }

      // Build with low token limit
      const context = await buildThreadContext(threadId, 500);

      // Should have fewer than all messages but still include system
      expect(context.messageCount).toBeLessThan(101);
      expect(context.messages[0].role).toBe('system');
      expect(context.estimatedTokens).toBeLessThanOrEqual(500);
    });

    test('threadMessagesToLLMFormat converts messages correctly', async () => {
      await addSystemMessage(threadId, 'System');
      await addUserMessage(threadId, 'User');
      await addAssistantMessage(threadId, 'Assistant');

      const dbMessages = await getMessages(threadId);
      const llmMessages = threadMessagesToLLMFormat(dbMessages);

      expect(llmMessages).toHaveLength(3);
      expect(llmMessages[0]).toEqual({ role: 'system', content: 'System' });
      expect(llmMessages[1]).toEqual({ role: 'user', content: 'User' });
      expect(llmMessages[2]).toEqual({ role: 'assistant', content: 'Assistant' });
    });
  });

  describe('Token Estimation', () => {
    test('estimateTokenCount calculates based on character count', () => {
      const messages = [
        { role: 'user', content: 'Hello' }, // 5 chars = ~2 tokens
        { role: 'assistant', content: 'Hi there!' }, // 9 chars = ~3 tokens
      ];
      const tokens = estimateTokenCount(messages);
      expect(tokens).toBe(4); // ceil(14/4) = 4
    });

    test('estimateTokenCount returns 0 for empty messages', () => {
      expect(estimateTokenCount([])).toBe(0);
    });
  });

  describe('trimMessagesToTokenBudget', () => {
    test('returns all messages when under budget', () => {
      const messages = [
        { role: 'system', content: 'Short' },
        { role: 'user', content: 'Hello' },
      ];
      const trimmed = trimMessagesToTokenBudget(messages, 1000);
      expect(trimmed).toEqual(messages);
    });

    test('preserves system messages at start', () => {
      const messages = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'A'.repeat(100) },
        { role: 'assistant', content: 'B'.repeat(100) },
        { role: 'user', content: 'Recent message' },
      ];
      const trimmed = trimMessagesToTokenBudget(messages, 50);

      expect(trimmed[0].role).toBe('system');
      expect(trimmed[0].content).toBe('System prompt');
    });

    test('keeps most recent messages when trimming', () => {
      const messages = [
        { role: 'system', content: 'Sys' },
        { role: 'user', content: 'Old message' },
        { role: 'assistant', content: 'Old response' },
        { role: 'user', content: 'New message' },
        { role: 'assistant', content: 'New response' },
      ];
      // Low budget to force trimming
      const trimmed = trimMessagesToTokenBudget(messages, 15);

      // Should have system + most recent
      expect(trimmed.some(m => m.content === 'Sys')).toBe(true);
      expect(trimmed.some(m => m.content === 'New response')).toBe(true);
    });

    test('returns empty array for empty input', () => {
      expect(trimMessagesToTokenBudget([], 1000)).toEqual([]);
    });

    test('handles multiple system messages at start', () => {
      const messages = [
        { role: 'system', content: 'Prompt 1' },
        { role: 'system', content: 'Prompt 2' },
        { role: 'user', content: 'Hello' },
      ];
      const trimmed = trimMessagesToTokenBudget(messages, 1000);

      expect(trimmed[0].content).toBe('Prompt 1');
      expect(trimmed[1].content).toBe('Prompt 2');
    });
  });

  describe('Compaction', () => {
    let threadId: string;

    beforeEach(async () => {
      const session = await startWorkSession(testAgentId);
      threadId = session.threadId;
    });

    afterEach(async () => {
      await deleteThread(threadId);
    });

    test('shouldCompact returns false when under limit', async () => {
      await addUserMessage(threadId, 'Hello');
      await addAssistantMessage(threadId, 'Hi');

      expect(await shouldCompact(threadId, 50)).toBe(false);
    });

    test('shouldCompact returns true when at or over limit', async () => {
      for (let i = 0; i < 10; i++) {
        await addUserMessage(threadId, `Message ${i}`);
      }

      expect(await shouldCompact(threadId, 10)).toBe(true);
      expect(await shouldCompact(threadId, 5)).toBe(true);
    });

    test('compactIfNeeded returns false when no compaction needed', async () => {
      await addUserMessage(threadId, 'Hello');

      const result = await compactIfNeeded(threadId, undefined, 50);
      expect(result).toBe(false);
    });

    test('compactIfNeeded returns false when no summarize function provided', async () => {
      for (let i = 0; i < 10; i++) {
        await addUserMessage(threadId, `Message ${i}`);
      }

      const result = await compactIfNeeded(threadId, undefined, 5);
      expect(result).toBe(false);
    });

    test('compactIfNeeded compacts with provided summarize function', async () => {
      for (let i = 0; i < 10; i++) {
        await addUserMessage(threadId, `Message ${i}`);
      }

      const summarizeFn = async () => 'This is a summary of 10 messages';
      const result = await compactIfNeeded(threadId, summarizeFn, 5);

      expect(result).toBe(true);

      const messages = await getMessages(threadId);
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('This is a summary of 10 messages');
    });

    test('compactWithSummary directly compacts thread', async () => {
      await addUserMessage(threadId, 'Hello');
      await addAssistantMessage(threadId, 'Hi');

      await compactWithSummary(threadId, 'Summarized conversation');

      const messages = await getMessages(threadId);
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Summarized conversation');
      expect(messages[0].role).toBe('system');
    });

    test('clearThread removes all messages without marking compacted', async () => {
      await addUserMessage(threadId, 'Hello');
      await addAssistantMessage(threadId, 'Hi');

      await clearThread(threadId);

      const messages = await getMessages(threadId);
      expect(messages).toHaveLength(0);

      const thread = await getSessionThread(threadId);
      expect(thread!.status).toBe('active'); // Not marked compacted
    });
  });

  describe('Thread Utilities', () => {
    let threadId: string;

    beforeEach(async () => {
      const session = await startWorkSession(testAgentId);
      threadId = session.threadId;
    });

    afterEach(async () => {
      await deleteThread(threadId);
    });

    test('getThreadStats returns correct statistics', async () => {
      await addUserMessage(threadId, 'Hello world');
      await addAssistantMessage(threadId, 'Hi there!');

      const stats = await getThreadStats(threadId);

      expect(stats.messageCount).toBe(2);
      expect(stats.estimatedTokens).toBeGreaterThan(0);
      expect(stats.isApproachingLimit).toBe(false);
    });

    test('getThreadStats detects approaching limit', async () => {
      for (let i = 0; i < 42; i++) {
        await addUserMessage(threadId, `Msg ${i}`);
      }

      // 42 messages, default max is 50, 80% of 50 is 40
      const stats = await getThreadStats(threadId, 50);
      expect(stats.isApproachingLimit).toBe(true);
    });

    test('initializeThreadWithPrompt adds system message at sequence 1', async () => {
      const msg = await initializeThreadWithPrompt(threadId, 'You are a helpful assistant');

      expect(msg.role).toBe('system');
      expect(msg.content).toBe('You are a helpful assistant');
      expect(msg.sequenceNumber).toBe(1);
    });
  });
});

// ============================================================================
// Edge Case Tests
// ============================================================================

describe('Edge Cases', () => {
  test('handles thread with very long messages', async () => {
    const thread = await createThread(testAgentId);
    const longContent = 'A'.repeat(10000);

    const msg = await appendThreadMessage(thread.id, 'user', longContent);
    expect(msg.content).toBe(longContent);

    const retrieved = await getThreadMessages(thread.id);
    expect(retrieved[0].content).toBe(longContent);

    await deleteThread(thread.id);
  });

  test('handles sequential message appends', async () => {
    // Note: Concurrent appends can have race conditions with sequence numbers
    // In production, consider using database sequences or serializable transactions
    const thread = await createThread(testAgentId);

    // Append messages sequentially
    for (let i = 0; i < 10; i++) {
      await appendThreadMessage(thread.id, 'user', `Message ${i}`);
    }

    const messages = await getThreadMessages(thread.id);
    const sequences = messages.map(m => m.sequenceNumber);
    const uniqueSequences = new Set(sequences);
    expect(uniqueSequences.size).toBe(10);

    await deleteThread(thread.id);
  });

  test('handles empty summary in compaction', async () => {
    const thread = await createThread(testAgentId);
    await appendThreadMessage(thread.id, 'user', 'Hello');

    await compactThread(thread.id, '');

    const messages = await getThreadMessages(thread.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('');

    await deleteThread(thread.id);
  });

  test('handles special characters in message content', async () => {
    const thread = await createThread(testAgentId);
    // Note: PostgreSQL does not support null bytes (\u0000) in text fields
    const specialContent = '`~!@#$%^&*()_+-=[]{}|;:\'"<>,.?/\\n\\t\u1234\u2603\ud83d\ude00';

    await appendThreadMessage(thread.id, 'user', specialContent);
    const retrieved = await getThreadMessages(thread.id);

    expect(retrieved[0].content).toBe(specialContent);

    await deleteThread(thread.id);
  });

  test('handles JSON in toolCalls', async () => {
    const thread = await createThread(testAgentId);
    const complexToolCalls = [
      {
        id: 'call_123',
        name: 'complex_tool',
        input: {
          nested: {
            array: [1, 2, 3],
            object: { key: 'value' },
            nullValue: null,
            boolValue: true,
          },
        },
      },
    ];

    await appendThreadMessage(thread.id, 'assistant', 'Using tool', complexToolCalls);
    const messages = await getThreadMessages(thread.id);

    expect(messages[0].toolCalls).toEqual(complexToolCalls);

    await deleteThread(thread.id);
  });

  test('multiple agents can have independent threads', async () => {
    const session1 = await startWorkSession(testAgentId);
    const session2 = await startWorkSession(testAgent2Id);

    await addUserMessage(session1.threadId, 'Agent 1 message');
    await addUserMessage(session2.threadId, 'Agent 2 message');

    const msgs1 = await getMessages(session1.threadId);
    const msgs2 = await getMessages(session2.threadId);

    expect(msgs1).toHaveLength(1);
    expect(msgs1[0].content).toBe('Agent 1 message');
    expect(msgs2).toHaveLength(1);
    expect(msgs2[0].content).toBe('Agent 2 message');

    await deleteThread(session1.threadId);
    await deleteThread(session2.threadId);
  });
});
