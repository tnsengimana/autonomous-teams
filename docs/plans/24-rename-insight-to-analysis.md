# 24 - Rename Insight to Analysis

## Overview

This plan renames the "insight" concept across the codebase to "analysis." The goal is to free up the word "insight" for use as the Brain's pattern-recognition output in the upcoming worker loop architecture (see `docs/research/24-worker-loop-brain-planner.md`).

Specifically:
- **AgentInsight** node type becomes **AgentAnalysis**
- **Insight Synthesis** phase becomes **Analysis Generation** phase
- All related constants, functions, schema fields, tool names, and prompts are renamed accordingly

This is a pure rename/refactor with zero behavioral changes. The database will be nuked and migrations regenerated fresh.

## Current State

| Concept | Current Name |
|---------|-------------|
| Node type | `AgentInsight` |
| Node type constant | `AGENT_INSIGHT_NODE_TYPE` |
| Tool name | `addAgentInsightNode` |
| Tool variable | `addAgentInsightNodeTool` |
| Tool params schema | `AddAgentInsightNodeParamsSchema` |
| Tool params type | `AddAgentInsightNodeParams` |
| Tool set function | `getInsightSynthesisTools()` |
| Phase function | `runInsightSynthesisPhase()` |
| Meta-prompt constant | `INSIGHT_SYNTHESIS_META_PROMPT` |
| Zod schema field | `insightSynthesisSystemPrompt` |
| DB column | `insight_synthesis_system_prompt` |
| Phase string literal | `"insight_synthesis"` |
| Phase label in UI | `"Insight Synthesis"` |

## Target State

| Concept | New Name |
|---------|----------|
| Node type | `AgentAnalysis` |
| Node type constant | `AGENT_ANALYSIS_NODE_TYPE` |
| Tool name | `addAgentAnalysisNode` |
| Tool variable | `addAgentAnalysisNodeTool` |
| Tool params schema | `AddAgentAnalysisNodeParamsSchema` |
| Tool params type | `AddAgentAnalysisNodeParams` |
| Tool set function | `getAnalysisGenerationTools()` |
| Phase function | `runAnalysisGenerationPhase()` |
| Meta-prompt constant | `ANALYSIS_GENERATION_META_PROMPT` |
| Zod schema field | `analysisGenerationSystemPrompt` |
| DB column | `analysis_generation_system_prompt` |
| Phase string literal | `"analysis_generation"` |
| Phase label in UI | `"Analysis Generation"` |

## Exclusions (NOT renamed)

The following uses of "insight" are unrelated to the AgentInsight node type and must NOT be renamed:

1. **Memory type `"insight"`** in `src/lib/types.ts` (line 51), `src/lib/db/schema.ts` (line 141), `src/lib/llm/memory.ts` (lines 10, 30, 82-83, 123, 136, 138) -- This is a separate concept for user conversation memories (preference/insight/fact). It has nothing to do with the AgentInsight node type.

2. **Landing page copy** in `src/app/page.tsx` (lines 33, 73, 76) -- Marketing copy uses "insights" as a general English word. Not tied to the AgentInsight type.

3. **Tavily tool query** in `src/lib/llm/tools/tavily-tools.ts` (line 329) -- The string `"analysis and insights"` is a search query template. General English usage.

## Changes Required

### Phase 1: Database Schema

**File: `src/lib/db/schema.ts`**

1. Rename column `insightSynthesisSystemPrompt` to `analysisGenerationSystemPrompt`:
   ```typescript
   // Before:
   insightSynthesisSystemPrompt: text("insight_synthesis_system_prompt").notNull(),
   // After:
   analysisGenerationSystemPrompt: text("analysis_generation_system_prompt").notNull(),
   ```

2. Update phase comment on `llmInteractions.phase`:
   ```typescript
   // Before:
   phase: text("phase"), // 'classification' | 'insight_synthesis' | 'advice_generation' | ...
   // After:
   phase: text("phase"), // 'classification' | 'analysis_generation' | 'advice_generation' | ...
   ```

### Phase 2: Types

