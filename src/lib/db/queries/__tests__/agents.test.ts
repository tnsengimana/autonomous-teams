/**
 * Tests for Agents Database Queries
 *
 * Tests CRUD operations and active state management for agents.
 */

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db/client";
import { users, agents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  createAgent,
  getAgentById,
  getAgentsByUserId,
  getActiveAgents,
  updateAgent,
  setAgentActive,
  activateAgent,
  pauseAgent,
  deleteAgent,
} from "../agents";

// ============================================================================
// Test Setup
// ============================================================================

let testUserId: string;

beforeAll(async () => {
  // Create test user
  const [user] = await db
    .insert(users)
    .values({
      email: `agents-test-${Date.now()}@example.com`,
      name: "Agents Test User",
    })
    .returning();
  testUserId = user.id;
});

afterAll(async () => {
  // Cleanup: delete test user (cascades to agents)
  await db.delete(users).where(eq(users.id, testUserId));
});

// ============================================================================
// createAgent Tests
// ============================================================================

describe("createAgent", () => {
  test("creates agent with isActive defaulting to true", async () => {
    const agent = await createAgent({
      userId: testUserId,
      name: "Default Active Agent",
      purpose: "Testing default active state",
      conversationSystemPrompt: "Test prompt",
      queryIdentificationSystemPrompt: "Test query identification",
      insightIdentificationSystemPrompt: "Test insight identification",
      analysisGenerationSystemPrompt: "Test analysis generation",
      adviceGenerationSystemPrompt: 'You generate advice for testing.',
      knowledgeAcquisitionSystemPrompt: 'Test knowledge acquisition',
      graphConstructionSystemPrompt: "Test construction",
      iterationIntervalMs: 300000,
    });

    try {
      expect(agent.isActive).toBe(true);
    } finally {
      await deleteAgent(agent.id);
    }
  });

  test("creates agent with isActive explicitly set to false", async () => {
    const agent = await createAgent({
      userId: testUserId,
      name: "Inactive Agent",
      purpose: "Testing inactive state",
      conversationSystemPrompt: "Test prompt",
      queryIdentificationSystemPrompt: "Test query identification",
      insightIdentificationSystemPrompt: "Test insight identification",
      analysisGenerationSystemPrompt: "Test analysis generation",
      adviceGenerationSystemPrompt: 'You generate advice for testing.',
      knowledgeAcquisitionSystemPrompt: 'Test knowledge acquisition',
      graphConstructionSystemPrompt: "Test construction",
      iterationIntervalMs: 300000,
      isActive: false,
    });

    try {
      expect(agent.isActive).toBe(false);
    } finally {
      await deleteAgent(agent.id);
    }
  });
});

// ============================================================================
// getActiveAgents Tests
// ============================================================================

describe("getActiveAgents", () => {
  test("returns only active agents", async () => {
    // Create one active and one inactive agent
    const activeAgent = await createAgent({
      userId: testUserId,
      name: "Active Agent for Filter Test",
      purpose: "Testing active filter",
      conversationSystemPrompt: "Test prompt",
      queryIdentificationSystemPrompt: "Test query identification",
      insightIdentificationSystemPrompt: "Test insight identification",
      analysisGenerationSystemPrompt: "Test analysis generation",
      adviceGenerationSystemPrompt: 'You generate advice for testing.',
      knowledgeAcquisitionSystemPrompt: 'Test knowledge acquisition',
      graphConstructionSystemPrompt: "Test construction",
      iterationIntervalMs: 300000,
      isActive: true,
    });

    const inactiveAgent = await createAgent({
      userId: testUserId,
      name: "Inactive Agent for Filter Test",
      purpose: "Testing active filter",
      conversationSystemPrompt: "Test prompt",
      queryIdentificationSystemPrompt: "Test query identification",
      insightIdentificationSystemPrompt: "Test insight identification",
      analysisGenerationSystemPrompt: "Test analysis generation",
      adviceGenerationSystemPrompt: 'You generate advice for testing.',
      knowledgeAcquisitionSystemPrompt: 'Test knowledge acquisition',
      graphConstructionSystemPrompt: "Test construction",
      iterationIntervalMs: 300000,
      isActive: false,
    });

    try {
      const activeAgents = await getActiveAgents();

      // Should include the active agent
      const foundActive = activeAgents.find((a) => a.id === activeAgent.id);
      expect(foundActive).toBeDefined();

      // Should NOT include the inactive agent
      const foundInactive = activeAgents.find((a) => a.id === inactiveAgent.id);
      expect(foundInactive).toBeUndefined();
    } finally {
      await deleteAgent(activeAgent.id);
      await deleteAgent(inactiveAgent.id);
    }
  });
});

