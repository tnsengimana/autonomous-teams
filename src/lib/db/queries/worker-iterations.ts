/**
 * Worker Iterations Database Queries
 *
 * Operations for tracking background worker iteration cycles.
 */

import { eq, desc } from "drizzle-orm";
import { db } from "../client";
import { workerIterations, llmInteractions } from "../schema";

// ============================================================================
// Types
// ============================================================================

export interface WorkerIteration {
  id: string;
  agentId: string;
  status: string;
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface WorkerIterationWithInteractions extends WorkerIteration {
  llmInteractions: {
    id: string;
    phase: string | null;
    systemPrompt: string;
    request: Record<string, unknown>;
    response: Record<string, unknown> | null;
    createdAt: Date;
    completedAt: Date | null;
  }[];
}

export interface CreateWorkerIterationInput {
  agentId: string;
}

export interface UpdateWorkerIterationInput {
  status?: string;
  errorMessage?: string;
  completedAt?: Date;
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Create a new worker iteration record
 */
export async function createWorkerIteration(
  data: CreateWorkerIterationInput,
): Promise<WorkerIteration> {
  const result = await db
    .insert(workerIterations)
    .values({
      agentId: data.agentId,
    })
    .returning();

  const iteration = result[0];
  return {
    id: iteration.id,
    agentId: iteration.agentId,
    status: iteration.status,
    errorMessage: iteration.errorMessage,
    createdAt: iteration.createdAt,
    completedAt: iteration.completedAt,
  };
}

/**
 * Update a worker iteration record
 */
export async function updateWorkerIteration(
  id: string,
  data: UpdateWorkerIterationInput,
): Promise<void> {
  await db
    .update(workerIterations)
    .set(data)
    .where(eq(workerIterations.id, id));
}

/**
 * Get worker iterations with their LLM interactions for an agent
 */
export async function getWorkerIterationsWithInteractions(
  agentId: string,
  limit: number = 50,
): Promise<WorkerIterationWithInteractions[]> {
  // Get iterations
  const iterations = await db
    .select()
    .from(workerIterations)
    .where(eq(workerIterations.agentId, agentId))
    .orderBy(desc(workerIterations.createdAt))
    .limit(limit);

  // Get all interactions for these iterations
  const iterationIds = iterations.map((i) => i.id);

  if (iterationIds.length === 0) {
    return [];
  }

  const interactions = await db
    .select()
    .from(llmInteractions)
    .where(eq(llmInteractions.agentId, agentId))
    .orderBy(desc(llmInteractions.createdAt));

  // Group interactions by iteration
  const interactionsByIteration = new Map<
    string,
    WorkerIterationWithInteractions["llmInteractions"]
  >();

  for (const interaction of interactions) {
    if (interaction.workerIterationId) {
      const list =
        interactionsByIteration.get(interaction.workerIterationId) || [];
      list.push({
        id: interaction.id,
        phase: interaction.phase,
        systemPrompt: interaction.systemPrompt,
        request: interaction.request as Record<string, unknown>,
        response: interaction.response as Record<string, unknown> | null,
        createdAt: interaction.createdAt,
        completedAt: interaction.completedAt,
      });
      interactionsByIteration.set(interaction.workerIterationId, list);
    }
  }

  // Build result with interactions grouped by iteration
  return iterations.map((iteration) => ({
    id: iteration.id,
    agentId: iteration.agentId,
    status: iteration.status,
    errorMessage: iteration.errorMessage,
    createdAt: iteration.createdAt,
    completedAt: iteration.completedAt,
    llmInteractions: (interactionsByIteration.get(iteration.id) || []).sort(
      (a, b) => {
        // Sort by phase order: query identification first, then research, then analysis/advice
        const phaseOrder: Record<string, number> = {
          query_identification: 0,
          knowledge_acquisition: 1,
          graph_construction: 2,
          insight_identification: 3,
          analysis_generation: 4,
          advice_generation: 5,
        };
        const aOrder = a.phase ? (phaseOrder[a.phase] ?? 2) : 2;
        const bOrder = b.phase ? (phaseOrder[b.phase] ?? 2) : 2;
        return aOrder - bOrder;
      },
    ),
  }));
}

/**
 * Get a single worker iteration by ID
 */
export async function getWorkerIterationById(
  id: string,
): Promise<WorkerIteration | null> {
  const results = await db
    .select()
    .from(workerIterations)
    .where(eq(workerIterations.id, id))
    .limit(1);

  if (results.length === 0) {
    return null;
  }

  const row = results[0];
  return {
    id: row.id,
    agentId: row.agentId,
    status: row.status,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

/**
 * Get the last completed worker iteration for an agent
 */
export async function getLastCompletedIteration(
  agentId: string,
): Promise<WorkerIteration | null> {
  const results = await db
    .select()
    .from(workerIterations)
    .where(eq(workerIterations.agentId, agentId))
    .orderBy(desc(workerIterations.completedAt))
    .limit(1);

  if (results.length === 0) {
    return null;
  }

  const row = results[0];
  return {
    id: row.id,
    agentId: row.agentId,
    status: row.status,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}
