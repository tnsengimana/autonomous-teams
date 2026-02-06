import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { db } from "@/lib/db/client";
import { agents, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import * as llmProviders from "@/lib/llm/providers";
import * as dbQueries from "@/lib/db/queries";
import * as toolRegistry from "../tools";
import * as graphTools from "../tools/graph-tools";
import {
  AGENT_ADVICE_NODE_TYPE,
  AGENT_ANALYSIS_NODE_TYPE,
  SEED_EDGE_TYPES,
  createDynamicTypes,
  createSeedTypes,
  generateSystemPrompts,
} from "../agent-initialization";
import {
  getEdgeTypesByAgent,
  getNodeTypesByAgent,
} from "@/lib/db/queries/graph-types";
import type { Tool } from "../tools";

function makeTool(name: string): Tool {
  return {
    schema: {
      name,
      description: `${name} tool`,
      parameters: [],
    },
    handler: vi.fn().mockResolvedValue({ success: true, data: {} }),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

let integrationTestUserId: string;
let previousMockLlmEnv: string | undefined;

async function createDbTestAgent(name: string) {
  const [agent] = await db
    .insert(agents)
    .values({
      userId: integrationTestUserId,
      name,
      purpose: "Testing graph type initialization",
      conversationSystemPrompt: "You are a test agent.",
      queryIdentificationSystemPrompt: "You identify queries for testing.",
      insightIdentificationSystemPrompt: "You identify insights for testing.",
      analysisGenerationSystemPrompt: "You generate analyses for testing.",
      adviceGenerationSystemPrompt: "You generate advice for testing.",
      knowledgeAcquisitionSystemPrompt: "You gather knowledge for testing.",
      graphConstructionSystemPrompt: "You construct graphs for testing.",
      iterationIntervalMs: 300_000,
      isActive: true,
    })
    .returning();

  return agent;
}

beforeAll(async () => {
  previousMockLlmEnv = process.env.MOCK_LLM;
  process.env.MOCK_LLM = "true";

  const [user] = await db
    .insert(users)
    .values({
      email: `agent-init-test-${Date.now()}@example.com`,
      name: "Agent Initialization Test User",
    })
    .returning();

  integrationTestUserId = user.id;
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, integrationTestUserId));

  if (previousMockLlmEnv === undefined) {
    delete process.env.MOCK_LLM;
  } else {
    process.env.MOCK_LLM = previousMockLlmEnv;
  }
});

describe("generateAgentConfiguration", () => {
  test("observer meta-prompt enforces UUID-only relevantNodeIds", async () => {
    const mockGenerateLLMObject = vi
      .spyOn(llmProviders, "generateLLMObject")
      .mockResolvedValueOnce({
        name: "Alpha Pulse",
        conversationSystemPrompt: "conversation prompt",
        queryIdentificationSystemPrompt: "query identification prompt",
        insightIdentificationSystemPrompt: "insight identification prompt",
        analysisGenerationSystemPrompt: "analysis prompt",
        adviceGenerationSystemPrompt: "advice prompt",
        knowledgeAcquisitionSystemPrompt: "knowledge acquisition prompt",
        graphConstructionSystemPrompt: "graph construction prompt",
      });

    await generateSystemPrompts(
      "Find short-term investment opportunities",
      60_000,
    );

    expect(mockGenerateLLMObject).toHaveBeenCalledTimes(1);

    const systemPrompt = mockGenerateLLMObject.mock.calls[0][2];
    expect(systemPrompt).toContain(
      "relevantNodeIds MUST contain only UUIDs from the graph context",
    );
    expect(systemPrompt).toContain(
      'Never use node names, labels, or "Type:Name" values in relevantNodeIds',
    );
    expect(systemPrompt).toContain("based_on");
    expect(systemPrompt).toContain(
      "Never overload an existing type with semantically different data just to avoid creating a type",
    );
    expect(systemPrompt).toContain(
      "For quantitative fields, use machine-typed numbers and separate unit/currency fields",
    );
    expect(systemPrompt).toContain(
      'Keep formatted human strings (e.g., "$171.88", "206.31M", "$10.32B vs $8.03B") in optional raw_text only',
    );

    mockGenerateLLMObject.mockRestore();
  });
});

describe("createSeedTypes", () => {
  test("creates all missing seed node and edge types", async () => {
    const agentId = "agent-seed-123";

    const nodeTypeExistsSpy = vi
      .spyOn(dbQueries, "nodeTypeExists")
      .mockResolvedValue(false);
    const createNodeTypeSpy = vi
      .spyOn(dbQueries, "createNodeType")
      .mockResolvedValue({} as Awaited<ReturnType<typeof dbQueries.createNodeType>>);
    const edgeTypeExistsSpy = vi
      .spyOn(dbQueries, "edgeTypeExists")
      .mockResolvedValue(false);
    const createEdgeTypeSpy = vi
      .spyOn(dbQueries, "createEdgeType")
      .mockResolvedValue({} as Awaited<ReturnType<typeof dbQueries.createEdgeType>>);

    await createSeedTypes(agentId);

    expect(nodeTypeExistsSpy).toHaveBeenCalledTimes(2);
    expect(nodeTypeExistsSpy).toHaveBeenNthCalledWith(
      1,
      agentId,
      AGENT_ANALYSIS_NODE_TYPE.name,
    );
    expect(nodeTypeExistsSpy).toHaveBeenNthCalledWith(
      2,
      agentId,
      AGENT_ADVICE_NODE_TYPE.name,
    );

    expect(createNodeTypeSpy).toHaveBeenCalledTimes(2);
    expect(createNodeTypeSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        agentId,
        name: AGENT_ANALYSIS_NODE_TYPE.name,
        createdBy: "system",
      }),
    );
    expect(createNodeTypeSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        agentId,
        name: AGENT_ADVICE_NODE_TYPE.name,
        createdBy: "system",
      }),
    );

    expect(edgeTypeExistsSpy).toHaveBeenCalledTimes(SEED_EDGE_TYPES.length);
    expect(createEdgeTypeSpy).toHaveBeenCalledTimes(SEED_EDGE_TYPES.length);
  });

  test("skips creation when seed types already exist", async () => {
    const agentId = "agent-seed-existing";

    vi.spyOn(dbQueries, "nodeTypeExists").mockResolvedValue(true);
    vi.spyOn(dbQueries, "edgeTypeExists").mockResolvedValue(true);
    const createNodeTypeSpy = vi.spyOn(dbQueries, "createNodeType");
    const createEdgeTypeSpy = vi.spyOn(dbQueries, "createEdgeType");

    await createSeedTypes(agentId);

    expect(createNodeTypeSpy).not.toHaveBeenCalled();
    expect(createEdgeTypeSpy).not.toHaveBeenCalled();
  });

  test("creates baseline node and edge seed types in database", async () => {
    const agent = await createDbTestAgent("Seed Type Init Agent");

    try {
      await createSeedTypes(agent.id);

      const nodeTypes = await getNodeTypesByAgent(agent.id);
      const edgeTypes = await getEdgeTypesByAgent(agent.id);

      expect(nodeTypes).toHaveLength(2);
      expect(
        nodeTypes.some((t) => t.name === AGENT_ANALYSIS_NODE_TYPE.name),
      ).toBe(true);
      expect(nodeTypes.some((t) => t.name === AGENT_ADVICE_NODE_TYPE.name)).toBe(
        true,
      );
      for (const nodeType of nodeTypes) {
        expect(nodeType.createdBy).toBe("system");
      }

      expect(edgeTypes).toHaveLength(SEED_EDGE_TYPES.length);
      expect(edgeTypes.map((t) => t.name).sort()).toEqual(
        [...SEED_EDGE_TYPES.map((t) => t.name)].sort(),
      );
      for (const edgeType of edgeTypes) {
        expect(edgeType.createdBy).toBe("system");
      }
    } finally {
      await db.delete(agents).where(eq(agents.id, agent.id));
    }
  });

  test("is idempotent in database when called multiple times", async () => {
    const agent = await createDbTestAgent("Seed Type Idempotency Agent");

    try {
      await createSeedTypes(agent.id);
      await createSeedTypes(agent.id);

      const nodeTypes = await getNodeTypesByAgent(agent.id);
      const edgeTypes = await getEdgeTypesByAgent(agent.id);

      expect(nodeTypes).toHaveLength(2);
      expect(
        nodeTypes.filter((t) => t.name === AGENT_ANALYSIS_NODE_TYPE.name),
      ).toHaveLength(1);
      expect(
        nodeTypes.filter((t) => t.name === AGENT_ADVICE_NODE_TYPE.name),
      ).toHaveLength(1);

      expect(edgeTypes).toHaveLength(SEED_EDGE_TYPES.length);
      for (const seedEdgeType of SEED_EDGE_TYPES) {
        expect(edgeTypes.filter((t) => t.name === seedEdgeType.name)).toHaveLength(
          1,
        );
      }
    } finally {
      await db.delete(agents).where(eq(agents.id, agent.id));
    }
  });
});

