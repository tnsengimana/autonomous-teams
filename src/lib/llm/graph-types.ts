/**
 * Graph Types
 *
 * Uses LLM to generate appropriate base node and edge types
 * when a new agent is created, based on the agent's purpose.
 */

import { z } from "zod";
import { generateLLMObject, type StreamOptions } from "./providers";
import {
  createNodeType,
  createEdgeType,
  getNodeTypeByName,
  nodeTypeExists,
} from "@/lib/db/queries/graph-types";

// ============================================================================
// Hardcoded Seed Types
// ============================================================================

export const AGENT_ANALYSIS_NODE_TYPE = {
  name: "AgentAnalysis",
  description: "Agent-derived observations and patterns from knowledge analysis",
  propertiesSchema: {
    type: "object" as const,
    required: ["type", "summary", "content", "generated_at"],
    properties: {
      type: {
        type: "string",
        enum: ["observation", "pattern"],
        description:
          "observation=notable trend or development, pattern=recurring behavior or relationship",
      },
      summary: {
        type: "string",
        description: "Brief 1-2 sentence summary of the analysis",
      },
      content: {
        type: "string",
        description:
          "Detailed analysis with [node:uuid] or [edge:uuid] citations",
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "Confidence level (0=low, 1=high)",
      },
      generated_at: {
        type: "string",
        format: "date-time",
        description: "When this analysis was derived",
      },
    },
  },
  exampleProperties: {
    type: "observation",
    summary:
      "Apple's services revenue growth is outpacing hardware sales.",
    content: `## Analysis

Apple's services segment continues to demonstrate accelerating growth compared to its hardware divisions.

### Supporting Evidence
- Q4 earnings report [node:abc-123] showed services revenue grew 24% YoY
- Hardware revenue [node:def-456] grew only 3% in the same period
- Services margins [node:ghi-789] reached 71%, significantly above hardware margins

### Implications
This shift suggests Apple is successfully transitioning toward a higher-margin business model, which could impact long-term valuation multiples.`,
    confidence: 0.85,
    generated_at: "2025-01-15T10:30:00Z",
  },
} as const;

export const AGENT_ADVICE_NODE_TYPE = {
  name: "AgentAdvice",
  description: "Actionable investment recommendation derived exclusively from AgentAnalysis analysis",
  propertiesSchema: {
    type: "object" as const,
    required: ["action", "summary", "content", "generated_at"],
    properties: {
      action: {
        type: "string",
        enum: ["BUY", "SELL", "HOLD"],
        description: "The recommended action",
      },
      summary: {
        type: "string",
        description: "Executive summary of the recommendation (1-2 sentences)",
      },
      content: {
        type: "string",
        description:
          "Detailed reasoning citing ONLY AgentAnalysis nodes using [node:uuid] format. Other node types are prohibited.",
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "Confidence level (0=low, 1=high)",
      },
      generated_at: {
        type: "string",
        format: "date-time",
        description: "When this advice was generated",
      },
    },
  },
  exampleProperties: {
    action: "BUY",
    summary:
      "Strong buy signal for AAPL based on services growth momentum and undervaluation.",
    content: `## Recommendation: BUY

Based on recent analysis, AAPL presents a compelling buying opportunity.

### Supporting AgentAnalyses
- [node:analysis-123] Services revenue pattern shows accelerating growth trajectory
- [node:analysis-456] Institutional accumulation observation indicates smart money confidence

### Risk Factors
- China revenue exposure remains elevated
- Hardware cycle timing uncertainty

### Why Now
The convergence of strong services momentum and technical oversold conditions creates an asymmetric risk/reward setup that may not persist beyond the next earnings cycle.`,
    confidence: 0.78,
    generated_at: "2025-01-15T14:00:00Z",
  },
} as const;

// ============================================================================
// Schemas for LLM-generated type definitions
// ============================================================================

const NodeTypeDefinitionSchema = z.object({
  name: z.string().describe("PascalCase type name"),
  description: z.string().describe("What this type represents"),
  propertiesSchema: z.object({
    type: z.literal("object"),
    required: z.array(z.string()).optional(),
    properties: z.record(z.string(), z.unknown()),
  }),
  exampleProperties: z.record(z.string(), z.unknown()),
});

