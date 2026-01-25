import { eq, desc, and } from 'drizzle-orm';
import { db } from '../client';
import { teams, agents } from '../schema';
import type { Team, TeamStatus, TeamWithAgents } from '@/lib/types';

/**
 * Get a team by ID
 */
export async function getTeamById(teamId: string): Promise<Team | null> {
  const result = await db
    .select()
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Get a team with its agents
 */
export async function getTeamWithAgents(
  teamId: string
): Promise<TeamWithAgents | null> {
  const team = await getTeamById(teamId);
  if (!team) {
    return null;
  }

  const teamAgents = await db
    .select()
    .from(agents)
    .where(eq(agents.teamId, teamId));

  return {
    ...team,
    agents: teamAgents,
  };
}

/**
 * Get all teams for a user
 */
export async function getTeamsByUserId(userId: string): Promise<Team[]> {
  return db
    .select()
    .from(teams)
    .where(eq(teams.userId, userId))
    .orderBy(desc(teams.createdAt));
}

/**
 * Get active teams for a user
 */
export async function getActiveTeamsByUserId(userId: string): Promise<Team[]> {
  return db
    .select()
    .from(teams)
    .where(and(eq(teams.userId, userId), eq(teams.status, 'active')))
    .orderBy(desc(teams.createdAt));
}

/**
 * Create a new team
 */
export async function createTeam(data: {
  userId: string;
  name: string;
  purpose?: string | null;
  status?: TeamStatus;
}): Promise<Team> {
  const result = await db
    .insert(teams)
    .values({
      userId: data.userId,
      name: data.name,
      purpose: data.purpose ?? null,
      status: data.status ?? 'active',
    })
    .returning();

  return result[0];
}

/**
 * Update team details
 */
export async function updateTeam(
  teamId: string,
  data: {
    name?: string;
    purpose?: string | null;
    status?: TeamStatus;
  }
): Promise<void> {
  await db
    .update(teams)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(teams.id, teamId));
}

/**
 * Update team status
 */
export async function updateTeamStatus(
  teamId: string,
  status: TeamStatus
): Promise<void> {
  await db
    .update(teams)
    .set({ status, updatedAt: new Date() })
    .where(eq(teams.id, teamId));
}

/**
 * Activate a team (set status to 'active')
 * This enables the team to run autonomous research cycles
 */
export async function activateTeam(teamId: string): Promise<void> {
  await updateTeamStatus(teamId, 'active');
}

/**
 * Delete a team (cascades to agents, conversations, etc.)
 */
export async function deleteTeam(teamId: string): Promise<void> {
  await db.delete(teams).where(eq(teams.id, teamId));
}

/**
 * Get the user ID for a team
 */
export async function getTeamUserId(teamId: string): Promise<string | null> {
  const result = await db
    .select({ userId: teams.userId })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);

  return result[0]?.userId ?? null;
}
