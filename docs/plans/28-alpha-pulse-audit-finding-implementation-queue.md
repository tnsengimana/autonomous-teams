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
- [ ] `F3` Graph Construction prompt/tool mismatch on type creation.
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
      - `derived_from`, `about`, `supports`, `contradicts`, `correlates_with`, `based_on_analysis`.
    - Seeded baseline edge types during type persistence (`persistInitializedTypes`) for every agent.
    - Added duplicate safeguard to skip LLM-generated edge types when an edge name already exists.
    - Enforced edge source/target type constraints at runtime in `addGraphEdge` tool.
    - Enabled Advice phase to use `addGraphEdge` and updated advice prompting to link `AgentAdvice` to `AgentAnalysis` via `based_on_analysis`.
  - Tests:
    - `npm run test:run -- src/lib/llm/__tests__/graph-configuration.test.ts src/lib/llm/tools/__tests__/graph-tools.test.ts src/lib/llm/__tests__/agents.test.ts`
    - `npm run build`
