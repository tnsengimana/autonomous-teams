import { getAgentById, updateAgentStatus } from '@/lib/db/queries/agents';
import { getMemoriesByAgentId } from '@/lib/db/queries/memories';
import {
  getActiveConversation,
  buildMessageContext,
  addUserMessage,
  addAssistantMessage,
  trimMessagesToTokenBudget,
} from './conversation';
import {
  streamLLMResponse,
  streamLLMResponseWithTools,
  generateLLMResponse,
  generateLLMObject,
  type StreamOptions,
} from './llm';
import {
  getTeamLeadTools,
  getBackgroundTools,
  type ToolContext,
} from './tools';
import {
  extractAndPersistMemories,
  buildMemoryContextBlock,
} from './memory';
import {
  extractInsightsFromThread,
  buildInsightsContextBlock,
  loadInsights,
} from './insights';
import {
  startWorkSession,
  endWorkSession,
  addToThread,
  buildThreadContext,
  shouldCompact,
  compactWithSummary,
  getMessages as getThreadMessages,
  threadMessagesToLLMFormat,
} from './thread';
import { queueUserTask, claimNextTask, getQueueStatus } from './taskQueue';
import type {
  Agent as AgentData,
  AgentTask,
  Memory,
  Insight,
  Conversation,
  LLMMessage,
} from '@/lib/types';
import { z } from 'zod';

// ============================================================================
// Agent Configuration
// ============================================================================

const DEFAULT_MAX_CONTEXT_TOKENS = 8000;
const DEFAULT_MAX_RESPONSE_TOKENS = 2000;

// Proactive cycle intervals (for legacy runCycle)
const BRIEFING_INTERVAL_HOURS = 1;
const RESEARCH_INTERVAL_MINUTES = 60;

