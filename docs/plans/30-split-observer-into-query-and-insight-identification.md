# Plan 30: Split Observer into Query Identification and Insight Identification

## Context

The current Observer phase runs a single LLM call that produces both queries (knowledge gaps) and insights (patterns) before any research happens. This means insights are identified on the **pre-research** graph state, not the enriched graph. By splitting the Observer into two phases — Query Identification (before research) and Insight Identification (after research) — insights run on the freshly enriched graph, producing higher quality analysis.

Additionally, `workerIterations.observerOutput` is a denormalized copy of data already stored in `llmInteractions.response`. We remove it to simplify the schema.

**Current pipeline:**
```
Observer (queries + insights) → Research (per query) → Rebuild graph → Analyzer (per insight) → Adviser
```

**Target pipeline:**
```
Query Identification (queries) → Research (per query) → Rebuild graph → Insight Identification (insights) → Analyzer (per insight) → Adviser
```

## Steps

### Step 1: Update DB schema

**File:** `src/lib/db/schema.ts`

**Agents table** (lines 99-112):
- Remove: `observerSystemPrompt` column
- Add: `queryIdentificationSystemPrompt: text("query_identification_system_prompt").notNull()`
- Add: `insightIdentificationSystemPrompt: text("insight_identification_system_prompt").notNull()`

**Worker iterations table** (line 184):
- Remove: `observerOutput: jsonb("observer_output")` column

**Migration:** Database is empty so no data migration needed. We regenerate all migrations from scratch and nuke the DB.

### Step 2: Update worker types

**File:** `src/worker/types.ts`

Add two new output types:

```typescript
export interface QueryIdentificationOutput extends Record<string, unknown> {
  queries: ObserverQuery[];
}

export interface InsightIdentificationOutput extends Record<string, unknown> {
  insights: ObserverInsight[];
}
```

Remove `ObserverOutput` (no longer needed — it was only used to store on the worker iteration).

### Step 3: Split `runObserverPhase()` into two functions in the worker runner

**File:** `src/worker/runner.ts`

**3a. Replace `ObserverOutputSchema` with two Zod schemas:**
- `QueryIdentificationOutputSchema` — `{ queries: z.array(ObserverQuerySchema) }`
- `InsightIdentificationOutputSchema` — `{ insights: z.array(ObserverInsightSchema) }`

