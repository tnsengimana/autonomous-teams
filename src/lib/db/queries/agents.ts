import { eq, isNull, and } from 'drizzle-orm';
import { db } from '../client';
import { agents, teams } from '../schema';
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
 * Get all agents for a team
 */
export async function getAgentsByTeamId(teamId: string): Promise<Agent[]> {
  return db.select().from(agents).where(eq(agents.teamId, teamId));
}

/**
 * Get the team lead for a team (agent with no parent)
 */
export async function getTeamLead(teamId: string): Promise<Agent | null> {
  const result = await db
    .select()
    .from(agents)
    .where(and(eq(agents.teamId, teamId), isNull(agents.parentAgentId)))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Get all active team leads (for worker runner)
 * Returns team leads for active teams regardless of agent status
 */
export async function getActiveTeamLeads(): Promise<Agent[]> {
  return db
    .select({
      id: agents.id,
      teamId: agents.teamId,
      parentAgentId: agents.parentAgentId,
      name: agents.name,
      role: agents.role,
      systemPrompt: agents.systemPrompt,
      status: agents.status,
      nextRunAt: agents.nextRunAt,
      lastCompletedAt: agents.lastCompletedAt,
      createdAt: agents.createdAt,
      updatedAt: agents.updatedAt,
    })
    .from(agents)
    .innerJoin(teams, eq(agents.teamId, teams.id))
    .where(
      and(
        isNull(agents.parentAgentId),
        eq(teams.status, 'active')
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
 * Create a new agent
 */
export async function createAgent(data: {
  teamId: string;
  parentAgentId?: string | null;
  name: string;
  role: string;
  systemPrompt?: string | null;
  status?: AgentStatus;
}): Promise<Agent> {
  const result = await db
    .insert(agents)
    .values({
      teamId: data.teamId,
      parentAgentId: data.parentAgentId ?? null,
      name: data.name,
      role: data.role,
      systemPrompt: data.systemPrompt ?? null,
      status: data.status ?? 'idle',
    })
    .returning();

  return result[0];
}
