/**
 * Tests for Graph Type Initializer
 *
 * Tests the LLM-based type initialization system that generates
 * appropriate node and edge types when a new agent is created.
 *
 * Uses MOCK_LLM=true for testing without real API calls.
 */

import { describe, test, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/lib/db/client";
import { users, agents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import * as llm from "@/lib/llm/providers";
import {
  initializeTypesForAgent,
  persistInitializedTypes,
  type TypeInitializationResult,
  SEED_EDGE_TYPES,
} from "../graph-types";
import {
  getNodeTypesByAgent,
  getEdgeTypesByAgent,
} from "@/lib/db/queries/graph-types";

// ============================================================================
// Test Setup
// ============================================================================

let testUserId: string;

// Mock LLM response for type initialization
const mockTypeInitializationResult: TypeInitializationResult = {
  nodeTypes: [
    {
      name: "Company",
      description: "A business agent or corporation",
      propertiesSchema: {
        type: "object",
        required: ["ticker"],
        properties: {
          ticker: { type: "string", description: "Stock ticker symbol" },
          sector: { type: "string", description: "Business sector" },
          market_cap: { type: "number", description: "Market capitalization" },
        },
      },
      exampleProperties: {
        ticker: "NVDA",
        sector: "Technology",
        market_cap: 1200000000000,
      },
    },
    {
      name: "MarketEvent",
      description: "A significant market event or news",
      propertiesSchema: {
        type: "object",
        required: ["occurred_at"],
        properties: {
          occurred_at: {
            type: "string",
            format: "date-time",
            description: "When the event occurred",
          },
          impact: { type: "string", enum: ["positive", "negative", "neutral"] },
          summary: {
            type: "string",
            description: "Brief summary of the event",
          },
        },
      },
      exampleProperties: {
        occurred_at: "2024-01-15T10:30:00Z",
        impact: "positive",
        summary: "NVDA announces record Q4 earnings",
      },
    },
    {
      name: "Analyst",
      description: "A financial analyst or research firm",
      propertiesSchema: {
        type: "object",
        properties: {
          firm: { type: "string", description: "Name of the research firm" },
          specialty: { type: "string", description: "Area of expertise" },
        },
      },
      exampleProperties: {
        firm: "Goldman Sachs",
        specialty: "Technology",
      },
    },
  ],
  edgeTypes: [
    {
      name: "affects",
      description: "Indicates that one agent affects another",
      propertiesSchema: {
        type: "object",
        properties: {
          strength: { type: "number", minimum: 0, maximum: 1 },
        },
      },
      exampleProperties: {
        strength: 0.8,
      },
    },
    {
      name: "covers",
      description: "Indicates that an analyst covers a company",
    },
    {
      name: "competes_with",
      description: "Indicates competition between companies",
    },
  ],
};

beforeAll(async () => {
  // Enable mock LLM mode for testing
  process.env.MOCK_LLM = "true";

  // Create test user
  const [user] = await db
    .insert(users)
    .values({
      email: `graph-type-init-test-${Date.now()}@example.com`,
      name: "Graph Type Init Test User",
    })
    .returning();
  testUserId = user.id;
});

afterAll(async () => {
  // Cleanup: delete test user (cascades to agents, types, etc.)
  await db.delete(users).where(eq(users.id, testUserId));
  delete process.env.MOCK_LLM;
});

// ============================================================================
// initializeTypesForAgent Tests
// ============================================================================

describe("initializeTypesForAgent", () => {
  test("returns valid node and edge type definitions", async () => {
    // Mock the LLM to return our test schema
    const mockGenerateLLMObject = vi
      .spyOn(llm, "generateLLMObject")
      .mockResolvedValueOnce(mockTypeInitializationResult);

    const result = await initializeTypesForAgent({
      name: "Test Team",
      purpose: "Financial research and analysis",
    });

    expect(result).toBeDefined();
    expect(result.nodeTypes).toBeInstanceOf(Array);
    expect(result.edgeTypes).toBeInstanceOf(Array);
    expect(result.nodeTypes.length).toBeGreaterThan(0);
    expect(result.edgeTypes.length).toBeGreaterThan(0);

    mockGenerateLLMObject.mockRestore();
  });

  test("generated node types have correct structure", async () => {
    const mockGenerateLLMObject = vi
      .spyOn(llm, "generateLLMObject")
      .mockResolvedValueOnce(mockTypeInitializationResult);

    const result = await initializeTypesForAgent({
      name: "Test Team",
      purpose: "Financial research",
    });

    for (const nodeType of result.nodeTypes) {
      // Check required fields
      expect(nodeType.name).toBeDefined();
      expect(typeof nodeType.name).toBe("string");
      expect(nodeType.description).toBeDefined();
      expect(typeof nodeType.description).toBe("string");
      expect(nodeType.propertiesSchema).toBeDefined();
      expect(nodeType.propertiesSchema.type).toBe("object");
      expect(nodeType.propertiesSchema.properties).toBeDefined();
      expect(nodeType.exampleProperties).toBeDefined();
    }

    mockGenerateLLMObject.mockRestore();
  });

  test("generated node types use PascalCase naming", async () => {
    const mockGenerateLLMObject = vi
      .spyOn(llm, "generateLLMObject")
      .mockResolvedValueOnce(mockTypeInitializationResult);

    const result = await initializeTypesForAgent({
      name: "Test Team",
      purpose: "Financial research",
    });

    for (const nodeType of result.nodeTypes) {
      // PascalCase: starts with uppercase, no underscores
      expect(nodeType.name[0]).toBe(nodeType.name[0].toUpperCase());
      expect(nodeType.name).not.toContain("_");
    }

    mockGenerateLLMObject.mockRestore();
  });

  test("generated edge types use snake_case naming", async () => {
    const mockGenerateLLMObject = vi
      .spyOn(llm, "generateLLMObject")
      .mockResolvedValueOnce(mockTypeInitializationResult);

    const result = await initializeTypesForAgent({
      name: "Test Team",
      purpose: "Financial research",
    });

    for (const edgeType of result.edgeTypes) {
      // snake_case: lowercase, may contain underscores
      expect(edgeType.name).toBe(edgeType.name.toLowerCase());
    }

    mockGenerateLLMObject.mockRestore();
  });

  test("generated types include exampleProperties", async () => {
    const mockGenerateLLMObject = vi
      .spyOn(llm, "generateLLMObject")
      .mockResolvedValueOnce(mockTypeInitializationResult);

    const result = await initializeTypesForAgent({
      name: "Test Team",
      purpose: "Financial research",
    });

    // All node types should have exampleProperties
    for (const nodeType of result.nodeTypes) {
      expect(nodeType.exampleProperties).toBeDefined();
      expect(typeof nodeType.exampleProperties).toBe("object");
    }

    mockGenerateLLMObject.mockRestore();
  });

  test("passes userId for API key lookup", async () => {
    const mockGenerateLLMObject = vi
      .spyOn(llm, "generateLLMObject")
      .mockResolvedValueOnce(mockTypeInitializationResult);

    await initializeTypesForAgent(
      { name: "Test", purpose: "Testing" },
      { userId: testUserId },
    );

    // Verify the call was made with the userId in options
    expect(mockGenerateLLMObject).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Object),
      expect.any(String),
      expect.objectContaining({ userId: testUserId }),
    );

    mockGenerateLLMObject.mockRestore();
  });

  test("handles null purpose gracefully", async () => {
    const mockGenerateLLMObject = vi
      .spyOn(llm, "generateLLMObject")
      .mockResolvedValueOnce(mockTypeInitializationResult);

    const result = await initializeTypesForAgent({
      name: "Test Team",
      purpose: null,
    });

    expect(result).toBeDefined();
    expect(result.nodeTypes.length).toBeGreaterThan(0);

    mockGenerateLLMObject.mockRestore();
  });
});

