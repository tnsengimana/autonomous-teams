import {
  getOrCreateConversation,
  getLatestConversation,
  createConversation as dbCreateConversation,
  touchConversation,
} from "@/lib/db/queries/conversations";
import {
  getMessagesByConversationId,
  appendLLMMessage,
  getRecentMessages,
  getLastMessage,
  getConversationContext,
  getMessageText,
} from "@/lib/db/queries/messages";
import type { Conversation, Message, LLMMessage, LLMMessageContent } from "@/lib/types";

// ============================================================================
// Conversation Management
// ============================================================================

/**
 * Get or create the active conversation for an agent
 */
export async function getActiveConversation(
  agentId: string,
): Promise<Conversation> {
  return getOrCreateConversation(agentId);
}

/**
 * Create a new conversation for an agent
 * Use this to start a fresh conversation
 */
export async function startNewConversation(
  agentId: string,
): Promise<Conversation> {
  return dbCreateConversation(agentId);
}

/**
 * Get the current conversation for an agent (may return null)
 */
export async function getCurrentConversation(
  agentId: string,
): Promise<Conversation | null> {
  return getLatestConversation(agentId);
}

// ============================================================================
// Message Management
// ============================================================================

/**
 * Load full conversation history (all messages, no compaction awareness)
 * Use loadConversationContext for compaction-aware loading
 */
export async function loadConversationHistory(
  conversationId: string,
): Promise<Message[]> {
  return getMessagesByConversationId(conversationId);
}

/**
 * Load conversation context with compaction awareness
 * Returns: latest summary (if any) + all messages created after it
 * If no summary exists, returns all messages
 */
export async function loadConversationContext(
  conversationId: string,
): Promise<Message[]> {
  return getConversationContext(conversationId);
}

/**
 * Load recent conversation history (for context window management)
 */
export async function loadRecentHistory(
  conversationId: string,
  limit: number = 50,
): Promise<Message[]> {
  return getRecentMessages(conversationId, limit);
}

/**
 * Add an LLM message to a conversation. This should be called for
 * special cases as we save the turn atomically.
 */
export async function addLLMMessage(
  conversationId: string,
  text: string,
  options?: { thinking?: string },
): Promise<Message> {
  const content: LLMMessageContent = {
    text,
    thinking: options?.thinking,
  };
  const message = await appendLLMMessage(conversationId, content);
  await touchConversation(conversationId);
  return message;
}

// Legacy alias for compatibility
export const addAssistantMessage = addLLMMessage;

/**
 * Get the last message in a conversation
 */
export async function getConversationLastMessage(
  conversationId: string,
): Promise<Message | null> {
  return getLastMessage(conversationId);
}

// ============================================================================
// Context Building
// ============================================================================

/**
 * Convert database messages to LLM message format
 * Handles roles: user, llm, summary are mapped to appropriate LLM API roles
 */
export function messagesToLLMFormat(messages: Message[]): LLMMessage[] {
  return messages.map((m) => ({
    role: mapRoleToLLMRole(m.role),
    content: getMessageText(m),
  }));
}

/**
 * Map database message roles to LLM API roles
 * - user -> user
 * - llm -> assistant
 * - summary -> assistant (summaries are context from the assistant's perspective)
 */
function mapRoleToLLMRole(role: string): "user" | "assistant" {
  switch (role) {
    case "user":
      return "user";
    case "llm":
    case "summary":
      return "assistant";
    default:
      return "assistant";
  }
}

/**
 * Build the message context for an LLM call
 * Uses compaction-aware loading (summary + recent messages if compacted)
 * Falls back to recent history if context is still too large
 */
export async function buildMessageContext(
  conversationId: string,
  maxMessages: number = 50,
): Promise<LLMMessage[]> {
  // Use compaction-aware context loading
  const contextMessages = await getConversationContext(conversationId);

  // If context is within limit, use it directly
  if (contextMessages.length <= maxMessages) {
    return messagesToLLMFormat(contextMessages);
  }

  // If still too large, fall back to most recent messages
  const recentMessages = await loadRecentHistory(conversationId, maxMessages);
  return messagesToLLMFormat(recentMessages);
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
  maxTokens: number,
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
  conversation: Conversation,
): Promise<ConversationSummary> {
  const messages = await getMessagesByConversationId(conversation.id);
  const lastMessage =
    messages.length > 0 ? messages[messages.length - 1] : null;

  return {
    conversationId: conversation.id,
    messageCount: messages.length,
    lastMessage,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}
