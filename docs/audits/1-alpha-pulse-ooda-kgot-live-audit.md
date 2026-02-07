# 1 - Alpha Pulse OODA/KGoT Live Audit

## Meta
- Started: 2026-02-06
- Agent: `ce00806c-7322-48ec-91d9-81165f25ae75` (`Alpha Pulse`)

## Scope
- Audit autonomous OODA loop behavior using:
  - Live DB records (`worker_iterations`, `llm_interactions`, graph tables)
  - Worker logs
  - Prompt-generation and tooling code
- Goal:
  - Identify issues reducing actor quality
  - Propose concrete prompt-level and system-level fixes

## Snapshot (2026-02-06, latest pull during audit)
- Iterations: `completed=4`, `failed=2`
- LLM interactions by phase:
  - `observer=6 (6 completed)`
  - `knowledge_acquisition=6 (4 completed)`
  - `graph_construction=4 (4 completed)`
  - `analysis_generation=4 (4 completed)`
  - `advice_generation=3 (3 completed)`
- Graph shape:
  - `node_count=25`, `edge_count=5`
  - `node_type_count=3`, `edge_type_count=1`
  - Node types in use: `Company`, `AgentAnalysis`
  - Edge types in use: `trades_on_exchange`
- Open interactions (`completed_at IS NULL`): `3`
  - Two are in failed iterations, one is the current running iteration

## Findings and Potential Fixes

### 1) Observer `relevantNodeIds` contract is broken (names, not UUIDs)
- Evidence:
  - Across observer plans, `relevantNodeIds` are names such as:
    - `NVIDIA Corporation (NVDA)`
    - `Meta Platforms, Inc. (META)`
    - `AgentAnalysis:...`
  - DB check: `total_refs=14`, `uuid_like_refs=0`, `non_uuid_refs=14`
- Code correlation:
  - `src/worker/runner.ts` schema says `relevantNodeIds` must be UUIDs.
  - Graph context serialization in `src/lib/db/queries/graph-data.ts` does not include node IDs in the text block.
- Potential fixes:
  - Include node IDs in graph context serialization (e.g., `- [Type] Name {id=...}`).
  - Tighten observer prompt to explicitly forbid non-UUID identifiers.
  - Add post-validation: resolve names to UUIDs before persisting plan, or reject and reprompt.

### 2) Edge ontology is too weak and semantically wrong for analysis linkage
- Evidence:
  - Only one edge type exists: `trades_on_exchange`.
  - This edge is being used for unrelated semantics:
    - `AgentAnalysis -> Company` via `trades_on_exchange`
    - `Company institutional-data node -> Company` via `trades_on_exchange`
- Code correlation:
  - Analyzer prompt expects `derived_from`, `about`, `supports`, etc.
  - These edge types are not present for this agent.
- Potential fixes:
  - Seed a minimum cross-domain analysis edge set for every agent:
    - `derived_from`, `about`, `supports`, `contradicts`, `correlates_with`
  - Add domain edge seeds for investment context:
    - `reported_in`, `impacts`, `compares_with`, `belongs_to_sector`
  - Backfill/repair existing semantically-invalid edges.

### 3) Graph Construction meta-prompt instructs type creation, but tools are unavailable
- Evidence:
  - Graph construction prompt includes “Type Management (CRITICAL)” and “create new types when necessary.”
  - Phase toolset currently exposes only `queryGraph`, `addGraphNode`, `addGraphEdge`.
  - Interaction logs show repeated attempts around missing types (`EarningsSurprise`, `MarketRegime`) with no way to create them.
- Code correlation:
  - `src/lib/llm/tools/index.ts#getGraphConstructionTools` excludes `createNodeType`/`createEdgeType`.
  - Meta-prompt text in `src/lib/llm/agents.ts` expects type creation behavior.
- Potential fixes:
  - Either:
    - Add `createNodeType` + `createEdgeType` to graph-construction tools, or
    - Remove type-creation instructions from this prompt and enforce strict fallback to existing types.
  - Preferred: allow type creation with strong safeguards (naming/schema checks already exist).

### 4) Analyzer loops on impossible edge creation requests
- Evidence:
  - `addGraphEdge` calls from analysis generation: very high, with repeated failures in worker logs:
    - `Edge type "derived_from" does not exist`
    - `supports`, `affects`, `correlates_with`, `indicates`, etc.
  - One malformed tool call observed: `{}[TOOL_CALLS]addGraphEdge`.