**File: `src/lib/types.ts`**

No changes needed. The `Agent` type is inferred from the Drizzle schema, so it will automatically pick up the renamed column. The `MemoryType = "preference" | "insight" | "fact"` is a separate concept and stays as-is.

### Phase 3: Graph Types Constants

**File: `src/lib/llm/graph-types.ts`**

1. Rename `AGENT_INSIGHT_NODE_TYPE` to `AGENT_ANALYSIS_NODE_TYPE` and update its internal values:
   ```typescript
   // Before:
   export const AGENT_INSIGHT_NODE_TYPE = {
     name: "AgentInsight",
     description: "Agent-derived observations and patterns from knowledge analysis",
     ...
   };
   // After:
   export const AGENT_ANALYSIS_NODE_TYPE = {
     name: "AgentAnalysis",
     description: "Agent-derived observations and patterns from knowledge analysis",
     ...
   };
   ```
   Update all internal string references: `"insight"` -> `"analysis"` in property descriptions (e.g., `"Brief 1-2 sentence summary of the insight"` -> `"Brief 1-2 sentence summary of the analysis"`).

2. Update `AGENT_ADVICE_NODE_TYPE` references to `AgentInsight` -> `AgentAnalysis`:
   - `description`: `"...derived exclusively from AgentInsight analysis"` -> `"...derived exclusively from AgentAnalysis analysis"`
   - `propertiesSchema.properties.content.description`: `"...citing ONLY AgentInsight nodes..."` -> `"...citing ONLY AgentAnalysis nodes..."`
   - `exampleProperties.content`: All references to `AgentInsight`, `AgentInsights`, `[node:insight-123]`, `[node:insight-456]` -> `AgentAnalysis`, `AgentAnalyses`, `[node:analysis-123]`, `[node:analysis-456]`

3. Update `createSeedNodeTypes()`:
   - All `AGENT_INSIGHT_NODE_TYPE` references -> `AGENT_ANALYSIS_NODE_TYPE`
   - Variable `insightExists` -> `analysisExists`
   - Log message: `"Created seed AgentInsight node type"` -> `"Created seed AgentAnalysis node type"`
   - JSDoc comment: `"AgentInsight"` -> `"AgentAnalysis"`

4. Update `persistInitializedTypes()`:
   - `AGENT_INSIGHT_NODE_TYPE` reference in the skip check -> `AGENT_ANALYSIS_NODE_TYPE`
   - Comment: `"AgentInsight, AgentAdvice"` -> `"AgentAnalysis, AgentAdvice"`

### Phase 4: Graph Tools

**File: `src/lib/llm/tools/graph-tools.ts`**

1. Rename `AddAgentInsightNodeParamsSchema` -> `AddAgentAnalysisNodeParamsSchema`:
   - Update all `.describe()` strings: `"insight"` -> `"analysis"`

2. Rename `AddAgentInsightNodeParams` type -> `AddAgentAnalysisNodeParams`

3. Rename `addAgentInsightNodeTool` -> `addAgentAnalysisNodeTool`:
   - `schema.name`: `'addAgentInsightNode'` -> `'addAgentAnalysisNode'`
   - `schema.description`: `'Create an AgentInsight node...'` -> `'Create an AgentAnalysis node...'`
   - All parameter descriptions: `"insight"` -> `"analysis"`
   - Handler: All `'AgentInsight'` string literals -> `'AgentAnalysis'`
   - Error messages: `'AgentInsight node type does not exist...'` -> `'AgentAnalysis node type does not exist...'`
   - Success message: `'Created AgentInsight'` -> `'Created AgentAnalysis'`
   - Error message: `'Failed to add AgentInsight node'` -> `'Failed to add AgentAnalysis node'`
   - Section comment: `"addAgentInsightNode Tool"` -> `"addAgentAnalysisNode Tool"`

4. Update `addAgentAdviceNodeTool`:
   - `properties.content.describe()`: `"citing ONLY AgentInsight nodes"` -> `"citing ONLY AgentAnalysis nodes"`
   - `schema.parameters.properties.description`: `"citing AgentInsight nodes"` -> `"citing AgentAnalysis nodes"`

