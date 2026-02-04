import { z } from 'zod';
import { generateLLMObject } from '@/lib/llm/providers';

/**
 * Schema for the generated entity configuration with four distinct system prompts
 */
const EntityConfigurationSchema = z.object({
  name: z.string().describe('A short, memorable name for this agent (2-4 words)'),
  conversationSystemPrompt: z.string().describe('System prompt for user-facing conversations'),
  classificationSystemPrompt: z.string().describe('System prompt for deciding between synthesize or populate actions'),
  insightSynthesisSystemPrompt: z.string().describe('System prompt for creating insights from existing knowledge'),
  graphConstructionSystemPrompt: z.string().describe('System prompt for gathering and structuring external knowledge'),
});

export type EntityConfiguration = z.infer<typeof EntityConfigurationSchema>;

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
const CLASSIFICATION_META_PROMPT = `You are an expert agent architect. Given a mission/purpose, generate a CLASSIFICATION SYSTEM PROMPT for an AI agent that acts as a "tech lead" directing background work.

## Context

This agent runs autonomously every 5 minutes. At the start of each iteration, the classification phase analyzes the current state of the Knowledge Graph and decides:
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
Create insights using the standardized Insight node type with these categories:
- **signal**: Actionable recommendations based on evidence (e.g., buy/sell/hold signals, timing recommendations)
- **observation**: Notable trends or developments worth tracking (e.g., "Company X is increasing R&D spending")
- **pattern**: Recurring behaviors or correlations discovered (e.g., "This sector typically reacts X way to Y events")

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

### 5. Insight Properties
For each insight, determine appropriate values:
- type: signal, observation, or pattern
- summary: Clear explanation of the insight and its reasoning
- action (for signals): specific recommended action
- strength: confidence level based on evidence quality
- generated_at: current timestamp

### 6. User Value Focus
- Think about what would be genuinely useful to the user
- Prioritize actionable insights over abstract observations
- Consider timing: is this insight timely and relevant now?
- Write summaries that are clear and informative without being verbose

### 7. Graph Hygiene
- Create edges linking insights to the nodes they're derived from
- Use appropriate edge types (derived_from, about, supports, contradicts)
- Don't create duplicate insights - check if similar insights exist`;

/**
 * Meta-prompt for generating the GRAPH CONSTRUCTION system prompt.
 * This prompt gathers external knowledge and populates the graph.
 */
const GRAPH_CONSTRUCTION_META_PROMPT = `You are an expert agent architect. Given a mission/purpose, generate a GRAPH CONSTRUCTION SYSTEM PROMPT for an AI agent that gathers and structures external knowledge.

## Context

This agent has been directed to populate its Knowledge Graph with new information. It uses web search tools (Tavily) to research topics and adds structured knowledge to the graph. The input includes reasoning from the classification phase explaining WHAT to research and WHY.

## Output Requirements

Generate a graphConstructionSystemPrompt (5-7 paragraphs) that instructs the agent to:

### 1. Follow Classification Guidance
- Read the classification reasoning carefully - it specifies what to research
- Focus on filling the specific knowledge gaps identified
- Don't deviate into unrelated research tangents

### 2. Research Strategy
- Use tavilySearch for broad discovery and current information
- Use tavilyExtract to get detailed content from promising URLs
- Use tavilyResearch for comprehensive deep-dive investigations
- Verify important facts across multiple sources when possible
- Prioritize authoritative, primary sources

### 3. Knowledge Structuring
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
// Unified Meta-Prompt for Generating All Four System Prompts
// ============================================================================

const UNIFIED_META_PROMPT = `You are an expert agent architect. Given a mission/purpose, generate FOUR DISTINCT SYSTEM PROMPTS for an autonomous AI agent that runs continuously.

## Agent Architecture Overview

This agent operates in four distinct phases, each with its own system prompt:

1. **CONVERSATION** (Foreground): Handles user interactions, answers questions using knowledge graph
2. **CLASSIFICATION** (Background): Analyzes graph state, decides whether to synthesize insights or gather more data
3. **INSIGHT SYNTHESIS** (Background): Creates Insight nodes from existing knowledge when classification chooses "synthesize"
4. **GRAPH CONSTRUCTION** (Background): Researches and populates the knowledge graph when classification chooses "populate"

## What This Agent Does

- Runs autonomously in the background every 5 minutes (classification + one action)
- Maintains a Knowledge Graph of typed nodes and edges
- Uses web search tools to research and discover information
- Creates Insight nodes (signals, observations, patterns) to surface discoveries
- Communicates with users through a chat interface

## Output Requirements

Generate all four system prompts tailored to the given mission:

### 1. conversationSystemPrompt (3-5 paragraphs)
${CONVERSATION_META_PROMPT.split('## Output Requirements')[1]}

### 2. classificationSystemPrompt (4-6 paragraphs)
${CLASSIFICATION_META_PROMPT.split('## Output Requirements')[1]}

### 3. insightSynthesisSystemPrompt (4-6 paragraphs)
${INSIGHT_SYNTHESIS_META_PROMPT.split('## Output Requirements')[1]}

### 4. graphConstructionSystemPrompt (5-7 paragraphs)
${GRAPH_CONSTRUCTION_META_PROMPT.split('## Output Requirements')[1]}

## Cross-Prompt Consistency

Ensure all four prompts:
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

// ============================================================================
// Entity Configuration Generation
// ============================================================================

/**
 * Generate entity configuration with four distinct system prompts from the mission/purpose.
 * Uses LLM to create appropriate values based on the purpose.
 */
export async function generateEntityConfiguration(
  purpose: string,
  options?: { userId?: string }
): Promise<EntityConfiguration> {
  const userPrompt = `Mission: ${purpose}

Generate the complete agent configuration with:
1. A short, memorable name (2-4 words)
2. All four system prompts tailored to this mission

Each system prompt should be detailed and actionable, giving clear guidance for its specific phase of operation. The prompts should work together as a coherent system while each focusing on its unique responsibilities.`;

  return generateLLMObject(
    [{ role: 'user', content: userPrompt }],
    EntityConfigurationSchema,
    UNIFIED_META_PROMPT,
    {
      temperature: 0.7,
      userId: options?.userId,
    }
  );
}
