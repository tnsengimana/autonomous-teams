import { getAgentById, updateAgentStatus } from '@/lib/db/queries/agents';
import { getMemoriesByAgentId } from '@/lib/db/queries/memories';
import {
  getActiveConversation,
  buildMessageContext,
  addUserMessage,
  addAssistantMessage,
  trimMessagesToTokenBudget,
} from './conversation';
import { streamLLMResponse, type StreamOptions } from './llm';
import {
  extractAndPersistMemories,
  buildMemoryContextBlock,
} from './memory';
import type {
  Agent as AgentData,
  Memory,
  Conversation,
  LLMMessage,
} from '@/lib/types';

// ============================================================================
// Agent Configuration
// ============================================================================

const DEFAULT_MAX_CONTEXT_TOKENS = 8000;
const DEFAULT_MAX_RESPONSE_TOKENS = 2000;

// ============================================================================
// Agent Class
// ============================================================================

export class Agent {
  readonly id: string;
  readonly teamId: string;
  readonly name: string;
  readonly role: string;
  readonly systemPrompt: string;
  readonly parentAgentId: string | null;

  private conversation: Conversation | null = null;
  private memories: Memory[] = [];
  private llmOptions: StreamOptions;

  constructor(data: AgentData, llmOptions: StreamOptions = {}) {
    this.id = data.id;
    this.teamId = data.teamId;
    this.name = data.name;
    this.role = data.role;
    this.systemPrompt = data.systemPrompt ?? this.getDefaultSystemPrompt();
    this.parentAgentId = data.parentAgentId;
    this.llmOptions = {
      teamId: data.teamId,
      ...llmOptions,
    };
  }

  /**
   * Create an Agent instance from a database record
   */
  static async fromId(
    agentId: string,
    llmOptions: StreamOptions = {}
  ): Promise<Agent | null> {
    const data = await getAgentById(agentId);
    if (!data) {
      return null;
    }
    return new Agent(data, llmOptions);
  }

  /**
   * Check if this agent is a team lead (no parent)
   */
  isTeamLead(): boolean {
    return this.parentAgentId === null;
  }

  // ============================================================================
  // Memory Management
  // ============================================================================

  /**
   * Load memories from the database
   */
  async loadMemories(): Promise<Memory[]> {
    this.memories = await getMemoriesByAgentId(this.id);
    return this.memories;
  }

  /**
   * Get currently loaded memories
   */
  getMemories(): Memory[] {
    return this.memories;
  }

  // ============================================================================
  // Conversation Management
  // ============================================================================

  /**
   * Ensure conversation is loaded
   */
  private async ensureConversation(): Promise<Conversation> {
    if (!this.conversation) {
      this.conversation = await getActiveConversation(this.id);
    }
    return this.conversation;
  }

  /**
   * Get the current conversation
   */
  async getConversation(): Promise<Conversation> {
    return this.ensureConversation();
  }

  // ============================================================================
  // Context Building
  // ============================================================================

  /**
   * Get the default system prompt for this agent
   */
  private getDefaultSystemPrompt(): string {
    return `You are ${this.name}, a ${this.role}.

Your primary responsibilities are to:
1. Understand and respond to user queries relevant to your role
2. Provide accurate and helpful information
3. Learn from interactions to improve future responses

Always be professional, concise, and focused on your role.`;
  }

  /**
   * Build the full system prompt including memory context
   */
  buildSystemPrompt(): string {
    const memoryBlock = buildMemoryContextBlock(this.memories);

    if (memoryBlock) {
      return `${this.systemPrompt}\n\n${memoryBlock}`;
    }

    return this.systemPrompt;
  }

  /**
   * Build the complete context for an LLM call
   */
  async buildContext(
    maxTokens: number = DEFAULT_MAX_CONTEXT_TOKENS
  ): Promise<LLMMessage[]> {
    const conversation = await this.ensureConversation();
    const messages = await buildMessageContext(conversation.id);

    // Trim to fit within token budget
    return trimMessagesToTokenBudget(messages, maxTokens);
  }

  // ============================================================================
  // Message Handling
  // ============================================================================