// ============================================================================
// persistInitializedTypes Tests
// ============================================================================

describe("persistInitializedTypes", () => {
  test("persists all node types to database", async () => {
    // Create a new agent for this test to avoid conflicts
    const [testAgent] = await db
      .insert(agents)
      .values({
        userId: testUserId,
        name: "Persist Test Agent",
        purpose: "Testing persistence",
        conversationSystemPrompt:
          "You are a test agent for persistence testing.",
        observerSystemPrompt: "You observe and classify information for testing.",
        analysisGenerationSystemPrompt: "You generate analyses for testing.",
        adviceGenerationSystemPrompt: 'You generate advice for testing.',
        graphConstructionSystemPrompt: "You construct graphs for testing.",
        iterationIntervalMs: 300000,
        isActive: true,
      })
      .returning();

    try {
      await persistInitializedTypes(testAgent.id, mockTypeInitializationResult);

      const nodeTypes = await getNodeTypesByAgent(testAgent.id);

      // Should have persisted all node types + 2 seed types (AgentAnalysis + AgentAdvice)
      expect(nodeTypes.length).toBe(
        mockTypeInitializationResult.nodeTypes.length + 2,
      );

      // Verify each node type was persisted correctly
      for (const expectedType of mockTypeInitializationResult.nodeTypes) {
        const found = nodeTypes.find((nt) => nt.name === expectedType.name);
        expect(found).toBeDefined();
        expect(found!.description).toBe(expectedType.description);
        expect(found!.agentId).toBe(testAgent.id);
        expect(found!.createdBy).toBe("system");
      }
    } finally {
      // Cleanup
      await db.delete(agents).where(eq(agents.id, testAgent.id));
    }
  });

  test("persists all edge types to database", async () => {
    // Create a new agent for this test
    const [testAgent] = await db
      .insert(agents)
      .values({
        userId: testUserId,
        name: "Edge Persist Test Agent",
        purpose: "Testing edge persistence",
        conversationSystemPrompt:
          "You are a test agent for edge persistence testing.",
        observerSystemPrompt: "You observe and classify information for testing.",
        analysisGenerationSystemPrompt: "You generate analyses for testing.",
        adviceGenerationSystemPrompt: 'You generate advice for testing.',
        graphConstructionSystemPrompt: "You construct graphs for testing.",
        iterationIntervalMs: 300000,
        isActive: true,
      })
      .returning();

    try {
      await persistInitializedTypes(testAgent.id, mockTypeInitializationResult);

      const edgeTypes = await getEdgeTypesByAgent(testAgent.id);

      // Should have persisted all LLM edge types + seed edge types
      expect(edgeTypes.length).toBe(
        mockTypeInitializationResult.edgeTypes.length + SEED_EDGE_TYPES.length,
      );

      // Verify each edge type was persisted correctly
      for (const expectedType of mockTypeInitializationResult.edgeTypes) {
        const found = edgeTypes.find((et) => et.name === expectedType.name);
        expect(found).toBeDefined();
        expect(found!.description).toBe(expectedType.description);
        expect(found!.agentId).toBe(testAgent.id);
        expect(found!.createdBy).toBe("system");
      }
    } finally {
      // Cleanup
      await db.delete(agents).where(eq(agents.id, testAgent.id));
    }
  });

  test("handles empty types gracefully", async () => {
    // Create a new agent for this test
    const [testAgent] = await db
      .insert(agents)
      .values({
        userId: testUserId,
        name: "Empty Types Test Agent",
        purpose: "Testing empty types",
        conversationSystemPrompt:
          "You are a test agent for empty types testing.",
        observerSystemPrompt: "You observe and classify information for testing.",
        analysisGenerationSystemPrompt: "You generate analyses for testing.",
        adviceGenerationSystemPrompt: 'You generate advice for testing.',
        graphConstructionSystemPrompt: "You construct graphs for testing.",
        iterationIntervalMs: 300000,
        isActive: true,
      })
      .returning();

    try {
      await persistInitializedTypes(testAgent.id, {
        nodeTypes: [],
        edgeTypes: [],
      });

      const nodeTypes = await getNodeTypesByAgent(testAgent.id);
      const edgeTypes = await getEdgeTypesByAgent(testAgent.id);

      // Seed node types (AgentAnalysis and AgentAdvice) are always created, even with empty LLM types
      expect(nodeTypes.length).toBe(2);
      const nodeTypeNames = nodeTypes.map(t => t.name).sort();
      expect(nodeTypeNames).toEqual(["AgentAdvice", "AgentAnalysis"]);
      expect(edgeTypes.length).toBe(SEED_EDGE_TYPES.length);
      const edgeTypeNames = edgeTypes.map((t) => t.name).sort();
      expect(edgeTypeNames).toEqual(
        [...SEED_EDGE_TYPES.map((t) => t.name)].sort(),
      );
    } finally {
      // Cleanup
      await db.delete(agents).where(eq(agents.id, testAgent.id));
    }
  });

  test("skips duplicate LLM edge types when seed edge already exists", async () => {
    const [testAgent] = await db
      .insert(agents)
      .values({
        userId: testUserId,
        name: "Seed Edge Duplicate Test Agent",
        purpose: "Testing duplicate seed edge handling",
        conversationSystemPrompt:
          "You are a test agent for duplicate seed edge handling.",
        observerSystemPrompt: "You observe and classify information for testing.",
        analysisGenerationSystemPrompt: "You generate analyses for testing.",
        adviceGenerationSystemPrompt: "You generate advice for testing.",
        graphConstructionSystemPrompt: "You construct graphs for testing.",
        iterationIntervalMs: 300000,
        isActive: true,
      })
      .returning();

    try {
      const typesWithSeedDuplicate: TypeInitializationResult = {
        nodeTypes: [],
        edgeTypes: [
          {
            name: "derived_from",
            description: "Duplicate of seeded edge",
          },
        ],
      };

      await persistInitializedTypes(testAgent.id, typesWithSeedDuplicate);

      const edgeTypes = await getEdgeTypesByAgent(testAgent.id);
      expect(edgeTypes.length).toBe(SEED_EDGE_TYPES.length);

      const derivedFromEdges = edgeTypes.filter((t) => t.name === "derived_from");
      expect(derivedFromEdges).toHaveLength(1);
    } finally {
      await db.delete(agents).where(eq(agents.id, testAgent.id));
    }
  });

});

