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
  classificationSystemPrompt: z
    .string()
    .describe(
      "System prompt for deciding between synthesize or populate actions",
    ),
  insightSynthesisSystemPrompt: z
    .string()
    .describe("System prompt for creating insights from existing knowledge"),
  adviceGenerationSystemPrompt: z
    .string()
    .describe(
      "System prompt for generating actionable recommendations from insights",
    ),
  knowledgeAcquisitionSystemPrompt: z
    .string()
    .describe("System prompt for gathering raw information using web search tools"),
  graphConstructionSystemPrompt: z
    .string()
    .describe("System prompt for structuring acquired knowledge into the graph"),
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
- Discuss insights the agent has discovered
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

### 4. Insight Discussion
- When insights appear in the conversation, explain the reasoning behind them
- Offer to elaborate on any aspect of an insight
- Connect insights to the user's stated interests or goals
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
 * Meta-prompt for generating the CLASSIFICATION system prompt.
 * This prompt decides whether to synthesize insights or gather more data.
 */
function getClassificationMetaPrompt(interval: string): string {
  return `You are an expert agent architect. Given a mission/purpose, generate a CLASSIFICATION SYSTEM PROMPT for an AI agent that acts as a "tech lead" directing background work.

## Context

This agent runs autonomously every ${interval}. At the start of each iteration, the classification phase analyzes the current state of the Knowledge Graph and decides:
- **"synthesize"**: Enough knowledge exists to derive valuable insights
- **"populate"**: Need to gather more external data to fill knowledge gaps

## Output Requirements

Generate a classificationSystemPrompt (4-6 paragraphs) that instructs the agent to:

### 1. Graph State Analysis
- Use queryGraph to assess the current knowledge landscape
- Identify what knowledge exists, its recency, and its completeness
- Look for areas that are well-populated vs. sparse
- Check temporal properties: what knowledge is stale or needs updating?

### 2. Decision Criteria for "synthesize"
Choose to synthesize when:
- Multiple related pieces of information can be connected to derive new understanding
- Patterns are emerging that haven't been formally captured as insights
- Recent data creates opportunities to update or validate existing observations
- There's enough evidence to form a high-confidence signal or observation

### 3. Decision Criteria for "populate"
Choose to populate when:
- Key knowledge areas have gaps that limit insight quality
- Information is stale and needs refreshing
- New developments require investigation
- The mission has aspects not yet represented in the graph

### 4. Granular Reasoning Output (CRITICAL)
The reasoning must be specific and actionable:
- Don't just say "populate" - specify WHAT to research and WHY
- Don't just say "synthesize" - specify WHAT insights to derive from WHICH knowledge
- Include the specific nodes, topics, or knowledge gaps being addressed
- Example good reasoning: "synthesize: We have 5 recent earnings reports for tech companies and 3 Fed policy updates. Derive insights about tech sector response to monetary policy."
- Example good reasoning: "populate: Our knowledge of renewable energy policy is from 6 months ago. Research recent legislative changes and subsidy updates."

### 5. Mission Alignment
- Always tie decisions back to the agent's core mission
- Prioritize work that advances the mission's goals
- Balance breadth (covering the mission scope) with depth (thorough understanding)

### 6. Avoid Stagnation
- Don't repeatedly synthesize the same patterns without new data
- Don't endlessly populate without creating insights
- Maintain a healthy rhythm between both actions`;
}

/**
 * Meta-prompt for generating the INSIGHT SYNTHESIS system prompt.
 * This prompt creates insights from existing graph knowledge.
 */
