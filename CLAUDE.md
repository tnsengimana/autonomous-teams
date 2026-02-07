# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Autonomous Agents is a TypeScript/Next.js application where users create agents that run continuously to fulfill a mission. Each agent has a system prompt, a knowledge graph, and runs in an autonomous iteration loop where it researches and learns using web search and graph tools.

**Key Concepts**:
- **Agent**: The central unit with a name, purpose, system prompt, and knowledge graph
- **Knowledge Graph (KGoT)**: Agent's accumulated knowledge stored as typed nodes and edges
- **Background Worker**: Runs agents in configurable iteration loops (default 5 min), calling the LLM with tools
- **OODA Loop**: The worker pipeline is a variant of the OODA (Observe → Orient → Decide → Act) loop — Query Identification identifies knowledge gaps, Researcher orients by actively gathering information, Insight Identification identifies patterns on the enriched graph, Analyzer decides by synthesizing insights, Adviser acts by producing recommendations
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

### Agent-Centric Architecture

The system is built around agents that run autonomously:

- **One Conversation Per Agent**: Each agent has a single conversation for user interaction
- **Knowledge Graph**: Each agent has a KGoT (Knowledge Graph of Thoughts) that stores learned knowledge
- **Background Iterations**: The worker runs each agent on its configured interval to work autonomously

### Core Components

**LLM & Tools** (`src/lib/llm/`)
- `llm.ts` - Provider abstraction (OpenAI, Anthropic, Gemini, LMStudio). Looks up user's encrypted API keys, falls back to env vars
- `knowledge-graph.ts` - Builds graph context block for LLM prompts
- `graph-types.ts` - Initializes node/edge types for new agents
- `conversation.ts` - Conversation management
- `memory.ts` - Memory extraction from user conversations
- `compaction.ts` - Conversation compaction via summary messages

**Tools** (`src/lib/llm/tools/`)
- `graph-tools.ts` - Knowledge graph manipulation (addGraphNode, addGraphEdge, queryGraph, addAgentAnalysisNode, addAgentAdviceNode, etc.)
- `tavily-tools.ts` - Web search tools (tavilySearch, tavilyExtract, tavilyResearch)
- `index.ts` - Tool registry, provides phase-specific tool sets (getAnalysisGenerationTools, getAdviceGenerationTools, etc.)

**Database** (`src/lib/db/`)
- PostgreSQL with Drizzle ORM
- Schema: users, agents, conversations, messages, memories, inboxItems, llmInteractions, workerIterations
- Knowledge Graph tables: graphNodeTypes, graphEdgeTypes, graphNodes, graphEdges
- `drizzle.config.ts` points to `src/lib/db/schema.ts`

**API Routes** (`src/app/api/agents/[id]/`)
- `route.ts` - Agent CRUD (GET, PATCH, DELETE)
- `worker-iterations/route.ts` - Worker iteration history (GET)
- `knowledge-graph/route.ts` - Knowledge graph visualization data (GET)
- `graph-node-types/route.ts` - Graph node type definitions (GET)
- `graph-edge-types/route.ts` - Graph edge type definitions (GET)
- All routes follow the same pattern: auth check → agent ownership check → query → JSON response

**Background Worker** (`src/worker/runner.ts`)
- Per-agent iteration loop based on `iterationIntervalMs`
- Each iteration runs the **Query Identification → Researcher → Insight Identification → Analyzer → Adviser** pipeline (a variant of the OODA loop):
  1. **Query Identification** (Observe): Scans graph, identifies knowledge gaps (queries)
  2. **Researcher** (Orient): For each query, runs Knowledge Acquisition (web research) + Graph Construction — actively gathers information rather than passively reorienting
  3. Rebuild graph context with enriched data
  4. **Insight Identification**: Scans enriched graph, identifies patterns (insights)
  5. **Analyzer** (Decide): For each insight, runs Analysis Generation (creates AgentAnalysis nodes)
  6. **Adviser** (Act): If analyses were produced, runs Advice Generation (may create AgentAdvice nodes)
- AgentAdvice node creation triggers user notifications via inbox items

**Authentication** (`src/lib/auth/config.ts`)
- NextAuth.js with passwordless magic links
- DrizzleAdapter for session persistence
- In dev, magic links log to console

### UI Architecture

**Agent Detail Layout** (`src/app/(dashboard)/agents/[id]/layout.tsx`)
- Server component handling auth + agent ownership
- Two-column layout: sidebar (back link + nav) | content (title + actions header + page content)
- `AgentHeaderActionsProvider` context allows subpages to inject page-specific actions into the content header