const EdgeTypeDefinitionSchema = z.object({
  name: z.string().describe("snake_case edge type name"),
  description: z.string().describe("What this relationship represents"),
  sourceNodeTypeNames: z
    .array(z.string())
    .describe("Names of node types allowed as source"),
  targetNodeTypeNames: z
    .array(z.string())
    .describe("Names of node types allowed as target"),
  propertiesSchema: z
    .object({
      type: z.literal("object"),
      properties: z.record(z.string(), z.unknown()),
    })
    .optional(),
  exampleProperties: z.record(z.string(), z.unknown()).optional(),
});

const TypeInitializationResultSchema = z.object({
  nodeTypes: z.array(NodeTypeDefinitionSchema),
  edgeTypes: z.array(EdgeTypeDefinitionSchema),
});

export type NodeTypeDefinition = z.infer<typeof NodeTypeDefinitionSchema>;
export type EdgeTypeDefinition = z.infer<typeof EdgeTypeDefinitionSchema>;
export type TypeInitializationResult = z.infer<
  typeof TypeInitializationResultSchema
>;

// ============================================================================
// Type Initialization Prompt
// ============================================================================

const TYPE_INITIALIZATION_SYSTEM_PROMPT = `You are a knowledge graph schema designer. Given an agent's purpose, design appropriate node types and edge types for its knowledge graph.

## Context
The agent runs autonomously on behalf of a single user, researching and learning over time. The knowledge graph stores external knowledge the agent discovers; never user data. User preferences and profile information are handled separately outside the graph.

## Naming Conventions
- Node types: PascalCase (e.g., "Company", "ResearchPaper", "MarketEvent")
- Edge types: snake_case (e.g., "published_by", "relates_to", "occurred_at")

## Schema Requirements
- Design 5-10 node types and 5-10 edge types covering key domain concepts
- Each node type needs: name, description, propertiesSchema (JSON Schema), exampleProperties
- Each edge type needs: name, description, sourceNodeTypeNames, targetNodeTypeNames, and optionally propertiesSchema/exampleProperties

## Property Guidelines
- Include a "source_url" property on types where provenance matters (articles, data points, claims)
- Include temporal properties where appropriate: discovered_at, published_at, occurred_at, updated_at
- Include "summary" or "description" fields for human-readable context
- Use specific property types: numbers for quantities, dates for timestamps, arrays for lists

## What to Include
- Domain entities the agent will research (companies, people, technologies, etc.)
- Information artifacts (articles, reports, announcements, data points)
- Events and changes over time (market events, releases, milestones)
- Concepts and topics relevant to the domain

## What to Avoid
- User-centric types (User, Portfolio, Preference, Account, Watchlist)
- Overly abstract types (Thing, Concept, Item, Object)
- Types that duplicate what properties can capture

## propertiesSchema Format
Valid JSON Schema object with:
- type: "object"
- properties: object mapping property names to schemas (e.g., { "name": { "type": "string" } })
- required: optional array of required property names`;

// ============================================================================
// Seed Type Initialization
// ============================================================================

/**
 * Create the standardized seed node types that all agents share.
 * Currently includes:
 * - AgentAnalysis: Derived observations and patterns from knowledge analysis
 * - AgentAdvice: Actionable recommendations derived from AgentAnalysis analysis
 *
 * This function is idempotent - it checks if types exist before creating them.
 */
export async function createSeedNodeTypes(agentId: string): Promise<void> {
  // Check if AgentAnalysis type already exists for this agent
  const analysisExists = await nodeTypeExists(agentId, AGENT_ANALYSIS_NODE_TYPE.name);

  if (!analysisExists) {
    await createNodeType({
      agentId: agentId,
      name: AGENT_ANALYSIS_NODE_TYPE.name,
      description: AGENT_ANALYSIS_NODE_TYPE.description,
      propertiesSchema: AGENT_ANALYSIS_NODE_TYPE.propertiesSchema,
      exampleProperties: AGENT_ANALYSIS_NODE_TYPE.exampleProperties,
      createdBy: "system",
    });

    console.log(
      `[GraphTypeInitializer] Created seed AgentAnalysis node type for agent ${agentId}`,
    );
  }

  // Check if AgentAdvice type already exists for this agent
  const adviceExists = await nodeTypeExists(agentId, AGENT_ADVICE_NODE_TYPE.name);

  if (!adviceExists) {
    await createNodeType({
      agentId: agentId,
      name: AGENT_ADVICE_NODE_TYPE.name,
      description: AGENT_ADVICE_NODE_TYPE.description,
      propertiesSchema: AGENT_ADVICE_NODE_TYPE.propertiesSchema,
      exampleProperties: AGENT_ADVICE_NODE_TYPE.exampleProperties,
      createdBy: "system",
    });

    console.log(
      `[GraphTypeInitializer] Created seed AgentAdvice node type for agent ${agentId}`,
    );
  }
}