5. Update `registerGraphTools()`:
   - `addAgentInsightNodeTool` -> `addAgentAnalysisNodeTool`

6. Update `getGraphToolNames()`:
   - `'addAgentInsightNode'` -> `'addAgentAnalysisNode'`

7. Update exports:
   - `addAgentInsightNodeTool` -> `addAgentAnalysisNodeTool`

### Phase 5: Tools Index

**File: `src/lib/llm/tools/index.ts`**

1. Rename `getInsightSynthesisTools()` -> `getAnalysisGenerationTools()`:
   - Update JSDoc comment: `"Insight Synthesis phase"` -> `"Analysis Generation phase"`
   - Update tool list comment: `"addAgentInsightNode"` -> `"addAgentAnalysisNode"`
   - Update filter array: `"addAgentInsightNode"` -> `"addAgentAnalysisNode"`

### Phase 6: Agent Configuration & Meta-Prompts

**File: `src/lib/llm/agents.ts`**

1. Rename `insightSynthesisSystemPrompt` in `AgentConfigurationSchema`:
   ```typescript
   // Before:
   insightSynthesisSystemPrompt: z.string().describe("System prompt for creating insights from existing knowledge"),
   // After:
   analysisGenerationSystemPrompt: z.string().describe("System prompt for creating analysis from existing knowledge"),
   ```

2. Rename `INSIGHT_SYNTHESIS_META_PROMPT` -> `ANALYSIS_GENERATION_META_PROMPT`:
   - Update all internal text:
     - `"INSIGHT SYNTHESIS SYSTEM PROMPT"` -> `"ANALYSIS GENERATION SYSTEM PROMPT"`
     - `"insight synthesis"` -> `"analysis generation"` / `"analysis"` as contextually appropriate
     - `"AgentInsight"` -> `"AgentAnalysis"` (all occurrences)
     - `"insights"` -> `"analyses"` when referring to the node type output
     - `"insight"` -> `"analysis"` when referring to individual nodes
     - `"insightSynthesisSystemPrompt"` -> `"analysisGenerationSystemPrompt"` in output requirements
     - `"Insight Types"` -> `"Analysis Types"`
     - `"Insight Properties"` -> `"Analysis Properties"`
     - `"Insight Discussion"` -> `"Analysis Discussion"` (section 4 of conversation meta-prompt)

3. Update `ADVICE_GENERATION_META_PROMPT`:
   - All `"AgentInsight"` -> `"AgentAnalysis"` (many occurrences throughout)
   - All `"insights"` -> `"analyses"` when referring to AgentInsight nodes

4. Update `CONVERSATION_META_PROMPT`:
   - Section 4 heading: `"Insight Discussion"` -> `"Analysis Discussion"`
   - Body text: `"insights"` -> `"analyses"` when referring to the node type
   - Note: Keep generic English "insights" if the context is about general knowledge/discovery

5. Update `getClassificationMetaPrompt()`:
   - `"synthesize insights"` -> `"synthesize analyses"` or keep as-is if it's the general English meaning (contextual decision)
   - `"insights"` in the description of "synthesize" action -> contextual rename
   - Note: The classification action is still `"synthesize"` -- we are NOT renaming the action itself

6. Update `getUnifiedMetaPrompt()`:
   - Section 3 title: `"INSIGHT SYNTHESIS"` -> `"ANALYSIS GENERATION"`
   - `"insightSynthesisSystemPrompt"` -> `"analysisGenerationSystemPrompt"`
   - `"AgentInsight"` -> `"AgentAnalysis"` throughout
   - `"Domain-specific insight types"` -> `"Domain-specific analysis types"`
   - `"Creates AgentInsight nodes"` -> `"Creates AgentAnalysis nodes"`
   - Reference to `INSIGHT_SYNTHESIS_META_PROMPT` -> `ANALYSIS_GENERATION_META_PROMPT`

### Phase 7: Database Queries

