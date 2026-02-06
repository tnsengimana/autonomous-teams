/**
 * Tests for Knowledge Graph Service
 *
 * Tests the high-level knowledge graph operations for the INSERT/RETRIEVE loop
 * and context building.
 */

import { describe, test, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/lib/db/client";
import { users, agents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  buildGraphContextBlock,
  ensureGraphTypesInitialized,
} from "../knowledge-graph";
import { createNodeType } from "@/lib/db/queries/graph-types";
import { createNode } from "@/lib/db/queries/graph-data";
import * as graphTypeInitializer from "../graph-types";

// ============================================================================
// Test Setup
// ============================================================================

let testUserId: string;
let testAgentId: string;

beforeAll(async () => {
  // Create test user
  const [user] = await db
    .insert(users)
    .values({
      email: `knowledge-graph-test-${Date.now()}@example.com`,
      name: "Knowledge Graph Test User",
    })
    .returning();
  testUserId = user.id;

  // Create test agent
  const [agent] = await db
    .insert(agents)
    .values({
      userId: testUserId,
      name: "Test Research Team",
      purpose: "Financial research and analysis",
      conversationSystemPrompt:
        "You are a test agent for knowledge graph testing.",
      queryIdentificationSystemPrompt: "You identify queries for testing.",
      insightIdentificationSystemPrompt: "You identify insights for testing.",
      analysisGenerationSystemPrompt: "You generate analyses for testing.",
      adviceGenerationSystemPrompt: 'You generate advice for testing.',
      knowledgeAcquisitionSystemPrompt: 'You gather knowledge for testing.',
      graphConstructionSystemPrompt: "You construct graphs for testing.",
      iterationIntervalMs: 300000,
      isActive: true,
    })
    .returning();
  testAgentId = agent.id;
});

afterAll(async () => {
  // Cleanup: delete test user (cascades to agents, types, nodes, etc.)
  await db.delete(users).where(eq(users.id, testUserId));
});

// ============================================================================
// buildGraphContextBlock Tests
// ============================================================================

describe("buildGraphContextBlock", () => {
  test("returns formatted context with types and graph state", async () => {
    // First create some types
    await createNodeType({
      agentId: testAgentId,
      name: "Company",
      description: "A business agent",
      justification: "Test fixture type for graph context rendering.",
      propertiesSchema: {
        type: "object",
        properties: {
          ticker: { type: "string" },
        },
      },
      createdBy: "system",
    });

    // Create a node
    await createNode({
      agentId: testAgentId,
      type: "Company",
      name: "Acme Corp",
      properties: { ticker: "ACME" },
    });

    const context = await buildGraphContextBlock(testAgentId);

    // Should contain the knowledge_graph tags
    expect(context).toContain("<knowledge_graph>");
    expect(context).toContain("</knowledge_graph>");

    // Should mention node/edge counts
    expect(context).toMatch(/Current graph has \d+ nodes? and \d+ edges?/);

    // Should contain available types section
    expect(context).toContain("## Available Types");
    expect(context).toContain("Company");

    // Should contain graph state
    expect(context).toContain("Acme Corp");

    // Should contain usage instructions
    expect(context).toContain("How to Use the Knowledge Graph");
    expect(context).toContain("RETRIEVE first");
    expect(context).toContain("INSERT when needed");
  });

  test("handles empty graph correctly", async () => {
    // Create a new agent with no types or nodes
    const [emptyAgent] = await db
      .insert(agents)
      .values({
        userId: testUserId,
        name: "Empty Test Agent",
        purpose: "Testing empty graph",
        conversationSystemPrompt:
          "You are a test agent for empty graph testing.",
        queryIdentificationSystemPrompt: "You identify queries for testing.",
      insightIdentificationSystemPrompt: "You identify insights for testing.",
        analysisGenerationSystemPrompt: "You generate analyses for testing.",
        adviceGenerationSystemPrompt: 'You generate advice for testing.',
        knowledgeAcquisitionSystemPrompt: 'You gather knowledge for testing.',
        graphConstructionSystemPrompt: "You construct graphs for testing.",
        iterationIntervalMs: 300000,
        isActive: true,
      })
      .returning();

    try {
      const context = await buildGraphContextBlock(emptyAgent.id);

      // Should contain the knowledge_graph tags
      expect(context).toContain("<knowledge_graph>");
      expect(context).toContain("</knowledge_graph>");

      // Should indicate empty graph
      expect(context).toContain("knowledge graph is currently empty");

      // Should still contain usage instructions
      expect(context).toContain("How to Use the Knowledge Graph");
      expect(context).toContain("RETRIEVE first");
      expect(context).toContain("INSERT when needed");

      // Should NOT contain the freshness reasoning (only in non-empty graph)
      expect(context).not.toContain("Reason about freshness");
    } finally {
      // Cleanup
      await db.delete(agents).where(eq(agents.id, emptyAgent.id));
    }
  });
});

// ============================================================================
// ensureGraphTypesInitialized Tests
// ============================================================================

describe("ensureGraphTypesInitialized", () => {
  test("initializes types for agent without types", async () => {
    // Create a new agent with no types
    const [newAgent] = await db
      .insert(agents)
      .values({
        userId: testUserId,
        name: "No Types Agent",
        purpose: "Testing type initialization",
        conversationSystemPrompt:
          "You are a test agent for type initialization.",
        queryIdentificationSystemPrompt: "You identify queries for testing.",
      insightIdentificationSystemPrompt: "You identify insights for testing.",
        analysisGenerationSystemPrompt: "You generate analyses for testing.",
        adviceGenerationSystemPrompt: 'You generate advice for testing.',
        knowledgeAcquisitionSystemPrompt: 'You gather knowledge for testing.',
        graphConstructionSystemPrompt: "You construct graphs for testing.",
        iterationIntervalMs: 300000,
        isActive: true,
      })
      .returning();

    // Mock the initializeAndPersistTypesForAgent function
    const mockInit = vi
      .spyOn(graphTypeInitializer, "initializeAndPersistTypesForAgent")
      .mockResolvedValueOnce();

    try {
      await ensureGraphTypesInitialized(
        newAgent.id,
        { name: newAgent.name, type: "agent", purpose: newAgent.purpose },
        { userId: testUserId },
      );

      // Should have called the initializer
      expect(mockInit).toHaveBeenCalledWith(
        newAgent.id,
        { name: newAgent.name, type: "agent", purpose: newAgent.purpose },
        { userId: testUserId },
      );
    } finally {
      mockInit.mockRestore();
      // Cleanup
      await db.delete(agents).where(eq(agents.id, newAgent.id));
    }
  });

  test("skips initialization if types exist", async () => {
    // The test agent already has types from the first test
    // Mock the initializeAndPersistTypesForAgent function
    const mockInit = vi
      .spyOn(graphTypeInitializer, "initializeAndPersistTypesForAgent")
      .mockResolvedValueOnce();

    try {
      await ensureGraphTypesInitialized(
        testAgentId,
        {
          name: "Test Research Team",
          type: "team",
          purpose: "Financial research",
        },
        { userId: testUserId },
      );

      // Should NOT have called the initializer since types exist
      expect(mockInit).not.toHaveBeenCalled();
    } finally {
      mockInit.mockRestore();
    }
  });

  test("handles missing userId gracefully", async () => {
    // Create a new agent with no types
    const [newAgent] = await db
      .insert(agents)
      .values({
        userId: testUserId,
        name: "No UserId Agent",
        purpose: "Testing without userId",
        conversationSystemPrompt: "You are a test agent for userId testing.",
        queryIdentificationSystemPrompt: "You identify queries for testing.",
      insightIdentificationSystemPrompt: "You identify insights for testing.",
        analysisGenerationSystemPrompt: "You generate analyses for testing.",
        adviceGenerationSystemPrompt: 'You generate advice for testing.',
        knowledgeAcquisitionSystemPrompt: 'You gather knowledge for testing.',
        graphConstructionSystemPrompt: "You construct graphs for testing.",
        iterationIntervalMs: 300000,
        isActive: true,
      })
      .returning();

    // Mock the initializeAndPersistTypesForAgent function
    const mockInit = vi
      .spyOn(graphTypeInitializer, "initializeAndPersistTypesForAgent")
      .mockResolvedValueOnce();

    try {
      // Call without userId option
      await ensureGraphTypesInitialized(newAgent.id, {
        name: newAgent.name,
        type: "agent",
        purpose: newAgent.purpose,
      });

      // Should still have called the initializer
      expect(mockInit).toHaveBeenCalledWith(
        newAgent.id,
        { name: newAgent.name, type: "agent", purpose: newAgent.purpose },
        undefined,
      );
    } finally {
      mockInit.mockRestore();
      // Cleanup
      await db.delete(agents).where(eq(agents.id, newAgent.id));
    }
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("Integration", () => {
  test("buildGraphContextBlock includes recently added nodes", async () => {
    // Create another agent for isolation
    const [integrationAgent] = await db
      .insert(agents)
      .values({
        userId: testUserId,
        name: "Integration Test Team",
        purpose: "Integration testing",
        conversationSystemPrompt:
          "You are a test agent for integration testing.",
        queryIdentificationSystemPrompt: "You identify queries for testing.",
      insightIdentificationSystemPrompt: "You identify insights for testing.",
        analysisGenerationSystemPrompt: "You generate analyses for testing.",
        adviceGenerationSystemPrompt: 'You generate advice for testing.',
        knowledgeAcquisitionSystemPrompt: 'You gather knowledge for testing.',
        graphConstructionSystemPrompt: "You construct graphs for testing.",
        iterationIntervalMs: 300000,
        isActive: true,
      })
      .returning();

    try {
      // Create a node type
      await createNodeType({
        agentId: integrationAgent.id,
        name: "Analyst",
        description: "A financial analyst",
        justification: "Test fixture type for integration graph context checks.",
        propertiesSchema: {
          type: "object",
          properties: {
            specialty: { type: "string" },
          },
        },
        createdBy: "system",
      });

      // Create multiple nodes
      await createNode({
        agentId: integrationAgent.id,
        type: "Analyst",
        name: "Alice Smith",
        properties: { specialty: "Tech" },
      });

      await createNode({
        agentId: integrationAgent.id,
        type: "Analyst",
        name: "Bob Jones",
        properties: { specialty: "Finance" },
      });

      const context = await buildGraphContextBlock(integrationAgent.id);

      // Should contain both nodes
      expect(context).toContain("Alice Smith");
      expect(context).toContain("Bob Jones");

      // Should have correct count
      expect(context).toContain("2 nodes");
    } finally {
      // Cleanup
      await db.delete(agents).where(eq(agents.id, integrationAgent.id));
    }
  });
});
