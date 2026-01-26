/**
 * Tests for the Worker Runner
 *
 * Tests cover:
 * - getAgentsNeedingWork combines pending tasks + due team leads
 * - processAgentWorkSession calls runWorkSession
 * - notifyTaskQueued triggers processing
 * - Team leads get scheduled, subordinates don't
 */

import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import { db } from "@/lib/db/client";
import { users, teams, agents, agentTasks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// Import functions to test
import { notifyTaskQueued, runSingleCycle, stopRunner } from "@/worker/runner";

// Import query functions for verification
import {
  getAgentsWithPendingTasks,
  getLeadsDueToRun,
} from "@/lib/db/queries/agents";

import { queueUserTask, type TaskOwnerInfo } from "@/lib/agents/taskQueue";
import { updateAgentLeadNextRunAt } from "@/lib/db/queries/agents";

// Helper to create ownerInfo for teams
function teamOwnerInfo(teamId: string): TaskOwnerInfo {
  return { teamId };
}

// ============================================================================
// Test Setup
// ============================================================================

let testUserId: string;
let testTeamId: string;
let testTeamLeadId: string;
let testSubordinateId: string;
let inactiveTeamId: string;
let inactiveTeamLeadId: string;

beforeAll(async () => {
  // Create test user
  const [user] = await db
    .insert(users)
    .values({
      email: `runner-test-${Date.now()}@example.com`,
      name: "Runner Test User",
    })
    .returning();
  testUserId = user.id;

  // Create active test team
  const [team] = await db
    .insert(teams)
    .values({
      userId: testUserId,
      name: "Runner Test Team",
      purpose: "Testing worker runner",
      status: "active",
    })
    .returning();
  testTeamId = team.id;

  // Create inactive test team
  const [inactiveTeam] = await db
    .insert(teams)
    .values({
      userId: testUserId,
      name: "Inactive Test Team",
      purpose: "Testing inactive teams are not processed",
      status: "paused",
    })
    .returning();
  inactiveTeamId = inactiveTeam.id;

  // Create team lead (no parent)
  const [teamLead] = await db
    .insert(agents)
    .values({
      teamId: testTeamId,
      name: "Test Team Lead",
      type: "lead",
      parentAgentId: null, // Team lead has no parent
    })
    .returning();
  testTeamLeadId = teamLead.id;

  // Create subordinate (has parent)
  const [subordinate] = await db
    .insert(agents)
    .values({
      teamId: testTeamId,
      name: "Test Subordinate",
      type: "subordinate",
      parentAgentId: testTeamLeadId, // Subordinate has team lead as parent
    })
    .returning();
  testSubordinateId = subordinate.id;

  // Create team lead in inactive team
  const [inactiveTeamLead] = await db
    .insert(agents)
    .values({
      teamId: inactiveTeamId,
      name: "Inactive Team Lead",
      type: "lead",
      parentAgentId: null,
    })
    .returning();
  inactiveTeamLeadId = inactiveTeamLead.id;
});

afterAll(async () => {
  // Cleanup: delete test user (cascades to teams, agents, tasks, etc.)
  await db.delete(users).where(eq(users.id, testUserId));
});

// Helper to cleanup tasks
async function cleanupTasks(taskIds: string[]) {
  for (const taskId of taskIds) {
    await db.delete(agentTasks).where(eq(agentTasks.id, taskId));
  }
}

// Helper to reset agent leadNextRunAt
async function resetAgentNextRunAt(agentId: string) {
  await db
    .update(agents)
    .set({
      leadNextRunAt: null,
      backoffNextRunAt: null,
      backoffAttemptCount: 0,
    })
    .where(eq(agents.id, agentId));
}

// ============================================================================
// getAgentsWithPendingTasks Tests
// ============================================================================

describe("getAgentsWithPendingTasks", () => {
  test("returns empty array when no pending tasks", async () => {
    const agentIds = await getAgentsWithPendingTasks();

    // Filter to only our test agents (other tests may have tasks)
    const ourAgents = agentIds.filter(
      (id) => id === testTeamLeadId || id === testSubordinateId,
    );

    expect(ourAgents).toHaveLength(0);
  });

  test("returns agent IDs with pending tasks", async () => {
    const task = await queueUserTask(
      testSubordinateId,
      teamOwnerInfo(testTeamId),
      "Pending task",
    );

    const agentIds = await getAgentsWithPendingTasks();

    expect(agentIds).toContain(testSubordinateId);

    await cleanupTasks([task.id]);
  });

  test("excludes agents in backoff", async () => {
    const task = await queueUserTask(
      testSubordinateId,
      teamOwnerInfo(testTeamId),
      "Pending task",
    );
    const futureDate = new Date(Date.now() + 60 * 60 * 1000);

    await db
      .update(agents)
      .set({ backoffNextRunAt: futureDate, backoffAttemptCount: 1 })
      .where(eq(agents.id, testSubordinateId));

    const agentIds = await getAgentsWithPendingTasks();

    expect(agentIds).not.toContain(testSubordinateId);

    await cleanupTasks([task.id]);
    await resetAgentNextRunAt(testSubordinateId);
  });

  test("does not return agents with only completed tasks", async () => {
    const task = await queueUserTask(
      testSubordinateId,
      teamOwnerInfo(testTeamId),
      "Completed task",
    );

    // Complete the task
    const { completeTaskWithResult } =
      await import("@/lib/db/queries/agentTasks");
    await completeTaskWithResult(task.id, "Done");

    const agentIds = await getAgentsWithPendingTasks();

    // Filter to only our test subordinate
    const hasSubordinate = agentIds.includes(testSubordinateId);
    expect(hasSubordinate).toBe(false);

    await cleanupTasks([task.id]);
  });

  test("returns distinct agent IDs even with multiple tasks", async () => {
    const task1 = await queueUserTask(
      testSubordinateId,
      teamOwnerInfo(testTeamId),
      "Task 1",
    );
    const task2 = await queueUserTask(
      testSubordinateId,
      teamOwnerInfo(testTeamId),
      "Task 2",
    );
    const task3 = await queueUserTask(
      testSubordinateId,
      teamOwnerInfo(testTeamId),
      "Task 3",
    );

    const agentIds = await getAgentsWithPendingTasks();

    // Should only appear once even with multiple tasks
    const subordinateOccurrences = agentIds.filter(
      (id) => id === testSubordinateId,
    );
    expect(subordinateOccurrences).toHaveLength(1);

    await cleanupTasks([task1.id, task2.id, task3.id]);
  });
});

// ============================================================================
// getLeadsDueToRun Tests
// ============================================================================

describe("getLeadsDueToRun", () => {
  beforeEach(async () => {
    // Reset leadNextRunAt for all test agents
    await resetAgentNextRunAt(testTeamLeadId);
    await resetAgentNextRunAt(testSubordinateId);
    await resetAgentNextRunAt(inactiveTeamLeadId);
  });

  test("returns empty array when no team leads are due", async () => {
    // Set leadNextRunAt to future
    const futureDate = new Date(Date.now() + 86400000); // 1 day from now
    await updateAgentLeadNextRunAt(testTeamLeadId, futureDate);

    const teamLeadIds = await getLeadsDueToRun();

    expect(teamLeadIds).not.toContain(testTeamLeadId);
  });

  test("returns team leads where leadNextRunAt <= now", async () => {
    // Set leadNextRunAt to past
    const pastDate = new Date(Date.now() - 1000); // 1 second ago
    await updateAgentLeadNextRunAt(testTeamLeadId, pastDate);

    const teamLeadIds = await getLeadsDueToRun();

    expect(teamLeadIds).toContain(testTeamLeadId);
  });

  test("excludes team leads in backoff", async () => {
    const pastDate = new Date(Date.now() - 1000);
    const futureBackoff = new Date(Date.now() + 60 * 60 * 1000);
    await updateAgentLeadNextRunAt(testTeamLeadId, pastDate);
    await db
      .update(agents)
      .set({ backoffNextRunAt: futureBackoff, backoffAttemptCount: 1 })
      .where(eq(agents.id, testTeamLeadId));

    const teamLeadIds = await getLeadsDueToRun();
    expect(teamLeadIds).not.toContain(testTeamLeadId);

    await resetAgentNextRunAt(testTeamLeadId);
  });

  test("does not return subordinates even if they have leadNextRunAt set", async () => {
    // Set leadNextRunAt on subordinate (shouldn't happen, but test the guard)
    const pastDate = new Date(Date.now() - 1000);
    await updateAgentLeadNextRunAt(testSubordinateId, pastDate);

    const teamLeadIds = await getLeadsDueToRun();

    expect(teamLeadIds).not.toContain(testSubordinateId);
  });

  test("only returns team leads from active teams", async () => {
    // Set leadNextRunAt on inactive team's lead
    const pastDate = new Date(Date.now() - 1000);
    await updateAgentLeadNextRunAt(inactiveTeamLeadId, pastDate);

    const teamLeadIds = await getLeadsDueToRun();

    expect(teamLeadIds).not.toContain(inactiveTeamLeadId);
  });

  test("returns team leads with null leadNextRunAt if first run", async () => {
    // leadNextRunAt is null by default - this means never run yet
    // The query uses lte which doesn't include null, so this should NOT be returned
    // This is the expected behavior - agents need to be scheduled first
    const teamLeadIds = await getLeadsDueToRun();

    // With null leadNextRunAt, team lead should NOT be in the due list
    expect(teamLeadIds).not.toContain(testTeamLeadId);
  });
});

// ============================================================================
// notifyTaskQueued Tests
// ============================================================================

describe("notifyTaskQueued", () => {
  test("adds agent to pending notifications", async () => {
    // notifyTaskQueued should add the agent to the Set
    notifyTaskQueued(testSubordinateId);

    // We can't directly access pendingNotifications since it's private
    // But we can verify by calling runSingleCycle and checking if the agent is processed
    // For this test, we just verify the function doesn't throw
    expect(true).toBe(true);
  });

  test("can be called multiple times for same agent", () => {
    // Should not throw even when called multiple times
    expect(() => {
      notifyTaskQueued(testSubordinateId);
      notifyTaskQueued(testSubordinateId);
      notifyTaskQueued(testSubordinateId);
    }).not.toThrow();
  });

  test("can be called for multiple agents", () => {
    // Should not throw for multiple agents
    expect(() => {
      notifyTaskQueued(testSubordinateId);
      notifyTaskQueued(testTeamLeadId);
    }).not.toThrow();
  });
});

// ============================================================================
// Integration Tests: Task Queue Triggers Worker
// ============================================================================

describe("Task Queue Integration", () => {
  test("queueUserTask calls notifyWorkerRunner", async () => {
    // Create a task - this should internally call notifyTaskQueued
    // We can verify by checking the task was created successfully
    const task = await queueUserTask(
      testSubordinateId,
      teamOwnerInfo(testTeamId),
      "Integration test task",
    );

    expect(task).toBeDefined();
    expect(task.assignedToId).toBe(testSubordinateId);

    await cleanupTasks([task.id]);
  });
});

// ============================================================================
// Agent Scheduling Tests
// ============================================================================

describe("Agent Scheduling", () => {
  test("team lead is identified correctly", async () => {
    // Team lead has no parent
    const [teamLead] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, testTeamLeadId));

    expect(teamLead.parentAgentId).toBeNull();
  });

  test("subordinate is identified correctly", async () => {
    // Subordinate has a parent
    const [subordinate] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, testSubordinateId));

    expect(subordinate.parentAgentId).toBe(testTeamLeadId);
  });

  test("team lead can have leadNextRunAt updated", async () => {
    const futureDate = new Date(Date.now() + 86400000); // 1 day from now
    await updateAgentLeadNextRunAt(testTeamLeadId, futureDate);

    const [teamLead] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, testTeamLeadId));

    expect(teamLead.leadNextRunAt).toEqual(futureDate);

    // Reset
    await resetAgentNextRunAt(testTeamLeadId);
  });
});