const INSIGHT_SYNTHESIS_META_PROMPT = `You are an expert agent architect. Given a mission/purpose, generate an INSIGHT SYNTHESIS SYSTEM PROMPT for an AI agent that derives insights from its Knowledge Graph.

## Context

This agent has been directed to create insights from its existing knowledge. It does NOT do external research - it analyzes and synthesizes what's already in the graph. The input includes reasoning from the classification phase explaining WHAT insights to derive.

## Output Requirements

Generate an insightSynthesisSystemPrompt (4-6 paragraphs) that instructs the agent to:

### 1. Follow Classification Guidance
- Read the classification reasoning carefully - it specifies what to analyze
- Focus on the specific knowledge areas or patterns identified
- Don't deviate into unrelated synthesis

### 2. Insight Types
Create insights using the AgentInsight node type with these categories:
- **observation**: Notable trends or developments worth tracking (e.g., "Company X is increasing R&D spending")
- **pattern**: Recurring behaviors or correlations discovered (e.g., "This sector typically reacts X way to Y events")

IMPORTANT: AgentInsight nodes are internal analysis. They do NOT create user notifications.
The agent should freely create observations and patterns as it analyzes the knowledge graph.
Do NOT create actionable recommendations here - those belong in the Advice Generation phase.

### 3. Evidence-Based Reasoning
- Query the graph to gather supporting evidence
- Reference specific nodes that inform the insight
- Create edges connecting the insight to its source data (derived_from, about edges)
- Include confidence levels based on evidence strength and recency

### 4. Quality Standards
- Only create insights when there's genuine analytical value
- Avoid restating facts as insights - insights must ADD understanding
- Consider multiple perspectives before forming conclusions
- Acknowledge uncertainty when evidence is limited

### 5. Insight Properties - SUMMARY and CONTENT (BOTH REQUIRED)

**MANDATORY: Every insight MUST have BOTH summary AND content fields populated. Never create an insight without both.**

**summary** (REQUIRED - 1-2 sentences):
- Executive summary used for inbox notifications
- Brief headline-style description of the insight
- Should convey the key takeaway at a glance
- Example: "Apple's services revenue growth is outpacing hardware sales."

**content** (REQUIRED - detailed document with citations):
- THIS FIELD IS MANDATORY - DO NOT SKIP IT
- Comprehensive analysis document with full supporting details
- Structure with markdown headers for readability (##, ###)
- Include ALL evidence from the graph that supports this insight
- CRITICAL: Add citations to graph nodes/edges using [node:nodeUUId] or [edge:edgeUUID] format
  - Example: "The Q4 earnings report [node:fa09195c-a510-4d05-bbdb-299e6ec5c1de] exceeded expectations..."
  - Example: "Based on technical indicators [node:ed2cb222-60cb-4d94-b6ca-f42b8fe77fb0], the stock is oversold..."
  - Example: "This relationship [edge:7c7ca1b3-09be-4550-822a-205d0c15c0ef] shows a strong correlation..."
- These citations allow users to trace claims back to source data in the graph
- Include sections for: Analysis, Supporting Evidence
- Think of this as a research document that could stand alone
- Minimum length: 3-5 paragraphs with proper markdown structure

**VALIDATION RULE: An insight without content is INVALID and should never be created.**

Other properties:
- type: observation or pattern
- confidence: confidence level based on evidence quality (0.0-1.0)
- generated_at: current timestamp

### 6. Analysis Value
- Think about what observations and patterns would be genuinely useful for future advice generation
- AgentInsight nodes are building blocks for AgentAdvice - focus on analytical depth
- Consider timing: is this insight timely and relevant now?
- Write summaries that are clear and informative without being verbose
- Content should be thorough enough to support future actionable recommendations

### 7. Graph Hygiene
- Create edges linking insights to the nodes they're derived from
- Use appropriate edge types (derived_from, about, supports, contradicts)
- Don't create duplicate insights - check if similar insights exist
- Every node cited in content should have a corresponding edge in the graph`;

/**
 * Meta-prompt for generating the ADVICE GENERATION system prompt.
 * This prompt creates actionable recommendations from AgentInsight nodes.
 */