- Potential fixes:
  - Prompt-level:
    - Add explicit fallback instruction: if edge type missing and creation tool unavailable, skip edge creation and continue analysis output.
    - Add retry budget per edge op (`max 1 retry` then move on).
  - System-level:
    - Pre-seed edge types expected by analyzer.
    - Validate/sanitize tool-call names before execution; reject malformed names early.

### 5) Failed iterations leave orphaned open `llm_interactions`
- Evidence:
  - Open interactions include rows tied to failed iterations (not only currently running one).
- Code correlation:
  - Interaction rows are created at phase start.
  - On unhandled failure path, some interactions never receive `completedAt`.
- Potential fixes:
  - Add iteration-level `finally` cleanup:
    - mark unfinished interactions for the iteration as completed with failure metadata.
  - Add `status`/`error` field at interaction level for explicit terminal state.

### 6) Knowledge Acquisition instability: body timeouts and extract failures
- Evidence:
  - Failed iterations end with `terminated` and undici `UND_ERR_BODY_TIMEOUT` in worker logs.
  - `tavilyExtract` failure also observed: “No content extracted from URL”.
  - Knowledge-acquisition responses in failed runs are large.
- Potential fixes:
  - Reduce extraction payload size and source count per cycle.
  - Add robust retry/backoff policy for extraction timeouts.
  - Add per-source time budget and graceful partial-success continuation.
  - Prefer `tavilySearch` shortlist + targeted extraction instead of broad extraction fan-out.

### 7) Analysis citation format drifts from required UUID citation contract
- Evidence:
  - AgentAnalysis content includes markers like `[node:NVIDIA Corporation (NVDA)]` instead of `[node:<uuid>]`.
  - DB summary:
    - `total AgentAnalysis=6`
    - `contains "[node:" marker = 3`
    - `contains UUID node citation = 0`
- Code correlation:
  - Prompt requires UUID citations.
  - `addAgentAnalysisNode` validates presence of `content` but not citation format.
- Potential fixes:
  - Add validator in `addAgentAnalysisNode`:
    - enforce at least one valid `[node:uuid]` or `[edge:uuid]` when citations are used.
  - Add helper tool or transform that maps node names -> UUIDs for citation insertion.

### 8) Data modeling quality issue: facts are overloaded into `Company` and numeric fields are stringified
- Evidence:
  - `Company` nodes contain mixed quote/surprise/artifact fields:
    - `price="$171.88"`, `volume="206.31M"`, `revenue_surprise="$10.32B vs $8.03B (+28.5%)"`.
  - This blocks numeric filtering/scoring and robust analysis.
- Potential fixes:
  - Expand ontology with specialized node types:
    - `MarketQuote`, `EarningsEvent`, `InstitutionalFlow`, `AnalystRevision`.
  - Enforce numeric schema fields (`number`) for machine-usable metrics.
  - Keep formatted human text as optional derived fields, not primary data.

### 9) Advice generation appears over-constrained for production usefulness
- Evidence:
  - `AgentAdvice` nodes: `0` after completed iterations.
  - Advice meta-prompt requires “100% coverage”, “every imaginable question”, “absolute conviction”.
- Potential fixes:
  - Replace absolute criteria with thresholded criteria:
    - minimum evidence count, freshness window, confidence floor, explicit risk section.
  - Keep conservative default, but make advice reachable under strong evidence.

### 10) Type initialization quality/risk: edge constraints can be partially empty
- Evidence:
  - For this agent, `trades_on_exchange` has source constraint but target constraint missing.
- Code correlation:
  - `persistInitializedTypes` proceeds even if valid source/target lists are incomplete.
- Potential fixes:
  - Reject creation of edge types with empty source or target constraints (unless explicitly intended wildcard).
  - Log and repair invalid edge-type constraints during initialization.

## Highest-Impact Immediate Improvements (recommended order)
1. Fix graph-context ID visibility + observer UUID contract.
2. Seed analyzer-required edge types globally (or agent bootstrap) and enforce valid semantic usage.
3. Resolve prompt-tool mismatch in graph construction (allow type creation or remove instruction).
4. Add iteration failure cleanup for `llm_interactions`.
5. Add citation-format validation for `AgentAnalysis`.
6. Harden knowledge-acquisition timeout strategy.

## Update Log
- 2026-02-06: Initial live audit findings added from DB + worker logs + code correlation.