**3b. Replace `runObserverPhase()` with:**
- `runQueryIdentificationPhase(agent, graphContext, workerIterationId)` → `QueryIdentificationOutput`
  - Uses `agent.queryIdentificationSystemPrompt`
  - Phase: `"query_identification"`
  - User message asks to identify knowledge gaps only
  - No normalization needed (queries don't reference node IDs)
- `runInsightIdentificationPhase(agent, graphContext, workerIterationId)` → `InsightIdentificationOutput`
  - Uses `agent.insightIdentificationSystemPrompt`
  - Phase: `"insight_identification"`
  - User message asks to identify patterns only
  - Normalizes `relevantNodeIds` (existing logic from `normalizeObserverOutput`)

**3c. Restructure `processAgentIteration()`:**
```
Step 1: Query Identification → queryOutput
Step 2: Researcher (for each query) → knowledge acquisition + graph construction
Step 3: Rebuild graph context (enriched)
Step 4: Insight Identification (on enriched graph) → insightOutput
Step 5: Analyzer (for each insight)
Step 6: Adviser (if analyses produced)
```

Remove the `updateWorkerIteration({ observerOutput })` call — no longer storing observer output.

**3d. Update imports, header comment, log messages.**

### Step 4: Rename normalization function

**File:** `src/worker/normalization.ts`

- Rename `normalizeObserverOutput` → `normalizeInsightIdentificationOutput`
- Change input type from `ObserverOutput` to `InsightIdentificationOutput`
- Update log prefixes from `[Observer]` to `[InsightIdentification]`

**File:** `src/worker/__tests__/normalization.test.ts`
- Rename function references
- Remove `queries` from test fixtures (now only `{ insights: [...] }`)

### Step 5: Split Observer meta-prompt and update agent configuration

**File:** `src/lib/llm/agents.ts`

**5a. Replace `getObserverMetaPrompt(interval)` with two functions:**
- `getQueryIdentificationMetaPrompt(interval)` — focuses on graph state analysis + query generation + output balance/quality for queries only
- `getInsightIdentificationMetaPrompt(interval)` — focuses on graph state analysis + insight generation + output balance/quality for insights only

**5b. Update `AgentConfigurationSchema`:**
- Remove: `observerSystemPrompt`
- Add: `queryIdentificationSystemPrompt` and `insightIdentificationSystemPrompt`
- Count changes from 6 → 7 system prompts

**5c. Update `getUnifiedMetaPrompt()`:**
- Replace single `### 2. observerSystemPrompt` section with `### 2. queryIdentificationSystemPrompt` and `### 3. insightIdentificationSystemPrompt`
- Renumber remaining sections (3→4, 4→5, 5→6, 6→7)
- Update pipeline description and "SIX" → "SEVEN"

**5d. Update `generateAgentConfiguration()` user prompt** — reference 7 prompts, update pipeline description.

### Step 6: Update agent CRUD

**File:** `src/lib/db/queries/agents.ts` (lines 20-47)
- Replace `observerSystemPrompt` with `queryIdentificationSystemPrompt` + `insightIdentificationSystemPrompt` in `createAgent()` params and `.values()` call

**File:** `src/app/api/agents/route.ts` (lines 67-79)
- Replace `observerSystemPrompt: config.observerSystemPrompt` with the two new fields

### Step 7: Remove `observerOutput` from worker iteration queries

**File:** `src/lib/db/queries/worker-iterations.ts`

- Remove `observerOutput` from `WorkerIteration` interface (line 19)
- Remove `observerOutput` from `UpdateWorkerIterationInput` interface (line 43)
- Remove all `observerOutput` field mappings in query return values (lines 70, 145, 188, 217)
- Update `phaseOrder` map (lines 153-159):
```typescript
const phaseOrder: Record<string, number> = {
  query_identification: 0,
  knowledge_acquisition: 1,
  graph_construction: 2,
  insight_identification: 3,
  analysis_generation: 4,
  advice_generation: 5,
};
```

### Step 8: Update worker iterations UI

**File:** `src/app/(dashboard)/agents/[id]/worker-iterations/page.tsx`

**8a. Remove `observerOutput` from the `WorkerIteration` interface** (line 36).

**8b. Derive the output summary from llmInteractions** instead of `observerOutput`.

Replace the `outputSummary` logic (lines 173-175) — extract counts from the `query_identification` and `insight_identification` phase interaction responses:

```typescript
const queryInteraction = iteration.llmInteractions.find(i => i.phase === "query_identification");
const insightInteraction = iteration.llmInteractions.find(i => i.phase === "insight_identification");
const queryCount = (queryInteraction?.response as any)?.queries?.length ?? 0;
const insightCount = (insightInteraction?.response as any)?.insights?.length ?? 0;
const outputSummary = (queryCount > 0 || insightCount > 0)
  ? `${queryCount} queries, ${insightCount} insights`
  : null;
```

**8c. Update `getPhaseLabel()`** (lines 43-58):
- Add `"query_identification"` → `"Query Identification"`
- Add `"insight_identification"` → `"Insight Identification"`

**8d. Update `getPhaseVariant()`** similarly.

### Step 9: Update all test files

Every test that creates agent fixtures with `observerSystemPrompt` needs updating. Replace each occurrence with both `queryIdentificationSystemPrompt` and `insightIdentificationSystemPrompt`.

Test files to update:
- `src/lib/db/queries/__tests__/agents.test.ts`
- `src/lib/db/queries/__tests__/graph-data.test.ts`
- `src/lib/db/queries/__tests__/graph-types.test.ts`
- `src/lib/db/__tests__/graph-schema.test.ts`
- `src/lib/llm/__tests__/agents.test.ts`
- `src/lib/llm/__tests__/graph-configuration.test.ts`
- `src/lib/llm/__tests__/knowledge-graph.test.ts`
- `src/lib/llm/tools/__tests__/graph-tools.test.ts`
- `src/worker/__tests__/normalization.test.ts`

### Step 10: Add and update tests

**File:** `src/worker/__tests__/normalization.test.ts`
- Rename `normalizeObserverOutput` → `normalizeInsightIdentificationOutput` in imports and all call sites
- Remove `queries` from test fixture objects (type no longer has `queries`)

**File:** `src/lib/llm/__tests__/agents.test.ts`
- Update mock return value to include `queryIdentificationSystemPrompt` and `insightIdentificationSystemPrompt` instead of `observerSystemPrompt`
- Update assertions to verify both new fields are present in the generated configuration

**File:** `src/lib/db/queries/__tests__/agents.test.ts`
- Verify `createAgent` works with the two new prompt fields
- Verify agent retrieval returns both new fields

**File:** `src/lib/db/__tests__/graph-schema.test.ts`
- Verify the `worker_iterations` table no longer has `observer_output` column (remove any references to it in schema tests)

### Step 11: Update CLAUDE.md

Update these sections to reflect the new pipeline:
- **OODA Loop** bullet point
- **Background Worker** pipeline description
- **Data Flow > Autonomous Work** section
- **Agent configuration** — 7 system prompts instead of 6

### Step 12: Regenerate migrations, rebuild DB, build, and test

1. Delete all existing migration files in `drizzle/` (SQL files, `meta/` snapshots, journal)
2. `npx drizzle-kit generate` — regenerate clean migration from current schema
3. `docker compose down -v && docker compose up -d` — nuke and recreate DB
4. `npx drizzle-kit migrate` — apply fresh migration
5. `npm run build` — verify no TypeScript errors
6. `npm test` — verify all tests pass

## Verification

1. Build passes: `npm run build`
2. All tests pass: `npm test`
3. Create a new agent via UI — verify 7 system prompts are generated (check DB)
4. Run a worker iteration — verify two separate LLM interactions appear: one for `query_identification`, one for `insight_identification`
5. Worker iterations UI derives output summary from llmInteractions (not from a dedicated column)
6. Worker iterations UI shows the new phase labels correctly
