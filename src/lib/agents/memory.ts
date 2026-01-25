import { z } from 'zod';
import { generateLLMObject, type StreamOptions } from './llm';
import { createMemories } from '@/lib/db/queries/memories';
import type { ExtractedMemory, Memory, LLMMessage } from '@/lib/types';

// ============================================================================
// Memory Extraction Schema
// ============================================================================

const MemoryTypeSchema = z.enum(['preference', 'insight', 'fact']);

const ExtractedMemorySchema = z.object({
  type: MemoryTypeSchema,
  content: z.string().describe('The memory content to store'),
});

// Wrap in object because OpenAI's generateObject requires object at root
const MemoryExtractionResultSchema = z.object({
  memories: z.array(ExtractedMemorySchema).describe('Array of extracted memories'),
});

// ============================================================================
// Memory Extraction Prompts
// ============================================================================

const MEMORY_EXTRACTION_SYSTEM_PROMPT = `You are a memory extraction assistant. Your job is to analyze conversation exchanges and extract important information that should be remembered for future interactions.

Extract memories that fall into these categories:
- **preference**: User preferences, likes, dislikes, communication style preferences
- **insight**: Strategic insights, patterns noticed, conclusions drawn from analysis
- **fact**: Factual information about the user, their situation, or relevant data

Guidelines:
- Only extract information that will be valuable for future interactions
- Be concise but capture the essence of what should be remembered
- Do not extract trivial or temporary information
- If nothing worth remembering, return an empty array

Return a JSON array of memories, or an empty array if nothing worth remembering.`;

// ============================================================================
// Memory Extraction Functions
// ============================================================================

/**
 * Extract memories from a conversation exchange
 * Called synchronously after each LLM response
 */
export async function extractMemories(
  userMessage: string,
  assistantResponse: string,
  agentRole: string,
  options: StreamOptions = {}
): Promise<ExtractedMemory[]> {
  const messages: LLMMessage[] = [
    {
      role: 'user',
      content: `Given this conversation exchange, extract any information worth remembering.

Agent Role: ${agentRole}

User said: "${userMessage}"

Assistant responded: "${assistantResponse}"

Extract memories that will help the agent perform its role better in future interactions.`,
    },
  ];

  try {
    const result = await generateLLMObject(
      messages,
      MemoryExtractionResultSchema,
      MEMORY_EXTRACTION_SYSTEM_PROMPT,
      {
        ...options,
        temperature: 0.3, // Lower temperature for more consistent extraction
      }
    );

    return result.memories;
  } catch (error) {
    console.error('Memory extraction failed:', error);
    return [];
  }
}

/**
 * Extract and persist memories for an agent
 */
export async function extractAndPersistMemories(
  agentId: string,
  userMessage: string,
  assistantResponse: string,
  agentRole: string,
  sourceMessageId?: string,
  options: StreamOptions = {}
): Promise<Memory[]> {
  const extractedMemories = await extractMemories(
    userMessage,
    assistantResponse,
    agentRole,
    options
  );

  if (extractedMemories.length === 0) {
    return [];
  }

  return createMemories(agentId, extractedMemories, sourceMessageId);
}

/**
 * Format memories for inclusion in agent context
 */
export function formatMemoriesForContext(memories: Memory[]): string {
  if (memories.length === 0) {
    return '';
  }

  const grouped = {
    preference: memories.filter((m) => m.type === 'preference'),
    insight: memories.filter((m) => m.type === 'insight'),
    fact: memories.filter((m) => m.type === 'fact'),
  };

  const sections: string[] = [];

  if (grouped.preference.length > 0) {
    sections.push(
      '## User Preferences\n' +
        grouped.preference.map((m) => `- ${m.content}`).join('\n')
    );
  }

  if (grouped.insight.length > 0) {
    sections.push(
      '## Insights\n' + grouped.insight.map((m) => `- ${m.content}`).join('\n')
    );
  }

  if (grouped.fact.length > 0) {
    sections.push(
      '## Facts\n' + grouped.fact.map((m) => `- ${m.content}`).join('\n')
    );
  }

  return sections.join('\n\n');
}

/**
 * Build a memory context block for the system prompt
 */
export function buildMemoryContextBlock(memories: Memory[]): string {
  if (memories.length === 0) {
    return '';
  }

  return `
<memories>
The following information has been learned from previous interactions:

${formatMemoriesForContext(memories)}
</memories>
`;
}
