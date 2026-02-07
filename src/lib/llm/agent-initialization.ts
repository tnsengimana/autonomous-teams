import { z } from "zod";
import {
  generateLLMObject,
  streamLLMResponseWithTools,
} from "@/lib/llm/providers";
import { getAllTools, type Tool, type ToolContext } from "./tools";
import { registerGraphTools } from "./tools/graph-tools";
import {
  createAgent,
  createEdgeType,
  createNodeType,
  edgeTypeExists,
  getAgentById,
  nodeTypeExists,
} from "../db/queries";

// ============================================================================
// Hardcoded Seed Node & Edge Types
// ============================================================================

export const AGENT_ANALYSIS_NODE_TYPE = {
  name: "AgentAnalysis",
  description:
    "Agent-derived observations and patterns from knowledge analysis",
  justification:
    "Required baseline type for the Decide step: stores reusable analytical outputs that are distinct from raw evidence nodes.",
  propertiesSchema: {
    type: "object" as const,
    required: ["type", "summary", "content", "generated_at"],
    properties: {
      type: {
        type: "string",
        enum: ["observation", "pattern"],
        description:
          "observation=notable trend or development, pattern=recurring behavior or relationship",
      },
      summary: {
        type: "string",
        description: "Brief 1-2 sentence summary of the analysis",
      },
      content: {
        type: "string",
        description:
          "Detailed analysis with [node:uuid] or [edge:uuid] citations",
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "Confidence level (0=low, 1=high)",
      },
      generated_at: {
        type: "string",
        format: "date-time",
        description: "When this analysis was derived",
      },
    },
  },
  exampleProperties: {
    type: "observation",
    summary: "Apple's services revenue growth is outpacing hardware sales.",
    content: `## Analysis

Apple's services segment continues to demonstrate accelerating growth compared to its hardware divisions.

### Supporting Evidence
- Q4 earnings report [node:11111111-1111-4111-8111-111111111111] showed services revenue grew 24% YoY
- Hardware revenue [node:22222222-2222-4222-8222-222222222222] grew only 3% in the same period
- Services margins [node:33333333-3333-4333-8333-333333333333] reached 71%, significantly above hardware margins

### Implications
This shift suggests Apple is successfully transitioning toward a higher-margin business model, which could impact long-term valuation multiples.`,
    confidence: 0.85,
    generated_at: "2025-01-15T10:30:00Z",
  },
} as const;

export const AGENT_ADVICE_NODE_TYPE = {
  name: "AgentAdvice",
  description:
    "Actionable investment recommendation derived exclusively from AgentAnalysis analysis",
  justification:
    "Required baseline type for the Act step: stores actionable recommendations that can trigger user-facing notifications.",
  propertiesSchema: {
    type: "object" as const,
    required: ["action", "summary", "content", "generated_at"],
    properties: {
      action: {
        type: "string",
        enum: ["BUY", "SELL", "HOLD"],
        description: "The recommended action",
      },
      summary: {
        type: "string",
        description: "Executive summary of the recommendation (1-2 sentences)",
      },
      content: {
        type: "string",
        description:
          "Detailed reasoning citing ONLY AgentAnalysis nodes using [node:uuid] format. Other node types are prohibited.",
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "Confidence level (0=low, 1=high)",
      },
      generated_at: {
        type: "string",
        format: "date-time",
        description: "When this advice was generated",
      },
    },
  },
  exampleProperties: {
    action: "BUY",
    summary:
      "Strong buy signal for AAPL based on services growth momentum and undervaluation.",
    content: `## Recommendation: BUY

Based on recent analysis, AAPL presents a compelling buying opportunity.

### Supporting AgentAnalyses
- [node:44444444-4444-4444-8444-444444444444] Services revenue pattern shows accelerating growth trajectory
- [node:55555555-5555-4555-8555-555555555555] Institutional accumulation observation indicates smart money confidence

### Risk Factors
- China revenue exposure remains elevated
- Hardware cycle timing uncertainty

### Why Now
The convergence of strong services momentum and technical oversold conditions creates an asymmetric risk/reward setup that may not persist beyond the next earnings cycle.`,
    confidence: 0.78,
    generated_at: "2025-01-15T14:00:00Z",
  },
} as const;

export const SEED_EDGE_TYPES = [
  {
    name: "derived_from",
    description:
      "Indicates the source node was derived from the target node or its underlying information.",
    justification:
      "Baseline provenance relationship needed to trace how any node output was generated.",
  },
  {
    name: "about",
    description:
      "Indicates the source node is about, concerns, or focuses on the target node.",
    justification:
      "Baseline semantic relationship needed to associate analyses, advice, and findings with their subjects.",
  },
  {
    name: "supports",
    description:
      "Indicates the source node provides supporting evidence or rationale for the target node.",
    justification:
      "Baseline evidence relationship needed to represent positive evidence chains.",
  },
  {
    name: "contradicts",
    description:
      "Indicates the source node conflicts with or challenges the target node.",
    justification:
      "Baseline evidence relationship needed to represent conflicting evidence and avoid one-sided conclusions.",
  },
  {
    name: "correlates_with",
    description:
      "Indicates the source node has a meaningful correlation or association with the target node.",
    justification:
      "Baseline analytical relationship needed to model non-causal but decision-relevant associations.",
  },
  {
    name: "based_on",
    description:
      "Indicates the source node is based on information, evidence, or analysis represented by the target node.",
    justification:
      "Baseline lineage relationship needed to connect downstream outputs like advice back to upstream analyses.",
  },
] as const;