// ============================================================================
// Integration Tests
// ============================================================================

describe("Integration", () => {
  test("full initialization flow works end-to-end", async () => {
    const mockGenerateLLMObject = vi
      .spyOn(llm, "generateLLMObject")
      .mockResolvedValueOnce(mockTypeInitializationResult);

    // Create a new agent for this test
    const [testAgent] = await db
      .insert(agents)
      .values({
        userId: testUserId,
        name: "E2E Test Aide",
        purpose: "End-to-end type initialization testing",
        conversationSystemPrompt: "You are a test agent for E2E testing.",
        observerSystemPrompt: "You observe and classify information for testing.",
        analysisGenerationSystemPrompt: "You generate analyses for testing.",
        adviceGenerationSystemPrompt: 'You generate advice for testing.',
        graphConstructionSystemPrompt: "You construct graphs for testing.",
        iterationIntervalMs: 300000,
        isActive: true,
      })
      .returning();

    try {
      // Initialize types
      const types = await initializeTypesForAgent({
        name: testAgent.name,
        purpose: testAgent.purpose,
      });

      // Persist types
      await persistInitializedTypes(testAgent.id, types);

      // Verify types are in database
      const nodeTypes = await getNodeTypesByAgent(testAgent.id);
      const edgeTypes = await getEdgeTypesByAgent(testAgent.id);

      // +2 for the seed types (AgentAnalysis + AgentAdvice)
      expect(nodeTypes.length).toBe(
        mockTypeInitializationResult.nodeTypes.length + 2,
      );
      expect(edgeTypes.length).toBe(
        mockTypeInitializationResult.edgeTypes.length + SEED_EDGE_TYPES.length,
      );

      // Verify node types have correct properties
      const companyNode = nodeTypes.find((nt) => nt.name === "Company");
      expect(companyNode).toBeDefined();
      expect(companyNode!.propertiesSchema).toEqual(
        mockTypeInitializationResult.nodeTypes[0].propertiesSchema,
      );

      // Verify edge types exist
      const affectsEdge = edgeTypes.find((et) => et.name === "affects");
      expect(affectsEdge).toBeDefined();
      expect(affectsEdge!.description).toBe("Indicates that one agent affects another");
    } finally {
      mockGenerateLLMObject.mockRestore();
      // Cleanup
      await db.delete(agents).where(eq(agents.id, testAgent.id));
    }
  });
});
