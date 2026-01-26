import { eq, asc, desc, and, gt } from 'drizzle-orm';
import { db } from '../client';
import { messages } from '../schema';
import type { Message } from '@/lib/types';

// Message role type for the new schema (no 'system', added 'tool' and 'summary')
export type MessageRole = 'user' | 'assistant' | 'tool' | 'summary';

// Tool call type for assistant messages
export interface ToolCall {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

// Parameters for creating a new message
export interface CreateMessageParams {
  conversationId: string;
  role: MessageRole;
  content: string;
  thinking?: string | null;
  toolCalls?: ToolCall[] | null;
  toolCallId?: string | null;
  previousMessageId?: string | null;
}

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
 * Get all messages for a conversation, ordered by creation time
 */
export async function getMessagesByConversationId(
  conversationId: string
): Promise<Message[]> {
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));
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
    .orderBy(desc(messages.createdAt))
    .limit(limit);

  return result.reverse();
}

/**
 * Create a new message with all supported fields
 */
export async function createMessage(data: CreateMessageParams): Promise<Message> {
  const result = await db
    .insert(messages)
    .values({
      conversationId: data.conversationId,
      role: data.role,
      content: data.content,
      thinking: data.thinking ?? null,
      toolCalls: data.toolCalls ?? null,
      toolCallId: data.toolCallId ?? null,
      previousMessageId: data.previousMessageId ?? null,
    })
    .returning();

  return result[0];
}

/**
 * Append a message to a conversation, automatically linking to the previous message
 */
export async function appendMessage(
  conversationId: string,
  role: MessageRole,
  content: string,
  options?: {
    thinking?: string | null;
    toolCalls?: ToolCall[] | null;
    toolCallId?: string | null;
  }
): Promise<Message> {
  // Get the last message to link to it
  const lastMessage = await getLastMessage(conversationId);

  return createMessage({
    conversationId,
    role,
    content,
    thinking: options?.thinking,
    toolCalls: options?.toolCalls,
    toolCallId: options?.toolCallId,
    previousMessageId: lastMessage?.id ?? null,
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
    .orderBy(desc(messages.createdAt))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Get the latest summary message in a conversation
 */
export async function getLatestSummary(
  conversationId: string
): Promise<Message | null> {
  const result = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.role, 'summary')
      )
    )
    .orderBy(desc(messages.createdAt))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Get conversation context with compaction awareness
 * Returns: latest summary (if any) + all messages created after it
 * If no summary exists, returns all messages
 */
export async function getConversationContext(
  conversationId: string
): Promise<Message[]> {
  const latestSummary = await getLatestSummary(conversationId);

  if (latestSummary) {
    // Get messages created after the summary
    const recentMessages = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          gt(messages.createdAt, latestSummary.createdAt)
        )
      )
      .orderBy(asc(messages.createdAt));

    return [latestSummary, ...recentMessages];
  }

  // No summary yet, return all messages
  return getMessagesByConversationId(conversationId);
}

/**
 * Add a tool result message to a conversation
 * Links the result to the tool call via toolCallId
 */
export async function addToolResultMessage(
  conversationId: string,
  toolCallId: string,
  content: string,
  previousMessageId?: string
): Promise<Message> {
  // If no previousMessageId provided, get the last message
  const prevId = previousMessageId ?? (await getLastMessage(conversationId))?.id ?? null;

  return createMessage({
    conversationId,
    role: 'tool',
    content,
    toolCallId,
    previousMessageId: prevId,
  });
}

/**
 * Add a summary message to a conversation (for compaction)
 * The summary includes all context up to and including the previous message
 */
export async function addSummaryMessage(
  conversationId: string,
  summaryContent: string,
  previousMessageId?: string
): Promise<Message> {
  // If no previousMessageId provided, get the last message
  const prevId = previousMessageId ?? (await getLastMessage(conversationId))?.id ?? null;

  return createMessage({
    conversationId,
    role: 'summary',
    content: summaryContent,
    previousMessageId: prevId,
  });
}
