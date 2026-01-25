/**
 * Insight Management Tools
 *
 * Tools available during user conversations for managing professional knowledge.
 * Insights are facts, techniques, patterns, and lessons learned during work.
 */

import {
  registerTool,
  type Tool,
  type ToolResult,
} from './index';
import {
  createInsight,
  deleteInsight,
  getRecentInsights,
} from '@/lib/db/queries/insights';
import { z } from 'zod';
import type { InsightType } from '@/lib/types';

// ============================================================================
// Parameter Schemas
// ============================================================================

export const AddInsightParamsSchema = z.object({
  type: z
    .enum(['fact', 'technique', 'pattern', 'lesson'])
    .describe('The type of insight'),
  content: z.string().min(1).describe('The insight content to store'),
  confidence: z.number().min(0).max(1).optional().describe('Confidence level (0-1)'),
});

export const ListInsightsParamsSchema = z.object({
  type: z
    .enum(['fact', 'technique', 'pattern', 'lesson'])
    .optional()
    .describe('Filter by insight type'),
  limit: z.number().min(1).max(50).optional().describe('Maximum number of insights to return'),
});

export const RemoveInsightParamsSchema = z.object({
  insightId: z.string().uuid().describe('The ID of the insight to remove'),
});

export type AddInsightParams = z.infer<typeof AddInsightParamsSchema>;
export type ListInsightsParams = z.infer<typeof ListInsightsParamsSchema>;
export type RemoveInsightParams = z.infer<typeof RemoveInsightParamsSchema>;

// ============================================================================
// addInsight Tool
// ============================================================================

const addInsightTool: Tool = {
  schema: {
    name: 'addInsight',
    description:
      'Store professional knowledge or a learning. Use this when the user shares valuable information about their domain, techniques that work, patterns observed, or lessons learned.',
    parameters: [
      {
        name: 'type',
        type: 'string',
        description: 'The type of insight: fact (domain knowledge), technique (how to do something), pattern (observed trend), lesson (learning from experience)',
        required: true,
        enum: ['fact', 'technique', 'pattern', 'lesson'],
      },
      {
        name: 'content',
        type: 'string',
        description: 'The insight content to store',
        required: true,
      },
      {
        name: 'confidence',
        type: 'number',
        description: 'Confidence level from 0 to 1 (optional)',
        required: false,
      },
    ],
  },
  handler: async (params, context): Promise<ToolResult> => {
    const parsed = AddInsightParamsSchema.safeParse(params);
    if (!parsed.success) {
      return {
        success: false,
        error: `Invalid parameters: ${parsed.error.message}`,
      };
    }

    const { type, content, confidence } = parsed.data;

    try {
      const insight = await createInsight(
        context.agentId,
        type as InsightType,
        content,
        undefined, // sourceThreadId - not available in foreground
        confidence
      );

      return {
        success: true,
        data: {
          insightId: insight.id,
          message: `Stored ${type} insight successfully`,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to store insight',
      };
    }
  },
};

// ============================================================================
// listInsights Tool
// ============================================================================

const listInsightsTool: Tool = {
  schema: {
    name: 'listInsights',
    description:
      'List stored insights for this agent. Useful for reviewing what professional knowledge has been accumulated.',
    parameters: [
      {
        name: 'type',
        type: 'string',
        description: 'Filter by insight type (optional)',
        required: false,
        enum: ['fact', 'technique', 'pattern', 'lesson'],
      },
      {
        name: 'limit',
        type: 'number',
        description: 'Maximum number of insights to return (default: 20)',
        required: false,
      },
    ],
  },
  handler: async (params, context): Promise<ToolResult> => {
    const parsed = ListInsightsParamsSchema.safeParse(params);
    if (!parsed.success) {
      return {
        success: false,
        error: `Invalid parameters: ${parsed.error.message}`,
      };
    }

    const { type, limit = 20 } = parsed.data;

    try {
      let insights;
      if (type) {
        const { getInsightsByType } = await import('@/lib/db/queries/insights');
        insights = await getInsightsByType(context.agentId, type as InsightType);
        insights = insights.slice(0, limit);
      } else {
        insights = await getRecentInsights(context.agentId, limit);
      }

      return {
        success: true,
        data: {
          count: insights.length,
          insights: insights.map((i) => ({
            id: i.id,
            type: i.type,
            content: i.content,
            confidence: i.confidence,
            createdAt: i.createdAt,
          })),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list insights',
      };
    }
  },
};

// ============================================================================
// removeInsight Tool
// ============================================================================

const removeInsightTool: Tool = {
  schema: {
    name: 'removeInsight',
    description:
      'Remove an insight that is no longer accurate or relevant.',
    parameters: [
      {
        name: 'insightId',
        type: 'string',
        description: 'The UUID of the insight to remove',
        required: true,
      },
    ],
  },
  handler: async (params, context): Promise<ToolResult> => {
    const parsed = RemoveInsightParamsSchema.safeParse(params);
    if (!parsed.success) {
      return {
        success: false,
        error: `Invalid parameters: ${parsed.error.message}`,
      };
    }

    const { insightId } = parsed.data;

    try {
      // Verify the insight belongs to this agent
      const { getInsightById } = await import('@/lib/db/queries/insights');
      const insight = await getInsightById(insightId);

      if (!insight) {
        return {
          success: false,
          error: 'Insight not found',
        };
      }

      if (insight.agentId !== context.agentId) {
        return {
          success: false,
          error: 'Cannot remove insights belonging to other agents',
        };
      }

      await deleteInsight(insightId);

      return {
        success: true,
        data: {
          message: 'Insight removed successfully',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to remove insight',
      };
    }
  },
};

// ============================================================================
// Registration
// ============================================================================

/**
 * Register all insight management tools
 */
export function registerInsightTools(): void {
  registerTool(addInsightTool);
  registerTool(listInsightsTool);
  registerTool(removeInsightTool);
}

// Export individual tools for testing
export { addInsightTool, listInsightsTool, removeInsightTool };
