/**
 * Tests for Aides Database Queries
 *
 * Tests cover:
 * - CRUD operations for aides
 * - Getting aide lead agent
 * - Getting agents for an aide
 * - Aide ownership lookup
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '@/lib/db/client';
import { users, aides, agents } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

// Import aide queries
import {
  createAide,
  getAideById,
  getAidesByUserId,
  getActiveAidesByUserId,
  updateAide,
  updateAideStatus,
  activateAide,
  deleteAide,
  getAideUserId,
  getAideLead,
  getAideWithAgents,
} from '@/lib/db/queries/aides';

// Import agent queries for aide-related tests
import {
  createAgentForAide,
  getAgentsByAideId,
  getActiveAideLeads,
  getAideLeadsDueToRun,
} from '@/lib/db/queries/agents';

// ============================================================================
// Test Setup
// ============================================================================

let testUserId: string;
let testUserId2: string;

beforeAll(async () => {
  // Create test users
  const [user1] = await db.insert(users).values({
    email: `aides-test-${Date.now()}@example.com`,
    name: 'Aides Test User',
  }).returning();
  testUserId = user1.id;

  const [user2] = await db.insert(users).values({
    email: `aides-test-2-${Date.now()}@example.com`,
    name: 'Aides Test User 2',
  }).returning();
  testUserId2 = user2.id;
});

afterAll(async () => {
  // Cleanup: delete test users (cascades to aides, agents, etc.)
  await db.delete(users).where(eq(users.id, testUserId));
  await db.delete(users).where(eq(users.id, testUserId2));
});

// Helper to cleanup aides created during tests
async function cleanupAides(aideIds: string[]) {
  for (const aideId of aideIds) {
    await db.delete(aides).where(eq(aides.id, aideId));
  }
}

// ============================================================================
// createAide Tests
// ============================================================================

describe('createAide', () => {
  test('creates an aide with required fields', async () => {
    const aide = await createAide({
      userId: testUserId,
      name: 'My Aide',
    });

    expect(aide.id).toBeDefined();
    expect(aide.userId).toBe(testUserId);
    expect(aide.name).toBe('My Aide');
    expect(aide.purpose).toBeNull();
    expect(aide.status).toBe('active');
    expect(aide.createdAt).toBeDefined();
    expect(aide.updatedAt).toBeDefined();

    await cleanupAides([aide.id]);
  });

  test('creates an aide with purpose', async () => {
    const aide = await createAide({
      userId: testUserId,
      name: 'Purpose Aide',
      purpose: 'Help with financial analysis',
    });

    expect(aide.purpose).toBe('Help with financial analysis');

    await cleanupAides([aide.id]);
  });

  test('creates an aide with custom status', async () => {
    const aide = await createAide({
      userId: testUserId,
      name: 'Paused Aide',
      status: 'paused',
    });

    expect(aide.status).toBe('paused');

    await cleanupAides([aide.id]);
  });

  test('defaults to active status', async () => {
    const aide = await createAide({
      userId: testUserId,
      name: 'Default Status Aide',
    });

    expect(aide.status).toBe('active');

    await cleanupAides([aide.id]);
  });
});

// ============================================================================
// getAideById Tests
// ============================================================================

describe('getAideById', () => {
  test('returns aide by ID', async () => {
    const created = await createAide({
      userId: testUserId,
      name: 'Findable Aide',
    });

    const found = await getAideById(created.id);

    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.name).toBe('Findable Aide');

    await cleanupAides([created.id]);
  });

  test('returns null for non-existent aide', async () => {
    const found = await getAideById('00000000-0000-0000-0000-000000000000');
    expect(found).toBeNull();
  });
});

// ============================================================================
// getAidesByUserId Tests
// ============================================================================

describe('getAidesByUserId', () => {
  test('returns all aides for a user', async () => {
    const aide1 = await createAide({ userId: testUserId, name: 'Aide 1' });
    const aide2 = await createAide({ userId: testUserId, name: 'Aide 2' });
    const aide3 = await createAide({ userId: testUserId, name: 'Aide 3' });

    const userAides = await getAidesByUserId(testUserId);

    expect(userAides.length).toBeGreaterThanOrEqual(3);
    expect(userAides.some(a => a.id === aide1.id)).toBe(true);
    expect(userAides.some(a => a.id === aide2.id)).toBe(true);
    expect(userAides.some(a => a.id === aide3.id)).toBe(true);

    await cleanupAides([aide1.id, aide2.id, aide3.id]);
  });

  test('returns empty array for user with no aides', async () => {
    const userAides = await getAidesByUserId(testUserId2);
    expect(userAides).toEqual([]);
  });

  test('returns aides ordered by createdAt descending', async () => {
    const aide1 = await createAide({ userId: testUserId, name: 'First Aide' });
    await new Promise(resolve => setTimeout(resolve, 10));
    const aide2 = await createAide({ userId: testUserId, name: 'Second Aide' });
    await new Promise(resolve => setTimeout(resolve, 10));
    const aide3 = await createAide({ userId: testUserId, name: 'Third Aide' });

    const userAides = await getAidesByUserId(testUserId);

    // Find indices
    const idx1 = userAides.findIndex(a => a.id === aide1.id);
    const idx2 = userAides.findIndex(a => a.id === aide2.id);
    const idx3 = userAides.findIndex(a => a.id === aide3.id);

    // Most recent should be first (descending order)
    expect(idx3).toBeLessThan(idx2);
    expect(idx2).toBeLessThan(idx1);

    await cleanupAides([aide1.id, aide2.id, aide3.id]);
  });

  test('only returns aides for the specific user', async () => {
    const user1Aide = await createAide({ userId: testUserId, name: 'User 1 Aide' });
    const user2Aide = await createAide({ userId: testUserId2, name: 'User 2 Aide' });

    const user1Aides = await getAidesByUserId(testUserId);
    const user2Aides = await getAidesByUserId(testUserId2);

    expect(user1Aides.some(a => a.id === user1Aide.id)).toBe(true);
    expect(user1Aides.some(a => a.id === user2Aide.id)).toBe(false);
    expect(user2Aides.some(a => a.id === user2Aide.id)).toBe(true);
    expect(user2Aides.some(a => a.id === user1Aide.id)).toBe(false);

    await cleanupAides([user1Aide.id, user2Aide.id]);
  });
});

// ============================================================================
// getActiveAidesByUserId Tests
// ============================================================================

describe('getActiveAidesByUserId', () => {
  test('returns only active aides', async () => {
    const activeAide = await createAide({ userId: testUserId, name: 'Active', status: 'active' });
    const pausedAide = await createAide({ userId: testUserId, name: 'Paused', status: 'paused' });
    const archivedAide = await createAide({ userId: testUserId, name: 'Archived', status: 'archived' });

    const activeAides = await getActiveAidesByUserId(testUserId);

    expect(activeAides.some(a => a.id === activeAide.id)).toBe(true);
    expect(activeAides.some(a => a.id === pausedAide.id)).toBe(false);
    expect(activeAides.some(a => a.id === archivedAide.id)).toBe(false);

    await cleanupAides([activeAide.id, pausedAide.id, archivedAide.id]);
  });
});

// ============================================================================
// updateAide Tests
// ============================================================================

describe('updateAide', () => {
  test('updates aide name', async () => {
    const aide = await createAide({ userId: testUserId, name: 'Original Name' });

    await updateAide(aide.id, { name: 'Updated Name' });

    const updated = await getAideById(aide.id);
    expect(updated!.name).toBe('Updated Name');

    await cleanupAides([aide.id]);
  });

  test('updates aide purpose', async () => {
    const aide = await createAide({ userId: testUserId, name: 'Aide', purpose: 'Original' });

    await updateAide(aide.id, { purpose: 'New Purpose' });

    const updated = await getAideById(aide.id);
    expect(updated!.purpose).toBe('New Purpose');

    await cleanupAides([aide.id]);
  });

  test('updates aide status', async () => {
    const aide = await createAide({ userId: testUserId, name: 'Aide', status: 'active' });

    await updateAide(aide.id, { status: 'paused' });

    const updated = await getAideById(aide.id);
    expect(updated!.status).toBe('paused');

    await cleanupAides([aide.id]);
  });

  test('updates multiple fields at once', async () => {
    const aide = await createAide({ userId: testUserId, name: 'Original', purpose: 'Old', status: 'active' });

    await updateAide(aide.id, { name: 'New', purpose: 'New Purpose', status: 'paused' });

    const updated = await getAideById(aide.id);
    expect(updated!.name).toBe('New');
    expect(updated!.purpose).toBe('New Purpose');
    expect(updated!.status).toBe('paused');

    await cleanupAides([aide.id]);
  });

  test('updates updatedAt timestamp', async () => {
    const aide = await createAide({ userId: testUserId, name: 'Aide' });
    const originalUpdatedAt = aide.updatedAt;

    await new Promise(resolve => setTimeout(resolve, 10));
    await updateAide(aide.id, { name: 'New Name' });

    const updated = await getAideById(aide.id);
    expect(updated!.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());

    await cleanupAides([aide.id]);
  });
});

// ============================================================================
// updateAideStatus Tests
// ============================================================================

describe('updateAideStatus', () => {
  test('updates status to paused', async () => {
    const aide = await createAide({ userId: testUserId, name: 'Aide', status: 'active' });

    await updateAideStatus(aide.id, 'paused');

    const updated = await getAideById(aide.id);
    expect(updated!.status).toBe('paused');

    await cleanupAides([aide.id]);
  });

  test('updates status to archived', async () => {
    const aide = await createAide({ userId: testUserId, name: 'Aide', status: 'active' });

    await updateAideStatus(aide.id, 'archived');

    const updated = await getAideById(aide.id);
    expect(updated!.status).toBe('archived');

    await cleanupAides([aide.id]);
  });
});

// ============================================================================
// activateAide Tests
// ============================================================================

describe('activateAide', () => {
  test('activates a paused aide', async () => {
    const aide = await createAide({ userId: testUserId, name: 'Aide', status: 'paused' });

    await activateAide(aide.id);

    const updated = await getAideById(aide.id);
    expect(updated!.status).toBe('active');

    await cleanupAides([aide.id]);
  });
});

// ============================================================================
// deleteAide Tests
// ============================================================================

describe('deleteAide', () => {
  test('deletes an aide', async () => {
    const aide = await createAide({ userId: testUserId, name: 'To Delete' });

    await deleteAide(aide.id);

    const deleted = await getAideById(aide.id);
    expect(deleted).toBeNull();
  });

  test('cascades delete to agents', async () => {
    const aide = await createAide({ userId: testUserId, name: 'Aide With Agents' });
    const agent = await createAgentForAide({
      aideId: aide.id,
      name: 'Agent To Delete',
      type: 'lead',
      parentAgentId: null,
    });

    await deleteAide(aide.id);

    // Agent should be deleted
    const [deletedAgent] = await db.select().from(agents).where(eq(agents.id, agent.id));
    expect(deletedAgent).toBeUndefined();
  });
});

// ============================================================================
// getAideUserId Tests
// ============================================================================

describe('getAideUserId', () => {
  test('returns user ID for aide', async () => {
    const aide = await createAide({ userId: testUserId, name: 'Aide' });

    const userId = await getAideUserId(aide.id);
    expect(userId).toBe(testUserId);

    await cleanupAides([aide.id]);
  });

  test('returns null for non-existent aide', async () => {
    const userId = await getAideUserId('00000000-0000-0000-0000-000000000000');
    expect(userId).toBeNull();
  });
});

// ============================================================================
// getAideLead Tests
// ============================================================================

describe('getAideLead', () => {
  test('returns the lead agent (no parent) for an aide', async () => {
    const aide = await createAide({ userId: testUserId, name: 'Aide With Lead' });
    const lead = await createAgentForAide({
      aideId: aide.id,
      name: 'Aide Lead',
      type: 'lead',
      parentAgentId: null,
    });

    const foundLead = await getAideLead(aide.id);

    expect(foundLead).not.toBeNull();
    expect(foundLead!.id).toBe(lead.id);
    expect(foundLead!.name).toBe('Aide Lead');
    expect(foundLead!.parentAgentId).toBeNull();

    await cleanupAides([aide.id]);
  });

  test('returns null for aide with no agents', async () => {
    const aide = await createAide({ userId: testUserId, name: 'Empty Aide' });

    const lead = await getAideLead(aide.id);
    expect(lead).toBeNull();

    await cleanupAides([aide.id]);
  });

  test('returns only the lead, not subordinates', async () => {
    const aide = await createAide({ userId: testUserId, name: 'Aide With Hierarchy' });
    const lead = await createAgentForAide({
      aideId: aide.id,
      name: 'Lead',
      type: 'lead',
      parentAgentId: null,
    });
    await createAgentForAide({
      aideId: aide.id,
      name: 'Subordinate',
      type: 'subordinate',
      parentAgentId: lead.id,
    });

    const foundLead = await getAideLead(aide.id);

    expect(foundLead!.id).toBe(lead.id);
    expect(foundLead!.name).toBe('Lead');

    await cleanupAides([aide.id]);
  });
});

// ============================================================================
// getAideWithAgents Tests
// ============================================================================

describe('getAideWithAgents', () => {
  test('returns aide with all agents', async () => {
    const aide = await createAide({ userId: testUserId, name: 'Aide With Agents' });
    const agent1 = await createAgentForAide({
      aideId: aide.id,
      name: 'Agent 1',
      type: 'lead',
      parentAgentId: null,
    });
    const agent2 = await createAgentForAide({
      aideId: aide.id,
      name: 'Agent 2',
      type: 'subordinate',
      parentAgentId: agent1.id,
    });

    const aideWithAgents = await getAideWithAgents(aide.id);

    expect(aideWithAgents).not.toBeNull();
    expect(aideWithAgents!.id).toBe(aide.id);
    expect(aideWithAgents!.agents).toHaveLength(2);
    expect(aideWithAgents!.agents.some(a => a.id === agent1.id)).toBe(true);
    expect(aideWithAgents!.agents.some(a => a.id === agent2.id)).toBe(true);

    await cleanupAides([aide.id]);
  });

  test('returns null for non-existent aide', async () => {
    const result = await getAideWithAgents('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  test('returns aide with empty agents array when no agents', async () => {
    const aide = await createAide({ userId: testUserId, name: 'No Agents Aide' });

    const aideWithAgents = await getAideWithAgents(aide.id);

    expect(aideWithAgents!.agents).toEqual([]);

    await cleanupAides([aide.id]);
  });
});

// ============================================================================
// createAgentForAide Tests (from agents.ts)
// ============================================================================

describe('createAgentForAide', () => {
  test('creates an agent for an aide', async () => {
    const aide = await createAide({ userId: testUserId, name: 'Aide' });

    const agent = await createAgentForAide({
      aideId: aide.id,
      name: 'My Agent',
      type: 'lead',
      parentAgentId: null,
    });

    expect(agent.id).toBeDefined();
    expect(agent.aideId).toBe(aide.id);
    expect(agent.teamId).toBeNull();
    expect(agent.name).toBe('My Agent');
    expect(agent.type).toBe('lead');
    expect(agent.parentAgentId).toBeNull();

    await cleanupAides([aide.id]);
  });

  test('creates agent with parent agent ID', async () => {
    const aide = await createAide({ userId: testUserId, name: 'Aide' });
    const lead = await createAgentForAide({
      aideId: aide.id,
      name: 'Lead',
      type: 'lead',
      parentAgentId: null,
    });

    const subordinate = await createAgentForAide({
      aideId: aide.id,
      name: 'Subordinate',
      type: 'subordinate',
      parentAgentId: lead.id,
    });

    expect(subordinate.parentAgentId).toBe(lead.id);

    await cleanupAides([aide.id]);
  });

  test('creates agent with system prompt', async () => {
    const aide = await createAide({ userId: testUserId, name: 'Aide' });

    const agent = await createAgentForAide({
      aideId: aide.id,
      name: 'Prompted Agent',
      type: 'lead',
      parentAgentId: null,
      systemPrompt: 'You are a helpful assistant.',
    });

    expect(agent.systemPrompt).toBe('You are a helpful assistant.');

    await cleanupAides([aide.id]);
  });
});

// ============================================================================
// getAgentsByAideId Tests (from agents.ts)
// ============================================================================

describe('getAgentsByAideId', () => {
  test('returns all agents for an aide', async () => {
    const aide = await createAide({ userId: testUserId, name: 'Aide' });
    const agent1 = await createAgentForAide({ aideId: aide.id, name: 'Agent 1', type: 'lead', parentAgentId: null });
    const agent2 = await createAgentForAide({ aideId: aide.id, name: 'Agent 2', type: 'subordinate', parentAgentId: agent1.id });
    const agent3 = await createAgentForAide({ aideId: aide.id, name: 'Agent 3', type: 'subordinate', parentAgentId: agent1.id });

    const aideAgents = await getAgentsByAideId(aide.id);

    expect(aideAgents.length).toBe(3);
    expect(aideAgents.some(a => a.id === agent1.id)).toBe(true);
    expect(aideAgents.some(a => a.id === agent2.id)).toBe(true);
    expect(aideAgents.some(a => a.id === agent3.id)).toBe(true);

    await cleanupAides([aide.id]);
  });

  test('returns empty array for aide with no agents', async () => {
    const aide = await createAide({ userId: testUserId, name: 'Empty Aide' });

    const aideAgents = await getAgentsByAideId(aide.id);
    expect(aideAgents).toEqual([]);

    await cleanupAides([aide.id]);
  });
});

// ============================================================================
// getActiveAideLeads Tests (from agents.ts)
// ============================================================================

describe('getActiveAideLeads', () => {
  test('returns lead agents from active aides', async () => {
    const activeAide = await createAide({ userId: testUserId, name: 'Active', status: 'active' });
    const activeLead = await createAgentForAide({
      aideId: activeAide.id,
      name: 'Active Lead',
      type: 'lead',
      parentAgentId: null,
    });

    const leads = await getActiveAideLeads();

    expect(leads.some(l => l.id === activeLead.id)).toBe(true);

    await cleanupAides([activeAide.id]);
  });

  test('excludes leads from paused aides', async () => {
    const pausedAide = await createAide({ userId: testUserId, name: 'Paused', status: 'paused' });
    const pausedLead = await createAgentForAide({
      aideId: pausedAide.id,
      name: 'Paused Lead',
      type: 'lead',
      parentAgentId: null,
    });

    const leads = await getActiveAideLeads();

    expect(leads.some(l => l.id === pausedLead.id)).toBe(false);

    await cleanupAides([pausedAide.id]);
  });

  test('excludes subordinates from active aides', async () => {
    const aide = await createAide({ userId: testUserId, name: 'Active', status: 'active' });
    const lead = await createAgentForAide({
      aideId: aide.id,
      name: 'Lead',
      type: 'lead',
      parentAgentId: null,
    });
    const subordinate = await createAgentForAide({
      aideId: aide.id,
      name: 'Subordinate',
      type: 'subordinate',
      parentAgentId: lead.id,
    });

    const leads = await getActiveAideLeads();

    expect(leads.some(l => l.id === lead.id)).toBe(true);
    expect(leads.some(l => l.id === subordinate.id)).toBe(false);

    await cleanupAides([aide.id]);
  });
});

// ============================================================================
// getAideLeadsDueToRun Tests (from agents.ts)
// ============================================================================

describe('getAideLeadsDueToRun', () => {
  test('returns aide leads where leadNextRunAt <= now', async () => {
    const aide = await createAide({ userId: testUserId, name: 'Active', status: 'active' });
    const lead = await createAgentForAide({
      aideId: aide.id,
      name: 'Due Lead',
      type: 'lead',
      parentAgentId: null,
    });

    // Set leadNextRunAt to past
    const pastDate = new Date(Date.now() - 1000);
    await db.update(agents)
      .set({ leadNextRunAt: pastDate })
      .where(eq(agents.id, lead.id));

    const dueLeads = await getAideLeadsDueToRun();

    expect(dueLeads).toContain(lead.id);

    await cleanupAides([aide.id]);
  });

  test('excludes aide leads in backoff', async () => {
    const aide = await createAide({ userId: testUserId, name: 'Active', status: 'active' });
    const lead = await createAgentForAide({
      aideId: aide.id,
      name: 'Backoff Lead',
      type: 'lead',
      parentAgentId: null,
    });

    const pastDate = new Date(Date.now() - 1000);
    const futureBackoff = new Date(Date.now() + 60 * 60 * 1000);
    await db.update(agents)
      .set({ leadNextRunAt: pastDate, backoffNextRunAt: futureBackoff, backoffAttemptCount: 1 })
      .where(eq(agents.id, lead.id));

    const dueLeads = await getAideLeadsDueToRun();

    expect(dueLeads).not.toContain(lead.id);

    await cleanupAides([aide.id]);
  });

  test('excludes aide leads with future leadNextRunAt', async () => {
    const aide = await createAide({ userId: testUserId, name: 'Active', status: 'active' });
    const lead = await createAgentForAide({
      aideId: aide.id,
      name: 'Future Lead',
      type: 'lead',
      parentAgentId: null,
    });

    // Set leadNextRunAt to future
    const futureDate = new Date(Date.now() + 86400000);
    await db.update(agents)
      .set({ leadNextRunAt: futureDate })
      .where(eq(agents.id, lead.id));

    const dueLeads = await getAideLeadsDueToRun();

    expect(dueLeads).not.toContain(lead.id);

    await cleanupAides([aide.id]);
  });

  test('excludes leads from paused aides', async () => {
    const pausedAide = await createAide({ userId: testUserId, name: 'Paused', status: 'paused' });
    const lead = await createAgentForAide({
      aideId: pausedAide.id,
      name: 'Paused Lead',
      type: 'lead',
      parentAgentId: null,
    });

    // Set leadNextRunAt to past
    const pastDate = new Date(Date.now() - 1000);
    await db.update(agents)
      .set({ leadNextRunAt: pastDate })
      .where(eq(agents.id, lead.id));

    const dueLeads = await getAideLeadsDueToRun();

    expect(dueLeads).not.toContain(lead.id);

    await cleanupAides([pausedAide.id]);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  test('handles empty purpose on create', async () => {
    const aide = await createAide({
      userId: testUserId,
      name: 'No Purpose',
      purpose: null,
    });

    expect(aide.purpose).toBeNull();

    await cleanupAides([aide.id]);
  });

  test('handles special characters in name', async () => {
    const specialName = 'My Aide! @#$%^&*()';
    const aide = await createAide({
      userId: testUserId,
      name: specialName,
    });

    expect(aide.name).toBe(specialName);

    await cleanupAides([aide.id]);
  });

  test('handles unicode in name', async () => {
    const unicodeName = 'My Aide \ud83d\ude00 \u4e2d\u6587';
    const aide = await createAide({
      userId: testUserId,
      name: unicodeName,
    });

    expect(aide.name).toBe(unicodeName);

    await cleanupAides([aide.id]);
  });

  test('handles very long purpose', async () => {
    const longPurpose = 'A'.repeat(1000);
    const aide = await createAide({
      userId: testUserId,
      name: 'Long Purpose Aide',
      purpose: longPurpose,
    });

    expect(aide.purpose).toBe(longPurpose);

    await cleanupAides([aide.id]);
  });

  test('can set purpose to null via update', async () => {
    const aide = await createAide({
      userId: testUserId,
      name: 'Aide',
      purpose: 'Original purpose',
    });

    await updateAide(aide.id, { purpose: null });

    const updated = await getAideById(aide.id);
    expect(updated!.purpose).toBeNull();

    await cleanupAides([aide.id]);
  });
});