  /**
   * Handle an incoming message and stream the response
   * Returns an async iterable that yields response chunks
   */
  async handleMessage(
    content: string,
    _from: 'user' | string = 'user'
  ): Promise<AsyncIterable<string>> {
    // Ensure we have loaded memories and conversation
    await this.loadMemories();
    const conversation = await this.ensureConversation();

    // Add user message to conversation
    await addUserMessage(conversation.id, content);

    // Build context
    const context = await this.buildContext();
    const systemPrompt = this.buildSystemPrompt();

    // Add the new user message to context
    const messagesWithNew: LLMMessage[] = [
      ...context,
      { role: 'user', content },
    ];

    // Stream response from LLM
    const responseStream = await streamLLMResponse(
      messagesWithNew,
      systemPrompt,
      {
        ...this.llmOptions,
        maxOutputTokens: DEFAULT_MAX_RESPONSE_TOKENS,
      }
    );

    // Create a wrapper that collects the full response for memory extraction
    // Use arrow function to preserve 'this' context
    const extractMemories = this.extractMemoriesInBackground.bind(this);
    const wrappedStream = async function* (): AsyncGenerator<string> {
      let fullResponse = '';

      for await (const chunk of responseStream) {
        fullResponse += chunk;
        yield chunk;
      }

      // After streaming completes, persist the response and extract memories
      const assistantMessage = await addAssistantMessage(
        conversation.id,
        fullResponse
      );

      // Extract and persist memories (async, don't block)
      extractMemories(content, fullResponse, assistantMessage.id);
    };

    return wrappedStream();
  }

  /**
   * Handle a message and return the complete response (non-streaming)
   */
  async handleMessageSync(
    content: string,
    from: 'user' | string = 'user'
  ): Promise<string> {
    const stream = await this.handleMessage(content, from);
    let fullResponse = '';

    for await (const chunk of stream) {
      fullResponse += chunk;
    }

    return fullResponse;
  }

  /**
   * Extract memories in the background (fire and forget)
   */
  private extractMemoriesInBackground(
    userMessage: string,
    assistantResponse: string,
    sourceMessageId: string
  ): void {
    extractAndPersistMemories(
      this.id,
      userMessage,
      assistantResponse,
      this.role,
      sourceMessageId,
      this.llmOptions
    ).catch((error) => {
      console.error(`Memory extraction failed for agent ${this.id}:`, error);
    });
  }

  // ============================================================================
  // Proactive Behavior (for Team Leads)
  // ============================================================================

  /**
   * Run a proactive cycle (for team leads running continuously)
   *
   * For team leads:
   * - Check for completed tasks from workers
   * - Optionally generate proactive briefings
   *
   * For workers:
   * - Check for assigned tasks
   * - Execute pending tasks
   * - Report results back
   */
  async runCycle(): Promise<void> {
    if (this.isTeamLead()) {
      await this.runTeamLeadCycle();
    } else {
      await this.runWorkerCycle();
    }
  }

  /**
   * Run a team lead's proactive cycle
   */
  private async runTeamLeadCycle(): Promise<void> {
    // Import dynamically to avoid circular dependencies
    const { getCompletedTasksDelegatedBy, archiveCompletedTasks } =
      await import('@/lib/db/queries/agentTasks');
    const { processWorkerPendingTasks } = await import('@/worker/spawner');
    const { getChildAgents } = await import('@/lib/db/queries/agents');

    // 1. Check for completed tasks from workers
    const completedTasks = await getCompletedTasksDelegatedBy(this.id);

    if (completedTasks.length > 0) {
      // Process completed task results
      for (const task of completedTasks) {
        // Load the result into the agent's context
        await this.loadMemories();

        // Optionally, we could send a system message about the completed task
        // For now, just log and archive
        console.log(
          `[Agent ${this.name}] Task completed: ${task.id} - ${task.status}`
        );
      }

      // Archive processed tasks
      await archiveCompletedTasks(completedTasks.map((t) => t.id));
    }

    // 2. Trigger processing of any pending worker tasks
    const childAgents = await getChildAgents(this.id);
    for (const child of childAgents) {
      await processWorkerPendingTasks(child.id);
    }

    // 3. Check if we should generate a proactive briefing
    await this.maybeGenerateProactiveBriefing();
  }

