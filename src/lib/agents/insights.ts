/**
 * Insight Extraction and Management
 *
 * This module handles extracting insights from agent work sessions (threads).
 * Insights represent professional knowledge learned during background work:
 * - Facts: Domain-specific knowledge
 * - Techniques: Approaches that work well
 * - Patterns: Observed trends or behaviors
 * - Lessons: Learning from experience (what worked, what didn't)
 */

import { z } from 'zod';
import { generateLLMObject, type StreamOptions } from './llm';
import { createInsight, getInsightsByAgentId, getRecentInsights } from '@/lib/db/queries/insights';
import { getThreadMessages } from '@/lib/db/queries/threads';
import type { Insight, InsightType, LLMMessage, ThreadMessage } from '@/lib/types';

// ============================================================================
// Insight Extraction Schema
// ============================================================================

const InsightTypeSchema = z.enum(['fact', 'technique', 'pattern', 'lesson']);

const ExtractedInsightSchema = z.object({
  type: InsightTypeSchema,
  content: z.string().describe('The insight content'),
  confidence: z.number().min(0).max(1).describe('Confidence level from 0 to 1'),
});

const InsightExtractionResultSchema = z.object({
  insights: z.array(ExtractedInsightSchema).describe('Array of extracted insights'),
});

export type ExtractedInsight = z.infer<typeof ExtractedInsightSchema>;

// ============================================================================
// Extraction Prompts
// ============================================================================

const INSIGHT_EXTRACTION_SYSTEM_PROMPT = `You are an insight extraction assistant. Your job is to analyze work session transcripts and extract valuable professional knowledge that should be retained for future work sessions.

Extract insights that fall into these categories:
- **fact**: Domain-specific knowledge, data points, specifications, or truths about the work domain
- **technique**: Approaches, methods, or procedures that proved effective
- **pattern**: Observed trends, recurring behaviors, or correlations
- **lesson**: Learnings from experience - what worked, what didn't, and why

Guidelines:
- Focus on knowledge that will improve future work performance
- Be concise but capture the essence of what should be retained
- Include confidence levels based on how well-supported the insight is
- Do not extract trivial or obvious information
- Prioritize actionable insights over general observations
- If nothing significant was learned, return an empty array

Return a JSON object with an array of insights, or an empty array if nothing worth retaining.`;

// ============================================================================
// Insight Extraction Functions
// ============================================================================

/**
 * Extract insights from a completed thread's messages
 */
export async function extractInsightsFromMessages(
  messages: ThreadMessage[],
  agentRole: string,
  options: StreamOptions = {}
): Promise<ExtractedInsight[]> {
  if (messages.length === 0) {
    return [];
  }

  // Build transcript from thread messages
  const transcript = messages
    .map((m) => `[${m.role.toUpperCase()}]: ${m.content}`)
    .join('\n\n');

  const extractionPrompt: LLMMessage[] = [
    {
      role: 'user',
      content: `Analyze this work session and extract any valuable insights worth retaining.

Agent Role: ${agentRole}

Work Session Transcript:
---
${transcript}
---

Extract insights that will help the agent perform better in future work sessions. Consider:
1. What approaches worked or didn't work? (type: technique or lesson)
2. What patterns were discovered? (type: pattern)
3. What domain facts were learned? (type: fact)
4. What should be done differently next time? (type: lesson)

Only extract insights that are genuinely valuable and not obvious.`,
    },
  ];

  try {
    const result = await generateLLMObject(
      extractionPrompt,
      InsightExtractionResultSchema,
      INSIGHT_EXTRACTION_SYSTEM_PROMPT,
      {
        ...options,
        temperature: 0.3, // Lower temperature for more consistent extraction
      }
    );

    return result.insights;
  } catch (error) {
    console.error('Insight extraction failed:', error);
    return [];
  }
}

/**
 * Extract and persist insights from a thread
 */
export async function extractInsightsFromThread(
  threadId: string,
  agentId: string,
  agentRole: string,
  options: StreamOptions = {}
): Promise<Insight[]> {
  // Load thread messages
  const messages = await getThreadMessages(threadId);

  if (messages.length === 0) {
    return [];
  }

  // Extract insights
  const extractedInsights = await extractInsightsFromMessages(
    messages,
    agentRole,
    options
  );

  if (extractedInsights.length === 0) {
    return [];
  }

  // Persist insights to database
  const persistedInsights: Insight[] = [];
  for (const insight of extractedInsights) {
    const persisted = await createInsight(
      agentId,
      insight.type as InsightType,
      insight.content,
      threadId,
      insight.confidence
    );
    persistedInsights.push(persisted);
  }

  return persistedInsights;
}

// ============================================================================
// Insight Context Building
// ============================================================================

/**
 * Format insights for inclusion in agent context (background work)
 */
export function formatInsightsForContext(insights: Insight[]): string {
  if (insights.length === 0) {
    return '';
  }

  const grouped = {
    fact: insights.filter((i) => i.type === 'fact'),
    technique: insights.filter((i) => i.type === 'technique'),
    pattern: insights.filter((i) => i.type === 'pattern'),
    lesson: insights.filter((i) => i.type === 'lesson'),
  };

  const sections: string[] = [];

  if (grouped.fact.length > 0) {
    sections.push(
      '## Domain Knowledge\n' +
        grouped.fact.map((i) => `- ${i.content}`).join('\n')
    );
  }

  if (grouped.technique.length > 0) {
    sections.push(
      '## Effective Techniques\n' +
        grouped.technique.map((i) => `- ${i.content}`).join('\n')
    );
  }

  if (grouped.pattern.length > 0) {
    sections.push(
      '## Observed Patterns\n' +
        grouped.pattern.map((i) => `- ${i.content}`).join('\n')
    );
  }

  if (grouped.lesson.length > 0) {
    sections.push(
      '## Lessons Learned\n' +
        grouped.lesson.map((i) => `- ${i.content}`).join('\n')
    );
  }

  return sections.join('\n\n');
}

/**
 * Build an insights context block for background work system prompts
 */
export function buildInsightsContextBlock(insights: Insight[]): string {
  if (insights.length === 0) {
    return '';
  }

  return `
<professional_knowledge>
The following insights have been learned from previous work sessions:

${formatInsightsForContext(insights)}
</professional_knowledge>
`;
}

/**
 * Load insights for an agent and build context block
 */
export async function loadInsightsContext(
  agentId: string,
  maxInsights: number = 20
): Promise<string> {
  const insights = await getRecentInsights(agentId, maxInsights);
  return buildInsightsContextBlock(insights);
}

/**
 * Load all insights for an agent
 */
export async function loadInsights(agentId: string): Promise<Insight[]> {
  return getInsightsByAgentId(agentId);
}
