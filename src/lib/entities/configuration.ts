import { z } from 'zod';
import { generateLLMObject } from '@/lib/agents/llm';
import type { EntityType } from '@/lib/types';

/**
 * Schema for the generated entity configuration
 */
const EntityConfigurationSchema = z.object({
  entityDescription: z.string().describe('A one sentence description of what this entity does'),
  leadAgentName: z.string().describe('A professional name for the lead agent'),
  leadAgentSystemPrompt: z.string().describe('System prompt defining the agent personality and approach'),
});

export type EntityConfiguration = z.infer<typeof EntityConfigurationSchema>;

/**
 * Generate entity configuration (description, lead agent name, system prompt) from entity name and purpose.
 * Uses LLM to create appropriate values based on the purpose and entity type.
 */
export async function generateEntityConfiguration(
  entityName: string,
  purpose: string,
  entityType: EntityType,
  options?: { userId?: string }
): Promise<EntityConfiguration> {
  const isTeam = entityType === 'team';

  const systemPrompt = isTeam
    ? `You are a team configuration assistant. Given a team name and mission, generate the configuration for an autonomous AI team.

Generate:
1. **entityDescription**: A one sentence description of what this team does
2. **leadAgentName**: A professional name for the team lead (e.g., "Alex", "Jordan", "Morgan", "Taylor")
3. **leadAgentSystemPrompt**: A detailed system prompt that defines:
   - The agent's role and expertise
   - Their approach to fulfilling the mission
   - How they should communicate and collaborate
   - Key responsibilities

The system prompt should be comprehensive (3-5 paragraphs) and tailored to the specific mission.`
    : `You are an aide configuration assistant. Given an aide name and purpose, generate the configuration for a personal AI aide.

An aide is a professional extension of the user - like having a personal portfolio manager, research assistant, or specialist who works on your behalf.

Generate:
1. **entityDescription**: A one sentence description of what this aide does for the user
2. **leadAgentName**: A professional, friendly name for the aide (e.g., "Alex", "Jordan", "Morgan", "Taylor")
3. **leadAgentSystemPrompt**: A detailed system prompt that defines:
   - The aide's role and expertise as a personal professional
   - Their approach to serving the user
   - How they should communicate (professional but personable)
   - Key responsibilities and areas of focus

The system prompt should emphasize that this aide works directly for the user as their personal professional in this domain. It should be comprehensive (3-5 paragraphs).`;

  const userPrompt = isTeam
    ? `Team Name: ${entityName}
Mission: ${purpose}

Generate the team configuration.`
    : `Aide Name: ${entityName}
Purpose: ${purpose}

Generate the aide configuration.`;

  return generateLLMObject(
    [{ role: 'user', content: userPrompt }],
    EntityConfigurationSchema,
    systemPrompt,
    {
      temperature: 0.7,
      userId: options?.userId,
    }
  );
}
