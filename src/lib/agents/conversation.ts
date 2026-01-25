import {
  getOrCreateConversation,
  getLatestConversation,
  createConversation as dbCreateConversation,
  touchConversation,
} from '@/lib/db/queries/conversations';
import {
  getMessagesByConversationId,
  appendMessage as dbAppendMessage,
  getRecentMessages,
  getLastMessage,
} from '@/lib/db/queries/messages';
import type {
  Conversation,
  Message,
  MessageRole,
  LLMMessage,
} from '@/lib/types';

// ============================================================================
// Conversation Management
// ============================================================================

/**
 * Get or create the active conversation for an agent
 */
export async function getActiveConversation(
  agentId: string
): Promise<Conversation> {
  return getOrCreateConversation(agentId);
}

/**
 * Create a new conversation for an agent
 * Use this to start a fresh conversation
 */
export async function startNewConversation(
  agentId: string
): Promise<Conversation> {
  return dbCreateConversation(agentId);
}

/**
 * Get the current conversation for an agent (may return null)
 */
export async function getCurrentConversation(
  agentId: string
): Promise<Conversation | null> {
  return getLatestConversation(agentId);
}

// ============================================================================
// Message Management
// ============================================================================

/**
 * Load full conversation history
 */
export async function loadConversationHistory(
  conversationId: string
): Promise<Message[]> {
  return getMessagesByConversationId(conversationId);
}

/**
 * Load recent conversation history (for context window management)
 */
export async function loadRecentHistory(
  conversationId: string,
  limit: number = 50
): Promise<Message[]> {
  return getRecentMessages(conversationId, limit);
}

/**
 * Add a message to a conversation
 */
export async function appendMessage(
  conversationId: string,
  role: MessageRole,
  content: string,
  thinking?: string | null
): Promise<Message> {
  const message = await dbAppendMessage(conversationId, role, content, thinking);
  await touchConversation(conversationId);
  return message;
}

/**
 * Add a user message to a conversation
 */
export async function addUserMessage(
  conversationId: string,
  content: string
): Promise<Message> {
  return appendMessage(conversationId, 'user', content);
}

/**
 * Add an assistant message to a conversation
 */
export async function addAssistantMessage(
  conversationId: string,
  content: string,
  thinking?: string | null
): Promise<Message> {
  return appendMessage(conversationId, 'assistant', content, thinking);
}

/**
 * Add a system message to a conversation
 */
export async function addSystemMessage(
  conversationId: string,
  content: string
): Promise<Message> {
  return appendMessage(conversationId, 'system', content);
}

/**
 * Get the last message in a conversation
 */
export async function getConversationLastMessage(
  conversationId: string
): Promise<Message | null> {
  return getLastMessage(conversationId);
}

// ============================================================================
// Context Building
// ============================================================================

/**
 * Convert database messages to LLM message format
 */
export function messagesToLLMFormat(messages: Message[]): LLMMessage[] {
  return messages
    .filter((m) => m.role !== 'system') // System messages are handled separately
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
}

/**
 * Build the message context for an LLM call
 * Includes conversation history, optionally trimmed for context window
 */
export async function buildMessageContext(
  conversationId: string,
  maxMessages: number = 50
): Promise<LLMMessage[]> {
  const messages = await loadRecentHistory(conversationId, maxMessages);
  return messagesToLLMFormat(messages);
}

/**
 * Estimate token count for messages (rough approximation)
 * Assumes ~4 characters per token on average
 */
export function estimateTokenCount(messages: LLMMessage[]): number {
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  return Math.ceil(totalChars / 4);
}

/**
 * Trim messages to fit within a token budget
 * Keeps the most recent messages
 */
export function trimMessagesToTokenBudget(
  messages: LLMMessage[],
  maxTokens: number
): LLMMessage[] {
  const result: LLMMessage[] = [];
  let tokenCount = 0;

  // Iterate from newest to oldest
  for (let i = messages.length - 1; i >= 0; i--) {
    const messageTokens = Math.ceil(messages[i].content.length / 4);
    if (tokenCount + messageTokens > maxTokens) {
      break;
    }
    result.unshift(messages[i]);
    tokenCount += messageTokens;
  }

  return result;
}

// ============================================================================
// Conversation Utilities
// ============================================================================

/**
 * Check if a conversation has any messages
 */
export async function hasMessages(conversationId: string): Promise<boolean> {
  const lastMessage = await getLastMessage(conversationId);
  return lastMessage !== null;
}

/**
 * Get the message count for a conversation
 */
export async function getMessageCount(conversationId: string): Promise<number> {
  const messages = await getMessagesByConversationId(conversationId);
  return messages.length;
}

/**
 * Get conversation summary for display
 */
export interface ConversationSummary {
  conversationId: string;
  messageCount: number;
  lastMessage: Message | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function getConversationSummary(
  conversation: Conversation
): Promise<ConversationSummary> {
  const messages = await getMessagesByConversationId(conversation.id);
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;

  return {
    conversationId: conversation.id,
    messageCount: messages.length,
    lastMessage,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}
