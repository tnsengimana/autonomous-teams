/**
 * Graph Type Initializer
 *
 * Uses LLM to generate appropriate base node and edge types
 * when a new entity is created, based on the entity's purpose.
 */

import { z } from 'zod';
import { generateLLMObject, type StreamOptions } from './llm';
import {
  createNodeType,
  createEdgeType,
  getNodeTypeByName,
} from '@/lib/db/queries/graph-types';

// ============================================================================
// Schemas for LLM-generated type definitions
// ============================================================================

const NodeTypeDefinitionSchema = z.object({
  name: z.string().describe('PascalCase type name'),
  description: z.string().describe('What this type represents'),
  propertiesSchema: z.object({
    type: z.literal('object'),
    required: z.array(z.string()).optional(),
    properties: z.record(z.string(), z.unknown()),
  }),
  exampleProperties: z.record(z.string(), z.unknown()),
});

const EdgeTypeDefinitionSchema = z.object({
  name: z.string().describe('snake_case edge type name'),
  description: z.string().describe('What this relationship represents'),
  sourceNodeTypeNames: z.array(z.string()).describe('Names of node types allowed as source'),
  targetNodeTypeNames: z.array(z.string()).describe('Names of node types allowed as target'),
  propertiesSchema: z.object({
    type: z.literal('object'),
    properties: z.record(z.string(), z.unknown()),
  }).optional(),
  exampleProperties: z.record(z.string(), z.unknown()).optional(),
});

const TypeInitializationResultSchema = z.object({
  nodeTypes: z.array(NodeTypeDefinitionSchema),
  edgeTypes: z.array(EdgeTypeDefinitionSchema),
});

export type NodeTypeDefinition = z.infer<typeof NodeTypeDefinitionSchema>;
export type EdgeTypeDefinition = z.infer<typeof EdgeTypeDefinitionSchema>;
export type TypeInitializationResult = z.infer<typeof TypeInitializationResultSchema>;

// ============================================================================
// Type Initialization Prompt
// ============================================================================

const TYPE_INITIALIZATION_SYSTEM_PROMPT = `You are a knowledge graph schema designer. Given an entity's purpose, design appropriate node types and edge types for its knowledge graph.

Guidelines:
- Node type names: PascalCase (e.g., "Company", "MarketEvent")
- Edge type names: snake_case (e.g., "affects", "issued_by")
- Each node type needs: name, description, propertiesSchema (JSON Schema), exampleProperties
- Each edge type needs: name, description, sourceNodeTypeNames, targetNodeTypeNames, and optionally propertiesSchema/exampleProperties
- Design 5-10 node types and 5-10 edge types that cover the key concepts for this domain
- Types should be specific enough to be useful but general enough to avoid proliferation
- Include standard types like news/events if relevant to the domain
- Focus on discoverable knowledge, not user data (no User, Portfolio, Account types)
- Include temporal properties in type schemas where appropriate (occurred_at, published_at, generated_at)

The propertiesSchema should be a valid JSON Schema object with:
- type: "object"
- properties: an object mapping property names to their schema (e.g., { "name": { "type": "string" } })
- required: an optional array of required property names

Return a comprehensive schema that supports the entity's mission.`;

// ============================================================================
// Type Initialization Functions
// ============================================================================

/**
 * Initialize types for an entity using LLM to generate appropriate node and edge types.
 * This analyzes the entity's purpose and generates domain-specific types.
 */
export async function initializeTypesForEntity(
  entity: { name: string; purpose: string | null },
  options?: { userId?: string }
): Promise<TypeInitializationResult> {
  const purposeDescription = entity.purpose || 'General purpose assistant';

  const messages = [
    {
      role: 'user' as const,
      content: `Design a knowledge graph schema for the following entity:

Entity Name: ${entity.name}
Entity Purpose: ${purposeDescription}

Create node types and edge types that would best support this entity's mission. Consider what kinds of information this entity would need to track and the relationships between them.`,
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
    llmOptions
  );

  return result;
}

/**
 * Persist initialized types to the database.
 * Creates node types first, then edge types with their constraints.
 */
export async function persistInitializedTypes(
  entityId: string,
  types: TypeInitializationResult
): Promise<void> {
  // First, create all node types
  for (const nodeType of types.nodeTypes) {
    await createNodeType({
      entityId,
      name: nodeType.name,
      description: nodeType.description,
      propertiesSchema: nodeType.propertiesSchema,
      exampleProperties: nodeType.exampleProperties,
      createdBy: 'system',
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
          `[GraphTypeInitializer] Source node type "${sourceName}" not found for edge type "${edgeType.name}"`
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
          `[GraphTypeInitializer] Target node type "${targetName}" not found for edge type "${edgeType.name}"`
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
      createdBy: 'system',
    });
  }

  console.log(
    `[GraphTypeInitializer] Initialized ${types.nodeTypes.length} node types and ${types.edgeTypes.length} edge types for entity ${entityId}`
  );
}

/**
 * Initialize and persist types for an entity in one call.
 * This is the main entry point for entity creation.
 */
export async function initializeAndPersistTypesForEntity(
  entityId: string,
  entity: { name: string; purpose: string | null },
  options?: { userId?: string }
): Promise<void> {
  const types = await initializeTypesForEntity(entity, options);
  await persistInitializedTypes(entityId, types);
}