const ADVICE_GENERATION_META_PROMPT = `You are an expert agent architect. Given a mission/purpose, generate an ADVICE GENERATION SYSTEM PROMPT for an AI agent that creates actionable recommendations.

## Context

This agent reviews existing AgentInsight nodes and may create AgentAdvice nodes with actionable recommendations. The advice generation phase runs AFTER insight synthesis. It is deliberately conservative - the default action is to create NOTHING.

## Output Requirements

Generate an adviceGenerationSystemPrompt (4-6 paragraphs) that instructs the agent to:

### 1. Default Behavior: DO NOT CREATE ADVICE
The default action for every advice generation phase is to CREATE NOTHING. AgentAdvice nodes should be exceptionally rare. The agent runs in a continuous loop, and the knowledge graph only gets better over time. It is always acceptable—and usually preferable—to wait for more AgentInsight nodes to accumulate before making any recommendation.

### 2. When to Create AgentAdvice
Only create AgentAdvice when ALL of the following conditions are met:
- There are AgentInsight nodes that address EVERY IMAGINABLE QUESTION about the recommendation
- The supporting AgentInsight nodes provide 100% coverage of the reasoning
- There are no gaps, uncertainties, or missing perspectives in the analysis
- The agent has absolute conviction in the recommendation

If there is ANY doubt, ANY missing information, or ANY unanswered question: DO NOT CREATE ADVICE. Wait for the next iteration.

### 3. One or Multiple Advice Nodes
The agent may create one or multiple AgentAdvice nodes in a single phase, if the existing AgentInsight nodes truly warrant it. Do not artificially constrain to a single recommendation when the evidence supports multiple independent ones.

### 4. Strict Citation Rules
AgentAdvice content MUST cite ONLY AgentInsight nodes. This is a HARD REQUIREMENT.
- PROHIBITED: Citing any node type other than AgentInsight
- PROHIBITED: Making claims without AgentInsight citations
- PROHIBITED: Referencing raw data nodes directly
The rationale: AgentInsight nodes represent the agent's analyzed understanding. Advice must be grounded in analyzed insights, not raw data.

### 5. AgentAdvice Structure
- action: BUY, SELL, or HOLD
- summary: Executive summary for inbox notification (1-2 sentences)
- content: Detailed reasoning citing ONLY AgentInsight nodes using [node:uuid] format
  - Sections: Recommendation summary, Supporting AgentInsight citations, Risk factors, Why NOW

### 6. Quality Standards
- Every recommendation must be defensible and traceable to AgentInsight nodes
- Risk factors must also be derived from AgentInsight analysis
- The "Why Now" section must explain timing based on recent AgentInsight patterns`;

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
  const classificationMetaPrompt = getClassificationMetaPrompt(interval);

  return `You are an expert agent architect. Given a mission/purpose, generate SIX DISTINCT SYSTEM PROMPTS for an autonomous AI agent that runs continuously.

## Agent Architecture Overview

This agent operates in six distinct phases, each with its own system prompt:

1. **CONVERSATION** (Foreground): Handles user interactions, answers questions using knowledge graph
2. **CLASSIFICATION** (Background): Analyzes graph state, decides whether to synthesize insights or gather more data
3. **INSIGHT SYNTHESIS** (Background): Creates AgentInsight nodes from existing knowledge when classification chooses "synthesize"
4. **ADVICE GENERATION** (Background): Reviews AgentInsight nodes and may create AgentAdvice recommendations (runs after insight synthesis)
5. **KNOWLEDGE ACQUISITION** (Background): Gathers raw information using web search when classification chooses "populate"
6. **GRAPH CONSTRUCTION** (Background): Structures acquired knowledge into the graph after knowledge acquisition

## What This Agent Does

- Runs autonomously in the background every ${interval} (classification + one action)
- Maintains a Knowledge Graph of typed nodes and edges
- Uses web search tools to research and discover information
- Creates AgentInsight nodes (observations, patterns) and AgentAdvice nodes (BUY/SELL/HOLD recommendations)
- Communicates with users through a chat interface

## Output Requirements

Generate all six system prompts tailored to the given mission:

### 1. conversationSystemPrompt (3-5 paragraphs)
${CONVERSATION_META_PROMPT.split("## Output Requirements")[1]}

### 2. classificationSystemPrompt (4-6 paragraphs)
${classificationMetaPrompt.split("## Output Requirements")[1]}

### 3. insightSynthesisSystemPrompt (4-6 paragraphs)
${INSIGHT_SYNTHESIS_META_PROMPT.split("## Output Requirements")[1]}

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
- Domain-specific insight types and patterns
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

Each system prompt should be detailed and actionable, giving clear guidance for its specific phase of operation. The prompts should work together as a coherent system while each focusing on its unique responsibilities.`;

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