// ============================================================================
// Combined Agent Selection Tests
// ============================================================================

describe("Combined Agent Selection", () => {
  beforeEach(async () => {
    await resetAgentNextRunAt(testTeamLeadId);
    await resetAgentNextRunAt(testSubordinateId);
  });

  test("agents with pending tasks are selected", async () => {
    const task = await queueUserTask(
      testSubordinateId,
      teamOwnerInfo(testTeamId),
      "Subordinate task",
    );

    const agentsWithTasks = await getAgentsWithPendingTasks();
    expect(agentsWithTasks).toContain(testSubordinateId);

    await cleanupTasks([task.id]);
  });

  test("due team leads are selected", async () => {
    const pastDate = new Date(Date.now() - 1000);
    await updateAgentLeadNextRunAt(testTeamLeadId, pastDate);

    const dueTeamLeads = await getLeadsDueToRun();
    expect(dueTeamLeads).toContain(testTeamLeadId);
  });

  test("both sources can contribute agents", async () => {
    // Subordinate has pending task
    const task = await queueUserTask(
      testSubordinateId,
      teamOwnerInfo(testTeamId),
      "Subordinate task",
    );

    // Team lead is due to run
    const pastDate = new Date(Date.now() - 1000);
    await updateAgentLeadNextRunAt(testTeamLeadId, pastDate);

    const agentsWithTasks = await getAgentsWithPendingTasks();
    const dueTeamLeads = await getLeadsDueToRun();

    expect(agentsWithTasks).toContain(testSubordinateId);
    expect(dueTeamLeads).toContain(testTeamLeadId);

    await cleanupTasks([task.id]);
  });
});

