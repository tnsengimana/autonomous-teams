/**
 * Tests for Graph Type Initializer
 *
 * Tests the LLM-based type initialization system that generates
 * appropriate node and edge types when a new entity is created.
 *
 * Uses MOCK_LLM=true for testing without real API calls.
 */

import { describe, test, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/lib/db/client";
import { users, entities } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import * as llm from "@/lib/llm/providers";
import {
  initializeTypesForEntity,
  persistInitializedTypes,
  type TypeInitializationResult,
} from "../graph-configuration";
import {
  getNodeTypesByEntity,
  getEdgeTypesByEntity,
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
      description: "A business entity or corporation",
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
      description: "Indicates that one entity affects another",
      sourceNodeTypeNames: ["MarketEvent"],
      targetNodeTypeNames: ["Company"],
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
      sourceNodeTypeNames: ["Analyst"],
      targetNodeTypeNames: ["Company"],
    },
    {
      name: "competes_with",
      description: "Indicates competition between companies",
      sourceNodeTypeNames: ["Company"],
      targetNodeTypeNames: ["Company"],
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
  // Cleanup: delete test user (cascades to entities, types, etc.)
  await db.delete(users).where(eq(users.id, testUserId));
  delete process.env.MOCK_LLM;
});

// ============================================================================
// initializeTypesForEntity Tests
// ============================================================================

