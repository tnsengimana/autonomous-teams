# 24 - Worker Loop: Brain as Planner

## Problem Statement

The current worker iteration uses a binary classification phase that picks between "synthesize" or "populate." This is limiting in two ways:

1. **Coarse binary choice** — A real "brain" doesn't pick between "think" or "learn." It does both, guided by what it notices. The classification should produce structured work items (sparks and queries) rather than a single action label.

2. **Ping-pong oscillation** — Imagine the agent just populated the graph with new nodes about a company earnings report. Now classification says "synthesize" and the agent reflects on it. But during synthesis, it might realize it's missing competitor data. It has to wait for the *next* iteration to go populate that, then *another* iteration to synthesize again with the fuller picture. That's 15 minutes of ping-ponging for what should be one coherent thought process.

## Proposed Solution

### The Iteration Becomes: Plan → Populate → Synthesize → Advise

The key structural change: **every iteration follows the same pipeline, but the brain decides what goes into it.**

```
┌─────────────────────────────────────────────────┐
│                   ITERATION                      │
│                                                  │
│  1. BRAIN (planner)                              │
│     Input: graph context + agent mission         │
│     Output: { queries[], sparks[] }              │
│                                                  │
│  2. POPULATE (for each query)                    │
│     Knowledge Acquisition → Graph Construction   │
│     (enriches the graph)                         │
│                                                  │
│  3. Rebuild graph context (now enriched)         │
│                                                  │
│  4. SYNTHESIZE (for each spark, on enriched      │
│     graph)                                       │
│     Insight Synthesis                            │
│                                                  │
│  5. ADVISE (if insights were produced)           │
│     Advice Generation                            │
│                                                  │
└─────────────────────────────────────────────────┘
```

This kills the ping-pong problem. In a single iteration, the agent researches competitor data (populate), then immediately synthesizes the pattern it spotted across the now-complete picture. No waiting for the next cycle.

### The Brain's Output

The brain scans the graph and produces a plan with two types of work items:

**Queries** — knowledge gaps to fill. Each one is a targeted research objective.
```
{
  objective: "Investigate Samsung's Q4 2025 semiconductor revenue",
  reasoning: "We have Apple and TSMC supplier data but no Samsung
              comparison — this gap limits our supply chain analysis",
  search_hints: ["Samsung Q4 2025 earnings", "Samsung semiconductor revenue"]
}
```

**Sparks** — patterns worth synthesizing. Each one points at specific graph regions.
```
{
  observation: "Three separate earnings nodes show services revenue
               accelerating across Apple, Google, and Microsoft",
  relevant_node_ids: ["node-abc", "node-def", "node-ghi"],
  synthesis_direction: "Analyze whether this is an industry-wide
                        structural shift toward services"
}
```

The brain can produce any combination: 3 queries and 0 sparks, 0 queries and 2 sparks, 2 of each, or even 0 and 0 (agent decides there's nothing worth doing — that's a valid plan).

### Why This Solves the Cognitive Load Problem

The concern is that asking one LLM call to both identify gaps AND spot patterns is a lot. Here's why it's manageable:

**The brain doesn't execute anything.** It just plans. It doesn't need to search the web, construct graph nodes, or write analyses. It reads the graph context and says "here's what I'd investigate, here's what I'd think about." That's a fundamentally easier cognitive task than what the current phases do.

Think of it this way: it's much easier to say "we should look into Samsung's earnings" than to actually research Samsung's earnings. The brain only does the first part.

**The downstream phases become more targeted.** Currently, the insight synthesis phase gets a generic "analyze your graph" instruction. Under this model, it gets a specific spark: "look at these three nodes, analyze whether services revenue acceleration is industry-wide." That's a much easier task for the synthesis LLM because the brain already did the hard part of figuring out *what* to think about.

### What Changes in Each Phase

**Brain (replaces classification):** Gets the graph context + agent mission. Outputs structured `{ queries[], sparks[] }`. This is the only phase that needs to "think broadly." Its system prompt would be the most important prompt in the entire system.

