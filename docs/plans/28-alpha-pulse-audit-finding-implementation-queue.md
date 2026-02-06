# 28 - Alpha Pulse Audit Finding Implementation Queue

## Source of Truth
- Audit document: `docs/audits/1-alpha-pulse-ooda-kgot-live-audit.md`
- This plan tracks execution order and completion status for audit findings.

## Working Protocol
- Process one finding at a time.
- For each finding:
  - Align on solution approach.
  - Implement code changes.
  - Add or update relevant tests.
  - Verify behavior in runtime/DB where applicable.
  - Mark the item complete and record outcome notes.

## Todo Queue
- [x] `F1` Observer `relevantNodeIds` are names instead of UUIDs.
- [x] `F2` Edge ontology is too weak and semantically incorrect for analysis linkage.
- [x] `F3` Graph Construction prompt/tool mismatch on type creation.
- [ ] `F4` Analyzer loops on impossible edge creation and malformed tool names.
- [ ] `F5` Failed iterations leave orphaned open `llm_interactions`.
- [ ] `F6` Knowledge Acquisition instability (`UND_ERR_BODY_TIMEOUT`, extract failures).
- [ ] `F7` Analysis citations do not follow required `[node:uuid]`/`[edge:uuid]` format.
- [ ] `F8` Data model overload in `Company` nodes and stringified numeric metrics.
- [ ] `F9` Advice generation criteria are over-constrained for practical output.
- [ ] `F10` Type initialization allows edge constraints with missing source/target sets.

## Execution Log
- 2026-02-06: Queue initialized from audit findings `F1` through `F10`.
- 2026-02-06: Completed `F1`.
  - Implemented:
    - Added node IDs to graph LLM serialization so Observer context exposes UUIDs.
    - Tightened Observer meta-prompt guidance to require UUID-only `relevantNodeIds`.
    - Added post-validation normalization in worker Observer phase to resolve names/typed refs to UUIDs and drop unresolved refs before persistence.
  - Tests:
    - `npm run test:run -- src/lib/db/queries/__tests__/graph-data.test.ts src/worker/__tests__/normalization.test.ts src/lib/llm/__tests__/agents.test.ts`
    - `npm run test:run -- src/lib/llm/__tests__/knowledge-graph.test.ts`
- 2026-02-06: Semantic cleanup requested by user:
  - Replaced Observer "plan" semantics with explicit `queries`/`insights` and umbrella term `output`.
  - Renamed worker iteration schema field from `observer_plan` to `observer_output`.
- 2026-02-06: F1 normalization refinements:
  - Renamed `src/worker/observer-output-normalization.ts` to `src/worker/normalization.ts`.
  - Renamed `normalizeObserverOutputNodeIds` to `normalizeObserverOutput`.
  - Simplified normalization return type to `ObserverOutput`.
  - Added warning logs that include full `droppedReferences` payload for traceability.
  - Revalidated F1 tests:
    - `npm run test:run -- src/lib/db/queries/__tests__/graph-data.test.ts src/worker/__tests__/normalization.test.ts src/lib/llm/__tests__/agents.test.ts`
    - `npm run test:run -- src/lib/llm/__tests__/knowledge-graph.test.ts`
- 2026-02-06: Completed `F2`.
  - Implemented:
    - Added `createSeedEdgeTypes` in `src/lib/llm/graph-types.ts` with baseline edge types:
      - `derived_from`, `about`, `supports`, `contradicts`, `correlates_with`, `based_on`.
    - Seeded baseline edge types during type persistence (`persistInitializedTypes`) for every agent.
    - Added duplicate safeguard to skip LLM-generated edge types when an edge name already exists.
    - Enforced edge source/target type constraints at runtime in `addGraphEdge` tool.
    - Enabled Advice phase to use `addGraphEdge` and updated advice prompting to link `AgentAdvice` to `AgentAnalysis` via `based_on`.
  - Tests:
    - `npm run test:run -- src/lib/llm/__tests__/graph-configuration.test.ts src/lib/llm/tools/__tests__/graph-tools.test.ts src/lib/llm/__tests__/agents.test.ts`
    - `npm run build`
- 2026-02-06: Completed `F3`.
  - Implemented:
    - Enabled Graph Construction phase toolset to include `createNodeType` and `createEdgeType` in `src/lib/llm/tools/index.ts`.
    - Added explicit Graph Construction guardrails in prompts:
      - Prefer existing types first.
      - Create new types only when no existing type fits.
      - Keep per-run type creation minimal.
    - Updated Graph Construction runner instruction text to reflect type-creation availability and guardrails.
    - Updated node-type naming convention from strict PascalCase to capitalized names with spaces allowed:
      - Tool schema/validation (`src/lib/llm/tools/graph-tools.ts`)
      - Type initialization schema/prompt guidance (`src/lib/llm/graph-types.ts`)
      - DB schema comment (`src/lib/db/schema.ts`)
  - Tests:
    - Added `src/lib/llm/tools/__tests__/index.test.ts` to verify Graph Construction toolset includes type-creation tools.
    - Updated createNodeType tests in `src/lib/llm/tools/__tests__/graph-tools.test.ts` for capitalized-space naming.
    - Revalidated:
      - `npm run test:run -- src/lib/llm/tools/__tests__/index.test.ts src/lib/llm/tools/__tests__/graph-tools.test.ts src/lib/llm/__tests__/graph-configuration.test.ts src/lib/llm/__tests__/agents.test.ts`
      - `npm run build`