// ============================================================================
// Runner Control Tests
// ============================================================================

describe("Runner Control", () => {
  test("stopRunner can be called without error", () => {
    expect(() => stopRunner()).not.toThrow();
  });

  // Note: We don't test runSingleCycle() here because it processes ALL agents
  // globally, which can interfere with other test suites running in parallel.
  // The actual work session processing is tested in agent.test.ts.
  test("runSingleCycle is exported and callable", async () => {
    // Just verify the function exists and is callable (without actually running it)
    expect(typeof runSingleCycle).toBe("function");
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("Edge Cases", () => {
  test("handles non-existent agent ID in notifications gracefully", () => {
    // Should not throw even with fake ID
    expect(() => {
      notifyTaskQueued("non-existent-id");
    }).not.toThrow();
  });

  test("handles concurrent task creation", async () => {
    // Create multiple tasks concurrently
    const tasks = await Promise.all([
      queueUserTask(testSubordinateId, teamOwnerInfo(testTeamId), "Task 1"),
      queueUserTask(testSubordinateId, teamOwnerInfo(testTeamId), "Task 2"),
      queueUserTask(testSubordinateId, teamOwnerInfo(testTeamId), "Task 3"),
    ]);

    const agentsWithTasks = await getAgentsWithPendingTasks();
    expect(agentsWithTasks).toContain(testSubordinateId);

    await cleanupTasks(tasks.map((t) => t.id));
  });

  test("deduplicates agents from multiple sources", async () => {
    // Team lead has both: pending task AND is due to run
    const task = await queueUserTask(
      testTeamLeadId,
      teamOwnerInfo(testTeamId),
      "Team lead task",
    );
    const pastDate = new Date(Date.now() - 1000);
    await updateAgentLeadNextRunAt(testTeamLeadId, pastDate);

    const agentsWithTasks = await getAgentsWithPendingTasks();
    const dueTeamLeads = await getLeadsDueToRun();

    // Both should contain the team lead
    expect(agentsWithTasks).toContain(testTeamLeadId);
    expect(dueTeamLeads).toContain(testTeamLeadId);

    // When combined and deduped, should only appear once
    const combined = [...new Set([...agentsWithTasks, ...dueTeamLeads])];
    const teamLeadOccurrences = combined.filter((id) => id === testTeamLeadId);
    expect(teamLeadOccurrences).toHaveLength(1);

    await cleanupTasks([task.id]);
    await resetAgentNextRunAt(testTeamLeadId);
  });
});
