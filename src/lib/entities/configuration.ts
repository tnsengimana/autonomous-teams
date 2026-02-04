import { z } from 'zod';
import { generateLLMObject } from '@/lib/agents/llm';

/**
 * Schema for the generated entity configuration
 */
const EntityConfigurationSchema = z.object({
  name: z.string().describe('A short, memorable name for this entity (2-4 words)'),
  systemPrompt: z.string().describe('System prompt defining the entity personality and approach'),
});

export type EntityConfiguration = z.infer<typeof EntityConfigurationSchema>;

/**
 * Generate entity configuration (name, system prompt) from just the mission/purpose.
 * Uses LLM to create appropriate values based on the purpose.
 */
export async function generateEntityConfiguration(
  purpose: string,
  options?: { userId?: string }
): Promise<EntityConfiguration> {
  const systemPromptInstructions = `You are an entity configuration assistant. Given a mission/purpose, generate the configuration for an autonomous AI entity.

Generate:
1. **name**: A short, memorable name for this entity (2-4 words, like "Research Scout" or "Market Analyst")
2. **systemPrompt**: A detailed system prompt that defines:
   - The entity's role and expertise
   - Their approach to fulfilling the mission
   - How they should communicate and work
   - Key responsibilities and areas of focus

The system prompt should be comprehensive (3-5 paragraphs) and tailored to the specific purpose.`;

  const userPrompt = `Mission: ${purpose}

Generate the entity configuration.`;

  return generateLLMObject(
    [{ role: 'user', content: userPrompt }],
    EntityConfigurationSchema,
    systemPromptInstructions,
    {
      temperature: 0.7,
      userId: options?.userId,
    }
  );
}