**Knowledge Acquisition + Graph Construction:** Instead of receiving "continue your work," each call receives a specific query objective. This makes these phases dramatically more focused. You might run them multiple times per iteration (once per query), or batch the queries into one call — leaning toward one-per-query for focus.

**Insight Synthesis:** Instead of "look at your graph and find patterns," it receives a specific spark with node references and a synthesis direction. Again, more focused. One call per spark or batched.

**Advice Generation:** This stays roughly the same — runs at the end, looks at any new insights produced during this iteration.

### The Graph Is the Memory

One nice property: the brain doesn't need an explicit memory of what it planned before. The graph *is* the memory. If the brain previously generated a query about Samsung's earnings and that query was executed, Samsung earnings nodes now exist in the graph. The next time the brain scans the graph, it sees those nodes and won't regenerate the same query. It'll notice the gap is filled and move on to the next thing.

This means the brain naturally avoids redundant work without any extra bookkeeping.

### Biggest Risk

The quality of the entire system now lives or dies by the brain's prompt. If the brain produces vague queries ("learn more about tech companies") or misses obvious patterns, everything downstream suffers. The current system avoids this by keeping classification trivially simple — but it pays for that simplicity with the ping-pong problem and the coarse binary choice.

So the investment needs to go into making the brain prompt excellent: clear about what a good query looks like, clear about what constitutes a spark worth synthesizing, and grounded in the agent's specific mission. The examples in the prompt will matter a lot.

## Q&A

### Q1: Graph Traversal Approaches vs. Brain-as-Planner

**Question:** I had started to approach this brain part as one of the graph traversal algorithms, where it maintains either:
- some type of "stack of themes" and then on each iteration, it pops the theme on top to explore it thoroughly through all the applicable phases (the depth-first approach)
- some type of "queue of themes" and the on each iteration, it pops the theme at the front to explore it thorough through all the applicable phases (i.e. the breadth-first approach)

These traversal approaches however would likely miss the temporal aspect of the graph as they are continuously expanding outward, while sometimes the brain may need to revisit older nodes. So perhaps we would have to modify them a bit to introduce an aspect of checking the temporal aspect of the graph by revisiting older nodes. Not sure how that would work though.

Your solution however is simple and avoids this complexity of graph traversals. But I wonder if this graph traversal might theoretically be better overall.

**Answer:**

The traversal approaches have one genuine theoretical advantage: **guaranteed coverage**. The brain-as-planner relies on the LLM's attention to notice what matters in the graph context. If there's an interesting pattern hiding in a neglected corner of a 500-node graph, the LLM might simply not attend to it. A systematic traversal would eventually get there.

But I think the traversal approach loses on three fronts that matter more in practice:

**1. Cross-theme connections are where the best insights live.** A DFS on "semiconductor supply chains" and a separate DFS on "interest rate policy" would each go deep — but the most valuable insight might be the *connection* between them ("rising rates are choking semiconductor capex"). Theme-by-theme traversal is structurally blind to cross-cutting patterns. The brain-as-planner sees the whole graph and can spot these.

**2. Responsiveness to the world.** The agent exists in a changing world. If it's three levels deep into a DFS on "EV battery technology" and a major Fed announcement drops, the traversal doesn't care — it's committed to its stack. The brain-as-planner re-scans every iteration and can pivot immediately.

**3. The temporal revisitation problem you raised is actually hard to bolt on.** You'd need heuristics like "revisit nodes older than N days" or "revisit when related nodes were recently updated." These heuristics are essentially reimplementing what the brain does naturally — looking at the whole graph and deciding what's worth attention. At that point, why not just let the brain do it directly?

