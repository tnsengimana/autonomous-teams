/**
 * Agents Database Queries
 *
 * CRUD operations for agents.
 */

import { eq, desc } from "drizzle-orm";
import { db } from "../client";
import { agents } from "../schema";
import type { Agent } from "@/lib/types";
import { initializeAndPersistTypesForAgent } from "@/lib/llm/graph-types";

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Create a new agent
 */
export async function createAgent(data: {
  userId: string;
  name: string;
  purpose?: string | null;
  conversationSystemPrompt: string;
  classificationSystemPrompt: string;
  insightSynthesisSystemPrompt: string;
  knowledgeAcquisitionSystemPrompt?: string | null;
  graphConstructionSystemPrompt: string;
  iterationIntervalMs: number;
  isActive?: boolean;
}): Promise<Agent> {
  const result = await db
    .insert(agents)
    .values({
      userId: data.userId,
      name: data.name,
      purpose: data.purpose ?? null,
      conversationSystemPrompt: data.conversationSystemPrompt,
      classificationSystemPrompt: data.classificationSystemPrompt,
      insightSynthesisSystemPrompt: data.insightSynthesisSystemPrompt,
      knowledgeAcquisitionSystemPrompt: data.knowledgeAcquisitionSystemPrompt ?? null,
      graphConstructionSystemPrompt: data.graphConstructionSystemPrompt,
      iterationIntervalMs: data.iterationIntervalMs,
      isActive: data.isActive ?? true,
    })
    .returning();

  const agent = result[0];

  // Fire and forget type initialization - don't block agent creation
  initializeAndPersistTypesForAgent(
    agent.id,
    { name: agent.name, purpose: agent.purpose },
    { userId: data.userId },
  ).catch((err) => {
    console.error("[createAgent] Failed to initialize graph types:", err);
  });

  return agent;
}

/**
 * Get an agent by ID
 */
export async function getAgentById(agentId: string): Promise<Agent | null> {
  const result = await db
    .select()
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Get all agents for a user
 */
export async function getAgentsByUserId(userId: string): Promise<Agent[]> {
  return db
    .select()
    .from(agents)
    .where(eq(agents.userId, userId))
    .orderBy(desc(agents.createdAt));
}

/**
 * Get active agents for a user
 */
export async function getActiveAgentsByUserId(
  userId: string,
): Promise<Agent[]> {
  return db
    .select()
    .from(agents)
    .where(eq(agents.userId, userId))
    .orderBy(desc(agents.createdAt));
}

/**
 * Get all active agents (across all users)
 * Used by the background worker to process all agents
 */
export async function getActiveAgents(): Promise<Agent[]> {
  return db
    .select()
    .from(agents)
    .where(eq(agents.isActive, true))
    .orderBy(desc(agents.createdAt));
}

/**
 * Update agent details
 */
export async function updateAgent(
  agentId: string,
  data: {
    name?: string;
    purpose?: string | null;
    iterationIntervalMs?: number;
    isActive?: boolean;
  },
): Promise<void> {
  await db
    .update(agents)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(agents.id, agentId));
}

/**
 * Set agent active state
 */
export async function setAgentActive(
  agentId: string,
  isActive: boolean,
): Promise<void> {
  await db
    .update(agents)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(agents.id, agentId));
}

/**
 * Activate an agent (set isActive to true)
 */
export async function activateAgent(agentId: string): Promise<void> {
  await setAgentActive(agentId, true);
}

/**
 * Pause an agent (set isActive to false)
 */
export async function pauseAgent(agentId: string): Promise<void> {
  await setAgentActive(agentId, false);
}

/**
 * Delete an agent (cascades to conversations, etc.)
 */
export async function deleteAgent(agentId: string): Promise<void> {
  await db.delete(agents).where(eq(agents.id, agentId));
}

/**
 * Get the user ID for an agent
 */
export async function getAgentUserId(agentId: string): Promise<string | null> {
  const result = await db
    .select({ userId: agents.userId })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  return result[0]?.userId ?? null;
}
