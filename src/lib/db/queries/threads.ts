import { eq, asc, desc, sql, and } from 'drizzle-orm';
import { db } from '../client';
import { threads, threadMessages } from '../schema';
import type { Thread, ThreadMessage, ThreadStatus } from '@/lib/types';

// ============================================================================
// Thread Lifecycle
// ============================================================================

/**
 * Create a new thread for an agent's work session
 */
export async function createThread(agentId: string): Promise<Thread> {
  const result = await db
    .insert(threads)
    .values({ agentId, status: 'active' })
    .returning();

  return result[0];
}

/**
 * Get the active thread for an agent (if any)
 */
export async function getActiveThread(agentId: string): Promise<Thread | null> {
  const result = await db
    .select()
    .from(threads)
    .where(and(eq(threads.agentId, agentId), eq(threads.status, 'active')))
    .orderBy(desc(threads.createdAt))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Get a thread by ID
 */
export async function getThreadById(threadId: string): Promise<Thread | null> {
  const result = await db
    .select()
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Mark thread as completed
 */
export async function completeThread(threadId: string): Promise<Thread> {
  const result = await db
    .update(threads)
    .set({
      status: 'completed' as ThreadStatus,
      completedAt: new Date(),
    })
    .where(eq(threads.id, threadId))
    .returning();

  return result[0];
}

/**
 * Mark thread as compacted (after summarization)
 */
export async function markThreadCompacted(threadId: string): Promise<Thread> {
  const result = await db
    .update(threads)
    .set({ status: 'compacted' as ThreadStatus })
    .where(eq(threads.id, threadId))
    .returning();

  return result[0];
}

// ============================================================================
// Thread Messages
// ============================================================================

/**
 * Get all messages in a thread (ordered by sequenceNumber)
 */
export async function getThreadMessages(threadId: string): Promise<ThreadMessage[]> {
  return db
    .select()
    .from(threadMessages)
    .where(eq(threadMessages.threadId, threadId))
    .orderBy(asc(threadMessages.sequenceNumber));
}

/**
 * Get the next sequence number for a thread
 */
export async function getNextThreadSequenceNumber(threadId: string): Promise<number> {
  const result = await db
    .select({ maxSeq: sql<number>`COALESCE(MAX(${threadMessages.sequenceNumber}), 0)` })
    .from(threadMessages)
    .where(eq(threadMessages.threadId, threadId));

  // Note: SQL aggregates may return string in some drivers, coerce to number
  return Number(result[0]?.maxSeq ?? 0) + 1;
}

/**
 * Append a message to a thread
 *
 * Note: This function has a potential race condition if called concurrently
 * for the same thread. The sequence number is fetched and then used in a
 * separate insert. For concurrent writes, consider using database sequences
 * or serializable transactions.
 */
export async function appendThreadMessage(
  threadId: string,
  role: string,
  content: string,
  toolCalls?: unknown
): Promise<ThreadMessage> {
  const sequenceNumber = await getNextThreadSequenceNumber(threadId);

  const result = await db
    .insert(threadMessages)
    .values({
      threadId,
      role,
      content,
      toolCalls: toolCalls ?? null,
      sequenceNumber,
    })
    .returning();

  return result[0];
}

/**
 * Create a thread message with explicit sequence number
 */
export async function createThreadMessage(
  threadId: string,
  role: string,
  content: string,
  sequenceNumber: number,
  toolCalls?: unknown
): Promise<ThreadMessage> {
  const result = await db
    .insert(threadMessages)
    .values({
      threadId,
      role,
      content,
      toolCalls: toolCalls ?? null,
      sequenceNumber,
    })
    .returning();

  return result[0];
}

/**
 * Get the last message in a thread
 */
export async function getLastThreadMessage(
  threadId: string
): Promise<ThreadMessage | null> {
  const result = await db
    .select()
    .from(threadMessages)
    .where(eq(threadMessages.threadId, threadId))
    .orderBy(desc(threadMessages.sequenceNumber))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Get message count for a thread
 */
export async function getThreadMessageCount(threadId: string): Promise<number> {
  const result = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(threadMessages)
    .where(eq(threadMessages.threadId, threadId));

  // Note: SQL COUNT returns string in some drivers, coerce to number
  return Number(result[0]?.count ?? 0);
}

/**
 * Delete all messages in a thread (for compaction)
 */
export async function deleteThreadMessages(threadId: string): Promise<void> {
  await db.delete(threadMessages).where(eq(threadMessages.threadId, threadId));
}

/**
 * Compact thread - replace all messages with a summary message
 */
export async function compactThread(
  threadId: string,
  summary: string
): Promise<void> {
  // Delete all existing messages
  await deleteThreadMessages(threadId);

  // Add the summary as the first message (system role)
  await createThreadMessage(threadId, 'system', summary, 1);

  // Mark thread as compacted
  await markThreadCompacted(threadId);
}

// ============================================================================
// Thread Queries
// ============================================================================

/**
 * Get threads by agent ID
 */
export async function getThreadsByAgentId(agentId: string): Promise<Thread[]> {
  return db
    .select()
    .from(threads)
    .where(eq(threads.agentId, agentId))
    .orderBy(desc(threads.createdAt));
}

/**
 * Get recent threads for an agent
 */
export async function getRecentThreads(
  agentId: string,
  limit: number
): Promise<Thread[]> {
  return db
    .select()
    .from(threads)
    .where(eq(threads.agentId, agentId))
    .orderBy(desc(threads.createdAt))
    .limit(limit);
}

/**
 * Get threads by status
 */
export async function getThreadsByStatus(
  agentId: string,
  status: ThreadStatus
): Promise<Thread[]> {
  return db
    .select()
    .from(threads)
    .where(and(eq(threads.agentId, agentId), eq(threads.status, status)))
    .orderBy(desc(threads.createdAt));
}

/**
 * Delete a thread (and its messages via cascade)
 */
export async function deleteThread(threadId: string): Promise<void> {
  await db.delete(threads).where(eq(threads.id, threadId));
}

/**
 * Get or create an active thread for an agent
 */
export async function getOrCreateActiveThread(agentId: string): Promise<Thread> {
  const existing = await getActiveThread(agentId);
  if (existing) {
    return existing;
  }
  return createThread(agentId);
}
