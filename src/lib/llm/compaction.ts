/**
 * Conversation Compaction - Context management for long conversations
 *
 * Compaction works by creating summary messages that capture the key points
 * of a conversation without deleting any messages. The summary message has
 * a `previousMessageId` pointing to the last summarized message, allowing
 * context loading to efficiently retrieve summary + recent messages.
 */

import {
  getConversationContext,
  addSummaryMessage,
  getLastMessage,
  getMessageText,
} from '@/lib/db/queries/messages';
import { generateLLMResponse } from './providers';
import type { Message, LLMMessage } from '@/lib/types';
import type { StreamOptions } from './providers';

// ============================================================================
// Constants
// ============================================================================

/** Default maximum messages before considering compaction */
const DEFAULT_COMPACTION_LIMIT = 50;

// ============================================================================
// Compaction Check
// ============================================================================

/**
 * Check if a conversation needs compaction based on message count
 *
 * @param conversationId - The conversation to check
 * @param limit - Maximum messages before compaction (default: 50)
 * @returns true if message count >= limit
 */
export async function shouldCompact(
  conversationId: string,
  limit: number = DEFAULT_COMPACTION_LIMIT
): Promise<boolean> {
  const context = await getConversationContext(conversationId);
  return context.length >= limit;
}

// ============================================================================
// Summary Generation
// ============================================================================

/**
 * Generate a summary of conversation messages using LLM
 *
 * The summary captures:
 * - Key topics discussed
 * - Important decisions or conclusions
 * - Pending questions or action items
 * - Relevant context for continuity
 *
 * @param messages - Messages to summarize
 * @param llmOptions - Optional LLM configuration
 * @returns Summary text
 */
export async function generateConversationSummary(
  messages: Message[],
  llmOptions?: StreamOptions
): Promise<string> {
  if (messages.length === 0) {
    return 'No messages to summarize.';
  }

  // Convert messages to LLM format
  const llmMessages: LLMMessage[] = messages.map((m) => ({
    role: mapRoleToLLMRole(m.role),
    content: getMessageText(m),
  }));

  const systemPrompt = `You are a conversation summarizer. Your task is to create a concise but comprehensive summary of the conversation that preserves:

1. KEY TOPICS: The main subjects discussed
2. DECISIONS: Any conclusions or decisions made
3. ACTION ITEMS: Pending tasks or questions that need follow-up
4. CONTEXT: Important background information needed for continuity

Guidelines:
- Be concise but thorough - aim for 200-500 words depending on conversation length
- Use clear, organized formatting
- Preserve specific details that would be needed to continue the conversation
- If the conversation includes previous summaries, incorporate them into your new summary
- Write in third person (e.g., "The user requested..." not "You requested...")

Create a summary that would allow someone to continue this conversation without reading all the previous messages.`;

  const userMessage: LLMMessage = {
    role: 'user',
    content: `Please summarize the following conversation:\n\n${formatMessagesForSummary(llmMessages)}`,
  };

  const result = await generateLLMResponse([userMessage], systemPrompt, llmOptions);

  return result.content;
}

/**
 * Map database message roles to LLM API roles
 * Summary role is treated as assistant context
 */
function mapRoleToLLMRole(role: string): 'user' | 'assistant' {
  switch (role) {
    case 'user':
      return 'user';
    case 'llm':
    case 'summary':
      return 'assistant';
    default:
      return 'assistant';
  }
}

/**
 * Format messages for summary generation
 */
function formatMessagesForSummary(messages: LLMMessage[]): string {
  return messages
    .map((m) => {
      const roleLabel = m.role.charAt(0).toUpperCase() + m.role.slice(1);
      return `[${roleLabel}]: ${m.content}`;
    })
    .join('\n\n');
}

// ============================================================================
// Compaction Operations
// ============================================================================

/**
 * Compact a conversation by generating a summary of current context
 *
 * Creates a summary message with `previousMessageId` pointing to the last message,
 * which allows getConversationContext to efficiently return summary + recent messages.
 *
 * @param conversationId - The conversation to compact
 * @param llmOptions - Optional LLM configuration
 * @returns The created summary message
 */
export async function compactConversation(
  conversationId: string,
  llmOptions?: StreamOptions
): Promise<Message> {
  // Get current context (may include previous summary + recent messages)
  const context = await getConversationContext(conversationId);

  if (context.length === 0) {
    throw new Error('Cannot compact empty conversation');
  }

  // Generate summary from current context
  const summary = await generateConversationSummary(context, llmOptions);

  // Get the last message to link the summary to
  const lastMessage = await getLastMessage(conversationId);
  const previousMessageId = lastMessage?.id ?? null;

  // Create the summary message
  const summaryMessage = await addSummaryMessage(
    conversationId,
    summary,
    previousMessageId ?? undefined
  );

  return summaryMessage;
}

/**
 * Compact a conversation if it exceeds the message limit
 *
 * This is the main entry point for automatic compaction. Call this after
 * adding messages to a conversation to keep context manageable.
 *
 * @param conversationId - The conversation to potentially compact
 * @param limit - Maximum messages before compaction (default: 50)
 * @param llmOptions - Optional LLM configuration
 * @returns The summary message if compaction occurred, null otherwise
 */
export async function compactIfNeeded(
  conversationId: string,
  limit: number = DEFAULT_COMPACTION_LIMIT,
  llmOptions?: StreamOptions
): Promise<Message | null> {
  const needsCompaction = await shouldCompact(conversationId, limit);

  if (!needsCompaction) {
    return null;
  }

  return compactConversation(conversationId, llmOptions);
}