**My honest take:** the brain-as-planner is better for this use case. But the coverage concern is real. Here's a lightweight way to get the benefit without the complexity: give the brain a **staleness signal** in the graph context. When building the graph context block, annotate regions that haven't been touched in a while. Something like "These 12 nodes about EU regulations were last updated 3 weeks ago." The brain can then decide whether that staleness matters. This isn't a traversal algorithm — it's just giving the brain better information to plan with. It addresses the blind spot risk without the state management overhead of maintaining stacks or queues across iterations.

### Q2: What Happens When a Spark Hits Insufficient Knowledge?

**Question:** With your solution, is it possible for the "insight synthesis" phase to potentially identify queries worth exploring? In other words, what happens to the spark if there's no enough knowledge in the graph to create a corresponding AgentInsight?

**Answer:**

This is the sharpest question you could ask about this design, because it reveals a gap in the pipeline.

Right now the pipeline is strictly linear: brain plans → populate runs → synthesize runs. But what if the brain generates a spark like "analyze services revenue trend across Apple, Google, and Microsoft" and the graph only has Apple data? The synthesis phase would either produce a weak insight or produce nothing.

The key insight is: **synthesis is in the best position to know what's missing.** The brain spots a potential pattern from a high-level scan, but synthesis is the one that actually tries to reason deeply about it and discovers "I can't do this properly without Google and Microsoft data."

So I'd let insight synthesis produce two types of output:

- **Insights** — when it has enough to work with
- **Investigation requests** — when it doesn't ("I need Q4 revenue data for Google and Microsoft to properly analyze this cross-company services trend")

The question is what happens to those investigation requests. Three options, in order of simplicity:

**Option A: Defer to next iteration.** Investigation requests go into the graph as a lightweight marker (or just naturally show up as the same spark next time, since the pattern still exists and is still incomplete). The brain sees them next iteration and generates the corresponding queries. Simple, no new mechanisms, but you pay one iteration of delay.

**Option B: Feed back within the same iteration.** After synthesis, if there are investigation requests, run a mini populate cycle for those specific queries, rebuild context, then re-run synthesis on the now-enriched graph. This eliminates the delay but introduces a loop within the iteration. You'd want a cap (max 1-2 feedback rounds) to prevent runaway iterations.

**Option C: The brain pre-validates sparks.** Before generating a spark, the brain checks whether the graph has sufficient data. If not, it generates the queries *and* the spark, knowing populate will run first and fill the gap. This front-loads the work but asks more of the brain — it needs to assess data sufficiency, which is hard to do from a high-level scan.

I'd lean toward **Option A** to start, with an eye toward Option B later. Here's why: the "one iteration delay" under the new system is much less painful than under the current system. Currently, a round-trip is: classify → populate → classify → synthesize (two full iterations, 10 minutes). Under Option A it's: brain generates spark + queries → populate fills gap + synthesis defers → next iteration brain sees completed data + same spark → synthesis succeeds. That's also two iterations, but the first one wasn't wasted — it did the populate work. And honestly, an insight that takes 10 minutes instead of 5 to fully develop is fine. The agent has infinite patience.

The important thing is that the investigation request is *specific*. It's not "I couldn't synthesize, try again later." It's "I need Google Q4 2025 services revenue to complete this analysis." That specificity means the brain's next plan is targeted, not a blind retry.

### Q3: Terminology — Naming the Actors and the Brain's Output

**Question:** A few things:

1. I like a lot this flow: "The brain observes a pattern" → "synthesis analyzes it" → "advice recommends action." what if we immortalize these parts: the brain, the analyzer and the adviser? Your flow can then use these nouns instead of verbs?
2. I like your take of using observation. But can't queries also count as observations? Ideally, the word should be applicable to what we have been calling "sparks" only. What do you think?
3. Whether we use insight/observation/etc for "sparks", what do you think about renaming the current usage of insights in the codebase to just analysis. So we would have AgentAnalysis, analysisGenerationSystemPrompt, analysisGenerationTools, etc

**Answer:**

**1. The Observer, the Researcher, the Analyzer, the Adviser.**