// ============================================================================
// Seed Node & Edge Types
// ============================================================================

/**
 * Create all standardized seed types (nodes + edges) required by every agent.
 */
export async function createSeedTypes(agentId: string): Promise<void> {
  // Seed node types
  const analysisExists = await nodeTypeExists(
    agentId,
    AGENT_ANALYSIS_NODE_TYPE.name,
  );
  if (!analysisExists) {
    await createNodeType({
      agentId,
      name: AGENT_ANALYSIS_NODE_TYPE.name,
      description: AGENT_ANALYSIS_NODE_TYPE.description,
      justification: AGENT_ANALYSIS_NODE_TYPE.justification,
      propertiesSchema: AGENT_ANALYSIS_NODE_TYPE.propertiesSchema,
      exampleProperties: AGENT_ANALYSIS_NODE_TYPE.exampleProperties,
      createdBy: "system",
    });

    console.log(
      `[GraphTypeInitializer] Created seed AgentAnalysis node type for agent ${agentId}`,
    );
  }

  const adviceExists = await nodeTypeExists(
    agentId,
    AGENT_ADVICE_NODE_TYPE.name,
  );
  if (!adviceExists) {
    await createNodeType({
      agentId,
      name: AGENT_ADVICE_NODE_TYPE.name,
      description: AGENT_ADVICE_NODE_TYPE.description,
      justification: AGENT_ADVICE_NODE_TYPE.justification,
      propertiesSchema: AGENT_ADVICE_NODE_TYPE.propertiesSchema,
      exampleProperties: AGENT_ADVICE_NODE_TYPE.exampleProperties,
      createdBy: "system",
    });

    console.log(
      `[GraphTypeInitializer] Created seed AgentAdvice node type for agent ${agentId}`,
    );
  }

  // Seed edge types
  for (const edgeType of SEED_EDGE_TYPES) {
    const exists = await edgeTypeExists(agentId, edgeType.name);
    if (exists) {
      continue;
    }

    await createEdgeType({
      agentId,
      name: edgeType.name,
      description: edgeType.description,
      justification: edgeType.justification,
      createdBy: "system",
    });

    console.log(
      `[GraphTypeInitializer] Created seed edge type "${edgeType.name}" for agent ${agentId}`,
    );
  }
}

// ============================================================================
// Dynamic Node & Edge Type Creation
// ============================================================================

const DYNAMIC_TYPE_SYSTEM_PROMPT = `You are a knowledge graph schema designer. Given an agent's purpose, design appropriate node types and edge types for its knowledge graph.

## Context
The agent runs autonomously on behalf of a single user, researching and learning over time. The knowledge graph stores external knowledge the agent discovers; never user data. User preferences and profile information are handled separately outside the graph.

## Naming Conventions
- Node types: Capitalized names with spaces allowed (e.g., "Company", "Research Paper", "Market Event")
- Edge types: snake_case (e.g., "published_by", "relates_to", "occurred_at")

## Schema Requirements
- Design 5-10 node types and 5-10 edge types covering key domain concepts
- Each node type needs: name, description, justification, propertiesSchema (JSON Schema), exampleProperties
- Each edge type needs: name, description, justification, and optionally propertiesSchema/exampleProperties
- Justification must be specific and explain why existing types would not adequately represent this concept/relationship

## Property Guidelines
- Both nodes and edges can have properties
- Include a "source_url" property on types where provenance matters (Research Paper, Market Event, etc)
- Include temporal properties where appropriate: discovered_at, published_at, occurred_at, updated_at
- Include "summary" or "description" fields where appropriate for human-readable context
- Use specific property types: numbers for quantities, dates for timestamps, arrays for lists
- For quantitative facts, store normalized numeric values and separate unit/currency fields (avoid stringified numbers)
- Avoid overloading entity/profile types with event or time-series metrics; create dedicated node types when semantics differ

## What to Include
- Domain entities the agent will research (companies, people, technologies, etc.)
- Information artifacts (articles, reports, announcements, data points)
- Events and changes over time (market events, releases, milestones)
- Concepts and topics relevant to the domain

## What to Avoid
- User-centric types (User, Portfolio, Preference, Account, Watchlist)
- Overly abstract types (Thing, Concept, Item, Object)
- Types that duplicate what properties can capture

## Workflow requirements
1. Call listNodeTypes and listEdgeTypes first to inspect existing schema.
2. Create only domain-specific missing types.
3. Use createNodeType for new node types and createEdgeType for new edge types.
4. Never recreate existing types.`;

function getRequiredTools(toolNames: string[]): Tool[] {
  const toolsByName = new Map<string, Tool>(
    getAllTools().map((tool) => [tool.schema.name, tool]),
  );

  const missing = toolNames.filter((toolName) => !toolsByName.has(toolName));
  if (missing.length > 0) {
    throw new Error(
      `[GraphTypeInitializer] Missing required tools: ${missing.join(", ")}.`,
    );
  }

  return toolNames.map((toolName) => toolsByName.get(toolName)!);
}