describe("initializeTypesForEntity", () => {
  test("returns valid node and edge type definitions", async () => {
    // Mock the LLM to return our test schema
    const mockGenerateLLMObject = vi
      .spyOn(llm, "generateLLMObject")
      .mockResolvedValueOnce(mockTypeInitializationResult);

    const result = await initializeTypesForEntity({
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

    const result = await initializeTypesForEntity({
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

    const result = await initializeTypesForEntity({
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

    const result = await initializeTypesForEntity({
      name: "Test Team",
      purpose: "Financial research",
    });

    for (const edgeType of result.edgeTypes) {
      // snake_case: lowercase, may contain underscores
      expect(edgeType.name).toBe(edgeType.name.toLowerCase());
    }

    mockGenerateLLMObject.mockRestore();
  });

  test("generated edge types have valid source and target constraints", async () => {
    const mockGenerateLLMObject = vi
      .spyOn(llm, "generateLLMObject")
      .mockResolvedValueOnce(mockTypeInitializationResult);

    const result = await initializeTypesForEntity({
      name: "Test Team",
      purpose: "Financial research",
    });

    // Collect all node type names
    const nodeTypeNames = new Set(result.nodeTypes.map((nt) => nt.name));

    for (const edgeType of result.edgeTypes) {
      expect(edgeType.sourceNodeTypeNames).toBeInstanceOf(Array);
      expect(edgeType.targetNodeTypeNames).toBeInstanceOf(Array);

      // All source node types should reference valid node types
      for (const sourceName of edgeType.sourceNodeTypeNames) {
        expect(nodeTypeNames.has(sourceName)).toBe(true);
      }

      // All target node types should reference valid node types
      for (const targetName of edgeType.targetNodeTypeNames) {
        expect(nodeTypeNames.has(targetName)).toBe(true);
      }
    }

    mockGenerateLLMObject.mockRestore();
  });

  test("generated types include exampleProperties", async () => {
    const mockGenerateLLMObject = vi
      .spyOn(llm, "generateLLMObject")
      .mockResolvedValueOnce(mockTypeInitializationResult);

    const result = await initializeTypesForEntity({
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

    await initializeTypesForEntity(
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

    const result = await initializeTypesForEntity({
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
    // Create a new entity for this test to avoid conflicts
    const [testEntity] = await db
      .insert(entities)
      .values({
        userId: testUserId,
        name: "Persist Test Entity",
        purpose: "Testing persistence",
        systemPrompt: "You are a test entity for persistence testing.",
        status: "active",
      })
      .returning();

    try {
      await persistInitializedTypes(
        testEntity.id,
        mockTypeInitializationResult,
      );

      const nodeTypes = await getNodeTypesByEntity(testEntity.id);

      // Should have persisted all node types
      expect(nodeTypes.length).toBe(
        mockTypeInitializationResult.nodeTypes.length,
      );

      // Verify each node type was persisted correctly
      for (const expectedType of mockTypeInitializationResult.nodeTypes) {
        const found = nodeTypes.find((nt) => nt.name === expectedType.name);
        expect(found).toBeDefined();
        expect(found!.description).toBe(expectedType.description);
        expect(found!.entityId).toBe(testEntity.id);
        expect(found!.createdBy).toBe("system");
      }
    } finally {
      // Cleanup
      await db.delete(entities).where(eq(entities.id, testEntity.id));
    }
  });

  test("persists all edge types to database", async () => {
    // Create a new entity for this test
    const [testEntity] = await db
      .insert(entities)
      .values({
        userId: testUserId,
        name: "Edge Persist Test Entity",
        purpose: "Testing edge persistence",
        systemPrompt: "You are a test entity for edge persistence testing.",
        status: "active",
      })
      .returning();

    try {
      await persistInitializedTypes(
        testEntity.id,
        mockTypeInitializationResult,
      );

      const edgeTypes = await getEdgeTypesByEntity(testEntity.id);

      // Should have persisted all edge types
      expect(edgeTypes.length).toBe(
        mockTypeInitializationResult.edgeTypes.length,
      );

      // Verify each edge type was persisted correctly
      for (const expectedType of mockTypeInitializationResult.edgeTypes) {
        const found = edgeTypes.find((et) => et.name === expectedType.name);
        expect(found).toBeDefined();
        expect(found!.description).toBe(expectedType.description);
        expect(found!.entityId).toBe(testEntity.id);
        expect(found!.createdBy).toBe("system");
      }
    } finally {
      // Cleanup
      await db.delete(entities).where(eq(entities.id, testEntity.id));
    }
  });

  test("persists edge type source/target constraints", async () => {
    // Create a new entity for this test
    const [testEntity] = await db
      .insert(entities)
      .values({
        userId: testUserId,
        name: "Constraint Persist Test Entity",
        purpose: "Testing constraint persistence",
        systemPrompt:
          "You are a test entity for constraint persistence testing.",
        status: "active",
      })
      .returning();

    try {
      await persistInitializedTypes(
        testEntity.id,
        mockTypeInitializationResult,
      );

      const edgeTypes = await getEdgeTypesByEntity(testEntity.id);

      // Find the 'affects' edge type
      const affectsEdge = edgeTypes.find((et) => et.name === "affects");
      expect(affectsEdge).toBeDefined();

      // Should have source and target constraints populated
      expect(affectsEdge!.sourceNodeTypes).toBeInstanceOf(Array);
      expect(affectsEdge!.targetNodeTypes).toBeInstanceOf(Array);
      expect(affectsEdge!.sourceNodeTypes.length).toBeGreaterThan(0);
      expect(affectsEdge!.targetNodeTypes.length).toBeGreaterThan(0);

      // Verify specific constraints
      const sourceNames = affectsEdge!.sourceNodeTypes.map((nt) => nt.name);
      const targetNames = affectsEdge!.targetNodeTypes.map((nt) => nt.name);
      expect(sourceNames).toContain("MarketEvent");
      expect(targetNames).toContain("Company");
    } finally {
      // Cleanup
      await db.delete(entities).where(eq(entities.id, testEntity.id));
    }
  });

  test("handles empty types gracefully", async () => {
    // Create a new entity for this test
    const [testEntity] = await db
      .insert(entities)
      .values({
        userId: testUserId,
        name: "Empty Types Test Entity",
        purpose: "Testing empty types",
        systemPrompt: "You are a test entity for empty types testing.",
        status: "active",
      })
      .returning();

    try {
      await persistInitializedTypes(testEntity.id, {
        nodeTypes: [],
        edgeTypes: [],
      });

      const nodeTypes = await getNodeTypesByEntity(testEntity.id);
      const edgeTypes = await getEdgeTypesByEntity(testEntity.id);

      expect(nodeTypes.length).toBe(0);
      expect(edgeTypes.length).toBe(0);
    } finally {
      // Cleanup
      await db.delete(entities).where(eq(entities.id, testEntity.id));
    }
  });

  test("logs warning for invalid node type references in edge types", async () => {
    // Create a new entity for this test
    const [testEntity] = await db
      .insert(entities)
      .values({
        userId: testUserId,
        name: "Invalid Ref Test Entity",
        purpose: "Testing invalid references",
        systemPrompt: "You are a test entity for invalid reference testing.",
        status: "active",
      })
      .returning();

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const typesWithInvalidRefs: TypeInitializationResult = {
        nodeTypes: [
          {
            name: "ValidNode",
            description: "A valid node type",
            propertiesSchema: { type: "object", properties: {} },
            exampleProperties: {},
          },
        ],
        edgeTypes: [
          {
            name: "invalid_edge",
            description: "Edge with invalid references",
            sourceNodeTypeNames: ["NonExistentNode"],
            targetNodeTypeNames: ["ValidNode"],
          },
        ],
      };

      await persistInitializedTypes(testEntity.id, typesWithInvalidRefs);

      // Should have logged a warning about the invalid reference
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Source node type "NonExistentNode" not found'),
      );
    } finally {
      consoleSpy.mockRestore();
      // Cleanup
      await db.delete(entities).where(eq(entities.id, testEntity.id));
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

    // Create a new entity for this test
    const [testEntity] = await db
      .insert(entities)
      .values({
        userId: testUserId,
        name: "E2E Test Aide",
        purpose: "End-to-end type initialization testing",
        systemPrompt: "You are a test entity for E2E testing.",
        status: "active",
      })
      .returning();

    try {
      // Initialize types
      const types = await initializeTypesForEntity({
        name: testEntity.name,
        purpose: testEntity.purpose,
      });

      // Persist types
      await persistInitializedTypes(testEntity.id, types);

      // Verify types are in database
      const nodeTypes = await getNodeTypesByEntity(testEntity.id);
      const edgeTypes = await getEdgeTypesByEntity(testEntity.id);

      expect(nodeTypes.length).toBe(
        mockTypeInitializationResult.nodeTypes.length,
      );
      expect(edgeTypes.length).toBe(
        mockTypeInitializationResult.edgeTypes.length,
      );

      // Verify node types have correct properties
      const companyNode = nodeTypes.find((nt) => nt.name === "Company");
      expect(companyNode).toBeDefined();
      expect(companyNode!.propertiesSchema).toEqual(
        mockTypeInitializationResult.nodeTypes[0].propertiesSchema,
      );

      // Verify edge types have constraints
      const affectsEdge = edgeTypes.find((et) => et.name === "affects");
      expect(affectsEdge).toBeDefined();
      expect(affectsEdge!.sourceNodeTypes.length).toBeGreaterThan(0);
    } finally {
      mockGenerateLLMObject.mockRestore();
      // Cleanup
      await db.delete(entities).where(eq(entities.id, testEntity.id));
    }
  });
});
