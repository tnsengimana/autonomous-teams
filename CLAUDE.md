# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Autonomous Teams is a TypeScript/Next.js application where users create teams of AI agents that run continuously to fulfill a mission. Teams have hierarchical agents (team leads run continuously, workers spawn on-demand) that collaborate, extract memories from conversations, and proactively deliver insights to users.

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

### Core Components

**Agent Runtime** (`src/lib/agents/`)
- `agent.ts` - Base Agent class with conversation management, memory loading, and LLM interaction
- `memory.ts` - Synchronous memory extraction after each LLM response using Vercel AI SDK's `generateObject()`
- `llm.ts` - Provider abstraction layer (OpenAI implemented, Anthropic-ready). Looks up user's encrypted API keys, falls back to env vars

**Database** (`src/lib/db/`)
- PostgreSQL with Drizzle ORM
- Schema: users, teams, agents (hierarchical via parentAgentId), conversations (one per agent lifetime), messages, memories, inboxItems
- `drizzle.config.ts` points to `src/lib/db/schema.ts`

**Background Worker** (`src/worker/runner.ts`)
- Registered via `instrumentation.ts` in nodejs runtime
- Polls every 5 seconds for active team leads (agents with no parent)
- Calls `agent.runCycle()` for proactive behavior

**Authentication** (`src/lib/auth/config.ts`)
- NextAuth.js with passwordless magic links
- DrizzleAdapter for session persistence
- In dev, magic links log to console

### Data Flow

1. User sends message → Team Lead Agent
2. Agent loads memories from DB
3. Builds context: system prompt + memories + conversation history
4. Calls LLM via Vercel AI SDK
5. Extracts memories synchronously from response
6. Persists message + new memories to DB
7. Response streamed to user

### Key Patterns

- **Path alias**: `@/*` maps to `./src/*`
- **Mock mode**: Set `MOCK_LLM=true` in `.env.local` to run without real API calls
- **Encrypted API keys**: User API keys stored encrypted in `userApiKeys` table
- **Team hierarchy**: Team leads have `parentAgentId = null`, workers reference their lead

## Autonomous Operation

For teams to run autonomously and deliver proactive insights:

1. **Team status must be 'active'** - Set via UI or database
2. **Worker process must be running** - Start separately from dev server with:
   ```bash
   npx ts-node --project tsconfig.json src/worker/index.ts
   ```
3. Worker polls every 5 seconds for active team leads and runs their cycles
4. Team leads can delegate to workers and push items to user inbox

## Design Document

Full system design with diagrams, tool definitions, and development tracks: `docs/plans/2026-01-25-autonomous-teams-design.md`

## Workflow Preferences

**Subagent Usage**: Always prefer to use subagents for implementation tasks:
1. **Implementation subagent** - Writes code, creates files, installs dependencies
2. **Review subagent** - Reviews implementation against plan/standards, then commits changes

**Keeping CLAUDE.md Updated**: Whenever working in this repository and something sounds like it's worth keeping in mind for the future (patterns, gotchas, decisions, learnings), update this CLAUDE.md file immediately.