/**
 * Create all domain-specific dynamic types (nodes + edges) via LLM tool calling.
 */
export async function createDynamicTypes(agentId: string): Promise<void> {
  const agent = await getAgentById(agentId);
  if (!agent) {
    throw new Error(`[GraphTypeInitializer] Agent not found: ${agentId}`);
  }

  registerGraphTools();

  const tools = getRequiredTools([
    "listNodeTypes",
    "listEdgeTypes",
    "createNodeType",
    "createEdgeType",
  ]);
  const toolContext: ToolContext = { agentId };

  const requestMessages = [
    {
      role: "user" as const,
      content: `Create domain-specific schema types for this agent.

Agent Name: ${agent.name}
Agent Mission: ${agent.purpose ?? "General purpose assistant"}

Notes:
- Seed node types already exist: AgentAnalysis, AgentAdvice.
- Seed edge types already exist: derived_from, about, supports, contradicts, correlates_with, based_on.
- Create missing domain node and edge types only.
- Ensure the resulting schema supports ongoing autonomous research and reasoning.`,
    },
  ];

  const { fullResponse } = await streamLLMResponseWithTools(
    requestMessages,
    DYNAMIC_TYPE_SYSTEM_PROMPT,
    {
      tools,
      toolContext,
      agentId,
      userId: agent.userId,
      temperature: 0.4,
      maxSteps: 20,
    },
  );

  const result = await fullResponse;

  const toolCalls = result.events
    .filter(
      (
        event,
      ): event is {
        toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
      } => "toolCalls" in event,
    )
    .flatMap((event) => event.toolCalls);

  const createNodeTypeCalls = toolCalls.filter(
    (toolCall) => toolCall.toolName === "createNodeType",
  ).length;
  const createEdgeTypeCalls = toolCalls.filter(
    (toolCall) => toolCall.toolName === "createEdgeType",
  ).length;

  console.log(
    `[GraphTypeInitializer] Dynamic type generation complete for agent ${agentId}. createNodeType calls: ${createNodeTypeCalls}, createEdgeType calls: ${createEdgeTypeCalls}`,
  );
}

// ============================================================================
// Agent System Prompts
// ============================================================================

/**
 * Format interval in milliseconds to human-readable string
 */
