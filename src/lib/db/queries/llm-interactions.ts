/**
 * LLM Interactions Database Queries
 *
 * Operations for tracking background LLM interactions.
 */

import { eq, desc } from 'drizzle-orm';
import { db } from '../client';
import { llmInteractions } from '../schema';

// ============================================================================
// Types
// ============================================================================

export interface LLMInteraction {
  id: string;
  agentId: string;
  workerIterationId: string | null;
  phase: string | null;
  systemPrompt: string;
  request: Record<string, unknown>;
  response: Record<string, unknown> | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface CreateLLMInteractionInput {
  agentId: string;
  workerIterationId?: string;
  systemPrompt: string;
  request: Record<string, unknown>;
  phase?: string; // 'observer' | 'knowledge_acquisition' | 'graph_construction' | 'analysis_generation' | 'advice_generation' | 'conversation'
}

export interface UpdateLLMInteractionInput {
  response?: Record<string, unknown>;
  completedAt?: Date;
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Create a new LLM interaction record
 */
export async function createLLMInteraction(
  data: CreateLLMInteractionInput
): Promise<LLMInteraction> {
  const result = await db
    .insert(llmInteractions)
    .values({
      agentId: data.agentId,
      workerIterationId: data.workerIterationId,
      systemPrompt: data.systemPrompt,
      request: data.request,
      phase: data.phase,
    })
    .returning();

  const interaction = result[0];
  return {
    id: interaction.id,
    agentId: interaction.agentId,
    workerIterationId: interaction.workerIterationId,
    phase: interaction.phase,
    systemPrompt: interaction.systemPrompt,
    request: interaction.request as Record<string, unknown>,
    response: interaction.response as Record<string, unknown> | null,
    createdAt: interaction.createdAt,
    completedAt: interaction.completedAt,
  };
}

/**
 * Sanitize JSON data to remove characters that can cause PostgreSQL JSONB issues.
 * Removes null bytes, control characters, and fixes broken Unicode surrogate pairs.
 */
function sanitizeJsonForPostgres(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    // Step 1: Remove null bytes and ASCII control characters
    let sanitized = obj.replace(/\u0000/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

    // Step 2: Fix broken Unicode surrogate pairs
    // High surrogates are \uD800-\uDBFF, low surrogates are \uDC00-\uDFFF
    // A high surrogate must be followed by a low surrogate to form a valid pair
    // Remove lone surrogates that would cause PostgreSQL JSONB errors
    sanitized = sanitized.replace(
      // Match lone high surrogate (not followed by low surrogate) or lone low surrogate (not preceded by high surrogate)
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
      '' // Remove invalid surrogates
    );

    return sanitized;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeJsonForPostgres(item));
  }

  if (typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeJsonForPostgres(value);
    }
    return sanitized;
  }

  return obj;
}

/**
 * Update an LLM interaction record with response and/or completion time.
 * Supports incremental updates (response only) and final updates (response + completedAt).
 */
export async function updateLLMInteraction(
  id: string,
  data: UpdateLLMInteractionInput
): Promise<void> {
  const updateData: { response?: Record<string, unknown>; completedAt?: Date } = {};

  if (data.response !== undefined) {
    // Sanitize response data to remove characters that cause PostgreSQL JSONB issues
    updateData.response = sanitizeJsonForPostgres(data.response) as Record<string, unknown>;
  }
  if (data.completedAt !== undefined) {
    updateData.completedAt = data.completedAt;
  }

  try {
    await db
      .update(llmInteractions)
      .set(updateData)
      .where(eq(llmInteractions.id, id));
  } catch (error) {
    // Log detailed error information for debugging
    const errorMessage = error instanceof Error ? error.message : String(error);
    const responseSize = data.response ? JSON.stringify(data.response).length : 0;
    console.error(`[LLM Interactions] Failed to update interaction ${id}:`);
    console.error(`  Error: ${errorMessage}`);
    console.error(`  Response size: ${responseSize} bytes`);
    if (error instanceof Error && error.stack) {
      console.error(`  Stack: ${error.stack}`);
    }
    throw error;
  }
}

/**
 * Get LLM interactions for an agent, ordered by createdAt desc
 */
export async function getLLMInteractionsByAgent(
  agentId: string,
  limit: number = 50
): Promise<LLMInteraction[]> {
  const results = await db
    .select()
    .from(llmInteractions)
    .where(eq(llmInteractions.agentId, agentId))
    .orderBy(desc(llmInteractions.createdAt))
    .limit(limit);

  return results.map((row) => ({
    id: row.id,
    agentId: row.agentId,
    workerIterationId: row.workerIterationId,
    phase: row.phase,
    systemPrompt: row.systemPrompt,
    request: row.request as Record<string, unknown>,
    response: row.response as Record<string, unknown> | null,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  }));
}

/**
 * Get a single LLM interaction by ID
 */
export async function getLLMInteractionById(
  id: string
): Promise<LLMInteraction | null> {
  const results = await db
    .select()
    .from(llmInteractions)
    .where(eq(llmInteractions.id, id))
    .limit(1);

  if (results.length === 0) {
    return null;
  }

  const row = results[0];
  return {
    id: row.id,
    agentId: row.agentId,
    workerIterationId: row.workerIterationId,
    phase: row.phase,
    systemPrompt: row.systemPrompt,
    request: row.request as Record<string, unknown>,
    response: row.response as Record<string, unknown> | null,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}
