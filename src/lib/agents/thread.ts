/**
 * Thread Management - High-level abstraction for agent work sessions
 *
 * Threads are ephemeral work sessions for background processing.
 * Each time an agent processes its task queue, it creates a new thread.
 * Threads hold the agent ↔ LLM conversation during work, and are
 * discarded after extracting insights.
 */

import {
  createThread,
  getActiveThread,
  getThreadById,
  completeThread,
  getThreadMessages,
  appendThreadMessage,
  getThreadMessageCount,
  compactThread as dbCompactThread,
  deleteThreadMessages,
  createThreadMessage,
} from '@/lib/db/queries/threads';
import type { Thread, ThreadMessage, LLMMessage } from '@/lib/types';

// ============================================================================
// Constants
// ============================================================================

/** Default maximum messages before considering compaction */
const DEFAULT_MAX_MESSAGES = 50;

/** Default token budget for context building */
const DEFAULT_MAX_TOKENS = 8000;

// ============================================================================
// Work Session Management
// ============================================================================

export interface WorkSession {
  threadId: string;
}

/**
 * Start a new work session for an agent
 * Creates a new thread and returns the thread ID
 */
export async function startWorkSession(agentId: string): Promise<WorkSession> {
  const thread = await createThread(agentId);
  return { threadId: thread.id };
}

/**
 * Get or resume the active work session for an agent
 * Returns existing active thread if present, otherwise creates new one
 */
export async function getOrStartWorkSession(agentId: string): Promise<WorkSession> {
  const existing = await getActiveThread(agentId);
  if (existing) {
    return { threadId: existing.id };
  }
  return startWorkSession(agentId);
}

/**
 * End a work session - marks the thread as completed
 */
export async function endWorkSession(threadId: string): Promise<void> {
  await completeThread(threadId);
}

/**
 * Check if a work session is active for an agent
 */
export async function hasActiveSession(agentId: string): Promise<boolean> {
  const thread = await getActiveThread(agentId);
  return thread !== null;
}

/**
 * Get the current thread for a work session
 */
export async function getSessionThread(threadId: string): Promise<Thread | null> {
  return getThreadById(threadId);
}

// ============================================================================
// Message Management
// ============================================================================

/**
 * Add a message to the current thread
 */
export async function addToThread(
  threadId: string,
  role: string,
  content: string,
  toolCalls?: unknown
): Promise<ThreadMessage> {
  return appendThreadMessage(threadId, role, content, toolCalls);
}

/**
 * Add a user message to the thread (agent's input to LLM)
 */
export async function addUserMessage(
  threadId: string,
  content: string
): Promise<ThreadMessage> {
  return addToThread(threadId, 'user', content);
}

/**
 * Add an assistant message to the thread (LLM's response)
 */
export async function addAssistantMessage(
  threadId: string,
  content: string,
  toolCalls?: unknown
): Promise<ThreadMessage> {
  return addToThread(threadId, 'assistant', content, toolCalls);
}

/**
 * Add a system message to the thread
 */
export async function addSystemMessage(
  threadId: string,
  content: string
): Promise<ThreadMessage> {
  return addToThread(threadId, 'system', content);
}

/**
 * Get all messages in a thread
 */
export async function getMessages(threadId: string): Promise<ThreadMessage[]> {
  return getThreadMessages(threadId);
}

// ============================================================================
// Context Building
// ============================================================================

export interface ThreadContext {
  messages: Array<{ role: string; content: string }>;
  messageCount: number;
  estimatedTokens: number;
}

/**
 * Build context from thread messages for LLM call
 * Converts thread messages to LLM format and respects token limits
 */
export async function buildThreadContext(
  threadId: string,
  maxTokens: number = DEFAULT_MAX_TOKENS
): Promise<ThreadContext> {
  const messages = await getThreadMessages(threadId);

  // Convert to LLM message format
  const llmMessages = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Estimate tokens and trim if needed
  const trimmed = trimMessagesToTokenBudget(llmMessages, maxTokens);

  return {
    messages: trimmed,
    messageCount: trimmed.length,
    estimatedTokens: estimateTokenCount(trimmed),
  };
}

/**
 * Convert thread messages to LLM message format
 */
export function threadMessagesToLLMFormat(messages: ThreadMessage[]): LLMMessage[] {
  return messages.map((m) => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
  }));
}

/**
 * Estimate token count for messages (rough approximation)
 * Assumes ~4 characters per token on average
 */