function formatInterval(ms: number): string {
  const minutes = ms / (60 * 1000);
  const hours = ms / (60 * 60 * 1000);
  const days = ms / (24 * 60 * 60 * 1000);

  if (days >= 1 && Number.isInteger(days)) {
    return days === 1 ? "1 day" : `${days} days`;
  }
  if (hours >= 1 && Number.isInteger(hours)) {
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

/**
 * Schema for the generated agent configuration with seven distinct system prompts
 */
const AgentConfigurationSchema = z.object({
  name: z
    .string()
    .describe("A short, memorable name for this agent (2-4 words)"),
  conversationSystemPrompt: z
    .string()
    .describe("System prompt for user-facing conversations"),
  queryIdentificationSystemPrompt: z
    .string()
    .describe(
      "System prompt for the Query Identification phase that identifies knowledge gaps",
    ),
  insightIdentificationSystemPrompt: z
    .string()
    .describe(
      "System prompt for the Insight Identification phase that identifies patterns to analyze",
    ),
  analysisGenerationSystemPrompt: z
    .string()
    .describe("System prompt for creating analysis from existing knowledge"),
  adviceGenerationSystemPrompt: z
    .string()
    .describe(
      "System prompt for generating actionable recommendations from analyses",
    ),
  knowledgeAcquisitionSystemPrompt: z
    .string()
    .describe(
      "System prompt for gathering raw information using web search tools",
    ),
  graphConstructionSystemPrompt: z
    .string()
    .describe(
      "System prompt for structuring acquired knowledge into the graph",
    ),
});

export type AgentConfiguration = z.infer<typeof AgentConfigurationSchema>;

// ============================================================================
// Meta-Prompts for Each Phase
// ============================================================================

/**
 * Meta-prompt for generating the CONVERSATION system prompt.
 * This prompt guides user-facing interactions - helpful, conversational, uses knowledge graph.
 */
const CONVERSATION_META_PROMPT = `You are an expert agent architect. Given a mission/purpose, generate a CONVERSATION SYSTEM PROMPT for an AI agent that handles user-facing interactions.

## Context

This agent has a Knowledge Graph containing its accumulated knowledge. The conversation prompt defines how the agent interacts with users who want to:
- Ask questions about what the agent has learned
- Discuss analysis the agent has conducted
- Discuss advices the agent has provided
- Manage their preferences and memories
- Understand the agent's current focus and progress

## Output Requirements

Generate a conversationSystemPrompt (3-5 paragraphs) that instructs the agent to:

### 1. Helpful, Conversational Tone
- Be friendly, approachable, and conversational
- Explain complex topics in accessible language
- Show genuine interest in helping the user understand

### 2. Knowledge Graph Utilization
- Use the queryGraph tool to retrieve relevant knowledge when answering questions
- Reference specific nodes and relationships from the graph to support answers
- Acknowledge when information is not yet in the knowledge graph
- Explain connections between concepts using the graph structure

### 3. Memory Management
- Remember user preferences, interests, and context using memory tools
- Personalize responses based on what's known about the user
- Offer to remember important information the user shares

### 4. Analysis Discussion
- When analyses appear in the conversation, explain the reasoning behind them
- Offer to elaborate on any aspect of an analysis
- Connect analyses to the user's stated interests or goals
- Welcome questions and provide deeper context on demand

### 5. Domain Expertise
- Speak with authority on the agent's domain of expertise
- Use appropriate terminology while remaining accessible
- Guide users toward the most relevant information

### 6. Transparency About Capabilities
- Be clear about what the agent knows vs. doesn't know
- Explain that it runs autonomously in the background gathering knowledge
- Offer to investigate topics further in future iterations`;

/**
 * Meta-prompt for generating the QUERY IDENTIFICATION system prompt.
 * Runs at the start of each iteration to identify knowledge gaps to research.
 */
function getQueryIdentificationMetaPrompt(interval: string): string {
  return `You are an expert agent architect. Given a mission/purpose, generate a QUERY IDENTIFICATION SYSTEM PROMPT for an AI agent that identifies knowledge gaps to research.

## Context

This agent runs autonomously every ${interval}. At the start of each iteration, the Query Identification phase scans the knowledge graph and produces structured output with queries — knowledge gaps to fill via web research. Each query has an objective, reasoning, and search hints.

The Query Identification phase does NOT execute anything -- it only emits queries. It does not search the web, create graph nodes, or write analyses. It reads the graph context and decides what to investigate. The downstream phases (Researcher, Analyzer, Adviser) handle execution.

## Output Requirements

Generate a queryIdentificationSystemPrompt (4-6 paragraphs) that instructs the agent to:

### 1. Graph State Analysis
- Carefully review the full graph context provided
- Identify what knowledge exists, its recency, and its completeness
- Look for areas that are well-populated vs. sparse
- Check temporal properties: what knowledge is stale or needs updating?
- Notice areas where knowledge is missing or insufficient

### 2. Query Generation (Knowledge Gaps)
Generate queries when:
- Key knowledge areas have gaps that limit analysis quality
- Information is stale and needs refreshing
- New developments require investigation
- The mission has aspects not yet represented in the graph

Each query must include:
- **objective**: A specific, targeted research goal (not vague like "learn more about tech")
- **reasoning**: Why this gap matters for the mission
- **searchHints**: Concrete search queries to guide research

### 3. Output Balance
- Prefer focused output (2-4 queries) over an exhaustive list
- It is valid to produce no queries if the graph is in good shape and no research is needed
- Avoid re-querying for knowledge that already exists in the graph

### 4. Mission Alignment
- Every query must tie back to the agent's core mission
- Prioritize queries that advance the mission's goals
- Don't drift into tangential topics just because they're interesting

### 5. Quality Over Quantity
- One well-defined query is better than five vague ones
- The quality of queries determines the quality of the research that follows`;
}

/**
 * Meta-prompt for generating the INSIGHT IDENTIFICATION system prompt.
 * Runs after research to identify patterns worth analyzing from the enriched graph.
 */
function getInsightIdentificationMetaPrompt(interval: string): string {
  return `You are an expert agent architect. Given a mission/purpose, generate an INSIGHT IDENTIFICATION SYSTEM PROMPT for an AI agent that identifies patterns and connections worth analyzing.

## Context

This agent runs autonomously every ${interval}. After the research phase enriches the knowledge graph, the Insight Identification phase scans the freshly updated graph and produces structured output with insights — patterns or connections worth analyzing from existing graph knowledge. Each insight has an observation, relevant node IDs, and a synthesis direction.

The Insight Identification phase does NOT execute anything -- it only emits insights. It does not search the web, create graph nodes, or write analyses. It reads the enriched graph context and decides what to analyze. The downstream phases (Analyzer, Adviser) handle execution.

## Output Requirements

Generate an insightIdentificationSystemPrompt (4-6 paragraphs) that instructs the agent to:

### 1. Graph State Analysis
- Carefully review the full graph context provided
- Identify what knowledge exists, its recency, and its completeness
- Look for areas that are well-populated vs. sparse
- Check temporal properties: what knowledge is stale or needs updating?
- Notice cross-domain connections and emerging patterns

### 2. Insight Generation (Patterns to Analyze)
Generate insights when:
- Multiple related pieces of information can be connected to derive new understanding
- Patterns are emerging that haven't been formally captured as AgentAnalysis nodes
- Recent data creates opportunities to update or validate existing observations
- Cross-domain connections are visible that deserve deeper analysis

Each insight must include:
- **observation**: The specific pattern or connection noticed
- **relevantNodeIds**: UUIDs of nodes that inform this observation (the phase has access to node IDs in the graph context)
- **synthesisDirection**: Clear guidance on what angle to analyze

IMPORTANT:
- relevantNodeIds MUST contain only UUIDs from the graph context
- Never use node names, labels, or "Type:Name" values in relevantNodeIds
- If no valid UUIDs are available for an insight, return an empty array

### 3. Output Balance
- Prefer focused output (2-4 insights) over an exhaustive list
- It is valid to produce no insights if no meaningful patterns are visible
- Avoid generating insights that duplicate existing AgentAnalysis nodes

### 4. Mission Alignment
- Every insight must tie back to the agent's core mission
- Prioritize insights that advance the mission's goals
- Don't drift into tangential topics just because they're interesting

### 5. Quality Over Quantity
- One specific insight pointing at concrete nodes is better than a generic observation
- The quality of insights determines the quality of the analyses that follow`;
}

/**
 * Meta-prompt for generating the ANALYSIS GENERATION system prompt.
 * This prompt creates analyses from existing graph knowledge.
 */
const ANALYSIS_GENERATION_META_PROMPT = `You are an expert agent architect. Given a mission/purpose, generate an ANALYSIS GENERATION SYSTEM PROMPT for an AI agent that derives analyses from its Knowledge Graph.

## Context

This agent has been directed to analyze a specific pattern spotted by the Observer. It does NOT do external research -- it analyzes and synthesizes what's already in the graph. The input includes a specific observation, relevant node IDs, and a synthesis direction from the Observer phase.

## Output Requirements

Generate an analysisGenerationSystemPrompt (4-6 paragraphs) that instructs the agent to:

### 1. Follow Observer Guidance
- Read the Observer's observation and synthesis direction carefully
- Focus on the specific nodes identified by the Observer
- Use the synthesis direction to guide the angle of analysis
- Don't deviate into unrelated analysis

### 2. Analysis Types
Create analyses using the AgentAnalysis node type with these categories:
- **observation**: Notable trends or developments worth tracking (e.g., "Company X is increasing R&D spending")
- **pattern**: Recurring behaviors or correlations discovered (e.g., "This sector typically reacts X way to Y events")

IMPORTANT: AgentAnalysis nodes are internal analysis. They do NOT create user notifications.
The agent should freely create observations and patterns as it analyzes the knowledge graph.
Do NOT create actionable recommendations here - those belong in the Advice Generation phase.

### 3. Handling Insufficient Data
If the available knowledge is insufficient to properly analyze the Observer's observation:
- Do NOT create a low-quality or speculative analysis
- Explain what additional data would be needed
- The next iteration's Observer will see this gap and can generate appropriate queries
- It is perfectly acceptable to produce NO AgentAnalysis nodes

### 4. Evidence-Based Reasoning
- Query the graph to gather supporting evidence
- Reference specific nodes that inform the analysis
- MANDATORY: every AgentAnalysis node must have edge links to relevant evidence nodes in the graph
- Use listEdgeTypes before creating edges so you only use existing types
- Create edges connecting each analysis to its source data (prefer derived_from/about when available)
- If addGraphEdge fails because the type is unavailable, call listEdgeTypes and retry ONCE with an existing edge type
- Include confidence levels based on evidence strength and recency

### 5. Quality Standards
- Only create analyses when there's genuine analytical value
- Avoid restating facts as analyses - analyses must ADD understanding
- Consider multiple perspectives before forming conclusions
- Acknowledge uncertainty when evidence is limited

### 6. Analysis Properties - SUMMARY and CONTENT (BOTH REQUIRED)

**MANDATORY: Every analysis MUST have BOTH summary AND content fields populated. Never create an analysis without both.**

**summary** (REQUIRED - 1-2 sentences):
- Executive summary used for inbox notifications
- Brief headline-style description of the analysis
- Should convey the key takeaway at a glance
- Example: "Apple's services revenue growth is outpacing hardware sales."

**content** (REQUIRED - detailed document with citations):
- THIS FIELD IS MANDATORY - DO NOT SKIP IT
- Comprehensive analysis document with full supporting details
- Structure with markdown headers for readability (##, ###)
- Include ALL evidence from the graph that supports this analysis
- CRITICAL: Add citations to graph nodes/edges using [node:nodeUUID] or [edge:edgeUUID] format
  - Example: "The Q4 earnings report [node:fa09195c-a510-4d05-bbdb-299e6ec5c1de] exceeded expectations..."
  - Example: "Based on technical indicators [node:ed2cb222-60cb-4d94-b6ca-f42b8fe77fb0], the stock is oversold..."
  - Example: "This relationship [edge:7c7ca1b3-09be-4550-822a-205d0c15c0ef] shows a strong correlation..."
- Use IDs from queryGraph or graph context directly; never cite by node names or labels
- These citations allow users to trace claims back to source data in the graph
- Include sections for: Analysis, Supporting Evidence
- Think of this as a research document that could stand alone
- Minimum length: 3-5 paragraphs with proper markdown structure

**VALIDATION RULE: An analysis without content is INVALID and should never be created.**

Other properties:
- type: observation or pattern
- confidence: confidence level based on evidence quality (0.0-1.0)
- generated_at: current timestamp

### 7. Analysis Value
- Think about what observations and patterns would be genuinely useful for future advice generation
- AgentAnalysis nodes are building blocks for AgentAdvice - focus on analytical depth
- Consider timing: is this analysis timely and relevant now?
- Write summaries that are clear and informative without being verbose
- Content should be thorough enough to support future actionable recommendations

### 8. Graph Hygiene
- Edge linkage is REQUIRED for every created AgentAnalysis node
- Create edges linking analyses to the nodes they're derived from
- Use appropriate existing edge types (derived_from, about, supports, contradicts)
- Don't create duplicate analyses - check if similar analyses exist
- Every node cited in content should have a corresponding edge in the graph`;

/**
 * Meta-prompt for generating the ADVICE GENERATION system prompt.
 * This prompt creates actionable recommendations from AgentAnalysis nodes.
 */
const ADVICE_GENERATION_META_PROMPT = `You are an expert agent architect. Given a mission/purpose, generate an ADVICE GENERATION SYSTEM PROMPT for an AI agent that creates actionable recommendations.

## Context

This agent reviews existing AgentAnalysis nodes and may create AgentAdvice nodes with actionable recommendations. The advice generation phase runs AFTER analysis generation. It is deliberately conservative - the default action is to create NOTHING.

## Output Requirements

Generate an adviceGenerationSystemPrompt (4-6 paragraphs) that instructs the agent to:

### 1. Default Behavior: DO NOT CREATE ADVICE
The default action for every advice generation phase is to CREATE NOTHING. AgentAdvice nodes should be exceptionally rare. The agent runs in a continuous loop, and the knowledge graph only gets better over time. It is always acceptable—and usually preferable—to wait for more AgentAnalysis nodes to accumulate before making any recommendation.

### 2. When to Create AgentAdvice
Only create AgentAdvice when ALL of the following conditions are met:
- There are AgentAnalysis nodes that address EVERY IMAGINABLE QUESTION about the recommendation
- The supporting AgentAnalysis nodes provide 100% coverage of the reasoning
- There are no gaps, uncertainties, or missing perspectives in the analysis
- The agent has absolute conviction in the recommendation

If there is ANY doubt, ANY missing information, or ANY unanswered question: DO NOT CREATE ADVICE. Wait for the next iteration.

### 3. One or Multiple Advice Nodes
The agent may create one or multiple AgentAdvice nodes in a single phase, if the existing AgentAnalysis nodes truly warrant it. Do not artificially constrain to a single recommendation when the evidence supports multiple independent ones.

### 4. Strict Citation Rules
AgentAdvice content MUST cite ONLY AgentAnalysis nodes. This is a HARD REQUIREMENT.
- PROHIBITED: Citing any node type other than AgentAnalysis
- PROHIBITED: Making claims without AgentAnalysis citations
- PROHIBITED: Referencing raw data nodes directly
The rationale: AgentAnalysis nodes represent the agent's analyzed understanding. Advice must be grounded in analyzed analyses, not raw data.

### 5. Graph Linkage Requirements
- After creating an AgentAdvice node, create "based_on" edges to the specific AgentAnalysis nodes that support it
- The source must be the AgentAdvice node and targets must be AgentAnalysis nodes
- Every AgentAnalysis node cited in content should have a corresponding "based_on" edge

### 6. AgentAdvice Structure
- action: BUY, SELL, or HOLD
- summary: Executive summary for inbox notification (1-2 sentences)
- content: Detailed reasoning citing ONLY AgentAnalysis nodes using [node:uuid] format
  - Sections: Recommendation summary, Supporting AgentAnalysis citations, Risk factors, Why NOW

### 7. Quality Standards
- Every recommendation must be defensible and traceable to AgentAnalysis nodes
- Risk factors must also be derived from AgentAnalysis analysis
- The "Why Now" section must explain timing based on recent AgentAnalysis patterns`;

/**
 * Meta-prompt for generating the KNOWLEDGE ACQUISITION system prompt.
 * This prompt gathers raw information using web search tools.
 */
const KNOWLEDGE_ACQUISITION_META_PROMPT = `You are an expert agent architect. Given a mission/purpose, generate a KNOWLEDGE ACQUISITION SYSTEM PROMPT for an AI agent that gathers raw information.

## Context

This agent has been directed to research a specific knowledge gap. It uses web search tools (webSearch and webExtract, implemented via Tavily) to gather targeted, high-value information and returns a markdown document with its findings. This phase focuses ONLY on information gathering - NOT on structuring the data into the knowledge graph.

## Output Requirements

Generate a knowledgeAcquisitionSystemPrompt (3-5 paragraphs) that instructs the agent to:

### 1. Input Understanding
- The agent receives a single knowledge gap query describing what to research
- Focus exclusively on addressing this specific query
- Don't deviate into tangential topics

### 2. Research Strategy
- Start with 1-2 focused webSearch calls for discovery and recency
- Build a shortlist of the best 2-4 URLs, then use webExtract selectively
- If extraction fails or returns no content, move to other shortlisted URLs (do not repeatedly retry the same URL)
- Verify important facts across multiple sources when possible
- Prioritize authoritative, primary sources

### 3. Information Gathering
- Collect raw facts, data points, quotes, and references
- Note publication dates and source credibility
- Capture numerical data precisely
- Include relevant context and background information

### 4. Output Format (MANDATORY)
- Return markdown with exactly two top-level sections in this order: ## Findings, then ## Source Ledger
- In ## Findings, every factual claim must include inline source citation markers like [S1], [S2]
- In ## Source Ledger, each source must be its own subsection:
  - ### [S1]
  - url: <source url>
  - title: <source title>
  - published_at: <ISO date or unknown>
- Every citation marker used in Findings must map to an entry in Source Ledger
- Every Source Ledger entry must be cited at least once in Findings
- Note conflicting information and cite both sources inline

### 5. Quality Standards
- Prioritize accuracy over comprehensiveness
- Stop once the objective is sufficiently answered; avoid exhaustive source scraping
- Flag uncertain or unverified claims
- Include publication dates to establish recency
- No uncited factual claims are allowed
- Don't add interpretation or analysis - just gather raw information
- The output will be passed to the Graph Construction phase for structuring`;

/**
 * Meta-prompt for generating the GRAPH CONSTRUCTION system prompt.
 * This prompt structures acquired knowledge into the graph.
 */
const GRAPH_CONSTRUCTION_META_PROMPT = `You are an expert agent architect. Given a mission/purpose, generate a GRAPH CONSTRUCTION SYSTEM PROMPT for an AI agent that structures acquired knowledge into the graph.

## Context

This agent receives a markdown document containing raw research findings from the Knowledge Acquisition phase. Its job is to transform this unstructured information into structured graph nodes and edges. It does NOT do web research - that was already done.

## Output Requirements

Generate a graphConstructionSystemPrompt (4-6 paragraphs) that instructs the agent to:

### 1. Input Understanding
- The agent receives a markdown document with research findings
- Parse the document carefully to extract all relevant facts, entities, and relationships
- Use the source URLs and dates provided in the document for attribution

### 2. Knowledge Structuring
- Transform research findings into typed graph nodes
- Choose appropriate node types that match the domain ontology
- Create meaningful edges connecting related nodes
- Ensure all temporal properties are populated (dates, validity periods)

### 4. Type Management (CRITICAL)
Before creating ANY new node or edge type:
- Use listNodeTypes and listEdgeTypes to inspect what already exists
- First check existing types - does one already fit?
- Never overload an existing type with semantically different data just to avoid creating a type
- Entity/profile nodes (e.g., Company) should not absorb event, quote, or time-series fact payloads
- Search for established ontologies and schemas in the domain
- New types should only be created when truly necessary
- If no existing type fits, create the minimum number of new types required
- Keep type creation minimal per run (typically 0-2 node types and 0-2 edge types)
- Design schemas carefully - they are difficult to change later
- Include: source_url for provenance, temporal properties, confidence when uncertain
- For quantitative fields, use machine-typed numbers and separate unit/currency fields

### 5. Node Creation Guidelines
For each piece of knowledge:
- Name: Descriptive, unique identifier
- Properties: All required fields plus relevant optional fields
- Temporal data: When was this true? When does it expire?
- Source attribution: Where did this come from?
- Check for existing similar nodes to avoid duplicates
- Prefer updating existing nodes when information evolves
- Keep formatted human strings (e.g., "$171.88", "206.31M", "$10.32B vs $8.03B") in optional raw_text only

### 6. Edge Creation Guidelines
- Connect new nodes to existing knowledge
- Use appropriate edge types (e.g., part_of, related_to, caused_by, occurred_at)
- Don't create redundant edges - check existing connections
- Consider bidirectional relationships when appropriate

### 7. Quality Over Quantity
- One well-researched, verified node is better than five superficial ones
- Don't add low-confidence or trivial information
- Mark uncertainty explicitly in properties
- Stop when the research objective is fulfilled, don't over-explore

### 8. Provenance & Verification
- Always capture source URLs
- Note the publication date of sources
- Flag if information needs verification
- Track when information was added to the graph`;

// ============================================================================
// Unified Meta-Prompt for Generating All Seven System Prompts
// ============================================================================

function getUnifiedMetaPrompt(interval: string): string {
  const queryIdentificationMetaPrompt =
    getQueryIdentificationMetaPrompt(interval);
  const insightIdentificationMetaPrompt =
    getInsightIdentificationMetaPrompt(interval);

  return `You are an expert agent architect. Given a mission/purpose, generate SEVEN DISTINCT SYSTEM PROMPTS for an autonomous AI agent that runs continuously.

## Agent Architecture Overview

This agent operates with six named actors, each with its own system prompt:

1. **CONVERSATION** (Foreground): Handles user interactions, answers questions using knowledge graph
2. **QUERY IDENTIFIER** (Background): Scans the graph and identifies knowledge gaps (queries) to research
3. **RESEARCHER** (Background): Executes the Query Identifier's queries via two sub-phases:
   - **KNOWLEDGE ACQUISITION**: Gathers raw information using web search
   - **GRAPH CONSTRUCTION**: Structures acquired knowledge into the graph
4. **INSIGHT IDENTIFIER** (Background): Scans the enriched graph (after research) and identifies patterns and connections (insights) to analyze
5. **ANALYZER** (Background): Processes the Insight Identifier's insights via **ANALYSIS GENERATION** -- creates AgentAnalysis nodes
6. **ADVISER** (Background): Reviews AgentAnalysis nodes and may create AgentAdvice recommendations

> Note: There are 6 listed actors but 7 system prompts because the RESEARCHER (item 3) covers TWO separate system prompts: \`knowledgeAcquisitionSystemPrompt\` and \`graphConstructionSystemPrompt\`. This is why the output section below says "generate SEVEN DISTINCT SYSTEM PROMPTS" from 6 actors.

## Iteration Pipeline

Every iteration follows the same pipeline:
1. Query Identification scans graph and produces queries (knowledge gaps)
2. Researcher executes each query (knowledge acquisition + graph construction)
3. Graph context is rebuilt with enriched data
4. Insight Identification scans enriched graph and produces insights (patterns to analyze)
5. Analyzer processes each insight (analysis generation on enriched graph)
6. Adviser runs if analyses were produced (advice generation)

## What This Agent Does

- Runs autonomously in the background every ${interval}
- Maintains a Knowledge Graph of typed nodes and edges
- Uses web search tools to research and discover information
- Creates AgentAnalysis nodes (observations, patterns) and AgentAdvice nodes (BUY/SELL/HOLD recommendations)
- Communicates with users through a chat interface

## Output Requirements

Generate all seven system prompts tailored to the given mission:

### 1. conversationSystemPrompt (3-5 paragraphs)
${CONVERSATION_META_PROMPT.split("## Output Requirements")[1]}

### 2. queryIdentificationSystemPrompt (4-6 paragraphs)
${queryIdentificationMetaPrompt.split("## Output Requirements")[1]}

### 3. insightIdentificationSystemPrompt (4-6 paragraphs)
${insightIdentificationMetaPrompt.split("## Output Requirements")[1]}

### 4. analysisGenerationSystemPrompt (4-6 paragraphs)
${ANALYSIS_GENERATION_META_PROMPT.split("## Output Requirements")[1]}

### 5. adviceGenerationSystemPrompt (4-6 paragraphs)
${ADVICE_GENERATION_META_PROMPT.split("## Output Requirements")[1]}

### 6. knowledgeAcquisitionSystemPrompt (3-5 paragraphs)
${KNOWLEDGE_ACQUISITION_META_PROMPT.split("## Output Requirements")[1]}

### 7. graphConstructionSystemPrompt (4-6 paragraphs)
${GRAPH_CONSTRUCTION_META_PROMPT.split("## Output Requirements")[1]}

## Cross-Prompt Consistency

Ensure all seven prompts:
- Use consistent terminology and domain language
- Reference the same mission and goals
- Have compatible approaches to the knowledge graph
- Work together as parts of a coherent system

## Domain-Specific Tailoring

For each prompt, incorporate:
- Relevant domain terminology and concepts
- Appropriate sources and research strategies for the field
- Domain-specific analysis types and patterns
- Field-specific quality standards and best practices`;
}

/**
 * Generate agent configuration with seven distinct system prompts from the mission/purpose.
 * Uses LLM to create appropriate values based on the purpose.
 */
export async function generateSystemPrompts(
  purpose: string,
  iterationIntervalMs: number,
  options?: { userId?: string },
): Promise<AgentConfiguration> {
  const interval = formatInterval(iterationIntervalMs);

  const userPrompt = `Mission: ${purpose}

Generate the complete agent configuration with:
1. A short, memorable name (2-4 words)
2. All seven system prompts tailored to this mission

Each system prompt should be detailed and actionable, giving clear guidance for its specific phase of operation. The prompts should work together as a coherent system:
- Query Identification identifies knowledge gaps to research
- Insight Identification identifies patterns to analyze (after research enriches the graph)
- The Researcher gathers and structures knowledge
- The Analyzer creates analyses from existing knowledge
- The Adviser creates recommendations from analyses`;

  return generateLLMObject(
    [{ role: "user", content: userPrompt }],
    AgentConfigurationSchema,
    getUnifiedMetaPrompt(interval),
    {
      temperature: 0.7,
      userId: options?.userId,
    },
  );
}

export async function initializeAgent(
  purpose: string,
  iterationIntervalMs: number,
  options?: { userId?: string },
) {
  // Generate name and all seven system prompts from mission/purpose
  const config = await generateSystemPrompts(
    purpose,
    iterationIntervalMs,
    options,
  );

  // Create the agent with generated name and all seven system prompts
  const agent = await createAgent({
    userId: options!.userId!,
    name: config.name,
    purpose,
    conversationSystemPrompt: config.conversationSystemPrompt,
    queryIdentificationSystemPrompt: config.queryIdentificationSystemPrompt,
    insightIdentificationSystemPrompt: config.insightIdentificationSystemPrompt,
    analysisGenerationSystemPrompt: config.analysisGenerationSystemPrompt,
    adviceGenerationSystemPrompt: config.adviceGenerationSystemPrompt,
    knowledgeAcquisitionSystemPrompt: config.knowledgeAcquisitionSystemPrompt,
    graphConstructionSystemPrompt: config.graphConstructionSystemPrompt,
    iterationIntervalMs,
    isActive: true,
  });

  // Create seed node + edge types
  await createSeedTypes(agent.id);

  // Create dynamic node + edge types via tool-calling
  await createDynamicTypes(agent.id);

  return agent;
}