  /**
   * Check if it's time to generate a proactive briefing and create one if so
   */
  private async maybeGenerateProactiveBriefing(): Promise<void> {
    // Import dynamically to avoid circular dependencies
    const { getMemoriesByAgentId } = await import('@/lib/db/queries/memories');
    const { getTeamUserId } = await import('@/lib/db/queries/teams');
    const { createInboxItem } = await import('@/lib/db/queries/inboxItems');

    // Check for a "last_briefing" memory to determine if we should generate one
    const memories = await getMemoriesByAgentId(this.id);
    const lastBriefingMemory = memories.find(
      (m) => m.type === 'fact' && m.content.startsWith('LAST_BRIEFING:')
    );

    // Parse the last briefing timestamp
    let lastBriefingTime: Date | null = null;
    if (lastBriefingMemory) {
      const timestampStr = lastBriefingMemory.content.replace(
        'LAST_BRIEFING:',
        ''
      );
      lastBriefingTime = new Date(timestampStr);
    }

    // Calculate hours since last briefing
    const now = new Date();
    const hoursSinceLastBriefing = lastBriefingTime
      ? (now.getTime() - lastBriefingTime.getTime()) / (1000 * 60 * 60)
      : Infinity;

    // Generate a briefing every 24 hours (configurable)
    const BRIEFING_INTERVAL_HOURS = 24;

    if (hoursSinceLastBriefing < BRIEFING_INTERVAL_HOURS) {
      return; // Not time for a briefing yet
    }

    console.log(`[Agent ${this.name}] Generating proactive briefing...`);

    try {
      // Get user ID for this team
      const userId = await getTeamUserId(this.teamId);
      if (!userId) {
        console.error(`[Agent ${this.name}] No user found for team`);
        return;
      }

      // Load memories for context
      await this.loadMemories();
      const memoryContext = this.memories
        .slice(0, 10) // Last 10 memories
        .map((m) => `- [${m.type}] ${m.content}`)
        .join('\n');

      // Generate a briefing based on recent memories
      const briefingPrompt = `Based on your recent interactions and stored knowledge, generate a brief summary briefing for the user. Include:
1. Key insights or patterns you've noticed
2. Any pending items or follow-ups
3. Suggestions for next steps

Recent memories:
${memoryContext || 'No recent memories to summarize.'}

Keep the briefing concise (2-3 paragraphs max).`;

      const briefingContent = await this.handleMessageSync(briefingPrompt);

      // Create inbox item
      await createInboxItem({
        userId,
        teamId: this.teamId,
        type: 'briefing',
        title: `Daily Briefing from ${this.name}`,
        content: briefingContent,
      });

      // Update last briefing time in memory
      const { createMemory, deleteMemory } = await import(
        '@/lib/db/queries/memories'
      );

      // Delete old briefing memory if it exists
      if (lastBriefingMemory) {
        await deleteMemory(lastBriefingMemory.id);
      }

      // Create new briefing timestamp memory
      await createMemory({
        agentId: this.id,
        type: 'fact',
        content: `LAST_BRIEFING:${now.toISOString()}`,
      });

      console.log(`[Agent ${this.name}] Briefing created successfully`);
    } catch (error) {
      console.error(`[Agent ${this.name}] Failed to generate briefing:`, error);
    }
  }

  /**
   * Run a worker agent's cycle
   */
  private async runWorkerCycle(): Promise<void> {
    // Import dynamically to avoid circular dependencies
    const {
      getActionableTasksForAgent,
      updateTaskStatus,
      completeTask,
    } = await import('@/lib/db/queries/agentTasks');

    // Check for assigned tasks
    const tasks = await getActionableTasksForAgent(this.id);
    const pendingTasks = tasks.filter((t) => t.status === 'pending');

    if (pendingTasks.length === 0) {
      return; // No work to do
    }

    // Process the first pending task
    const task = pendingTasks[0];
    console.log(`[Agent ${this.name}] Starting task: ${task.id}`);

    // Mark as in progress
    await updateTaskStatus(task.id, 'in_progress');
    await this.setStatus('running');

    try {
      // Execute the task
      const response = await this.handleMessageSync(
        `Execute this task: ${task.task}`
      );

      // Mark as completed
      await completeTask(task.id, response, 'completed');
      console.log(`[Agent ${this.name}] Task completed: ${task.id}`);
    } catch (error) {
      // Mark as failed
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      await completeTask(task.id, errorMessage, 'failed');
      console.error(`[Agent ${this.name}] Task failed: ${task.id}`, error);
    }

    await this.setStatus('idle');
  }

  /**
   * Update this agent's status in the database
   */
  async setStatus(status: 'idle' | 'running' | 'paused'): Promise<void> {
    await updateAgentStatus(this.id, status);
  }
}

// ============================================================================
// Agent Factory
// ============================================================================

/**
 * Create an agent from a database ID
 */
export async function createAgent(
  agentId: string,
  llmOptions: StreamOptions = {}
): Promise<Agent | null> {
  return Agent.fromId(agentId, llmOptions);
}

/**
 * Create an agent from data
 */
export function createAgentFromData(
  data: AgentData,
  llmOptions: StreamOptions = {}
): Agent {
  return new Agent(data, llmOptions);
}
