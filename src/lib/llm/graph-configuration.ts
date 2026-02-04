/**
 * Graph Type Initializer
 *
 * Uses LLM to generate appropriate base node and edge types
 * when a new entity is created, based on the entity's purpose.
 */

import { z } from "zod";
import { generateLLMObject, type StreamOptions } from "./providers";
import {
  createNodeType,
  createEdgeType,
  getNodeTypeByName,
} from "@/lib/db/queries/graph-types";

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
// Type Initialization Functions
// ============================================================================

/**
 * Initialize types for an entity using LLM to generate appropriate node and edge types.
 * This analyzes the entity's purpose and generates domain-specific types.
 */
export async function initializeTypesForEntity(
  entity: { name: string; purpose: string | null },
  options?: { userId?: string },
): Promise<TypeInitializationResult> {
  const purposeDescription = entity.purpose || "General purpose assistant";

  const messages = [
    {
      role: "user" as const,
      content: `Design a knowledge graph schema for the following agent:

Agent Name: ${entity.name}
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
 * Creates node types first, then edge types with their constraints.
 */
export async function persistInitializedTypes(
  entityId: string,
  types: TypeInitializationResult,
): Promise<void> {
  // First, create all node types
  for (const nodeType of types.nodeTypes) {
    await createNodeType({
      entityId,
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
      const nodeType = await getNodeTypeByName(entityId, sourceName);
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
      const nodeType = await getNodeTypeByName(entityId, targetName);
      if (nodeType) {
        validTargetNames.push(targetName);
      } else {
        console.warn(
          `[GraphTypeInitializer] Target node type "${targetName}" not found for edge type "${edgeType.name}"`,
        );
      }
    }

    await createEdgeType({
      entityId,
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
    `[GraphTypeInitializer] Initialized ${types.nodeTypes.length} node types and ${types.edgeTypes.length} edge types for entity ${entityId}`,
  );
}

/**
 * Initialize and persist types for an entity in one call.
 * This is the main entry point for entity creation.
 */
export async function initializeAndPersistTypesForEntity(
  entityId: string,
  entity: { name: string; purpose: string | null },
  options?: { userId?: string },
): Promise<void> {
  const types = await initializeTypesForEntity(entity, options);
  await persistInitializedTypes(entityId, types);
}
