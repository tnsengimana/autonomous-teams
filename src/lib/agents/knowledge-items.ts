/**
 * Knowledge Extraction and Management
 *
 * This module handles extracting knowledge items from agent work sessions (background conversations).
 * Knowledge items represent professional knowledge learned during background work:
 * - Facts: Domain-specific knowledge
 * - Techniques: Approaches that work well
 * - Patterns: Observed trends or behaviors
 * - Lessons: Learning from experience (what worked, what didn't)
 */

import { z } from 'zod';
import { generateLLMObject, type StreamOptions } from './llm';
import { createKnowledgeItem, getKnowledgeItemsByAgentId, getRecentKnowledgeItems } from '@/lib/db/queries/knowledge-items';
import { getConversationContext } from '@/lib/db/queries/messages';
import type { KnowledgeItem, KnowledgeItemType, LLMMessage, Message } from '@/lib/types';

// ============================================================================
// Knowledge Extraction Schema
// ============================================================================

const KnowledgeItemTypeSchema = z.enum(['fact', 'technique', 'pattern', 'lesson']);

const ExtractedKnowledgeItemSchema = z.object({
  type: KnowledgeItemTypeSchema,
  content: z.string().describe('The knowledge item content'),
  confidence: z.number().min(0).max(1).describe('Confidence level from 0 to 1'),
});

const KnowledgeExtractionResultSchema = z.object({
  knowledgeItems: z.array(ExtractedKnowledgeItemSchema).describe('Array of extracted knowledge items'),
});

export type ExtractedKnowledgeItem = z.infer<typeof ExtractedKnowledgeItemSchema>;

// ============================================================================
// Extraction Prompts
// ============================================================================

const KNOWLEDGE_EXTRACTION_SYSTEM_PROMPT = `You are a knowledge extraction assistant. Your job is to analyze work session transcripts and extract valuable professional knowledge that should be retained for future work sessions.

Extract knowledge items that fall into these categories:
- **fact**: Domain-specific knowledge, data points, specifications, or truths about the work domain
- **technique**: Approaches, methods, or procedures that proved effective
- **pattern**: Observed trends, recurring behaviors, or correlations
- **lesson**: Learnings from experience - what worked, what didn't, and why

Guidelines:
- Focus on knowledge that will improve future work performance
- Be concise but capture the essence of what should be retained
- Include confidence levels based on how well-supported the knowledge item is
- Do not extract trivial or obvious information
- Prioritize actionable knowledge items over general observations
- If nothing significant was learned, return an empty array

Return a JSON object with an array of knowledge items, or an empty array if nothing worth retaining.`;

// ============================================================================
// Knowledge Extraction Functions
// ============================================================================

/**
 * Extract knowledge items from conversation messages
 */
export async function extractKnowledgeFromMessages(
  messages: Message[],
  agentRole: string,
  options: StreamOptions = {}
): Promise<ExtractedKnowledgeItem[]> {
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
      content: `Analyze this work session and extract any valuable knowledge items worth retaining.

Agent Role: ${agentRole}

Work Session Transcript:
---
${transcript}
---

Extract knowledge items that will help the agent perform better in future work sessions. Consider:
1. What approaches worked or didn't work? (type: technique or lesson)
2. What patterns were discovered? (type: pattern)
3. What domain facts were learned? (type: fact)
4. What should be done differently next time? (type: lesson)

Only extract knowledge items that are genuinely valuable and not obvious.`,
    },
  ];

  try {
    const result = await generateLLMObject(
      extractionPrompt,
      KnowledgeExtractionResultSchema,
      KNOWLEDGE_EXTRACTION_SYSTEM_PROMPT,
      {
        ...options,
        temperature: 0.3, // Lower temperature for more consistent extraction
      }
    );

    return result.knowledgeItems;
  } catch (error) {
    console.error('Knowledge extraction failed:', error);
    return [];
  }
}

/**
 * Extract and persist knowledge items from a conversation
 */
export async function extractKnowledgeFromConversation(
  conversationId: string,
  agentId: string,
  agentRole: string,
  options: StreamOptions = {}
): Promise<KnowledgeItem[]> {
  // Load conversation messages (with compaction awareness)
  const conversationMessages = await getConversationContext(conversationId);

  if (conversationMessages.length === 0) {
    return [];
  }

  // Extract knowledge items
  const extractedKnowledge = await extractKnowledgeFromMessages(
    conversationMessages,
    agentRole,
    options
  );

  if (extractedKnowledge.length === 0) {
    return [];
  }

  // Persist knowledge items to database
  const persistedKnowledgeItems: KnowledgeItem[] = [];
  for (const item of extractedKnowledge) {
    const persisted = await createKnowledgeItem(
      agentId,
      item.type as KnowledgeItemType,
      item.content,
      conversationId,
      item.confidence
    );
    persistedKnowledgeItems.push(persisted);
  }

  return persistedKnowledgeItems;
}

// ============================================================================
// Knowledge Context Building
// ============================================================================

/**
 * Format knowledge items for inclusion in agent context (background work)
 */
export function formatKnowledgeForContext(knowledgeItems: KnowledgeItem[]): string {
  if (knowledgeItems.length === 0) {
    return '';
  }

  const grouped = {
    fact: knowledgeItems.filter((i) => i.type === 'fact'),
    technique: knowledgeItems.filter((i) => i.type === 'technique'),
    pattern: knowledgeItems.filter((i) => i.type === 'pattern'),
    lesson: knowledgeItems.filter((i) => i.type === 'lesson'),
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
 * Build a knowledge context block for background work system prompts
 */
export function buildKnowledgeContextBlock(knowledgeItems: KnowledgeItem[]): string {
  if (knowledgeItems.length === 0) {
    return '';
  }

  return `
<professional_knowledge>
The following knowledge items have been learned from previous work sessions:

${formatKnowledgeForContext(knowledgeItems)}
</professional_knowledge>
`;
}

/**
 * Load knowledge items for an agent and build context block
 */
export async function loadKnowledgeContext(
  agentId: string,
  maxKnowledgeItems: number = 20
): Promise<string> {
  const knowledgeItems = await getRecentKnowledgeItems(agentId, maxKnowledgeItems);
  return buildKnowledgeContextBlock(knowledgeItems);
}

/**
 * Load all knowledge items for an agent
 */
export async function loadKnowledge(agentId: string): Promise<KnowledgeItem[]> {
  return getKnowledgeItemsByAgentId(agentId);
}