// ============================================================================
// setAgentActive Tests
// ============================================================================

describe("setAgentActive", () => {
  test("sets agent to inactive", async () => {
    const agent = await createAgent({
      userId: testUserId,
      name: "Agent to Deactivate",
      purpose: "Testing deactivation",
      conversationSystemPrompt: "Test prompt",
      queryIdentificationSystemPrompt: "Test query identification",
      insightIdentificationSystemPrompt: "Test insight identification",
      analysisGenerationSystemPrompt: "Test analysis generation",
      adviceGenerationSystemPrompt: 'You generate advice for testing.',
      knowledgeAcquisitionSystemPrompt: 'Test knowledge acquisition',
      graphConstructionSystemPrompt: "Test construction",
      iterationIntervalMs: 300000,
      isActive: true,
    });

    try {
      await setAgentActive(agent.id, false);
      const updated = await getAgentById(agent.id);
      expect(updated?.isActive).toBe(false);
    } finally {
      await deleteAgent(agent.id);
    }
  });

  test("sets agent to active", async () => {
    const agent = await createAgent({
      userId: testUserId,
      name: "Agent to Activate",
      purpose: "Testing activation",
      conversationSystemPrompt: "Test prompt",
      queryIdentificationSystemPrompt: "Test query identification",
      insightIdentificationSystemPrompt: "Test insight identification",
      analysisGenerationSystemPrompt: "Test analysis generation",
      adviceGenerationSystemPrompt: 'You generate advice for testing.',
      knowledgeAcquisitionSystemPrompt: 'Test knowledge acquisition',
      graphConstructionSystemPrompt: "Test construction",
      iterationIntervalMs: 300000,
      isActive: false,
    });

    try {
      await setAgentActive(agent.id, true);
      const updated = await getAgentById(agent.id);
      expect(updated?.isActive).toBe(true);
    } finally {
      await deleteAgent(agent.id);
    }
  });
});

// ============================================================================
// activateAgent and pauseAgent Tests
// ============================================================================

describe("activateAgent", () => {
  test("activates a paused agent", async () => {
    const agent = await createAgent({
      userId: testUserId,
      name: "Agent to Activate via Helper",
      purpose: "Testing activateAgent helper",
      conversationSystemPrompt: "Test prompt",
      queryIdentificationSystemPrompt: "Test query identification",
      insightIdentificationSystemPrompt: "Test insight identification",
      analysisGenerationSystemPrompt: "Test analysis generation",
      adviceGenerationSystemPrompt: 'You generate advice for testing.',
      knowledgeAcquisitionSystemPrompt: 'Test knowledge acquisition',
      graphConstructionSystemPrompt: "Test construction",
      iterationIntervalMs: 300000,
      isActive: false,
    });

    try {
      await activateAgent(agent.id);
      const updated = await getAgentById(agent.id);
      expect(updated?.isActive).toBe(true);
    } finally {
      await deleteAgent(agent.id);
    }
  });
});

describe("pauseAgent", () => {
  test("pauses an active agent", async () => {
    const agent = await createAgent({
      userId: testUserId,
      name: "Agent to Pause",
      purpose: "Testing pauseAgent helper",
      conversationSystemPrompt: "Test prompt",
      queryIdentificationSystemPrompt: "Test query identification",
      insightIdentificationSystemPrompt: "Test insight identification",
      analysisGenerationSystemPrompt: "Test analysis generation",
      adviceGenerationSystemPrompt: 'You generate advice for testing.',
      knowledgeAcquisitionSystemPrompt: 'Test knowledge acquisition',
      graphConstructionSystemPrompt: "Test construction",
      iterationIntervalMs: 300000,
      isActive: true,
    });

    try {
      await pauseAgent(agent.id);
      const updated = await getAgentById(agent.id);
      expect(updated?.isActive).toBe(false);
    } finally {
      await deleteAgent(agent.id);
    }
  });
});

