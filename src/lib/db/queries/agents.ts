import { eq, isNull, and, or, lte, inArray } from 'drizzle-orm';
import { db } from '../client';
import { agents, entities } from '../schema';
import type { Agent, AgentStatus } from '@/lib/types';

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
 * Get all agents for an entity
 */
export async function getAgentsByEntityId(entityId: string): Promise<Agent[]> {
  return db.select().from(agents).where(eq(agents.entityId, entityId));
}

/**
 * Get the lead for an entity (agent with no parent)
 */
export async function getLead(entityId: string): Promise<Agent | null> {
  const result = await db
    .select()
    .from(agents)
    .where(and(eq(agents.entityId, entityId), isNull(agents.parentAgentId)))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Get all active leads (for worker runner)
 * Returns leads for active entities regardless of agent status
 */
export async function getActiveLeads(): Promise<Agent[]> {
  return db
    .select({
      id: agents.id,
      entityId: agents.entityId,
      parentAgentId: agents.parentAgentId,
      name: agents.name,
      type: agents.type,
      systemPrompt: agents.systemPrompt,
      status: agents.status,
      leadNextRunAt: agents.leadNextRunAt,
      backoffNextRunAt: agents.backoffNextRunAt,
      backoffAttemptCount: agents.backoffAttemptCount,
      lastCompletedAt: agents.lastCompletedAt,
      createdAt: agents.createdAt,
      updatedAt: agents.updatedAt,
    })
    .from(agents)
    .innerJoin(entities, eq(agents.entityId, entities.id))
    .where(
      and(
        isNull(agents.parentAgentId),
        eq(entities.status, 'active')
      )
    );
}

/**
 * Get child agents for a parent agent
 */
export async function getChildAgents(parentAgentId: string): Promise<Agent[]> {
  return db
    .select()
    .from(agents)
    .where(eq(agents.parentAgentId, parentAgentId));
}

/**
 * Update agent status
 */
export async function updateAgentStatus(
  agentId: string,
  status: AgentStatus
): Promise<void> {
  await db
    .update(agents)
    .set({ status, updatedAt: new Date() })
    .where(eq(agents.id, agentId));
}

/**
 * Update agent details (name, type, systemPrompt)
 */
export async function updateAgent(
  agentId: string,
  data: {
    name?: string;
    type?: string;
    systemPrompt?: string;
  }
): Promise<void> {
  await db
    .update(agents)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(agents.id, agentId));
}

/**
 * Create a new agent for an entity
 */
export async function createAgent(data: {
  entityId: string;
  parentAgentId?: string | null;
  name: string;
  type: string;
  systemPrompt?: string | null;
  status?: AgentStatus;
}): Promise<Agent> {
  const result = await db
    .insert(agents)
    .values({
      entityId: data.entityId,
      parentAgentId: data.parentAgentId ?? null,
      name: data.name,
      type: data.type,
      systemPrompt: data.systemPrompt ?? null,
      status: data.status ?? 'idle',
    })
    .returning();

  return result[0];
}

/**
 * Update lead agent's next scheduled run time
 */
export async function updateAgentLeadNextRunAt(
  agentId: string,
  leadNextRunAt: Date
): Promise<void> {
  await db
    .update(agents)
    .set({ leadNextRunAt, updatedAt: new Date() })
    .where(eq(agents.id, agentId));
}

/**
 * Set agent backoff state
 */
export async function setAgentBackoff(
  agentId: string,
  backoffAttemptCount: number,
  backoffNextRunAt: Date
): Promise<void> {
  await db
    .update(agents)
    .set({
      backoffAttemptCount,
      backoffNextRunAt,
      updatedAt: new Date(),
    })
    .where(eq(agents.id, agentId));
}

/**
 * Clear agent backoff state
 */
export async function clearAgentBackoff(agentId: string): Promise<void> {
  await db
    .update(agents)
    .set({
      backoffAttemptCount: 0,
      backoffNextRunAt: null,
      updatedAt: new Date(),
    })
    .where(eq(agents.id, agentId));
}

/**
 * Update agent's last completed timestamp
 */
export async function updateAgentLastCompletedAt(
  agentId: string,
  lastCompletedAt: Date
): Promise<void> {
  await db
    .update(agents)
    .set({ lastCompletedAt, updatedAt: new Date() })
    .where(eq(agents.id, agentId));
}

/**
 * Get all agent IDs that have pending tasks
 * Used by the worker runner to find agents with queued work
 */
export async function getAgentsWithPendingTasks(): Promise<string[]> {
  // Import agentTasks dynamically to avoid circular dependencies
  const { agentTasks } = await import('../schema');
  const now = new Date();

  const result = await db
    .selectDistinct({ agentId: agentTasks.assignedToId })
    .from(agentTasks)
    .innerJoin(agents, eq(agentTasks.assignedToId, agents.id))
    .where(
      and(
        eq(agentTasks.status, 'pending'),
        or(
          isNull(agents.backoffNextRunAt),
          lte(agents.backoffNextRunAt, now)
        )
      )
    );

  return result.map((r) => r.agentId);
}

/**
 * Get lead agent IDs where leadNextRunAt <= now
 * Only includes leads from active entities
 */
export async function getLeadsDueToRun(): Promise<string[]> {
  const now = new Date();
  const result = await db
    .select({ id: agents.id })
    .from(agents)
    .innerJoin(entities, eq(agents.entityId, entities.id))
    .where(
      and(
        isNull(agents.parentAgentId), // Leads only
        eq(entities.status, 'active'),   // Active entities only
        lte(agents.leadNextRunAt, now),   // Due to run
        or(
          isNull(agents.backoffNextRunAt),
          lte(agents.backoffNextRunAt, now)
        )
      )
    );

  return result.map((r) => r.id);
}

/**
 * Filter agent IDs to those not currently in backoff
 */
export async function getAgentsReadyForWork(
  agentIds: string[]
): Promise<string[]> {
  if (agentIds.length === 0) return [];

  const now = new Date();
  const result = await db
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(
        inArray(agents.id, agentIds),
        or(
          isNull(agents.backoffNextRunAt),
          lte(agents.backoffNextRunAt, now)
        )
      )
    );

  return result.map((r) => r.id);
}
