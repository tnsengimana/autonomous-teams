# Knowledge Graph of Thoughts (KGoT)

> Research exploration of the KGoT framework from ETH Zurich

**Paper**: [Knowledge Graph of Thoughts: Navigating Complex Problems with LLMs via Iterative Structured Reasoning](https://arxiv.org/abs/2504.02670)
**Repository**: [github.com/spcl/knowledge-graph-of-thoughts](https://github.com/spcl/knowledge-graph-of-thoughts)

---

## Overview

KGoT (Knowledge Graph of Thoughts) is a research framework that integrates LLM reasoning with dynamically constructed knowledge graphs. The key insight is that instead of relying solely on an LLM's parametric knowledge, the system:

1. Uses external tools (web search, code execution, document parsing) to gather information
2. Structures that information as a knowledge graph (nodes + edges)
3. Queries the graph to retrieve relevant facts
4. Synthesizes a final answer from the structured data

This approach enables smaller, cheaper LLMs to solve complex reasoning tasks that would otherwise require more capable models.

---

## Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CONTROLLER                                   │
│  Orchestrates the reasoning workflow, decides INSERT vs RETRIEVE    │
└─────────────────────────────────────────────────────────────────────┘
           │                    │                    │
           ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐
│  KNOWLEDGE GRAPH │  │   TOOL MANAGER  │  │    LLM PROVIDERS        │
│  - Neo4j         │  │   - SearchTool  │  │    - OpenAI             │
│  - NetworkX      │  │   - PythonCode  │  │    - Anthropic          │
│  - RDF4J         │  │   - Wikipedia   │  │    - Google Gemini      │
│                  │  │   - TextInspect │  │                         │
└─────────────────┘  └─────────────────┘  └─────────────────────────┘
```

### Supported Graph Backends

| Backend | Query Language | Best For |
|---------|---------------|----------|
| **Neo4j** | Cypher | Production, large graphs |
| **NetworkX** | Python code | Development, in-memory |
| **RDF4J** | SPARQL | Semantic web applications |

---

## The INSERT/RETRIEVE Loop

KGoT uses an iterative decision loop where the LLM decides whether existing graph data can answer the question (RETRIEVE) or if more data is needed (INSERT).

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER QUESTION                                 │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
              ┌─────────────────────────────────┐
              │    DEFINE_NEXT_STEP_PROMPT      │
              │    LLM analyzes graph state     │
              └─────────────────────────────────┘
                                │
                ┌───────────────┴───────────────┐
                ▼                               ▼
┌───────────────────────────┐   ┌───────────────────────────────────┐
│       INSERT BRANCH       │   │         RETRIEVE BRANCH           │
│  (graph lacks data)       │   │    (graph has enough data)        │
└───────────────────────────┘   └───────────────────────────────────┘
         │                                      │
         ▼                                      ▼
┌───────────────────────────┐   ┌───────────────────────────────────┐
│  DEFINE_TOOL_CALLS        │   │  Execute graph query              │
│  LLM selects tools        │   │  (Python/Cypher/SPARQL)           │
└───────────────────────────┘   └───────────────────────────────────┘
         │                                      │
         ▼                                      ▼
┌───────────────────────────┐   ┌───────────────────────────────────┐
│  Execute tools            │   │  PARSE_SOLUTION_WITH_LLM          │
│  (web search, etc.)       │   │  Format into natural language     │
└───────────────────────────┘   └───────────────────────────────────┘
         │                                      │
         ▼                                      ▼
┌───────────────────────────┐   ┌───────────────────────────────────┐
│  UPDATE_GRAPH             │   │         FINAL ANSWER              │
│  LLM generates code to    │   └───────────────────────────────────┘
│  add nodes/edges          │
└───────────────────────────┘
         │
         └──────────► Loop back to DEFINE_NEXT_STEP
```

---

## Knowledge Building: Text to Graph Transformation

A critical aspect of KGoT is how unstructured text from tools gets transformed into structured graph data.

### The Transformation Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│  TOOL RESULT (Raw Text)                                             │
│  "The winter storm was caused by a polar vortex disruption that    │
│   allowed arctic air to descend. Contributing factors included a    │
│   weakened jet stream and La Niña conditions..."                    │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  UPDATE_GRAPH_GIVEN_NEW_INFORMATION_PROMPT                          │
│  LLM reads text and generates Python/Cypher code                    │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  GENERATED CODE                                                      │
│  ```python                                                          │
│  event_attrs = {'label': 'WeatherEvent', 'name': 'Winter Storm'}    │
│  self.G.add_node('WE1', **event_attrs)                              │
│                                                                      │
│  cause_attrs = {'label': 'Cause', 'name': 'Polar Vortex Disruption'}│
│  self.G.add_node('C1', **cause_attrs)                               │
│                                                                      │
│  self.G.add_edge('C1', 'WE1', relationship='caused')                │
│  ```                                                                 │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  KNOWLEDGE GRAPH                                                     │
│                                                                      │
│  ┌──────────────────┐         ┌──────────────────┐                  │
│  │ Cause            │         │ WeatherEvent     │                  │
│  │ ─────────────────│ caused  │ ─────────────────│                  │
│  │ name: Polar      │────────►│ name: Winter     │                  │
│  │       Vortex     │         │       Storm      │                  │
│  │       Disruption │         │ date: Jan 2026   │                  │
│  └──────────────────┘         └──────────────────┘                  │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Insight

The transformation is **purely LLM-driven**. There is no:
- Named Entity Recognition (NER)
- Rule-based parsing
- Template matching
- Schema enforcement

The LLM reads unstructured text and decides what entities and relationships to create based on the prompt instructions and the initial problem context.

---

## Concrete Example Walkthrough

**Question**: "Why did the US have a winter storm in late January 2026?"

### The Complete Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           USER QUESTION                                  │
│  "Why did the US have a winter storm in late January 2026?"             │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 1: DEFINE_NEXT_STEP_PROMPT                                        │
│  LLM analyzes: empty graph → returns query_type: INSERT                 │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 2: DEFINE_TOOL_CALLS_PROMPT                                       │
│  LLM selects tool: ask_search_agent("What caused the winter storm       │
│  in the US in late January 2026?")                                      │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 3: WEB SEARCH (SearchTool → ReactJsonAgent)                       │
│  Sub-agent browses web, visits pages, returns structured findings       │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 4: UPDATE_GRAPH_GIVEN_NEW_INFORMATION_PROMPT                      │
│  LLM generates Python code to add nodes/edges to NetworkX graph         │
│  Graph: WeatherEvent ← caused_by ← Causes (nodes with properties)       │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 5: DEFINE_NEXT_STEP_PROMPT (iteration 2)                          │
│  LLM sees populated graph → returns query_type: RETRIEVE + code         │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 6: EXECUTE RETRIEVAL CODE                                         │
│  Python code runs against self.G → extracts cause information           │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 7: PARSE_SOLUTION_WITH_LLM_PROMPT                                 │
│  LLM formats raw data into coherent natural language answer             │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                            FINAL ANSWER                                  │
│  "The US experienced a severe winter storm due to a polar vortex        │
│  disruption, weakened jet stream, negative Arctic Oscillation..."       │
└─────────────────────────────────────────────────────────────────────────┘
```

### What Gets Added to the Graph (and What Doesn't)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Initial Problem: "Why did US have winter storm in Jan 2026?"           │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  DEFINE_NEXT_STEP_PROMPT                                                │
│  Input: initial_query (as text), empty graph                            │
│  Output: query_type="INSERT", reason="need weather data"                │
│  ✗ Problem NOT added to graph                                           │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  DEFINE_TOOL_CALLS_PROMPT                                               │
│  Input: initial_query (as text context), missing_information            │
│  Output: tool_calls=[{name: "ask_search_agent", args: {query: "..."}}]  │
│  ✗ Problem NOT added to graph                                           │
│  ✓ Problem informs the search query the LLM generates                   │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  TOOL EXECUTION (SearchTool)                                            │
│  Input: search query generated by LLM (derived from problem)            │
│  Output: raw text with weather information                              │
│  ✗ Problem NOT added to graph                                           │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  UPDATE_GRAPH_GIVEN_NEW_INFORMATION_PROMPT                              │
│  Input: initial_query (as context), new_information (tool result)       │
│  Output: Python code to add nodes/edges from tool results               │
│  ✗ Problem NOT added to graph                                           │
│  ✓ ONLY tool results get converted to nodes/edges                       │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Key Prompts Reference

| Prompt | Purpose | Input | Output |
|--------|---------|-------|--------|
| `DEFINE_NEXT_STEP` | Decide INSERT vs RETRIEVE | Problem + graph state | `query_type` + reasoning |
| `DEFINE_TOOL_CALLS` | Select tools to call | Problem + missing info | Tool calls with args |
| `UPDATE_GRAPH_GIVEN_NEW_INFORMATION` | Convert text to graph | Problem + tool result | Python/Cypher code |
| `DEFINE_RETRIEVE_QUERY` | Fix failed queries | Problem + wrong query | Corrected query |
| `PARSE_SOLUTION_WITH_LLM` | Format final answer | Problem + graph data | Natural language |
| `DEFINE_NEED_FOR_MATH` | Check if calculations needed | Problem + partial solution | Boolean |
| `FIX_CODE` | Repair syntax errors | Broken code + error | Fixed code |

---

## Available Tools

| Tool | Description |
|------|-------------|
| `SearchTool` (ask_search_agent) | Web search via ReactJsonAgent with sub-tools for browsing |
| `RunPythonCodeTool` | Execute Python in sandboxed Docker container |
| `LangchainLLMTool` | Query another LLM for extended knowledge |
| `TextInspectorTool` | Extract text from documents, PDFs, web pages |
| `ImageQuestionTool` | Analyze images with captions |
| `ExtractZipTool` | Handle compressed files |
| `WikipediaTool` | Search and retrieve Wikipedia articles |

---

## FAQs

### Q: Is the initial question converted to graph nodes?

**No.** The initial problem/query is NEVER added to the knowledge graph. It serves only as context in prompts to help the LLM:
1. Decide what information is missing
2. Generate appropriate tool queries
3. Extract relevant entities/relationships from tool results

Only external tool results get transformed into graph nodes and edges.

### Q: How does text become graph structure?

Through pure LLM generation. The `UPDATE_GRAPH_GIVEN_NEW_INFORMATION` prompt gives the LLM:
- The initial problem (context)
- Current graph state (to avoid duplicates)
- Raw text from tool execution

The LLM then generates Python/Cypher code to create nodes and edges. There's no parsing, NER, or rule-based extraction.

### Q: What happens if the LLM generates invalid code?

KGoT has error recovery. If generated code fails:
1. The `FIX_CODE` prompt is invoked with the error message
2. The LLM attempts to fix the syntax/semantic issues
3. Retries up to `max_cypher_fixing_retry` times (configurable)

### Q: How does KGoT avoid duplicate tool calls?

The `DEFINE_TOOL_CALLS` prompt includes all previous tool calls in `<tool_calls_made>`. The prompt explicitly instructs:
> Before proposing a tool call, analyze the list of previous tool calls to ensure your proposed call is not identical to any previous call.

### Q: What if the graph never has enough data?

After `max_iterations`, KGoT forces a solution:
1. `DEFINE_FORCED_RETRIEVE_QUERY` attempts retrieval with guessing allowed
2. `DEFINE_FORCED_SOLUTION` generates an answer from incomplete data
3. The prompt allows "educated guesses" for missing information

### Q: Why use a knowledge graph instead of just RAG?

The paper argues that knowledge graphs provide:
1. **Structured relationships** - Not just text chunks but typed connections
2. **Iterative refinement** - Can add data incrementally as needed
3. **Explicit reasoning** - Graph queries are interpretable
4. **Deduplication** - Graph structure naturally prevents redundant information

### Q: How does the SearchTool work internally?

SearchTool wraps a `ReactJsonAgent` (from HuggingFace Transformers) with sub-tools:
- `SearchInformationTool` - Google search
- `VisitTool` - Visit URLs
- `PageUpTool` / `PageDownTool` - Navigate pages
- `FinderTool` / `FindNextTool` - Search within pages
- `ArchiveSearchTool` - Search web archives
- `FullPageSummaryTool` - Summarize entire pages

The agent autonomously browses the web for up to 12 iterations before returning a structured answer.

### Q: What benchmarks does KGoT target?

- **GAIA Benchmark** - Complex question-answering requiring web search and multi-step reasoning
- **SimpleQA** - Factual question answering

The framework includes specialized output formatters for GAIA's strict answer requirements.

---

## Repo File Structure Reference

**Repository**: [github.com/spcl/knowledge-graph-of-thoughts](https://github.com/spcl/knowledge-graph-of-thoughts)

```
kgot/
├── controller/
│   ├── networkX/
│   │   └── queryRetrieve/
│   │       ├── controller.py          # Main orchestration logic
│   │       └── llm_invocation_handle.py  # Prompt invocations
│   └── neo4j/
│       └── ...
├── knowledge_graph/
│   ├── networkX/main.py               # NetworkX graph implementation
│   ├── neo4j/main.py                  # Neo4j graph implementation
│   └── kg_interface.py                # Abstract interface
├── prompts/
│   ├── networkX/
│   │   ├── base_prompts.py            # Shared prompts
│   │   └── queryRetrieve/prompts.py   # Query-retrieve specific
│   └── neo4j/
│       └── ...
├── tools/
│   └── tools_v2_3/
│       ├── SurferTool.py              # Web search agent
│       ├── TextInspectorTool.py       # Document parsing
│       └── ...
└── __main__.py                        # CLI entry point
```

---

## Relevance to Our Project

We plan to integrate KGoT concepts into our autonomous agent system, specifically for an **Investment Advisor** aide that runs 24/7, continuously building knowledge and alerting users to actionable insights.

### What the Graph is For

The graph stores **discovered knowledge with relationships** - things the agent learns from external sources that have meaningful connections to each other.

**NOT for the graph:**
- User preferences → `user_settings` table (structured, known schema)
- Portfolio holdings → `positions` table (transactional data, CRUD operations)
- Watchlist → simple table or array field

**FOR the graph:**
- Market events and their impacts
- News and what it affects
- Insights (signals, observations, patterns)
- Sector and asset class relationships
- Discovered correlations

### Schema Validation Research

We validated our schema against established financial ontologies and knowledge graphs:

1. https://arxiv.org/abs/2407.10909 - Financial Dynamic Knowledge Graph with 12 entity types, 15 relationships                                                                            
2. https://spec.edmcouncil.org/fibo/ - Financial Industry Business Ontology (2,457 classes)  
3. https://www.bloomberg.com/professional/products/data/enterprise-catalog/reference/ - 200B data points, 13M instruments, 6.5M entities                                                  
4. https://www.ontotext.com/blog/the-power-of-ontologies-and-knowledge-graphs-for-the-financial-industry/ - Industry best practices.
5. https://www.cfp.net/industry-insights/2023/05/the-critical-skill-sets-of-a-financial-planner - Advisor competencies
6. https://www.finra.org/investors/insights/key-economic-indicators-every-investor-should-know -Key indicators for investors 

#### FinDKG Schema Comparison

| FinDKG Entity | Description | Our Equivalent |
|---------------|-------------|----------------|
| FIN INST | Financial instruments | Asset |
| COMP | Companies | Company |
| SECTOR | Industry sectors | Sector |
| EVENT | Material events | MarketEvent |
| ORG/GOV, ORG/REG | Government, regulators | Institution |
| CONCEPT | Abstract ideas, themes | Insight |
| GPE | Countries, regions | Property on Company or MarketEvent |
| PERSON | Influential individuals | News/MarketEvent source attribution |
| ECON IND | Economic indicators | MarketEvent with type="indicator_release" |
| PRODUCT | Products/services | News/MarketEvent detail |

### Node Types

| Node Type | What It Represents | Example Properties |
|-----------|--------------------|--------------------|
| **Asset** | Financial instrument | `{symbol: "AAPL", type: "stock"}` |
| **Company** | Legal entity that issues securities | `{name: "Apple Inc", ticker: "AAPL", country: "USA"}` |
| **Sector** | Industry grouping | `{name: "Technology", trend: "bullish"}` |
| **AssetClass** | High-level category | `{name: "Equities", risk_sentiment: "risk-on"}` |
| **Institution** | Central banks, regulators, international bodies | `{name: "Federal Reserve", type: "central_bank", country: "USA"}` |
| **MarketEvent** | Significant occurrence | `{type: "earnings", date: "2026-02-05", summary: "Apple beats estimates"}` |
| **News** | Information item | `{headline: "...", source: "Reuters", sentiment: "positive"}` |
| **Insight** | Derived analysis (signals, patterns, observations) | See below |

Eight node types total.

#### Why Company Separate from Asset?

```
Without Company:
  MarketEvent("Apple earnings beat") --affects--> Asset(AAPL)
  MarketEvent("Apple earnings beat") --affects--> Asset(AAPL bonds)  # Duplicate event

With Company:
  MarketEvent("Apple earnings beat") --affects--> Company(Apple Inc.)
  Asset(AAPL) --issued_by--> Company(Apple Inc.)
  Asset(AAPL bonds) --issued_by--> Company(Apple Inc.)
  # Event propagates naturally through company relationship
```

Also enables future extensions:
- Supply chain: `Company(Apple) --supplier--> Company(TSMC)`
- Competitors: `Company(Apple) --competes_with--> Company(Samsung)`
- Subsidiaries: `Company(Alphabet) --owns--> Company(YouTube)`

#### Why Institution as Separate Node?

```
Without Institution:
  MarketEvent("Fed raises rates") --affects--> AssetClass(Fixed Income)
  MarketEvent("Fed signals hawkish") --affects--> AssetClass(Fixed Income)
  # No connection between these events

With Institution:
  Institution(Federal Reserve) --affects--> AssetClass(Fixed Income)
  MarketEvent("Fed raises rates") --by--> Institution(Federal Reserve)
  # Can track Fed's evolving policy stance over time
```

Examples of Institutions:
- Central banks: Federal Reserve, ECB, Bank of Japan
- Regulators: SEC, FINRA, FCA
- International bodies: IMF, World Bank, OPEC

#### Node Hierarchy

```
AssetClass (Equities)
  └── Sector (Technology)
        └── Company (Apple Inc.) ←── Institution (SEC) regulates
              └── Asset (AAPL stock)
              └── Asset (AAPL bonds)

AssetClass (Fixed Income)
  └── Asset (TLT, BND)

AssetClass (Commodities)
  └── Asset (GLD, USO)

AssetClass (Crypto)
  └── Asset (BTC, ETH)

Institution (Federal Reserve)
  └── affects → AssetClass (Fixed Income)
  └── affects → AssetClass (Equities)
```

#### Insight Node Properties

| Property | Description |
|----------|-------------|
| `type` | `"signal"` \| `"observation"` \| `"pattern"` |
| `summary` | The explanation/reasoning |
| `action` | `"buy"` \| `"sell"` \| `"hold"` \| `null` (only present for signals) |
| `strength` | 0-1 confidence |
| `generated_at` | Timestamp |

**Examples:**

```jsonc
// Actionable signal (has action)
{
  "type": "signal",
  "summary": "AAPL oversold with RSI at 28, positive earnings surprise of 12%, and sector tailwinds from Fed holding rates",
  "action": "buy",
  "strength": 0.8
}

// Observation (no action)
{
  "type": "observation",
  "summary": "Tech sector showing rotation from growth to value stocks",
  "action": null,
  "strength": 0.7
}

// Pattern (no action)
{
  "type": "pattern",
  "summary": "AAPL historically drops 5-8% in the week before earnings, then recovers",
  "action": null,
  "strength": 0.6
}
```

#### Considered but Rejected

| Candidate | Reasoning |
|-----------|-----------|
| **Index** (S&P 500, VIX) | Modeled as Asset with `type: "index"` |
| **Economic Indicator** (CPI, GDP) | Captured as MarketEvent with `type: "indicator_release"`; history belongs in time-series table |
| **Person** (Powell, Musk) | Captured in MarketEvent/News source attribution; add later if tracking individuals becomes important |
| **Region/Country** | Property on Company (`country: "USA"`), or captured in MarketEvent/News; add later if supply chain modeling needed |
| **Product** (iPhone, Model 3) | Captured in MarketEvent/News detail; product-level analysis is company research, not portfolio management |

### Edge Types

| Edge Type | Meaning | Examples |
|-----------|---------|----------|
| **issued_by** | Asset issued by company | Asset(AAPL) → Company(Apple Inc.) |
| **in_sector** | Company operates in sector | Company(Apple) → Sector(Technology) |
| **belongs_to** | Hierarchical membership | Sector → AssetClass |
| **affects** | Event/institution impacts entity | MarketEvent/Institution → Asset/Company/Sector/AssetClass |
| **mentions** | News references entity | News → any entity |
| **about** | Insight concerns entity | Insight → any entity |
| **derived_from** | Insight sourced from | Insight → MarketEvent/News |
| **correlated** | Statistical relationship | Asset ↔ Asset |

Eight edge types. Each one represents a meaningful, discovered relationship.

#### Example: Multi-Level Discovery

```
Agent discovers from news: "Apple beats earnings, Fed holds rates, tech rallies"

Creates/updates:
  - Company(Apple Inc.)
  - Asset(AAPL) --issued_by--> Company(Apple Inc.)
  - Company(Apple Inc.) --in_sector--> Sector(Technology)

  - MarketEvent(type: earnings, summary: "Apple beats estimates")
  - MarketEvent --affects--> Company(Apple Inc.)

  - Institution(Federal Reserve)
  - MarketEvent(type: fed_decision, summary: "Fed holds rates")
  - MarketEvent --affects--> Institution(Federal Reserve)
  - Institution --affects--> AssetClass(Equities)

  - News(headline: "Tech rallies on Apple earnings, Fed hold")
  - News --mentions--> Company(Apple Inc.)
  - News --mentions--> Institution(Federal Reserve)
  - News --mentions--> Sector(Technology)

  - Insight(type: signal, summary: "AAPL bullish on earnings beat + dovish Fed", action: buy)
  - Insight --about--> Asset(AAPL)
  - Insight --derived_from--> MarketEvent(earnings)
  - Insight --derived_from--> MarketEvent(fed_decision)
```

### What Lives Outside the Graph

```
┌─────────────────────────────────────────────────────────────────────┐
│  RELATIONAL TABLES (structured user data)                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  user_investment_profiles                                           │
│  ├── user_id                                                        │
│  ├── risk_tolerance ('conservative' | 'moderate' | 'aggressive')   │
│  ├── investment_horizon                                             │
│  ├── goals (JSONB array)                                           │
│  └── preferences (JSONB - dividend focus, ESG, etc.)               │
│                                                                     │
│  positions                                                          │
│  ├── user_id                                                        │
│  ├── symbol                                                         │
│  ├── shares                                                         │
│  ├── avg_cost                                                       │
│  └── added_at                                                       │
│                                                                     │
│  watchlist                                                          │
│  ├── user_id                                                        │
│  ├── symbol                                                         │
│  └── added_at                                                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  KNOWLEDGE GRAPH (discovered, interconnected knowledge)             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  graph_nodes                                                        │
│  ├── id, entity_id, type, name, properties, created_at, expires_at │
│                                                                     │
│  graph_edges                                                        │
│  ├── id, entity_id, source_id, target_id, type, properties         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### How They Work Together

When the agent runs:

1. **Load user context** from relational tables (positions, watchlist, preferences)
2. **Query/update graph** with discovered knowledge (news, events, insights)
3. **Briefing decision**: Cross-reference graph insights with user's positions/watchlist

```
Agent iteration:

  1. Load: user holds [AAPL, GOOGL, VTI], watches [MSFT, NVDA]

  2. Graph query: "Any actionable insights for these symbols?"
     → Found: Insight(type=signal, action=buy) --about--> Asset(AAPL)
              Insight --derived_from--> News("AAPL beats earnings")

  3. Briefing decision: User holds AAPL + actionable insight exists
     → Create briefing: "Your AAPL position: buy signal based on..."
```

### Example Graph

```
┌─────────────────┐
│   AssetClass    │
│    Equities     │
└────────┬────────┘
         │ belongs_to
         │
┌────────┴────────┐         ┌─────────────────┐
│     Sector      │         │   Institution   │
│   Technology    │         │ Federal Reserve │
└────────┬────────┘         └────────┬────────┘
         │ in_sector                 │ affects
         │                           │
┌────────┴────────┐                  │
│    Company      │◄─────────────────┘
│   Apple Inc.    │
└────────┬────────┘
         │ issued_by
         │
┌────────┴────────┐         ┌──────────────┐
│     Asset       │◄────────│    Asset     │
│     AAPL        │correlated   MSFT      │
└─────────────────┘         └──────────────┘
         ▲
         │ about
         │
┌────────┴────────┐         ┌─────────────────┐
│    Insight      │         │   MarketEvent   │
│ type: signal    │         │ Apple earnings  │
│ action: buy     │◄────────│ beat estimates  │
│ strength: 0.8   │ derived └─────────────────┘
└────────┬────────┘  _from
         │ derived_from
         ▼
┌─────────────────┐
│      News       │
│ "Tech rallies   │
│ on earnings"    │
└─────────────────┘
```

No user data in the graph. Just discovered knowledge and its relationships.

### Key Differences from KGoT

| Aspect | KGoT | Our System |
|--------|------|------------|
| **Graph lifecycle** | Per-question (ephemeral) | Per-entity (persistent, grows over time) |
| **Goal** | Answer one question | Monitor continuously, alert when relevant |
| **RETRIEVE triggers** | "Can I answer the question?" | "Is there a briefing-worthy insight?" |
| **Data freshness** | N/A (one-shot) | Critical - need `expires_at` for stale data |
| **User context** | Implicit in question | Loaded from relational tables, not in graph |