// ============================================================================
// updateAgent Tests
// ============================================================================

describe("updateAgent", () => {
  test("updates isActive via updateAgent", async () => {
    const agent = await createAgent({
      userId: testUserId,
      name: "Agent for Update Test",
      purpose: "Testing updateAgent",
      conversationSystemPrompt: "Test prompt",
      queryIdentificationSystemPrompt: "Test query identification",
      insightIdentificationSystemPrompt: "Test insight identification",
      analysisGenerationSystemPrompt: "Test analysis generation",
      adviceGenerationSystemPrompt: 'You generate advice for testing.',
      knowledgeAcquisitionSystemPrompt: 'Test knowledge acquisition',
      graphConstructionSystemPrompt: "Test construction",
      iterationIntervalMs: 300000,
      isActive: true,
    });

    try {
      await updateAgent(agent.id, { isActive: false });
      const updated = await getAgentById(agent.id);
      expect(updated?.isActive).toBe(false);

      await updateAgent(agent.id, { isActive: true });
      const reactivated = await getAgentById(agent.id);
      expect(reactivated?.isActive).toBe(true);
    } finally {
      await deleteAgent(agent.id);
    }
  });

  test("updates name without affecting isActive", async () => {
    const agent = await createAgent({
      userId: testUserId,
      name: "Original Name",
      purpose: "Testing partial update",
      conversationSystemPrompt: "Test prompt",
      queryIdentificationSystemPrompt: "Test query identification",
      insightIdentificationSystemPrompt: "Test insight identification",
      analysisGenerationSystemPrompt: "Test analysis generation",
      adviceGenerationSystemPrompt: 'You generate advice for testing.',
      knowledgeAcquisitionSystemPrompt: 'Test knowledge acquisition',
      graphConstructionSystemPrompt: "Test construction",
      iterationIntervalMs: 300000,
      isActive: true,
    });

    try {
      await updateAgent(agent.id, { name: "Updated Name" });
      const updated = await getAgentById(agent.id);
      expect(updated?.name).toBe("Updated Name");
      expect(updated?.isActive).toBe(true);
    } finally {
      await deleteAgent(agent.id);
    }
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("Integration", () => {
  test("pause/resume cycle works correctly", async () => {
    const agent = await createAgent({
      userId: testUserId,
      name: "Cycle Test Agent",
      purpose: "Testing pause/resume cycle",
      conversationSystemPrompt: "Test prompt",
      queryIdentificationSystemPrompt: "Test query identification",
      insightIdentificationSystemPrompt: "Test insight identification",
      analysisGenerationSystemPrompt: "Test analysis generation",
      adviceGenerationSystemPrompt: 'You generate advice for testing.',
      knowledgeAcquisitionSystemPrompt: 'Test knowledge acquisition',
      graphConstructionSystemPrompt: "Test construction",
      iterationIntervalMs: 300000,
      isActive: true,
    });

    try {
      // Verify initially active
      let current = await getAgentById(agent.id);
      expect(current?.isActive).toBe(true);

      // Pause
      await pauseAgent(agent.id);
      current = await getAgentById(agent.id);
      expect(current?.isActive).toBe(false);

      // Verify not in active agents list
      let activeAgents = await getActiveAgents();
      expect(activeAgents.find((a) => a.id === agent.id)).toBeUndefined();

      // Resume
      await activateAgent(agent.id);
      current = await getAgentById(agent.id);
      expect(current?.isActive).toBe(true);

      // Verify back in active agents list
      activeAgents = await getActiveAgents();
      expect(activeAgents.find((a) => a.id === agent.id)).toBeDefined();
    } finally {
      await deleteAgent(agent.id);
    }
  });
});
