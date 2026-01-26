import { z } from 'zod';
import { generateLLMObject } from './llm';

/**
 * Schema for the generated team configuration
 */
const TeamConfigurationSchema = z.object({
  teamDescription: z.string().describe('A one sentence description of what this team does'),
  leadAgentName: z.string().describe('A professional name for the team lead agent'),
  leadAgentSystemPrompt: z.string().describe('System prompt defining the agent personality and approach'),
});

export type TeamConfiguration = z.infer<typeof TeamConfigurationSchema>;

/**
 * Generate team configuration (description, lead agent name, system prompt) from team name and mission.
 * Uses LLM to create appropriate values based on the mission.
 */
export async function generateTeamConfiguration(
  teamName: string,
  mission: string,
  options?: { userId?: string }
): Promise<TeamConfiguration> {
  const systemPrompt = `You are a team configuration assistant. Given a team name and mission, generate the configuration for an autonomous AI team.

Generate:
1. **teamDescription**: A one sentence description of what this team does
2. **leadAgentName**: A professional name for the team lead (e.g., "Alex", "Jordan", "Morgan", "Taylor")
3. **leadAgentSystemPrompt**: A detailed system prompt that defines:
   - The agent's role and expertise
   - Their approach to fulfilling the mission
   - How they should communicate and collaborate
   - Key responsibilities

The system prompt should be comprehensive (3-5 paragraphs) and tailored to the specific mission.`;

  const userPrompt = `Team Name: ${teamName}
Mission: ${mission}

Generate the team configuration.`;

  return generateLLMObject(
    [{ role: 'user', content: userPrompt }],
    TeamConfigurationSchema,
    systemPrompt,
    {
      temperature: 0.7,
      userId: options?.userId,
    }
  );
}