describe("createDynamicTypes", () => {
  test("runs unified dynamic generation with merged schema tools", async () => {
    const agentId = "agent-dynamic-123";
    vi.spyOn(dbQueries, "getAgentById").mockResolvedValue({
      id: agentId,
      userId: "user-123",
      name: "Alpha Pulse",
      purpose: "Track US equities",
    } as Awaited<ReturnType<typeof dbQueries.getAgentById>>);

    const registerGraphToolsSpy = vi
      .spyOn(graphTools, "registerGraphTools")
      .mockImplementation(() => {});

    vi.spyOn(toolRegistry, "getAllTools").mockReturnValue([
      makeTool("listNodeTypes"),
      makeTool("createNodeType"),
      makeTool("listEdgeTypes"),
      makeTool("createEdgeType"),
    ]);

    const streamLLMResponseWithToolsSpy = vi
      .spyOn(llmProviders, "streamLLMResponseWithTools")
      .mockResolvedValue({
        textStream: (async function* () {})(),
        fullResponse: Promise.resolve({
          events: [
            {
              toolCalls: [
                {
                  toolName: "createNodeType",
                  args: { name: "Company" },
                },
                {
                  toolName: "createEdgeType",
                  args: { name: "impacts" },
                },
              ],
            },
          ],
        }),
      });

    await createDynamicTypes(agentId);

    expect(registerGraphToolsSpy).toHaveBeenCalledTimes(1);
    expect(streamLLMResponseWithToolsSpy).toHaveBeenCalledTimes(1);

    const [messages, systemPrompt, options] =
      streamLLMResponseWithToolsSpy.mock.calls[0];

    expect(messages[0].content).toContain("Agent Name: Alpha Pulse");
    expect(messages[0].content).toContain("Agent Mission: Track US equities");
    expect(messages[0].content).toContain(
      "Create missing domain node and edge types only.",
    );
    expect(systemPrompt).toContain("creating BOTH NODE TYPES and EDGE TYPES");
    expect(options).toEqual(
      expect.objectContaining({
        agentId,
        userId: "user-123",
        temperature: 0.4,
        maxSteps: 20,
        toolContext: { agentId },
      }),
    );
    expect(options.tools.map((tool) => tool.schema.name)).toEqual([
      "listNodeTypes",
      "listEdgeTypes",
      "createNodeType",
      "createEdgeType",
    ]);
  });

  test("throws when required tools are missing", async () => {
    const agentId = "agent-dynamic-missing-tools";
    vi.spyOn(dbQueries, "getAgentById").mockResolvedValue({
      id: agentId,
      userId: "user-123",
      name: "Alpha Pulse",
      purpose: "Track US equities",
    } as Awaited<ReturnType<typeof dbQueries.getAgentById>>);

    const registerGraphToolsSpy = vi
      .spyOn(graphTools, "registerGraphTools")
      .mockImplementation(() => {});
    vi.spyOn(toolRegistry, "getAllTools").mockReturnValue([
      makeTool("listNodeTypes"),
    ]);

    const streamLLMResponseWithToolsSpy = vi.spyOn(
      llmProviders,
      "streamLLMResponseWithTools",
    );

    await expect(createDynamicTypes(agentId)).rejects.toThrow(
      /Missing required tools: listEdgeTypes, createNodeType, createEdgeType/,
    );
    expect(registerGraphToolsSpy).toHaveBeenCalledTimes(1);
    expect(streamLLMResponseWithToolsSpy).not.toHaveBeenCalled();
  });

  test("throws for unknown agent id", async () => {
    await expect(createDynamicTypes("00000000-0000-4000-8000-000000000000")).rejects
      .toThrow(/Agent not found/);
  });

  test("runs in mock mode for an existing agent", async () => {
    const agent = await createDbTestAgent("Dynamic Type Mock Agent");

    try {
      await createSeedTypes(agent.id);
      await expect(createDynamicTypes(agent.id)).resolves.toBeUndefined();
    } finally {
      await db.delete(agents).where(eq(agents.id, agent.id));
    }
  });
});