// Work session configuration
const MAX_THREAD_MESSAGES_BEFORE_COMPACT = 50;
const TEAM_LEAD_NEXT_RUN_HOURS = 1;

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
  private insights: Insight[] = [];
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
  // Memory Management (for foreground/user conversations)
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
  // Insight Management (for background/work sessions)
  // ============================================================================

  /**
   * Load insights from the database
   */
  async loadInsights(): Promise<Insight[]> {
    this.insights = await loadInsights(this.id);
    return this.insights;
  }

  /**
   * Get currently loaded insights
   */
  getInsights(): Insight[] {
    return this.insights;
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
   * Build the full system prompt including memory context (for foreground)
   */
  buildSystemPrompt(): string {
    const memoryBlock = buildMemoryContextBlock(this.memories);

    if (memoryBlock) {
      return `${this.systemPrompt}\n\n${memoryBlock}`;
    }

    return this.systemPrompt;
  }

  /**
   * Build the system prompt with insights context (for background work)
   */
  buildBackgroundSystemPrompt(): string {
    const insightsBlock = buildInsightsContextBlock(this.insights);

    if (insightsBlock) {
      return `${this.systemPrompt}\n\n${insightsBlock}`;
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
  // NEW: Foreground Message Handling (User Conversations)
  // ============================================================================

  /**
   * Handle a user message in the foreground (user conversation)
   *
   * This method:
   * 1. Loads MEMORIES for user context
   * 2. Adds user message to conversation
   * 3. Generates a quick contextual acknowledgment
   * 4. Adds ack to conversation
   * 5. Queues the task for background processing
   * 6. Returns the acknowledgment as a stream
   */
  async handleUserMessage(content: string): Promise<AsyncIterable<string>> {
    // 1. Load memories for user context (not insights)
    await this.loadMemories();
    const conversation = await this.ensureConversation();

    // 2. Add user message to conversation
    await addUserMessage(conversation.id, content);

    // 3. Generate quick contextual acknowledgment
    const ackPrompt = `The user just sent you this message:
"${content}"

Generate a brief, natural acknowledgment (1-2 sentences) that shows you understand what they're asking for.
Don't answer the question yet - just acknowledge that you'll look into it.
Examples:
- "I'll look into the latest NVIDIA earnings for you."
- "Let me research current market trends for semiconductor stocks."
- "I'll analyze your portfolio's performance and get back to you."`;

    const systemPrompt = this.buildSystemPrompt();
    const ackResponse = await generateLLMResponse(
      [{ role: 'user', content: ackPrompt }],
      systemPrompt,
      {
        ...this.llmOptions,
        maxOutputTokens: 100, // Keep it short
        temperature: 0.7,
      }
    );

    const acknowledgment = ackResponse.content;

    // 4. Add acknowledgment to conversation
    await addAssistantMessage(conversation.id, acknowledgment);

    // 5. Queue task for background processing
    await queueUserTask(this.id, this.teamId, content);

    // 6. Return the acknowledgment as a stream (for API compatibility)
    async function* streamAck(): AsyncGenerator<string> {
      // Yield the acknowledgment in chunks for streaming feel
      const words = acknowledgment.split(' ');
      for (const word of words) {
        yield word + ' ';
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }

    // Extract memories in background (from user message + ack)
    this.extractMemoriesInBackground(content, acknowledgment, '');

    return streamAck();
  }

  // ============================================================================
  // NEW: Background Work Session (Thread-based processing)
  // ============================================================================

  /**
   * Run a work session to process queued tasks
   *
   * This is the main entry point for background processing:
   * 1. Creates a new thread for this session
   * 2. Loads INSIGHTS for work context (not memories)
   * 3. Processes all pending tasks in queue
   * 4. When queue empty:
   *    - Extracts insights from thread
   *    - Marks thread completed
   *    - Team lead: decides on briefing
   *    - Schedules next run
   */
  async runWorkSession(): Promise<void> {
    // Check if there's work to do
    const queueStatus = await getQueueStatus(this.id);
    if (!queueStatus.hasPendingWork) {
      console.log(`[Agent ${this.name}] No pending work, skipping session`);
      return;
    }

    console.log(
      `[Agent ${this.name}] Starting work session with ${queueStatus.pendingCount} pending tasks`
    );

    await this.setStatus('running');

    try {
      // 1. Create new thread for this session
      const { threadId } = await startWorkSession(this.id);

      // 2. Load INSIGHTS for work context (not memories)
      await this.loadInsights();

      // 3. Process all pending tasks in queue (loop)
      let task = await claimNextTask(this.id);
      while (task) {
        console.log(`[Agent ${this.name}] Processing task: ${task.id}`);

        try {
          const result = await this.processTaskInThread(threadId, task);
          console.log(
            `[Agent ${this.name}] Task ${task.id} completed: ${result.slice(0, 100)}...`
          );
        } catch (error) {
          console.error(
            `[Agent ${this.name}] Task ${task.id} failed:`,
            error
          );
          // Mark task as failed
          const { failTask } = await import('@/lib/db/queries/agentTasks');
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          await failTask(task.id, errorMessage);
        }

        // Get next task
        task = await claimNextTask(this.id);
      }

      // 4. Queue empty - wrap up the session
      console.log(`[Agent ${this.name}] All tasks processed, wrapping up session`);

      // Extract insights from thread
      const newInsights = await extractInsightsFromThread(
        threadId,
        this.id,
        this.role,
        this.llmOptions
      );
      console.log(
        `[Agent ${this.name}] Extracted ${newInsights.length} insights from session`
      );

      // Mark thread completed
      await endWorkSession(threadId);

      // Team lead: decide on briefing
      if (this.isTeamLead()) {
        await this.decideBriefing(threadId);
      }

      // Schedule next run (team lead: 1 hour, worker: none - triggered by delegation)
      if (this.isTeamLead()) {
        await this.scheduleNextRun(TEAM_LEAD_NEXT_RUN_HOURS);
      }
    } catch (error) {
      console.error(`[Agent ${this.name}] Work session failed:`, error);
    } finally {
      await this.setStatus('idle');
    }
  }

  /**
   * Process a single task within a thread
   */
  async processTaskInThread(threadId: string, task: AgentTask): Promise<string> {
    // 1. Add task as "user" message to thread (agent is the user here)
    const taskMessage = `Task from ${task.source}: ${task.task}`;
    await addToThread(threadId, 'user', taskMessage);

    // 2. Build context from thread messages + INSIGHTS
    // Note: threadContext is used implicitly when we fetch messages below for the LLM call
    await buildThreadContext(threadId);
    const systemPrompt = this.buildBackgroundSystemPrompt();

    // 3. Get tools for background work
    const tools = getBackgroundTools(this.isTeamLead());
    const toolContext: ToolContext = {
      agentId: this.id,
      teamId: this.teamId,
      isTeamLead: this.isTeamLead(),
    };

    // 4. Call LLM with tools
    const result = await streamLLMResponseWithTools(
      threadMessagesToLLMFormat(
        (await getThreadMessages(threadId)).map((m) => ({
          ...m,
          toolCalls: null,
          createdAt: new Date(),
        }))
      ),
      systemPrompt,
      {
        ...this.llmOptions,
        tools,
        toolContext,
        maxSteps: 10, // Allow multiple tool calls
        maxOutputTokens: DEFAULT_MAX_RESPONSE_TOKENS,
      }
    );

    // 5. Consume stream and get response
    const fullResponse = await result.fullResponse;

    // 6. Add response to thread
    await addToThread(threadId, 'assistant', fullResponse.text, fullResponse.toolCalls);

    // 7. Check if should compact thread
    if (await shouldCompact(threadId, MAX_THREAD_MESSAGES_BEFORE_COMPACT)) {
      await this.compactThread(threadId);
    }

    // 8. Mark task complete with result
    const { completeTaskWithResult } = await import('@/lib/db/queries/agentTasks');
    await completeTaskWithResult(task.id, fullResponse.text);

    return fullResponse.text;
  }

  /**
   * Compact a thread by summarizing its content
   */
  private async compactThread(threadId: string): Promise<void> {
    const messages = await getThreadMessages(threadId);

    // Generate summary
    const summaryPrompt = `Summarize the key points from this work session conversation for context in future messages. Focus on:
- What tasks were completed
- Key decisions made
- Important findings
- Outstanding items

Conversation:
${messages.map((m) => `[${m.role}]: ${m.content}`).join('\n\n')}`;

    const summaryResponse = await generateLLMResponse(
      [{ role: 'user', content: summaryPrompt }],
      'You are a concise summarizer. Create a brief summary (2-3 paragraphs max).',
      {
        ...this.llmOptions,
        maxOutputTokens: 500,
      }
    );

    await compactWithSummary(threadId, summaryResponse.content);
    console.log(`[Agent ${this.name}] Thread compacted`);
  }

  // ============================================================================
  // NEW: Briefing Decision (Team Lead Only)
  // ============================================================================

  /**
   * Decide whether to brief the user based on work session results
   */
  async decideBriefing(threadId: string): Promise<void> {
    if (!this.isTeamLead()) return;

    // Get thread messages for review
    const messages = await getThreadMessages(threadId);
    if (messages.length === 0) return;

    // Build summary of work done
    const workSummary = messages
      .filter((m) => m.role === 'assistant')
      .map((m) => m.content)
      .join('\n\n')
      .slice(0, 2000); // Limit context size

    // Schema for briefing decision
    const BriefingDecisionSchema = z.object({
      shouldBrief: z
        .boolean()
        .describe('Whether this work warrants notifying the user'),
      reason: z.string().describe('Brief reason for the decision'),
      title: z.string().optional().describe('Title for the briefing if shouldBrief is true'),
      summary: z.string().optional().describe('Summary for inbox if shouldBrief is true'),
      fullMessage: z
        .string()
        .optional()
        .describe('Full briefing message if shouldBrief is true'),
    });

    // Ask LLM to decide
    const decisionPrompt = `Review this work session and decide if the user should be briefed.

Work completed:
${workSummary}

Guidelines for briefing:
- Brief if there are significant findings, insights, or completed user requests
- Brief if there are important market signals or alerts
- DO NOT brief for routine maintenance, minor updates, or no-op sessions
- The user should not be overwhelmed with notifications

If briefing is warranted, provide:
- A concise title
- A brief summary (1-2 sentences for the inbox)
- A full message with details for the conversation`;

    try {
      const decision = await generateLLMObject(
        [{ role: 'user', content: decisionPrompt }],
        BriefingDecisionSchema,
        'You are a thoughtful assistant deciding what warrants user attention.',
        {
          ...this.llmOptions,
          temperature: 0.3,
        }
      );

      if (decision.shouldBrief && decision.title && decision.summary && decision.fullMessage) {
        console.log(`[Agent ${this.name}] Creating briefing: ${decision.title}`);

        // Get user ID
        const { getTeamUserId } = await import('@/lib/db/queries/teams');
        const userId = await getTeamUserId(this.teamId);
        if (!userId) {
          console.error(`[Agent ${this.name}] No user found for team`);
          return;
        }

        // Create inbox item
        const { createInboxItem } = await import('@/lib/db/queries/inboxItems');
        await createInboxItem({
          userId,
          teamId: this.teamId,
          agentId: this.id,
          type: 'briefing',
          title: decision.title,
          content: decision.summary,
        });

        // Add full message to user conversation
        const conversation = await this.ensureConversation();
        await addAssistantMessage(conversation.id, decision.fullMessage);

        console.log(`[Agent ${this.name}] Briefing sent successfully`);
      } else {
        console.log(
          `[Agent ${this.name}] No briefing needed: ${decision.reason}`
        );
      }
    } catch (error) {
      console.error(`[Agent ${this.name}] Failed to decide briefing:`, error);
    }
  }

  /**
   * Schedule the next work session run
   */
  private async scheduleNextRun(hours: number): Promise<void> {
    const { updateAgentNextRunAt } = await import('@/lib/db/queries/agents');
    const nextRun = new Date(Date.now() + hours * 60 * 60 * 1000);
    await updateAgentNextRunAt(this.id, nextRun);
    console.log(`[Agent ${this.name}] Next run scheduled for ${nextRun.toISOString()}`);
  }

  // ============================================================================
  // LEGACY: Message Handling (kept for backwards compatibility)
  // ============================================================================

  /**
   * Handle an incoming message and stream the response
   * Returns an async iterable that yields response chunks
   *
   * @deprecated Use handleUserMessage for the new foreground/background architecture
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
   *
   * @deprecated Use handleUserMessage for the new foreground/background architecture
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
  // LEGACY: Proactive Behavior (kept for backwards compatibility)
  // ============================================================================

  /**
   * Run a proactive cycle (for team leads running continuously)
   *
   * @deprecated Use runWorkSession for the new thread-based architecture
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
   *
   * @deprecated Use runWorkSession for the new thread-based architecture
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

    // 3. Run research cycle to gather market insights
    await this.runResearchCycle();

    // 4. Check if we should generate a proactive briefing
    await this.maybeGenerateProactiveBriefing();
  }

  /**
   * Run a research cycle to proactively gather market insights
   *
   * @deprecated Will be replaced by task-based proactive research
   */
  private async runResearchCycle(): Promise<void> {
    // Import dynamically to avoid circular dependencies (createMemory, deleteMemory not imported at top)
    const { createMemory, deleteMemory } = await import(
      '@/lib/db/queries/memories'
    );

    // Load memories once and reuse for both timing check and preferences
    await this.loadMemories();

    // Check for last research time
    const lastResearchMemory = this.memories.find(
      (m) => m.type === 'fact' && m.content.startsWith('LAST_RESEARCH:')
    );

    // Parse the last research timestamp
    let lastResearchTime: Date | null = null;
    if (lastResearchMemory) {
      const timestampStr = lastResearchMemory.content.replace(
        'LAST_RESEARCH:',
        ''
      );
      lastResearchTime = new Date(timestampStr);
    }

    // Calculate minutes since last research
    const now = new Date();
    const minutesSinceLastResearch = lastResearchTime
      ? (now.getTime() - lastResearchTime.getTime()) / (1000 * 60)
      : Infinity;

    if (minutesSinceLastResearch < RESEARCH_INTERVAL_MINUTES) {
      return; // Not time for research yet
    }

    console.log(`[Agent ${this.name}] Running research cycle...`);

    try {
      // Extract user preferences from memories (already loaded above)
      const userPreferences = this.memories
        .filter(
          (m) =>
            m.type === 'preference' ||
            (m.type === 'fact' && !m.content.startsWith('LAST_'))
        )
        .map((m) => m.content)
        .join('\n');

      // Create tool context
      const toolContext: ToolContext = {
        agentId: this.id,
        teamId: this.teamId,
        isTeamLead: true,
      };

      // Get team lead tools
      const tools = getTeamLeadTools();

      // Skip if no tools are registered (tools must be registered by worker runner)
      if (tools.length === 0) {
        console.warn(
          `[Agent ${this.name}] No tools registered, skipping research cycle`
        );
        return;
      }

      // Build research prompt based on user preferences
      const researchPrompt = `You are conducting proactive research on behalf of the user. Based on the user's preferences and interests, search for relevant market news and insights.

User preferences and context:
${userPreferences || 'No specific preferences recorded yet. Focus on general market trends and news.'}

Your role: ${this.role}

Instructions:
1. Use the tavilySearch tool to search for relevant news and information based on the user's interests
2. If you find significant findings that warrant deeper investigation, use delegateToAgent to assign research to a worker (if available)
3. If you find noteworthy insights, use createInboxItem to push a signal or alert to the user
4. Keep your findings focused and actionable

Be concise and only push insights that are truly valuable to the user. Do not create inbox items for routine or minor updates.`;

      // Build message for tool-enabled LLM call
      const messages: LLMMessage[] = [{ role: 'user', content: researchPrompt }];

      // Call LLM with tools
      const result = await streamLLMResponseWithTools(
        messages,
        this.buildSystemPrompt(),
        {
          ...this.llmOptions,
          tools,
          toolContext,
          maxSteps: 5,
        }
      );

      // Consume the stream to let tool calls execute
      const fullResponse = await result.fullResponse;

      console.log(
        `[Agent ${this.name}] Research cycle completed. Tool calls: ${fullResponse.toolCalls.length}`
      );

      // Update last research time in memory
      if (lastResearchMemory) {
        await deleteMemory(lastResearchMemory.id);
      }

      await createMemory({
        agentId: this.id,
        type: 'fact',
        content: `LAST_RESEARCH:${now.toISOString()}`,
      });
    } catch (error) {
      console.error(`[Agent ${this.name}] Research cycle failed:`, error);
    }
  }

  /**
   * Check if it's time to generate a proactive briefing and create one if so
   *
   * @deprecated Use decideBriefing in the new architecture
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

      // Generate a summary for the inbox notification (first sentence or first 100 chars)
      const summaryMatch = briefingContent.match(/^[^.!?]*[.!?]/);
      const summary = summaryMatch
        ? summaryMatch[0].trim()
        : briefingContent.slice(0, 100) + '...';

      // 1. Create inbox item with summary
      await createInboxItem({
        userId,
        teamId: this.teamId,
        agentId: this.id,
        type: 'briefing',
        title: `Daily Briefing from ${this.name}`,
        content: summary,
      });

      // 2. Append full briefing to agent's conversation
      const { getOrCreateConversation } = await import(
        '@/lib/db/queries/conversations'
      );
      const { appendMessage } = await import('@/lib/db/queries/messages');
      const conversation = await getOrCreateConversation(this.id);
      await appendMessage(conversation.id, 'assistant', briefingContent);

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
   *
   * @deprecated Use runWorkSession for the new thread-based architecture
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
