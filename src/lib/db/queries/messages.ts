import { eq, asc, desc, and, gt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db } from '../client';
import * as schema from '../schema';
import { messages, conversations } from '../schema';
import type { Message, MessageContent, MessageRole, UserMessageContent, LLMMessageContent, SummaryMessageContent } from '@/lib/types';

type DbClient = PostgresJsDatabase<typeof schema>;

// Parameters for creating a new message
export interface CreateMessageParams {
  conversationId: string;
  role: MessageRole;
  content: MessageContent;
  previousMessageId?: string | null;
}

type TurnMessageParams = Omit<CreateMessageParams, 'conversationId' | 'previousMessageId'>;

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
 * Create a new message
 */
export async function createMessage(data: CreateMessageParams): Promise<Message> {
  const result = await db
    .insert(messages)
    .values({
      conversationId: data.conversationId,
      role: data.role,
      content: data.content,
      previousMessageId: data.previousMessageId ?? null,
    })
    .returning();

  return result[0];
}

/**
 * Create a full turn (user + llm) in a single transaction.
 * Links user -> last message, llm -> user message.
 */
export async function createTurnMessages(
  conversationId: string,
  user: TurnMessageParams,
  llm: TurnMessageParams
): Promise<{ userMessage: Message; llmMessage: Message }> {
  return db.transaction(async (tx) =>
    createTurnMessagesInTransaction(tx, conversationId, user, llm)
  );
}

/**
 * Create a full turn using an existing transaction.
 */
export async function createTurnMessagesInTransaction(
  tx: DbClient,
  conversationId: string,
  user: TurnMessageParams,
  llm: TurnMessageParams
): Promise<{ userMessage: Message; llmMessage: Message }> {
  const lastMessage = await tx
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(1);

  const previousMessageId = lastMessage[0]?.id ?? null;

  const [userMessage] = await tx
    .insert(messages)
    .values({
      conversationId,
      role: user.role,
      content: user.content,
      previousMessageId,
    })
    .returning();

  const [llmMessage] = await tx
    .insert(messages)
    .values({
      conversationId,
      role: llm.role,
      content: llm.content,
      previousMessageId: userMessage.id,
    })
    .returning();

  await tx
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));

  return { userMessage, llmMessage };
}

/**
 * Append a message to a conversation, automatically linking to the previous message
 */
export async function appendMessage(
  conversationId: string,
  role: MessageRole,
  content: MessageContent
): Promise<Message> {
  // Get the last message to link to it
  const lastMessage = await getLastMessage(conversationId);

  return createMessage({
    conversationId,
    role,
    content,
    previousMessageId: lastMessage?.id ?? null,
  });
}

/**
 * Append a user message
 */
export async function appendUserMessage(
  conversationId: string,
  text: string
): Promise<Message> {
  const content: UserMessageContent = { text };
  return appendMessage(conversationId, 'user', content);
}

/**
 * Append an LLM message
 */
export async function appendLLMMessage(
  conversationId: string,
  content: LLMMessageContent
): Promise<Message> {
  return appendMessage(conversationId, 'llm', content);
}

/**
 * Append a summary message
 */
export async function appendSummaryMessage(
  conversationId: string,
  text: string
): Promise<Message> {
  const content: SummaryMessageContent = { text };
  return appendMessage(conversationId, 'summary', content);
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
 * Add a summary message to a conversation (for compaction)
 * The summary includes all context up to and including the previous message
 */
export async function addSummaryMessage(
  conversationId: string,
  summaryText: string,
  previousMessageId?: string
): Promise<Message> {
  // If no previousMessageId provided, get the last message
  const prevId = previousMessageId ?? (await getLastMessage(conversationId))?.id ?? null;

  const content: SummaryMessageContent = { text: summaryText };
  return createMessage({
    conversationId,
    role: 'summary',
    content,
    previousMessageId: prevId,
  });
}

// ============================================================================
// Helper functions for extracting text from message content
// ============================================================================

/**
 * Extract text from any message content type
 */
export function getMessageText(message: Message): string {
  const content = message.content as MessageContent;
  return content.text;
}

/**
 * Check if a message has tool calls (only LLM messages can have them)
 */
export function hasToolCalls(message: Message): boolean {
  if (message.role !== 'llm') return false;
  const content = message.content as LLMMessageContent;
  return Array.isArray(content.toolCalls) && content.toolCalls.length > 0;
}

/**
 * Get tool calls from an LLM message
 */
export function getToolCalls(message: Message): LLMMessageContent['toolCalls'] {
  if (message.role !== 'llm') return undefined;
  const content = message.content as LLMMessageContent;
  return content.toolCalls;
}

/**
 * Get thinking from an LLM message
 */
export function getThinking(message: Message): string | undefined {
  if (message.role !== 'llm') return undefined;
  const content = message.content as LLMMessageContent;
  return content.thinking;
}
