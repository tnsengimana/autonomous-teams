import { z } from 'zod';
import { generateLLMObject } from '@/lib/agents/llm';

/**
 * Schema for the generated entity configuration (with name)
 */
const EntityConfigurationWithNameSchema = z.object({
  name: z.string().describe('A short, memorable name for this entity (2-4 words)'),
  systemPrompt: z.string().describe('System prompt defining the entity personality and approach'),
});

/**
 * Schema for the generated entity configuration (without name)
 */
const EntityConfigurationSchema = z.object({
  systemPrompt: z.string().describe('System prompt defining the entity personality and approach'),
});

export type EntityConfiguration = z.infer<typeof EntityConfigurationWithNameSchema>;

/**
 * Generate entity configuration from mission/purpose.
 * If name is provided, only generates systemPrompt.
 * If name is not provided, generates both name and systemPrompt.
 */
export async function generateEntityConfiguration(
  purpose: string,
  options?: { userId?: string; name?: string }
): Promise<EntityConfiguration> {
  const providedName = options?.name?.trim();

  if (providedName) {
    // Name provided - only generate systemPrompt
    const systemPromptInstructions = `You are an entity configuration assistant. Given an entity name and mission/purpose, generate a system prompt for an autonomous AI entity.

Generate a **systemPrompt**: A detailed system prompt that defines:
- The entity's role and expertise
- Their approach to fulfilling the mission
- How they should communicate and work
- Key responsibilities and areas of focus

The system prompt should be comprehensive (3-5 paragraphs) and tailored to the specific purpose.`;

    const userPrompt = `Entity Name: ${providedName}
Mission: ${purpose}

Generate the system prompt.`;

    const result = await generateLLMObject(
      [{ role: 'user', content: userPrompt }],
      EntityConfigurationSchema,
      systemPromptInstructions,
      {
        temperature: 0.7,
        userId: options?.userId,
      }
    );

    return { name: providedName, systemPrompt: result.systemPrompt };
  } else {
    // No name provided - generate both
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
      EntityConfigurationWithNameSchema,
      systemPromptInstructions,
      {
        temperature: 0.7,
        userId: options?.userId,
      }
    );
  }
}