export function estimateTokenCount(
  messages: Array<{ role: string; content: string }>
): number {
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  return Math.ceil(totalChars / 4);
}

/**
 * Trim messages to fit within a token budget
 * Keeps the most recent messages, but always preserves system messages at the start
 */
export function trimMessagesToTokenBudget(
  messages: Array<{ role: string; content: string }>,
  maxTokens: number
): Array<{ role: string; content: string }> {
  if (messages.length === 0) {
    return [];
  }

  // Separate system messages at the start from the rest
  const systemMessages: Array<{ role: string; content: string }> = [];
  const otherMessages: Array<{ role: string; content: string }> = [];

  let foundNonSystem = false;
  for (const msg of messages) {
    if (!foundNonSystem && msg.role === 'system') {
      systemMessages.push(msg);
    } else {
      foundNonSystem = true;
      otherMessages.push(msg);
    }
  }

  // Calculate tokens used by system messages
  const systemTokens = estimateTokenCount(systemMessages);
  const remainingBudget = Math.max(0, maxTokens - systemTokens);

  // Trim other messages to fit
  const trimmedOther: Array<{ role: string; content: string }> = [];
  let tokenCount = 0;

  // Iterate from newest to oldest
  for (let i = otherMessages.length - 1; i >= 0; i--) {
    const messageTokens = Math.ceil(otherMessages[i].content.length / 4);
    if (tokenCount + messageTokens > remainingBudget) {
      break;
    }
    trimmedOther.unshift(otherMessages[i]);
    tokenCount += messageTokens;
  }

  return [...systemMessages, ...trimmedOther];
}

// ============================================================================
// Compaction
// ============================================================================

/**
 * Check if thread is approaching context limit and should be compacted
 */
export async function shouldCompact(
  threadId: string,
  maxMessages: number = DEFAULT_MAX_MESSAGES
): Promise<boolean> {
  const count = await getThreadMessageCount(threadId);
  return count >= maxMessages;
}

/**
 * Summarization function type for compaction
 */
export type SummarizeFn = (messages: ThreadMessage[]) => Promise<string>;

/**
 * Compact thread if it's too long
 * If an LLM client/summarize function is provided, summarizes the conversation
 * Otherwise, just checks if compaction is needed
 *
 * @returns true if compaction was performed, false otherwise
 */
export async function compactIfNeeded(
  threadId: string,
  summarizeFn?: SummarizeFn,
  maxMessages: number = DEFAULT_MAX_MESSAGES
): Promise<boolean> {
  const needsCompaction = await shouldCompact(threadId, maxMessages);

  if (!needsCompaction) {
    return false;
  }

  if (!summarizeFn) {
    // No summarize function provided, can't compact
    return false;
  }

  // Get all messages for summarization
  const messages = await getThreadMessages(threadId);

  // Generate summary using provided function
  const summary = await summarizeFn(messages);

  // Compact the thread with the summary
  await dbCompactThread(threadId, summary);

  return true;
}

/**
 * Manually compact a thread with a provided summary
 */
export async function compactWithSummary(
  threadId: string,
  summary: string
): Promise<void> {
  await dbCompactThread(threadId, summary);
}

/**
 * Clear all messages in a thread without marking it compacted
 * Useful for resetting a thread
 */
export async function clearThread(threadId: string): Promise<void> {
  await deleteThreadMessages(threadId);
}

// ============================================================================
// Thread Utilities
// ============================================================================

/**
 * Get thread statistics
 */
export interface ThreadStats {
  messageCount: number;
  estimatedTokens: number;
  isApproachingLimit: boolean;
}

export async function getThreadStats(
  threadId: string,
  maxMessages: number = DEFAULT_MAX_MESSAGES
): Promise<ThreadStats> {
  const messages = await getThreadMessages(threadId);
  const messageCount = messages.length;
  const estimatedTokens = estimateTokenCount(
    messages.map((m) => ({ role: m.role, content: m.content }))
  );

  return {
    messageCount,
    estimatedTokens,
    isApproachingLimit: messageCount >= maxMessages * 0.8,
  };
}

/**
 * Initialize a thread with a system prompt
 */
export async function initializeThreadWithPrompt(
  threadId: string,
  systemPrompt: string
): Promise<ThreadMessage> {
  return createThreadMessage(threadId, 'system', systemPrompt, 1);
}
