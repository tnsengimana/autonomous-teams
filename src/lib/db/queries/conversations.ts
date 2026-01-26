import { eq, desc, and } from 'drizzle-orm';
import { db } from '../client';
import { conversations } from '../schema';
import type { Conversation } from '@/lib/types';

export type ConversationMode = 'foreground' | 'background';

/**
 * Get a conversation by ID
 */
export async function getConversationById(
  conversationId: string
): Promise<Conversation | null> {
  const result = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Get the most recent conversation for an agent, optionally filtered by mode
 */
export async function getLatestConversation(
  agentId: string,
  mode?: ConversationMode
): Promise<Conversation | null> {
  const conditions = mode
    ? and(eq(conversations.agentId, agentId), eq(conversations.mode, mode))
    : eq(conversations.agentId, agentId);

  const result = await db
    .select()
    .from(conversations)
    .where(conditions)
    .orderBy(desc(conversations.createdAt))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Get all conversations for an agent
 */
export async function getConversationsByAgentId(
  agentId: string
): Promise<Conversation[]> {
  return db
    .select()
    .from(conversations)
    .where(eq(conversations.agentId, agentId))
    .orderBy(desc(conversations.createdAt));
}

/**
 * Create a new conversation for an agent with specified mode
 */
export async function createConversation(
  agentId: string,
  mode: ConversationMode = 'foreground'
): Promise<Conversation> {
  const result = await db
    .insert(conversations)
    .values({ agentId, mode })
    .returning();

  return result[0];
}

/**
 * Get conversation by mode for an agent
 */
export async function getConversationByMode(
  agentId: string,
  mode: ConversationMode
): Promise<Conversation | null> {
  const result = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.agentId, agentId), eq(conversations.mode, mode)))
    .orderBy(desc(conversations.createdAt))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Get or create a conversation for an agent with specified mode
 * Creates a new conversation if none exists for the given mode
 */
export async function getOrCreateConversation(
  agentId: string,
  mode: ConversationMode = 'foreground'
): Promise<Conversation> {
  const existing = await getConversationByMode(agentId, mode);
  if (existing) {
    return existing;
  }
  return createConversation(agentId, mode);
}

/**
 * Get the foreground conversation for an agent (convenience wrapper)
 * Returns the existing foreground conversation or null if none exists
 */
export async function getForegroundConversation(
  agentId: string
): Promise<Conversation | null> {
  return getConversationByMode(agentId, 'foreground');
}

/**
 * Get the background conversation for an agent (convenience wrapper)
 * Returns the existing background conversation or null if none exists
 */
export async function getBackgroundConversation(
  agentId: string
): Promise<Conversation | null> {
  return getConversationByMode(agentId, 'background');
}

/**
 * Update conversation timestamp
 */
export async function touchConversation(
  conversationId: string
): Promise<void> {
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}