**Agent Detail Subpages** — all client-rendered, fetch data via API routes:
- Details (`page.tsx`) — mission, stats; header actions: Edit/Pause/Delete
- Chat (`chat/page.tsx`) — conversation UI; header actions: View System Prompt
- Worker Iterations (`worker-iterations/page.tsx`) — iteration history with collapsible LLM interaction details
- Knowledge Graph (`knowledge-graph/page.tsx`) — 3D graph visualization via reagraph
- Graph Node Types (`graph-node-types/page.tsx`) — collapsible cards showing type definitions
- Graph Edge Types (`graph-edge-types/page.tsx`) — collapsible cards with source/target constraints

**Key UI Components**:
- `AgentHeaderActions` / `AgentHeaderActionsSlot` (`src/components/agent-header-actions.tsx`) — React Context slot pattern for page-specific header actions
- `AgentDetailNav` (`src/components/agent-detail-nav.tsx`) — sidebar navigation with active state via `usePathname()`
- `AgentDetailTitle` (`src/components/agent-detail-title.tsx`) — dynamic "AgentName - SubPage" title based on route
- `AutoRefresh` (`src/components/auto-refresh.tsx`) — 60-second auto-refresh interval + manual Refresh button in header; accepts optional `onRefresh` callback for client-fetched pages

### Data Flow

**User Interaction (Foreground)**:
1. User sends message to agent via chat UI
2. Agent loads memories (user context)
3. Responds to user message
4. Can optionally use foreground tools (web search, graph queries)

**Autonomous Work (Background — OODA Loop)**:
1. Worker picks up active agent based on its iteration interval
2. **Query Identification** (Observe): Scans graph, identifies knowledge gaps (queries)
3. **Researcher** (Orient) for each query:
   - **Knowledge Acquisition**: Uses Tavily tools to research knowledge gap
   - **Graph Construction**: Structures acquired knowledge into typed graph nodes/edges
4. Rebuild graph context (now enriched with new data)
5. **Insight Identification**: Scans enriched graph, identifies patterns (insights)
6. **Analyzer** (Decide) for each insight:
   - **Analysis Generation**: Creates AgentAnalysis nodes from existing knowledge
7. **Adviser** (Act) if analyses were produced:
   - **Advice Generation**: Reviews AgentAnalysis nodes, may create AgentAdvice nodes which notify user
8. All phases logged to `llm_interactions` with phase tracking

### Key Patterns

- **Path alias**: `@/*` maps to `./src/*`
- **Mock mode**: Set `MOCK_LLM=true` in `.env.local` to run without real API calls
- **Encrypted API keys**: User API keys stored encrypted in `userApiKeys` table
- **Conversation compaction**: Summary messages compress old context via linked list (`previousMessageId`)
- **Single worker assumption**: One worker per deployment; concurrent workers would require locking
- **Client-rendered subpages**: All agent detail subpages are `"use client"` components that fetch data via API routes. This keeps the architecture simple — no server/client serialization issues, consistent data-fetching pattern, easy auto-refresh via `useCallback` + `setInterval`
- **Header action slots**: Subpages inject page-specific actions (Edit/Delete, Refresh, View System Prompt) into the layout header via React Context (`AgentHeaderActions`)

## Autonomous Operation

For agents to run autonomously:

1. **Agent status must be 'active'** - Set via UI or database
2. **Worker process must be running** - Start separately from dev server:
   ```bash
   npx ts-node --project tsconfig.json src/worker/index.ts
   ```
3. **Configurable iterations**: Each agent has `iterationIntervalMs` (default 5 minutes)
4. **Advice via notifications**: AgentAdvice nodes automatically create inbox notifications

## UI Guidelines

- **Emphasis colors are reserved for buttons only** — buttons can use `default` (black), `destructive` (red), etc. to signal intent clearly.
- **Badges & labels must use subtle, muted colors only** — use `secondary` (gray) or `outline` variants. Never use `default` (dark) or `destructive` (red) on badges/labels. This keeps the UI predictable: if something is colored, it's actionable.

## Workflow Preferences

**IMPORTANT - Plans Location**: ALL implementation plans go in `docs/plans/` with naming `<next-incrementing-number>-<topic>.md`. Never use `.claude/plans/` or any other location. This is non-negotiable. The incrementing number in front of the plan document is important must be the next line; this allows sorting plans in order they were applied to repositories, effectively being able to track changes made over time.

**Subagent Usage**: Always prefer to use subagents for implementation tasks:
1. **Implementation subagent** - Writes code, creates files, installs dependencies
2. **Review subagent** - Reviews implementation against plan/standards, then commits changes

**Keeping CLAUDE.md Updated**: Whenever working in this repository and something sounds like it's worth keeping in mind for the future (patterns, gotchas, decisions, learnings), update this CLAUDE.md file immediately.

**NEVER EVER rename files in docs/plans**: When you're engaged in refactoring to rename things, never ever rename documents in `docs/plans`. These documents represent a snapshot of the development of this codebase over time, and it doesn't make sense to rename the previous documents as the new plan document will fit nicely in the evolution timeline of this codebase, together with other plans documents.
