# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Autonomous Agents is a TypeScript/Next.js application where users create entities that run continuously to fulfill a mission. Each entity has a system prompt, a knowledge graph, and runs in a 5-minute iteration loop where it autonomously researches and learns using web search and graph tools.

**Key Concepts**:
- **Entity**: The central unit with a name, purpose, system prompt, and knowledge graph
- **Knowledge Graph (KGoT)**: Entity's accumulated knowledge stored as typed nodes and edges
- **Background Worker**: Runs entities in 5-minute iteration loops, calling the LLM with tools
- **LLM Interactions**: Trace of all background LLM calls stored for debugging/auditing

## Commands

```bash
# Start Postgres, run migrations, start web + worker. This is the preferred development workflow
docker compose up
```

Alternatively, if you want to use `npm` directly

```bash
# Development
npm run dev          # Start Next.js dev server
npm run build        # Build for production
npm run lint         # Run ESLint

# Background Worker (for autonomous operation)
npx ts-node --project tsconfig.json src/worker/index.ts  # Start worker process

# Database
docker compose up -d              # Start PostgreSQL (port 5433)
npx drizzle-kit generate          # Generate migrations from schema changes
npx drizzle-kit migrate           # Apply migrations
npx drizzle-kit studio            # Open Drizzle Studio UI
```

## Architecture

### Entity-Centric Architecture

The system is built around entities that run autonomously:

- **One Conversation Per Entity**: Each entity has a single conversation for user interaction
- **Knowledge Graph**: Each entity has a KGoT (Knowledge Graph of Thoughts) that stores learned knowledge
- **Background Iterations**: The worker calls the LLM every 5 minutes to let the entity work autonomously

### Core Components

**LLM & Tools** (`src/lib/agents/`)
- `llm.ts` - Provider abstraction (OpenAI, Anthropic, Gemini, LMStudio). Looks up user's encrypted API keys, falls back to env vars
- `knowledge-graph.ts` - Builds graph context block for LLM prompts
- `graph-type-initializer.ts` - Initializes node/edge types for new entities
- `conversation.ts` - Conversation management
- `memory.ts` - Memory extraction from user conversations
- `compaction.ts` - Conversation compaction via summary messages

**Tools** (`src/lib/agents/tools/`)
- `graph-tools.ts` - Knowledge graph manipulation (addGraphNode, addGraphEdge, queryGraph, etc.)
- `tavily-tools.ts` - Web search tools (tavilySearch, tavilyExtract, tavilyResearch)
- `index.ts` - Tool registry, provides `getBackgroundTools()` and `getForegroundTools()`

**Database** (`src/lib/db/`)
- PostgreSQL with Drizzle ORM
- Schema: users, entities, conversations, messages, memories, briefings, inboxItems, llmInteractions
- Knowledge Graph tables: graphNodeTypes, graphEdgeTypes, graphNodes, graphEdges
- `drizzle.config.ts` points to `src/lib/db/schema.ts`

**Background Worker** (`src/worker/runner.ts`)
- 5-minute iteration loop for each active entity
- Each iteration:
  1. Creates `llm_interaction` record
  2. Builds system prompt with graph context
  3. Calls LLM with graph and web search tools
  4. Saves response to `llm_interaction`
- Node creation can trigger user notifications (via `notifyUser` flag on node types)

**Authentication** (`src/lib/auth/config.ts`)
- NextAuth.js with passwordless magic links
- DrizzleAdapter for session persistence
- In dev, magic links log to console

### Data Flow

**User Interaction (Foreground)**:
1. User sends message to entity via chat UI
2. Entity loads memories (user context)
3. Responds to user message
4. Can optionally use foreground tools (web search, graph queries)

**Autonomous Work (Background)**:
1. Worker picks up active entity every 5 minutes
2. Builds system prompt with entity's purpose and graph context
3. Calls LLM with "Continue your work" prompt
4. LLM uses tools to:
   - Search the web (Tavily)
   - Query existing knowledge graph
   - Add new nodes/edges to graph
5. Response and tool calls logged to `llm_interactions`
6. If node type has `notifyUser=true`, creates inbox item

### Key Patterns

- **Path alias**: `@/*` maps to `./src/*`
- **Mock mode**: Set `MOCK_LLM=true` in `.env.local` to run without real API calls
- **Encrypted API keys**: User API keys stored encrypted in `userApiKeys` table
- **Conversation compaction**: Summary messages compress old context via linked list (`previousMessageId`)
- **Single worker assumption**: One worker per deployment; concurrent workers would require locking

## Autonomous Operation

For entities to run autonomously:

1. **Entity status must be 'active'** - Set via UI or database
2. **Worker process must be running** - Start separately from dev server:
   ```bash
   npx ts-node --project tsconfig.json src/worker/index.ts
   ```
3. **5-minute iterations**: Worker processes all active entities every 5 minutes
4. **Insights via notifications**: Configure node types with `notifyUser=true` to push discoveries to inbox

## Workflow Preferences

**IMPORTANT - Plans Location**: ALL implementation plans go in `docs/plans/` with naming `<next-incrementing-number>-<topic>.md`. Never use `.claude/plans/` or any other location. This is non-negotiable. The incrementing number in front of the plan document is important must be the next line; this allows sorting plans in order they were applied to repositories, effectively being able to track changes made over time.

**Subagent Usage**: Always prefer to use subagents for implementation tasks:
1. **Implementation subagent** - Writes code, creates files, installs dependencies
2. **Review subagent** - Reviews implementation against plan/standards, then commits changes

**Keeping CLAUDE.md Updated**: Whenever working in this repository and something sounds like it's worth keeping in mind for the future (patterns, gotchas, decisions, learnings), update this CLAUDE.md file immediately.

**NEVER EVER rename files in docs/plans**: When you're engaged in refactoring to rename things, never ever rename documents in `docs/plans`. These documents represent a snapshot of the development of this codebase over time, and it doesn't make sense to rename the previous documents as the new plan document will fit nicely in the evolution timeline of this codebase, together with other plans documents.
