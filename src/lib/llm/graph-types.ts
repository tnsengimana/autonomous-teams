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

/**
 * The standardized Insight node type that all entities share.
 * This type is used for derived analysis including signals, observations, and patterns.
 * Creating an Insight node always notifies the user via inbox item.
 */
export const INSIGHT_NODE_TYPE = {
  name: "Insight",
  description: "Derived analysis including signals, observations, and patterns",
  propertiesSchema: {
    type: "object" as const,
    required: ["type", "summary", "content", "generated_at"],
    properties: {
      type: {
        type: "string",
        enum: ["signal", "observation", "pattern"],
        description:
          "signal=actionable, observation=notable trend, pattern=recurring behavior",
      },
      summary: {
        type: "string",
        description:
          "Executive summary of the insight (1-2 sentences). Used for inbox notifications. For signals, briefly mention the recommended action.",
      },
      content: {
        type: "string",
        description:
          "Detailed insight with supporting evidence and citations to graph nodes/edges. Include [node:nodeUUId] or [edge:nodeUUId] annotations for traceability. For signals, include detailed action rationale.",
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
        description: "When this insight was derived",
      },
    },
  },
  exampleProperties: {
    type: "signal",
    summary:
      "Strong buy signal for AAPL: oversold technicals combined with positive earnings momentum suggest 22% upside potential.",
    content: `## Analysis

AAPL presents a compelling buying opportunity based on multiple converging factors.

### Technical Analysis
The stock is currently oversold with an RSI of 28 [node:abc123], significantly below the typical oversold threshold of 30. Historical analysis of Apple [node:def456] shows that RSI levels below 30 have preceded 15%+ rallies in 7 of the last 10 occurrences.

### Fundamental Catalyst
The Q4 2025 earnings report [node:ghi789] delivered a positive surprise of 12%, with:
- Revenue: $124.3B vs. $121.1B expected
- EPS: $2.18 vs. $1.95 expected
- Services revenue grew 24% YoY [node:jkl012]

### Macro Tailwinds
The Federal Reserve's decision to hold rates [node:mno345] provides sector-wide support for growth stocks. The Technology sector [node:pqr678] has historically outperformed during rate pause periods by an average of 8% over 6 months.

### Risk Factors
- China revenue uncertainty (18% of total revenue)
- Supply chain constraints in Vietnam facility [node:stu901]

### Recommendation
**Action: BUY** with 12-month price target of $245, representing 22% upside from current levels. This recommendation is based on the convergence of technical oversold conditions, strong fundamental catalysts, and supportive macro environment.`,
    confidence: 0.8,
    generated_at: "2026-02-04T10:30:00Z",
  },
  notifyUser: true,
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
 * - Insight: Derived analysis including signals, observations, and patterns
 *
 * This function is idempotent - it checks if types exist before creating them.
 */
export async function createSeedNodeTypes(agentId: string): Promise<void> {
  // Check if Insight type already exists for this agent
  const insightExists = await nodeTypeExists(agentId, INSIGHT_NODE_TYPE.name);

  if (!insightExists) {
    await createNodeType({
      agentId: agentId,
      name: INSIGHT_NODE_TYPE.name,
      description: INSIGHT_NODE_TYPE.description,
      propertiesSchema: INSIGHT_NODE_TYPE.propertiesSchema,
      exampleProperties: INSIGHT_NODE_TYPE.exampleProperties,
      notifyUser: INSIGHT_NODE_TYPE.notifyUser,
      createdBy: "system",
    });

    console.log(
      `[GraphTypeInitializer] Created seed Insight node type for agent ${agentId}`,
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
  // First, create seed node types (e.g., Insight)
  await createSeedNodeTypes(agentId);

  // Then, create all LLM-generated node types
  for (const nodeType of types.nodeTypes) {
    // Skip if this is the Insight type (already created as seed type)
    if (nodeType.name === INSIGHT_NODE_TYPE.name) {
      console.log(
        `[GraphTypeInitializer] Skipping LLM-generated Insight type (using seed type instead)`,
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