Naming the actors instead of the actions gives the system a clearer mental model. The "brain" remains as the conceptual metaphor for what this phase does, but in code we use **Observer** — it translates better into the codebase (`observerSystemPrompt`, `runObserverPhase`, `"observer"` phase literal). The flow reads naturally:

> The **Observer** scans and notices → the **Researcher** investigates → the **Analyzer** analyzes → the **Adviser** recommends.

The Observer delegates to the Researcher (populate) and the Analyzer (analysis), and the Adviser follows the Analyzer. Four actors with clear roles.

**2. "Observation" applies to queries too — you're right.**

"I observe that we're missing Samsung data" and "I observe that services revenue is accelerating" are both observations. The word doesn't disambiguate between the two types of brain output.

I actually think **insight** is the correct word here, and it does disambiguate. A query is recognizing what you *don't* know — "we have a gap here." An insight is recognizing something in what you *do* know — "these three nodes form a pattern." You don't call a knowledge gap an "insight." You call a moment of pattern recognition an insight.

So the Observer produces **queries** (gaps to fill) and **insights** (patterns to analyze). Those are semantically distinct in a way that "observations" wouldn't be.

And since AgentInsight is getting renamed to AgentAnalysis (point 3), there's no terminology collision anymore. "Insight" cleanly belongs to the Observer's output, "Analysis" cleanly belongs to the Analyzer's output.

**3. Renaming insight → analysis across the codebase.**

Yes, this is the right move. It completes the separation and creates a consistent naming pattern:

| Actor | Output | System Prompt Field | Tools |
|---|---|---|---|
| Observer | queries + insights | `observerSystemPrompt` | (structured output, no tools) |
| Researcher | graph nodes/edges | `knowledgeAcquisitionSystemPrompt` + `graphConstructionSystemPrompt` | search + graph tools |
| Analyzer | AgentAnalysis nodes | `analysisGenerationSystemPrompt` | graph tools |
| Adviser | AgentAdvice nodes | `adviceGenerationSystemPrompt` | graph tools |

The `analysisGeneration` naming parallels `adviceGeneration` nicely. And it follows a clean pattern: `{output}GenerationSystemPrompt`.

The Observer replaces the current `classificationSystemPrompt`, which becomes `observerSystemPrompt`.

### Q4: Relationship to the OODA Loop

**Question:** Don't you think our research doc and pretty much what we just implemented is a variant of the OODA loop?

**Answer:**

That's a sharp observation. It absolutely is.

**OODA**: Observe → Orient → Decide → Act

**Our pipeline**: Observer → Researcher → Analyzer → Adviser

The mapping:

| OODA | Our Pipeline | What it does |
|---|---|---|
| **Observe** | **Observer** | Scans the graph, notices knowledge gaps and patterns |
| **Orient** | **Researcher** | Builds context by filling gaps — actively acquires knowledge to properly understand the situation |
| **Decide** | **Analyzer** | Synthesizes patterns, forms conclusions about what the observations mean |
| **Act** | **Adviser** | Recommends specific actions to the user |

The main twist from classic OODA is that our "Orient" phase is *active* rather than purely mental. Boyd's Orient is about updating your mental model with what you already know — cultural traditions, previous experience, genetic heritage, new information. Our Researcher goes further: it actively goes out and gathers new information to fill the gaps the Observer identified. But that makes sense for an information agent operating in a data-rich environment.

The other nice parallel is Boyd's core insight: **the loop itself matters**. The agent that cycles through OODA faster and more coherently gains an advantage. That's exactly why we killed the ping-pong problem — the old system broke the loop across multiple iterations, while now the full cycle completes in one iteration. Boyd would call this "getting inside the opponent's OODA loop" — except our opponent is entropy and information decay, not another combatant.

We didn't consciously design it as OODA, but we converged on the same structure because the problem demands it: continuous autonomous sense-making in a changing environment. Boyd developed OODA for fighter pilots making split-second decisions; we built it for an agent making 5-minute decisions. The timescales are different, the structure is the same.