**File: `src/lib/db/queries/agents.ts`**

1. Update `createAgent()` function signature and body:
   - Parameter: `insightSynthesisSystemPrompt` -> `analysisGenerationSystemPrompt`
   - `.values()`: `insightSynthesisSystemPrompt: data.insightSynthesisSystemPrompt` -> `analysisGenerationSystemPrompt: data.analysisGenerationSystemPrompt`

**File: `src/lib/db/queries/llm-interactions.ts`**

1. Update `CreateLLMInteractionInput` interface comment:
   - `'insight_synthesis'` -> `'analysis_generation'`

**File: `src/lib/db/queries/worker-iterations.ts`**

1. Update phase order mapping:
   - `insight_synthesis: 1` -> `analysis_generation: 1`

### Phase 8: API Route

**File: `src/app/api/agents/route.ts`**

1. Update agent creation call:
   - `insightSynthesisSystemPrompt: config.insightSynthesisSystemPrompt` -> `analysisGenerationSystemPrompt: config.analysisGenerationSystemPrompt`

### Phase 9: Worker Runner

**File: `src/worker/runner.ts`**

1. Update import:
   - `getInsightSynthesisTools` -> `getAnalysisGenerationTools`

2. Rename `runInsightSynthesisPhase()` -> `runAnalysisGenerationPhase()`:
   - All log prefixes: `[InsightSynthesis]` -> `[AnalysisGeneration]`
   - `agent.insightSynthesisSystemPrompt` -> `agent.analysisGenerationSystemPrompt`
   - Error message: `"Agent missing insightSynthesisSystemPrompt"` -> `"Agent missing analysisGenerationSystemPrompt"`
   - User message content: `"Execute insight synthesis"` -> `"Execute analysis generation"`
   - `"AgentInsight nodes"` -> `"AgentAnalysis nodes"`
   - `"addAgentInsightNode"` -> `"addAgentAnalysisNode"`
   - `"insights"` -> `"analyses"` when referring to node type output
   - Phase literal: `"insight_synthesis"` -> `"analysis_generation"`
   - `getInsightSynthesisTools()` -> `getAnalysisGenerationTools()`
   - Comment: `"Get insight synthesis tools"` -> `"Get analysis generation tools"`

3. Update `runAdviceGenerationPhase()`:
   - `"AgentInsight"` -> `"AgentAnalysis"` in all user message content
   - `"AgentInsight coverage"` -> `"AgentAnalysis coverage"`
   - `"AgentInsight analysis"` -> `"AgentAnalysis analysis"`

4. Update `processAgentIteration()`:
   - `runInsightSynthesisPhase(` -> `runAnalysisGenerationPhase(`
   - Comment: `"new AgentInsight nodes"` -> `"new AgentAnalysis nodes"`
   - Comment: `"insight synthesis"` -> `"analysis generation"`

5. Update top-level module JSDoc comment:
   - `"create Insight nodes"` -> `"create Analysis nodes"`

6. Update classification schema `.describe()`:
   - `"create insights from existing knowledge"` -> `"create analyses from existing knowledge"`

7. Update classification user message:
   - `"derive meaningful insights"` -> `"derive meaningful analyses"`

### Phase 10: UI Components

**File: `src/app/(dashboard)/agents/[id]/worker-iterations/page.tsx`**

1. Update `getPhaseLabel()`:
   - `case "insight_synthesis": return "Insight Synthesis"` -> `case "analysis_generation": return "Analysis Generation"`

2. Update `getPhaseVariant()`:
   - `case "insight_synthesis"` -> `case "analysis_generation"`

### Phase 11: Test Files

All test files need `insightSynthesisSystemPrompt` renamed to `analysisGenerationSystemPrompt` in agent creation data, plus any `AgentInsight` / `addAgentInsightNode` references.

**File: `src/lib/db/__tests__/graph-schema.test.ts`**

- 5 occurrences of `insightSynthesisSystemPrompt` -> `analysisGenerationSystemPrompt` (lines 36, 141, 217, 459, 625)

