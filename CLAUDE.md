# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Autonomous Teams is a TypeScript/Next.js application where users create teams of AI agents that run continuously to fulfill a mission. Teams have hierarchical agents (team leads run continuously, workers spawn on-demand) that collaborate, extract insights from work sessions, and proactively deliver briefings to users.

## Commands

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

### Foreground/Background Architecture

The system separates user interactions (foreground) from agent work (background):

**Conversations vs Threads**:
- **Conversations**: User-Agent interaction (permanent, UI-visible, one per agent). Used for foreground communication.
- **Threads**: Background work sessions (ephemeral, internal only, many per agent). Created when processing tasks, discarded after insight extraction.

**Memories vs Insights**:
- **Memories**: User interaction context (preferences, past requests). Extracted from user conversations. Sent to LLM in **foreground only**.
- **Insights**: Professional knowledge base (domain expertise, techniques, patterns, facts). Extracted from work threads. Sent to LLM in **background only**.

### Core Components

**Agent Runtime** (`src/lib/agents/`)
- `agent.ts` - Agent class with foreground/background separation:
  - `handleUserMessage()` - Foreground: quick ack + queue task, returns immediately
  - `runWorkSession()` - Background: process queue in thread, extract insights, decide briefing
  - `processTaskInThread()` - Per-task processing with tools within a thread
  - `extractInsightsFromThread()` - Post-session professional learning (via `insights.ts`)
  - `decideBriefing()` - Team lead briefing decision after work session
- `memory.ts` - Memory extraction from user conversations using `generateObject()`
- `insights.ts` - Insight extraction from work threads (professional knowledge)
- `thread.ts` - Thread lifecycle management (create, add messages, compact, complete)
- `taskQueue.ts` - Task queue operations (queue, claim, complete)
- `llm.ts` - Provider abstraction (OpenAI, Anthropic, Gemini). Looks up user's encrypted API keys, falls back to env vars

**Database** (`src/lib/db/`)
- PostgreSQL with Drizzle ORM
- Schema: users, teams, agents, conversations, messages, memories, threads, threadMessages, insights, agentTasks, inboxItems
- `drizzle.config.ts` points to `src/lib/db/schema.ts`

**Background Worker** (`src/worker/runner.ts`)
- Event-driven + timer-based execution:
  - **Event-driven**: Tasks queued via `notifyTaskQueued()` trigger immediate processing
  - **Timer-based**: Team leads scheduled for 1-hour proactive runs via `nextRunAt`
- Workers are purely reactive (only triggered when work in queue)
- Team leads are proactive (1-hour trigger to further mission)
- Calls `agent.runWorkSession()` for thread-based task processing

**Authentication** (`src/lib/auth/config.ts`)
- NextAuth.js with passwordless magic links
- DrizzleAdapter for session persistence
- In dev, magic links log to console

### Data Flow

**Foreground (User Interaction)**:
1. User sends message to Team Lead
2. Agent loads MEMORIES (user context)
3. Generates quick contextual acknowledgment
4. Queues task for background processing
5. Returns acknowledgment immediately

**Background (Work Session)**:
1. Task picked up from queue (event-driven or scheduled)
2. New thread created for work session
3. Agent loads INSIGHTS (professional knowledge)
4. Processes task with tools in thread
5. After queue empty: extracts insights from thread
6. Team lead only: decides whether to brief user
7. Thread marked completed, next run scheduled

### Key Patterns

- **Path alias**: `@/*` maps to `./src/*`
- **Mock mode**: Set `MOCK_LLM=true` in `.env.local` to run without real API calls
- **Encrypted API keys**: User API keys stored encrypted in `userApiKeys` table
- **Team hierarchy**: Team leads have `parentAgentId = null`, workers reference their lead
- **Memories vs Insights**: Memories store user interaction context. Insights are the agent's professional knowledge base.
- **Thread lifecycle**: created -> active -> insight extraction -> completed
- **Thread compaction**: Mid-session context management when thread exceeds 50 messages
- **Professional growth**: Insights accumulate as expertise from work sessions

## Autonomous Operation

For teams to run autonomously and deliver proactive insights:

1. **Team status must be 'active'** - Set via UI or database
2. **Worker process must be running** - Start separately from dev server:
   ```bash
   npx ts-node --project tsconfig.json src/worker/index.ts
   ```
3. **Event-driven**: Tasks queued trigger immediate processing via `notifyTaskQueued()`
4. **Timer-based**: Team leads auto-scheduled for 1-hour proactive runs
5. Team leads can delegate to workers and push briefings to user inbox

## Design Document

Full system design with diagrams, tool definitions, and development tracks: `docs/plans/2026-01-25-autonomous-teams-design.md`

## Workflow Preferences

**Subagent Usage**: Always prefer to use subagents for implementation tasks:
1. **Implementation subagent** - Writes code, creates files, installs dependencies
2. **Review subagent** - Reviews implementation against plan/standards, then commits changes

**Keeping CLAUDE.md Updated**: Whenever working in this repository and something sounds like it's worth keeping in mind for the future (patterns, gotchas, decisions, learnings), update this CLAUDE.md file immediately.
