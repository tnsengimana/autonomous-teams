# Autonomous Teams - System Design

## Overview

Autonomous Teams is a TypeScript web application where users create teams of AI agents that run continuously to fulfill a mission. Each team has a hierarchy of agents that collaborate, learn from user interactions, and proactively deliver insights.

**Example: Hedge Fund Team**
- Portfolio Manager (Team Lead) - Holds user's risk profile, presents briefings
- Macro Scout - Watches global liquidity, Fed speeches, bond yields
- Equity Analyst - Deep dives into SEC filings, earnings calls
- Sentinel - Monitors social media for momentum signals

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Deployment | Monolith | Simplicity for initial development |
| Agent execution | Hybrid | Team leads run continuously, workers spawn on-demand |
| Frontend | Next.js | Full-stack TypeScript, API routes built-in |
| Database | PostgreSQL only | Simple, JSONB for flexible data, LISTEN/NOTIFY for real-time |
| LLM integration | Vercel AI SDK | Unified interface, streaming, thinking mode support |
| Authentication | NextAuth.js passwordless | Magic links, no passwords to manage |
| Background execution | Separate worker process | Isolates agent execution from web server |
| Agent communication | Postgres LISTEN/NOTIFY | Real-time without additional infrastructure |
| Memory extraction | Synchronous after each message | Immediate extraction while context is fresh |
| User communication | Hybrid | Streaming for chat, async inbox for proactive updates |

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Next.js Application                   │
├─────────────────────────────────────────────────────────┤
│  Frontend (React)          │  API Routes (REST/SSE)     │
│  - Dashboard               │  - /api/auth/*             │
│  - Team Management         │  - /api/teams/*            │
│  - Chat Interface          │  - /api/agents/*           │
│  - Inbox (Briefings)       │  - /api/messages/*         │
└─────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────┐
│              Separate Worker Process                     │
│  - Team Lead agents (always running)                    │
│  - Worker agents (spawned on-demand)                    │
│  - Memory extraction (sync after each message)          │
│  - Postgres LISTEN/NOTIFY for coordination              │
└─────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────┐
│                     PostgreSQL                           │
│  - Users, Teams, Agents, Conversations, Memories        │
│  - LISTEN/NOTIFY channels for real-time events          │
└─────────────────────────────────────────────────────────┘
```

## Local Development Setup

A `docker-compose.yml` file is required to spin up the entire stack for local development:

```yaml
services:
  postgres:
    image: postgres:16
    # Database for users, teams, agents, conversations, memories

  next-app:
    build: .
    # Next.js application (frontend + API routes)
    depends_on:
      - postgres

  worker:
    build: .
    command: npm run worker
    # Separate worker process for agent execution
    depends_on:
      - postgres
```

This allows developers to start all services with a single `docker compose up` command.

## Database Schema

```sql
-- Users and authentication
users (
  id uuid PRIMARY KEY,
  email text UNIQUE NOT NULL,
  email_verified_at timestamp,
  created_at timestamp,
  updated_at timestamp
)

user_api_keys (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users,
  provider text NOT NULL,  -- anthropic, openai, google, tavily, etc.
  encrypted_key text NOT NULL,
  created_at timestamp,
  updated_at timestamp
)

-- Teams and agents
teams (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users,
  name text NOT NULL,
  purpose text NOT NULL,  -- The team's mission
  status text NOT NULL,   -- active, paused, archived
  created_at timestamp,
  updated_at timestamp
)

agents (
  id uuid PRIMARY KEY,
  team_id uuid REFERENCES teams,
  parent_agent_id uuid REFERENCES agents,  -- null = team lead
  name text NOT NULL,
  role text NOT NULL,
  system_prompt text NOT NULL,
  status text NOT NULL,  -- idle, running, waiting
  created_at timestamp,
  updated_at timestamp
)

-- Conversations and memories
conversations (
  id uuid PRIMARY KEY,
  agent_id uuid REFERENCES agents,  -- One per agent lifetime
  created_at timestamp,
  updated_at timestamp
)

messages (
  id uuid PRIMARY KEY,
  conversation_id uuid REFERENCES conversations,
  role text NOT NULL,      -- user, assistant, system
  content text NOT NULL,
  thinking text,           -- Extended thinking content
  sequence_number integer NOT NULL,
  created_at timestamp
)

memories (
  id uuid PRIMARY KEY,
  agent_id uuid REFERENCES agents,
  content text NOT NULL,
  source_message_id uuid REFERENCES messages,
  created_at timestamp,
  updated_at timestamp
)

-- User inbox
inbox_items (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users,
  team_id uuid REFERENCES teams,
  type text NOT NULL,      -- briefing, signal, alert
  title text NOT NULL,
  content text NOT NULL,
  read_at timestamp,
  created_at timestamp
)
```

## Agent Core Runtime

### Agent Class

```typescript
class Agent {
  id: string;
  teamId: string;
  role: string;
  systemPrompt: string;
  conversation: Conversation;
  memories: Memory[];

  async handleMessage(message: string, from: 'user' | AgentId): Promise<string>;
  private async extractMemories(response: string): Promise<void>;
  private buildContext(): Message[];
}
```

### Message Flow

```
User sends message
       │
       ▼
┌──────────────────┐
│  Team Lead Agent │
│  ┌─────────────┐ │
│  │ 1. Load     │ │  ← Fetch memories from DB
│  │    memories │ │
│  ├─────────────┤ │
│  │ 2. Build    │ │  ← System prompt + memories + conversation history
│  │    context  │ │
│  ├─────────────┤ │
│  │ 3. Call LLM │ │  ← Vercel AI SDK, thinking mode enabled
│  │    (stream) │ │
│  ├─────────────┤ │
│  │ 4. Extract  │ │  ← Sync call: "What should I remember?"
│  │    memories │ │
│  ├─────────────┤ │
│  │ 5. Persist  │ │  ← Save message + new memories to DB
│  └─────────────┘ │
└──────────────────┘
       │
       ▼
Response streamed to user
```

### Memory Extraction

Called synchronously after each LLM response:

```
Given this conversation exchange, extract any information worth
remembering about the user, their preferences, or insights that
will help you perform your role better in the future.

Return as JSON array: [{"content": "...", "type": "preference|insight|fact"}]
Return empty array if nothing worth remembering.
```

## Agent Tools

### Shared Tools (All Agents)

**Tavily Integration** (requires user's Tavily API key):

| Tool | Description | Parameters |
|------|-------------|------------|
| `search` | Search the web for current information | `query`, `maxResults?` |
| `extract` | Extract structured content from a URL | `url` |
| `crawl` | Crawl a website to discover pages | `url`, `maxPages?` |
| `research` | Deep research on a topic with multiple sources | `topic`, `depth?` |

### Team Lead Tools

| Tool | Description |
|------|-------------|
| `delegateToAgent` | Assign a task to a worker agent |
| `createInboxItem` | Push briefing/signal to user inbox |
| `getTeamStatus` | Check status of all worker agents |

### Worker Agent Tools

| Tool | Description |
|------|-------------|
| `reportToLead` | Send results back to team lead |
| `requestInput` | Ask team lead for clarification |

## Team Orchestration

### Worker Agent Lifecycle

```
Team Lead decides to delegate
         │
         ▼
┌────────────────────────┐
│  NOTIFY 'agent_tasks'  │  ← Team lead writes task to DB + notifies
│  payload: {            │
│    agent_id,           │
│    task_type,          │
│    instruction         │
│  }                     │
└────────────────────────┘
         │
         ▼
┌────────────────────────┐
│  Worker spawns         │  ← Worker process listening, creates instance
│  (on-demand)           │
└────────────────────────┘
         │
         ▼
┌────────────────────────┐
│  Worker executes task  │  ← Handles message, extracts memories
└────────────────────────┘
         │
         ▼
┌────────────────────────┐
│  NOTIFY 'agent_results'│  ← Worker writes result + notifies team lead
└────────────────────────┘
         │
         ▼
Team Lead receives, continues
```

### Team Lead Continuous Loop

```typescript
async function runTeamLead(agent: Agent) {
  while (team.status === 'active') {
    // Check for user messages
    const userMessage = await pollForUserMessages(agent.teamId);
    if (userMessage) {
      await agent.handleMessage(userMessage);
    }

    // Periodic proactive check
    if (shouldRunProactiveCheck(agent)) {
      const briefing = await agent.generateBriefing();
      if (briefing.hasContent) {
        await createInboxItem(briefing);
      }
    }

    await sleep(1000);
  }
}
```

## User Interface

### Routes

| Path | Description |
|------|-------------|
| `/` | Landing page |
| `/login` | Magic link login |
| `/dashboard` | Overview of teams + inbox |
| `/inbox` | All briefings/signals |
| `/teams` | List of user's teams |
| `/teams/new` | Create new team wizard |
| `/teams/[id]` | Team detail (edit, delete, navigation) |
| `/teams/[id]/inbox` | Team-specific briefings and signals |
| `/teams/[id]/chat` | Chat with team lead |
| `/teams/[id]/agents` | Manage team agents |
| `/teams/[id]/agents/[agentId]` | Direct chat with agent |
| `/settings` | API keys for supported providers |
| `/profile` | User profile (read-only) |

### Post-Login User Flow

After a user logs in, they land on the dashboard with the following elements:

1. **Teams List** - Shows all teams owned by the user
   - Each team displays name and status (active/paused/archived)
   - Click on a team to navigate to `/teams/[id]`

2. **Create Team Button** - Navigates to `/teams/new`

3. **Settings Button** - Navigates to `/settings` for API key management
   - Configure API keys for supported providers (Anthropic, OpenAI, Google, Tavily, etc.)

4. **Profile Button** - Navigates to `/profile` (read-only for now)

### Team Detail View (`/teams/[id]`)

When clicking on a team from the list:

- **Team Details** - Name, purpose, status, creation date
- **Edit Button** - Modify team name and purpose
- **Delete Button** - Archive/delete the team (with confirmation)
- **Go to Inbox** - Navigate to `/teams/[id]/inbox` for team-specific briefings
- **Go to Chat** - Navigate to `/teams/[id]/chat` to interact with the team lead

### Dashboard Layout

```
┌─────────────────────────────────────────────────────────┐
│  Autonomous Teams                    [Settings] [Logout]│
├───────────────┬─────────────────────────────────────────┤
│               │                                         │
│  Teams        │  Inbox (3 unread)                       │
│  ─────────    │  ─────────────────                      │
│  • Hedge Fund │  🔔 [Urgent] BTC volatility spike       │
│    (active)   │     Sentinel • 2 hours ago              │
│               │                                         │
│  • Research   │  📊 Daily Briefing                      │
│    (paused)   │     Portfolio Manager • 8 hours ago     │
│               │                                         │
│  [+ New Team] │  📈 Opportunity: NVDA earnings play     │
│               │     Equity Analyst • 1 day ago          │
│               │                                         │
└───────────────┴─────────────────────────────────────────┘
```

### Team Chat Interface

```
┌─────────────────────────────────────────────────────────┐
│  ← Back    Hedge Fund Team                    [Agents ▼]│
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Portfolio Manager (Team Lead)                    │   │
│  │ Good morning. Based on overnight analysis...     │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ You                                              │   │
│  │ What's the risk level on that NVDA play?        │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Portfolio Manager                                │   │
│  │ Let me check with the Equity Analyst...         │   │
│  │ [Thinking: Delegating to analyze SEC filings...]│   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  [Type your message...]                        [Send]   │
└─────────────────────────────────────────────────────────┘
```

## Project Structure

```
autonomous-teams/
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── (auth)/               # Auth pages (login, verify)
│   │   ├── (dashboard)/          # Protected pages
│   │   │   ├── dashboard/
│   │   │   ├── inbox/
│   │   │   ├── teams/
│   │   │   └── settings/
│   │   ├── api/                  # API routes
│   │   │   ├── auth/             # NextAuth endpoints
│   │   │   ├── teams/
│   │   │   ├── agents/
│   │   │   └── messages/
│   │   └── layout.tsx
│   │
│   ├── lib/
│   │   ├── db/                   # Database layer
│   │   │   ├── schema.ts         # Drizzle schema
│   │   │   ├── client.ts         # Postgres client
│   │   │   └── queries/          # Query functions
│   │   │
│   │   ├── auth/                 # NextAuth config
│   │   │
│   │   ├── agents/               # Agent Core
│   │   │   ├── agent.ts          # Base Agent class
│   │   │   ├── conversation.ts   # Conversation management
│   │   │   ├── memory.ts         # Memory extraction
│   │   │   └── llm.ts            # Vercel AI SDK wrapper
│   │   │
│   │   ├── teams/                # Team Orchestration
│   │   │   ├── team-lead.ts      # Team lead logic
│   │   │   ├── worker.ts         # Worker agent logic
│   │   │   ├── coordinator.ts    # LISTEN/NOTIFY handling
│   │   │   └── inbox.ts          # Inbox item creation
│   │   │
│   │   └── tools/                # Agent tools
│   │       ├── tavily.ts         # Tavily integration
│   │       ├── team-lead-tools.ts
│   │       └── worker-tools.ts
│   │
│   ├── components/               # React components
│   │   ├── ui/                   # Base UI components
│   │   ├── chat/                 # Chat interface
│   │   ├── inbox/                # Inbox components
│   │   └── teams/                # Team management
│   │
│   └── worker/                   # Separate worker process
│       ├── index.ts              # Entry point
│       ├── runner.ts             # Agent runner loop
│       └── spawner.ts            # On-demand worker spawning
│
├── drizzle/                      # DB migrations
├── package.json
├── tsconfig.json
├── next.config.js
└── docker-compose.yml            # Spins up entire stack (Postgres, Next.js, Worker)
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `next` | Framework |
| `next-auth` | Authentication |
| `drizzle-orm` + `postgres` | Database |
| `ai` (Vercel AI SDK) | LLM integration |
| `@tavily/core` | Web search tools |
| `tailwindcss` | Styling |

## Development Tracks (Parallel Implementation)

### Track 1: Infrastructure
- Next.js project setup with TypeScript
- PostgreSQL + Drizzle ORM schema and migrations
- NextAuth.js passwordless authentication
- User API keys management (encrypted storage)
- Basic UI shell (layout, navigation, Tailwind)
- Settings page for API key management

### Track 2: Agent Core
- Base Agent class with conversation management
- Vercel AI SDK integration with thinking mode
- Memory extraction (sync after each message)
- Tool execution framework
- Tavily tools integration (search, extract, crawl, research)
- LLM context building (system prompt + memories + history)

### Track 3: Team Orchestration
- Team lead continuous runner loop
- Worker agent on-demand spawning
- Postgres LISTEN/NOTIFY coordinator
- Team lead tools (delegateToAgent, createInboxItem, getTeamStatus)
- Worker tools (reportToLead, requestInput)
- Inbox item creation and delivery
- Proactive briefing generation

### Track Dependencies

```
Track 1 (Infrastructure)  ──→  Track 2 needs: DB schema, API keys
         │
         └──────────────────→  Track 3 needs: DB schema, user context

Track 2 (Agent Core)  ──────→  Track 3 needs: Agent class, tools framework
```

### Sequencing

1. All tracks start immediately
2. Track 1 delivers DB schema first (unblocks 2 & 3)
3. Track 2 delivers Agent class (unblocks Track 3 team orchestration)
4. Tracks converge for integration