// ============================================================================
// Type Initialization Functions
// ============================================================================

/**
 * Initialize types for an agent using LLM to generate appropriate node and edge types.
 * This analyzes the agent's purpose and generates domain-specific types.
 */
export async function initializeTypesForAgent(
  agent: { name: string; purpose: string | null },
  options?: { userId?: string },
): Promise<TypeInitializationResult> {
  const purposeDescription = agent.purpose || "General purpose assistant";

  const messages = [
    {
      role: "user" as const,
      content: `Design a knowledge graph schema for the following agent:

Agent Name: ${agent.name}
Agent Purpose: ${purposeDescription}

Create node types and edge types that capture the external knowledge this agent will discover while fulfilling its mission.`,
    },
  ];

  const llmOptions: StreamOptions = {
    temperature: 0.7, // Allow some creativity in schema design
  };

  if (options?.userId) {
    llmOptions.userId = options.userId;
  }

  const result = await generateLLMObject(
    messages,
    TypeInitializationResultSchema,
    TYPE_INITIALIZATION_SYSTEM_PROMPT,
    llmOptions,
  );

  return result;
}

/**
 * Persist initialized types to the database.
 * Creates seed types first, then LLM-generated node types, then edge types with their constraints.
 */
export async function persistInitializedTypes(
  agentId: string,
  types: TypeInitializationResult,
): Promise<void> {
  // First, create seed node types (AgentAnalysis, AgentAdvice)
  await createSeedNodeTypes(agentId);

  // Then, create all LLM-generated node types
  for (const nodeType of types.nodeTypes) {
    // Skip if this is a seed type (already created)
    if (nodeType.name === AGENT_ANALYSIS_NODE_TYPE.name || nodeType.name === AGENT_ADVICE_NODE_TYPE.name) {
      console.log(
        `[GraphTypeInitializer] Skipping LLM-generated ${nodeType.name} type (using seed type instead)`,
      );
      continue;
    }

    await createNodeType({
      agentId: agentId,
      name: nodeType.name,
      description: nodeType.description,
      propertiesSchema: nodeType.propertiesSchema,
      exampleProperties: nodeType.exampleProperties,
      createdBy: "system",
    });
  }

  // Then, create edge types with references to node types
  for (const edgeType of types.edgeTypes) {
    // Validate that all referenced node types exist
    const validSourceNames: string[] = [];
    for (const sourceName of edgeType.sourceNodeTypeNames) {
      const nodeType = await getNodeTypeByName(agentId, sourceName);
      if (nodeType) {
        validSourceNames.push(sourceName);
      } else {
        console.warn(
          `[GraphTypeInitializer] Source node type "${sourceName}" not found for edge type "${edgeType.name}"`,
        );
      }
    }

    const validTargetNames: string[] = [];
    for (const targetName of edgeType.targetNodeTypeNames) {
      const nodeType = await getNodeTypeByName(agentId, targetName);
      if (nodeType) {
        validTargetNames.push(targetName);
      } else {
        console.warn(
          `[GraphTypeInitializer] Target node type "${targetName}" not found for edge type "${edgeType.name}"`,
        );
      }
    }

    await createEdgeType({
      agentId: agentId,
      name: edgeType.name,
      description: edgeType.description,
      sourceNodeTypeNames: validSourceNames,
      targetNodeTypeNames: validTargetNames,
      propertiesSchema: edgeType.propertiesSchema,
      exampleProperties: edgeType.exampleProperties,
      createdBy: "system",
    });
  }

  console.log(
    `[GraphTypeInitializer] Initialized ${types.nodeTypes.length} node types and ${types.edgeTypes.length} edge types for agent ${agentId}`,
  );
}

/**
 * Initialize and persist types for an agent in one call.
 * This is the main entry point for agent creation.
 */
export async function initializeAndPersistTypesForAgent(
  agentId: string,
  agent: { name: string; purpose: string | null },
  options?: { userId?: string },
): Promise<void> {
  const types = await initializeTypesForAgent(agent, options);
  await persistInitializedTypes(agentId, types);
}