**File: `src/lib/db/queries/__tests__/graph-data.test.ts`**

- 3 occurrences of `insightSynthesisSystemPrompt` -> `analysisGenerationSystemPrompt` (lines 58, 578, 650)

**File: `src/lib/db/queries/__tests__/graph-types.test.ts`**

- 3 occurrences of `insightSynthesisSystemPrompt` -> `analysisGenerationSystemPrompt` (lines 54, 67, 530)

**File: `src/lib/db/queries/__tests__/agents.test.ts`**

- 11 occurrences of `insightSynthesisSystemPrompt` -> `analysisGenerationSystemPrompt` (lines 58, 78, 106, 119, 155, 178, 207, 232, 261, 288, 318)

**File: `src/lib/llm/__tests__/graph-configuration.test.ts`**

- 6 occurrences of `insightSynthesisSystemPrompt` -> `analysisGenerationSystemPrompt` (lines 336, 379, 422, 467, 506, 569)
- `"AgentInsight"` string references -> `"AgentAnalysis"` (lines 349, 487, 489, 490, 506, 569, 591)

**File: `src/lib/llm/__tests__/knowledge-graph.test.ts`**

- 5 occurrences of `insightSynthesisSystemPrompt` -> `analysisGenerationSystemPrompt` (lines 48, 124, 172, 240, 291)

**File: `src/lib/llm/tools/__tests__/graph-tools.test.ts`**

This is the most heavily affected test file:
- 1 occurrence of `insightSynthesisSystemPrompt` -> `analysisGenerationSystemPrompt` (line 60)
- Import: `addAgentInsightNodeTool` -> `addAgentAnalysisNodeTool` (line 30)
- Import: `AddAgentInsightNodeParamsSchema` -> `AddAgentAnalysisNodeParamsSchema` (line 31)
- Node type name: `'AgentInsight'` -> `'AgentAnalysis'` (lines 101, 119, 146, etc.)
- `'AgentInsight analysis'` -> `'AgentAnalysis analysis'` (line 119)
- Describe block: `'addAgentInsightNode'` -> `'addAgentAnalysisNode'` (line 710)
- Variable: `createdInsightIds` -> `createdAnalysisIds` (lines 711, 714, 744, 768, 855)
- All `addAgentInsightNodeTool.handler` calls -> `addAgentAnalysisNodeTool.handler` (lines 718, 748, 772, 789, 806, 824, 841, 859, 876)
- Test names: `"insight"` -> `"analysis"` (lines 717, 747, 771, 788, 805, 823, 840)
- Success assertion: `'Created AgentInsight'` -> `'Created AgentAnalysis'` (line 740)
- Comment: `'AgentInsight does NOT create inbox items'` -> `'AgentAnalysis does NOT create inbox items'` (line 741)
- `'Invalid Insight'` -> `'Invalid Analysis'` in test data (lines 774, 791, 808, 826)
- `'This insight'` -> `'This analysis'` in test data (lines 777, 794, 822, 829, 846, 826)
- `'Insight Without Confidence'` -> `'Analysis Without Confidence'` (line 843)
- `'AgentInsights'` -> `'AgentAnalyses'` in advice node content (lines 918, 951, 974)
- `'[node:insight-123]'` -> `'[node:analysis-123]'` (lines 919, 994, 1213)
- `'[node:insight-456]'` -> `'[node:analysis-456]'` (line 920)
- `'[node:insight-789]'` -> `'[node:analysis-789]'` (line 952)
- `'[node:insight-101]'` -> `'[node:analysis-101]'` (line 975)
- Describe block: `'AddAgentInsightNodeParamsSchema'` -> `'AddAgentAnalysisNodeParamsSchema'` (line 1058)
- All `AddAgentInsightNodeParamsSchema.safeParse` calls -> `AddAgentAnalysisNodeParamsSchema.safeParse` (lines 1060, 1075, 1094, 1116, 1129, 1144, 1159, 1174, 1188)
- Test data names: `'Complete Insight'` -> `'Complete Analysis'` (line 1061)

### Phase 12: Database Migration

