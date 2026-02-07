import { eq, desc } from 'drizzle-orm';
import { db } from '../client';
import { conversations } from '../schema';
import type { Conversation } from '@/lib/types';

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
 * Get the conversation for an agent (one conversation per agent)
 */
export async function getLatestConversation(
  agentId: string
): Promise<Conversation | null> {
  const result = await db
    .select()
    .from(conversations)
    .where(eq(conversations.agentId, agentId))
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
 * Create a new conversation for an agent
 */
export async function createConversation(
  agentId: string
): Promise<Conversation> {
  const result = await db
    .insert(conversations)
    .values({ agentId })
    .returning();

  return result[0];
}

/**
 * Get or create a conversation for an agent
 * Creates a new conversation if none exists
 */
export async function getOrCreateConversation(
  agentId: string
): Promise<Conversation> {
  const existing = await getLatestConversation(agentId);
  if (existing) {
    return existing;
  }
  return createConversation(agentId);
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
