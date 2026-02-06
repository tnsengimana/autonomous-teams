import { z } from "zod";
import { generateLLMObject } from "@/lib/llm/providers";

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
 * Schema for the generated agent configuration with six distinct system prompts
 */
const AgentConfigurationSchema = z.object({
  name: z
    .string()
    .describe("A short, memorable name for this agent (2-4 words)"),
  conversationSystemPrompt: z
    .string()
    .describe("System prompt for user-facing conversations"),
  observerSystemPrompt: z
    .string()
    .describe(
      "System prompt for the Observer phase that plans each iteration's work",
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
 * Meta-prompt for generating the OBSERVER system prompt.
 * The Observer is the agent's "brain" -- it scans the knowledge graph and produces a structured plan.
 */
function getObserverMetaPrompt(interval: string): string {
  return `You are an expert agent architect. Given a mission/purpose, generate an OBSERVER SYSTEM PROMPT for an AI agent that acts as the central planner directing all background work.

## Context

This agent runs autonomously every ${interval}. At the start of each iteration, the Observer phase scans the knowledge graph and produces a structured plan with two types of work items:

- **Queries**: Knowledge gaps to fill via web research. Each query has an objective, reasoning, and search hints.
- **Insights**: Patterns or connections worth analyzing from existing graph knowledge. Each insight has an observation, relevant node IDs, and a synthesis direction.

The Observer does NOT execute anything -- it only plans. It does not search the web, create graph nodes, or write analyses. It reads the graph context and decides what to investigate and what to think about. The downstream phases (Researcher, Analyzer, Adviser) handle execution.

## Output Requirements

Generate an observerSystemPrompt (5-8 paragraphs) that instructs the agent to:

### 1. Graph State Analysis
- Carefully review the full graph context provided
- Identify what knowledge exists, its recency, and its completeness
- Look for areas that are well-populated vs. sparse
- Check temporal properties: what knowledge is stale or needs updating?
- Notice cross-domain connections and emerging patterns

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

### 3. Insight Generation (Patterns to Analyze)
Generate insights when:
- Multiple related pieces of information can be connected to derive new understanding
- Patterns are emerging that haven't been formally captured as AgentAnalysis nodes
- Recent data creates opportunities to update or validate existing observations
- Cross-domain connections are visible that deserve deeper analysis

Each insight must include:
- **observation**: The specific pattern or connection noticed
- **relevantNodeIds**: UUIDs of nodes that inform this observation (the Observer has access to node IDs in the graph context)
- **synthesisDirection**: Clear guidance on what angle to analyze

IMPORTANT:
- relevantNodeIds MUST contain only UUIDs from the graph context
- Never use node names, labels, or "Type:Name" values in relevantNodeIds
- If no valid UUIDs are available for an insight, return an empty array

### 4. Plan Balance
- Prefer a focused plan (2-4 total items) over an exhaustive one
- It is valid to produce an empty plan if the graph is in good shape and no action is needed
- Balance queries and insights -- don't always do one without the other
- Avoid re-querying for knowledge that already exists in the graph
- Avoid generating insights that duplicate existing AgentAnalysis nodes

### 5. Mission Alignment
- Every query and insight must tie back to the agent's core mission
- Prioritize work that advances the mission's goals
- Don't drift into tangential topics just because they're interesting

### 6. Quality Over Quantity
- One well-defined query is better than five vague ones
- One specific insight pointing at concrete nodes is better than a generic observation
- The Observer's output quality determines the quality of the entire iteration`;
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
- Create edges connecting the analysis to its source data (derived_from, about edges)
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
- CRITICAL: Add citations to graph nodes/edges using [node:nodeUUId] or [edge:edgeUUID] format
  - Example: "The Q4 earnings report [node:fa09195c-a510-4d05-bbdb-299e6ec5c1de] exceeded expectations..."
  - Example: "Based on technical indicators [node:ed2cb222-60cb-4d94-b6ca-f42b8fe77fb0], the stock is oversold..."
  - Example: "This relationship [edge:7c7ca1b3-09be-4550-822a-205d0c15c0ef] shows a strong correlation..."
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
- Create edges linking analyses to the nodes they're derived from
- Use appropriate edge types (derived_from, about, supports, contradicts)
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

### 5. AgentAdvice Structure
- action: BUY, SELL, or HOLD
- summary: Executive summary for inbox notification (1-2 sentences)
- content: Detailed reasoning citing ONLY AgentAnalysis nodes using [node:uuid] format
  - Sections: Recommendation summary, Supporting AgentAnalysis citations, Risk factors, Why NOW

### 6. Quality Standards
- Every recommendation must be defensible and traceable to AgentAnalysis nodes
- Risk factors must also be derived from AgentAnalysis analysis
- The "Why Now" section must explain timing based on recent AgentAnalysis patterns`;

/**
 * Meta-prompt for generating the KNOWLEDGE ACQUISITION system prompt.
 * This prompt gathers raw information using web search tools.
 */
const KNOWLEDGE_ACQUISITION_META_PROMPT = `You are an expert agent architect. Given a mission/purpose, generate a KNOWLEDGE ACQUISITION SYSTEM PROMPT for an AI agent that gathers raw information.

## Context

This agent has been directed to research a specific knowledge gap. It uses web search tools (Tavily) to gather comprehensive information and returns a markdown document with its findings. This phase focuses ONLY on information gathering - NOT on structuring the data into the knowledge graph.

## Output Requirements

Generate a knowledgeAcquisitionSystemPrompt (3-5 paragraphs) that instructs the agent to:

### 1. Input Understanding
- The agent receives a single knowledge gap query describing what to research
- Focus exclusively on addressing this specific query
- Don't deviate into tangential topics

### 2. Research Strategy
- Use tavilySearch for broad discovery and current information
- Use tavilyExtract to get detailed content from promising URLs
- Use tavilyResearch for comprehensive deep-dive investigations
- Verify important facts across multiple sources when possible
- Prioritize authoritative, primary sources

### 3. Information Gathering
- Collect raw facts, data points, quotes, and references
- Note publication dates and source credibility
- Capture numerical data precisely
- Include relevant context and background information

### 4. Output Format
- Return a comprehensive markdown document with findings
- Use clear headers to organize different aspects of the research
- Include direct quotes when relevant
- List all source URLs for attribution
- Note any conflicting information found across sources

### 5. Quality Standards
- Prioritize accuracy over comprehensiveness
- Flag uncertain or unverified claims
- Include publication dates to establish recency
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
- First check existing types - does one already fit?
- Search for established ontologies and schemas in the domain
- New types should only be created when truly necessary
- Design schemas carefully - they are difficult to change later
- Include: source_url for provenance, temporal properties, confidence when uncertain

### 5. Node Creation Guidelines
For each piece of knowledge:
- Name: Descriptive, unique identifier
- Properties: All required fields plus relevant optional fields
- Temporal data: When was this true? When does it expire?
- Source attribution: Where did this come from?
- Check for existing similar nodes to avoid duplicates
- Prefer updating existing nodes when information evolves

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
// Unified Meta-Prompt for Generating All Six System Prompts
// ============================================================================

function getUnifiedMetaPrompt(interval: string): string {
  const observerMetaPrompt = getObserverMetaPrompt(interval);

  return `You are an expert agent architect. Given a mission/purpose, generate SIX DISTINCT SYSTEM PROMPTS for an autonomous AI agent that runs continuously.

## Agent Architecture Overview

This agent operates with four named actors, each with its own system prompt:

1. **CONVERSATION** (Foreground): Handles user interactions, answers questions using knowledge graph
2. **OBSERVER** (Background): Scans the graph and plans each iteration's work -- produces queries (knowledge gaps) and insights (patterns to analyze)
3. **RESEARCHER** (Background): Executes the Observer's queries via two sub-phases:
   - **KNOWLEDGE ACQUISITION**: Gathers raw information using web search
   - **GRAPH CONSTRUCTION**: Structures acquired knowledge into the graph
4. **ANALYZER** (Background): Processes the Observer's insights via **ANALYSIS GENERATION** -- creates AgentAnalysis nodes
5. **ADVISER** (Background): Reviews AgentAnalysis nodes and may create AgentAdvice recommendations

> Note: There are 5 listed actors but 6 system prompts because the RESEARCHER (item 3) covers TWO separate system prompts: \`knowledgeAcquisitionSystemPrompt\` and \`graphConstructionSystemPrompt\`. This is why the output section below says "generate SIX DISTINCT SYSTEM PROMPTS" from 5 actors.

## Iteration Pipeline

Every iteration follows the same pipeline:
1. Observer produces plan with queries and insights
2. Researcher executes each query (knowledge acquisition + graph construction)
3. Graph context is rebuilt with enriched data
4. Analyzer processes each insight (analysis generation on enriched graph)
5. Adviser runs if analyses were produced (advice generation)

## What This Agent Does

- Runs autonomously in the background every ${interval}
- Maintains a Knowledge Graph of typed nodes and edges
- Uses web search tools to research and discover information
- Creates AgentAnalysis nodes (observations, patterns) and AgentAdvice nodes (BUY/SELL/HOLD recommendations)
- Communicates with users through a chat interface

## Output Requirements

Generate all six system prompts tailored to the given mission:

### 1. conversationSystemPrompt (3-5 paragraphs)
${CONVERSATION_META_PROMPT.split("## Output Requirements")[1]}

### 2. observerSystemPrompt (5-8 paragraphs)
${observerMetaPrompt.split("## Output Requirements")[1]}

### 3. analysisGenerationSystemPrompt (4-6 paragraphs)
${ANALYSIS_GENERATION_META_PROMPT.split("## Output Requirements")[1]}

### 4. adviceGenerationSystemPrompt (4-6 paragraphs)
${ADVICE_GENERATION_META_PROMPT.split("## Output Requirements")[1]}

### 5. knowledgeAcquisitionSystemPrompt (3-5 paragraphs)
${KNOWLEDGE_ACQUISITION_META_PROMPT.split("## Output Requirements")[1]}

### 6. graphConstructionSystemPrompt (4-6 paragraphs)
${GRAPH_CONSTRUCTION_META_PROMPT.split("## Output Requirements")[1]}

## Cross-Prompt Consistency

Ensure all six prompts:
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

// ============================================================================
// Agent Configuration Generation
// ============================================================================

/**
 * Generate agent configuration with six distinct system prompts from the mission/purpose.
 * Uses LLM to create appropriate values based on the purpose.
 */
export async function generateAgentConfiguration(
  purpose: string,
  iterationIntervalMs: number,
  options?: { userId?: string },
): Promise<AgentConfiguration> {
  const interval = formatInterval(iterationIntervalMs);

  const userPrompt = `Mission: ${purpose}

Generate the complete agent configuration with:
1. A short, memorable name (2-4 words)
2. All six system prompts tailored to this mission

Each system prompt should be detailed and actionable, giving clear guidance for its specific phase of operation. The prompts should work together as a coherent system:
- The Observer plans what to research and what to analyze
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