Since this is a destructive rename of a database column, nuke the database and regenerate migrations fresh:

1. Delete all existing migration files in `drizzle/` (or wherever they live)
2. Run `npx drizzle-kit generate` to regenerate from the updated schema
3. Run `npx drizzle-kit migrate` to apply

No data migration is needed -- the database is being nuked.

## File Changes Summary

| File | Type of Change |
|------|---------------|
| `src/lib/db/schema.ts` | Rename column `insightSynthesisSystemPrompt` -> `analysisGenerationSystemPrompt`, update phase comment |
| `src/lib/llm/graph-types.ts` | Rename `AGENT_INSIGHT_NODE_TYPE` -> `AGENT_ANALYSIS_NODE_TYPE`, update `AgentInsight` -> `AgentAnalysis` throughout, update `createSeedNodeTypes()`, update `persistInitializedTypes()` |
| `src/lib/llm/tools/graph-tools.ts` | Rename tool, schema, params, type, all string references from `Insight` -> `Analysis` |
| `src/lib/llm/tools/index.ts` | Rename `getInsightSynthesisTools()` -> `getAnalysisGenerationTools()`, update tool name in filter |
| `src/lib/llm/agents.ts` | Rename `insightSynthesisSystemPrompt` field, `INSIGHT_SYNTHESIS_META_PROMPT` -> `ANALYSIS_GENERATION_META_PROMPT`, update all prompt text |
| `src/lib/db/queries/agents.ts` | Rename parameter and field reference |
| `src/lib/db/queries/llm-interactions.ts` | Update phase comment |
| `src/lib/db/queries/worker-iterations.ts` | Update phase order key |
| `src/app/api/agents/route.ts` | Rename field reference |
| `src/worker/runner.ts` | Rename function, import, all log messages, phase literal, prompt references |
| `src/app/(dashboard)/agents/[id]/worker-iterations/page.tsx` | Update phase label and variant cases |
| `src/lib/db/__tests__/graph-schema.test.ts` | Rename field in test data (5 occurrences) |
| `src/lib/db/queries/__tests__/graph-data.test.ts` | Rename field in test data (3 occurrences) |
| `src/lib/db/queries/__tests__/graph-types.test.ts` | Rename field in test data (3 occurrences) |
| `src/lib/db/queries/__tests__/agents.test.ts` | Rename field in test data (11 occurrences) |
| `src/lib/llm/__tests__/graph-configuration.test.ts` | Rename field + `AgentInsight` string refs (6 + several occurrences) |
| `src/lib/llm/__tests__/knowledge-graph.test.ts` | Rename field in test data (5 occurrences) |
| `src/lib/llm/tools/__tests__/graph-tools.test.ts` | Extensive renames: imports, tool refs, test names, string literals, schema refs |
| Migration files | Nuke and regenerate fresh |

## Implementation Order

1. **Schema** (`src/lib/db/schema.ts`) -- rename column
2. **Graph types** (`src/lib/llm/graph-types.ts`) -- rename constant, update node type name, update seed functions
3. **Graph tools** (`src/lib/llm/tools/graph-tools.ts`) -- rename tool, schema, params, all string literals
4. **Tools index** (`src/lib/llm/tools/index.ts`) -- rename function, update filter
5. **Agents config** (`src/lib/llm/agents.ts`) -- rename Zod field, meta-prompt constant, all prompt text
6. **Queries** (`src/lib/db/queries/agents.ts`, `llm-interactions.ts`, `worker-iterations.ts`) -- rename field refs
7. **API route** (`src/app/api/agents/route.ts`) -- rename field ref
8. **Worker runner** (`src/worker/runner.ts`) -- rename function, import, phase literal, all messages
9. **UI** (`src/app/(dashboard)/agents/[id]/worker-iterations/page.tsx`) -- update phase cases
10. **Tests** (all test files) -- rename all field refs, tool refs, string literals
11. **Migrations** -- nuke existing, regenerate fresh, apply
12. **Verify** -- run `npm run build` and `npm run test` to confirm everything compiles and passes
