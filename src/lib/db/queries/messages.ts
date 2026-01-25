import { eq, asc, desc, sql } from 'drizzle-orm';
import { db } from '../client';
import { messages } from '../schema';
import type { Message, NewMessage, MessageRole } from '@/lib/types';

/**
 * Get a message by ID
 */
export async function getMessageById(messageId: string): Promise<Message | null> {
  const result = await db
    .select()
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Get all messages for a conversation, ordered by sequence
 */
export async function getMessagesByConversationId(
  conversationId: string
): Promise<Message[]> {
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.sequenceNumber));
}

/**
 * Get the next sequence number for a conversation
 */
export async function getNextSequenceNumber(
  conversationId: string
): Promise<number> {
  const result = await db
    .select({ maxSeq: sql<number>`COALESCE(MAX(${messages.sequenceNumber}), 0)` })
    .from(messages)
    .where(eq(messages.conversationId, conversationId));

  return (result[0]?.maxSeq ?? 0) + 1;
}

/**
 * Get the last N messages from a conversation
 */
export async function getRecentMessages(
  conversationId: string,
  limit: number
): Promise<Message[]> {
  // Get the last N messages and reverse to maintain chronological order
  const result = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.sequenceNumber))
    .limit(limit);

  return result.reverse();
}

/**
 * Create a new message
 */
export async function createMessage(data: NewMessage): Promise<Message> {
  const result = await db
    .insert(messages)
    .values({
      conversationId: data.conversationId,
      role: data.role,
      content: data.content,
      thinking: data.thinking ?? null,
      sequenceNumber: data.sequenceNumber,
    })
    .returning();

  return result[0];
}

/**
 * Append a message to a conversation with auto-incrementing sequence number
 */
export async function appendMessage(
  conversationId: string,
  role: MessageRole,
  content: string,
  thinking?: string | null
): Promise<Message> {
  const sequenceNumber = await getNextSequenceNumber(conversationId);
  return createMessage({
    conversationId,
    role,
    content,
    thinking,
    sequenceNumber,
  });
}

/**
 * Get the last message in a conversation
 */
export async function getLastMessage(
  conversationId: string
): Promise<Message | null> {
  const result = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.sequenceNumber))
    .limit(1);

  return result[0] ?? null;
}
