# Plan 8: Simplify Team Creation with LLM Generation

## Overview

Simplify the team creation UX by having users provide only the team name and mission/objective. The system will automatically generate the team description, team lead name, and system prompt using LLM.

## Current State

**UI Form** (`src/app/(dashboard)/teams/new/page.tsx`):
- 5 fields: team name, description, mission, lead agent name, lead agent system prompt
- All fields required

**API** (`src/app/api/teams/route.ts`):
- Accepts all 5 fields
- Creates team with `purpose` = description + mission
- Creates agent with user-provided name and system prompt

## Target State

**UI Form**:
- 2 fields: team name, mission/objective
- Simpler, faster UX

**API**:
- Accepts team name and mission
- Calls LLM to generate: team description, lead agent name, lead agent system prompt
- Creates team and agent with generated values

## Implementation

### Step 1: Create Team Setup Generation Module

**File**: `src/lib/agents/team-configuration.ts` (new)

```typescript
import { z } from 'zod';
import { generateLLMObject } from './llm';

const TeamSetupSchema = z.object({
  teamDescription: z.string().describe('A concise description of the team'),
  leadAgentName: z.string().describe('A professional name for the team lead agent'),
  leadAgentSystemPrompt: z.string().describe('System prompt defining the agent personality and approach'),
});

export type TeamSetup = z.infer<typeof TeamSetupSchema>;

export async function generateTeamSetup(
  teamName: string,
  mission: string,
  options?: { userId?: string }
): Promise<TeamSetup> {
  const systemPrompt = `You are a team configuration assistant. Given a team name and mission, generate the configuration for an autonomous AI team.

Generate:
1. **teamDescription**: A one sentence description of what this team does
2. **leadAgentName**: A professional name for the team lead (e.g., "Alex", "Jordan", "Morgan")
3. **leadAgentSystemPrompt**: A detailed system prompt that defines:
   - The agent's role and expertise
   - Their approach to fulfilling the mission
   - How they should communicate and collaborate
   - Key responsibilities

The system prompt should be comprehensive (3-5 paragraphs) and tailored to the specific mission.`;

  const userPrompt = `Team Name: ${teamName}
Mission: ${mission}

Generate the team configuration.`;

  return generateLLMObject({
    schema: TeamSetupSchema,
    system: systemPrompt,
    prompt: userPrompt,
    options: {
      temperature: 0.7,
      userId: options?.userId,
    },
  });
}
```

### Step 2: Update API Route

**File**: `src/app/api/teams/route.ts`

Changes:
- Update Zod schema to only require `name` and `mission`
- Remove `description`, `leadAgentName`, `leadAgentPrompt` from schema
- Call `generateTeamSetup()` to get generated values
- Use generated values when creating team and agent

```typescript
const createTeamSchema = z.object({
  name: z.string().min(1, 'Team name is required'),
  mission: z.string().min(1, 'Mission is required'),
});

// In POST handler:
const { name, mission } = createTeamSchema.parse(body);

// Generate team setup using LLM
const setup = await generateTeamSetup(name, mission, { userId: user.id });

// Create team with generated description
const team = await createTeam({
  userId: user.id,
  name,
  purpose: `${setup.teamDescription}\n\nMission: ${mission}`,
  status: 'active',
});

// Create agent with generated name and prompt
const teamLead = await createAgent({
  teamId: team.id,
  parentAgentId: null,
  name: setup.leadAgentName,
  role: 'team_lead',
  systemPrompt: setup.leadAgentSystemPrompt,
  status: 'idle',
});
```

### Step 3: Simplify UI Form

**File**: `src/app/(dashboard)/teams/new/page.tsx`

Changes:
- Remove description, leadAgentName, leadAgentPrompt fields
- Keep only name and mission fields
- Update form state and handleChange
- Update submit button text to indicate generation happening

```tsx
const [formData, setFormData] = useState({
  name: '',
  mission: '',
});

// Form fields:
// 1. Team Name (text input)
// 2. Mission (textarea - expanded for detailed input)
```

### Step 4: Add Loading State Enhancement

Since LLM generation takes time, improve the loading state:
- Change button text to "Creating team..." during submission
- Consider adding a brief explanation that the system is configuring the team

## Files to Modify

| File | Action |
|------|--------|
| `src/lib/agents/team-configuration.ts` | Create new |
| `src/app/api/teams/route.ts` | Modify |
| `src/app/(dashboard)/teams/new/page.tsx` | Modify |

## Verification

1. **Start the app**: `docker compose up`
2. **Navigate to**: http://localhost:3000/teams/new
3. **Verify form**: Only shows team name and mission fields
4. **Submit form**: Enter team name and mission, click create
5. **Verify team created**: Check that team has generated description
6. **Verify agent created**: Check that team lead has generated name and system prompt
7. **Check worker logs**: Verify bootstrap task is queued and processed
