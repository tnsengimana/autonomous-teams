import { eq } from "drizzle-orm";
import { getAgentById, updateAgentStatus } from "@/lib/db/queries/agents";
import { getMemoriesByAgentId } from "@/lib/db/queries/memories";
import { getOrCreateConversation } from "@/lib/db/queries/conversations";
import {
  getConversationContext,
  createTurnMessages,
  createTurnMessagesInTransaction,
} from "@/lib/db/queries/messages";
import { db } from "@/lib/db/client";
import { agentTasks } from "@/lib/db/schema";
import {
  getActiveConversation,
  buildMessageContext,
  addAssistantMessage,
  trimMessagesToTokenBudget,
  loadConversationHistory,
  messagesToLLMFormat,
} from "./conversation";
import {
  streamLLMResponse,
  streamLLMResponseWithTools,
  generateLLMResponse,
  generateLLMObject,
  type StreamOptions,
} from "./llm";
import {
  getBackgroundTools,
  getForegroundTools,
  type ToolContext,
} from "./tools";
import { extractAndPersistMemories, buildMemoryContextBlock } from "./memory";
import {
  extractKnowledgeFromMessages,
  buildKnowledgeContextBlock,
  loadKnowledge,
} from "./knowledge-items";
import { compactIfNeeded } from "./compaction";
import { queueUserTask, claimNextTask, getQueueStatus } from "./taskQueue";
import { clearAgentBackoff, setAgentBackoff } from "@/lib/db/queries/agents";
import type {
  Agent as AgentData,
  AgentTask,
  Memory,
  KnowledgeItem,
  Conversation,
  Message,
  LLMMessage,
} from "@/lib/types";
import { z } from "zod";

// ============================================================================
// Agent Configuration
// ============================================================================

const DEFAULT_MAX_CONTEXT_TOKENS = 8000;
const DEFAULT_MAX_RESPONSE_TOKENS = 2000;

// Work session configuration
const MAX_MESSAGES_BEFORE_COMPACT = 50;
const LEAD_NEXT_RUN_HOURS = 24; // 1 day

// ============================================================================
// User Intent Classification
// ============================================================================

const UserIntentSchema = z.object({
  intent: z.enum(["work_request", "regular_chat"]),
  reasoning: z.string().describe("Brief explanation of classification"),
});

type UserIntent = "work_request" | "regular_chat";

// ============================================================================
// Agent Class
// ============================================================================

export class Agent {
  readonly id: string;
  readonly teamId: string | null;
  readonly aideId: string | null;
  readonly name: string;
  readonly type: string;
  readonly systemPrompt: string;
  readonly parentAgentId: string | null;

  private conversation: Conversation | null = null;
  private memories: Memory[] = [];
  private knowledgeItems: KnowledgeItem[] = [];
  private llmOptions: StreamOptions;

  constructor(data: AgentData, llmOptions: StreamOptions = {}) {
    this.id = data.id;
    this.teamId = data.teamId;
    this.aideId = data.aideId;
    this.name = data.name;
    this.type = data.type;
    this.systemPrompt = data.systemPrompt ?? this.getDefaultSystemPrompt();
    this.parentAgentId = data.parentAgentId;
    this.llmOptions = {
      teamId: data.teamId ?? undefined,
      aideId: data.aideId ?? undefined,
      ...llmOptions,
    };
  }

  /**
   * Get owner info for task queuing and inbox items
   * Returns { teamId: string } or { aideId: string }
   */
  getOwnerInfo(): { teamId: string } | { aideId: string } {
    if (this.teamId) return { teamId: this.teamId };
    if (this.aideId) return { aideId: this.aideId };
    throw new Error(`Agent ${this.id} has no team or aide`);
  }

  /**
   * Create an Agent instance from a database record
   */
  static async fromId(
    agentId: string,
    llmOptions: StreamOptions = {},
  ): Promise<Agent | null> {
    const data = await getAgentById(agentId);
    if (!data) {
      return null;
    }
    return new Agent(data, llmOptions);
  }

  /**
   * Check if this agent is a lead (no parent)
   */
  isLead(): boolean {
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
  // Knowledge Management (for background/work sessions)
  // ============================================================================

  /**
   * Load knowledge items from the database
   */
  async loadKnowledge(): Promise<KnowledgeItem[]> {
    this.knowledgeItems = await loadKnowledge(this.id);
    return this.knowledgeItems;
  }

  /**
   * Get currently loaded knowledge items
   */
  getKnowledge(): KnowledgeItem[] {
    return this.knowledgeItems;
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
    return `You are ${this.name}, a ${this.type}.

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
   * Build the system prompt with knowledge context (for background work)
   */
  buildBackgroundSystemPrompt(): string {
    const knowledgeBlock = buildKnowledgeContextBlock(this.knowledgeItems);

    if (knowledgeBlock) {
      return `${this.systemPrompt}\n\n${knowledgeBlock}`;
    }

    return this.systemPrompt;
  }

  /**
   * Build the system prompt for foreground chat (with chat guidelines)
   */
  buildForegroundSystemPrompt(): string {
    const basePrompt = this.buildSystemPrompt();

    const foregroundGuidance = `

## Chat Guidelines

You are chatting directly with the user. You have access to tools for looking up information.

If the user's question would benefit from deeper research or extended analysis:
- Answer what you can now
- Suggest: "Would you like me to research this more thoroughly? I can work on it in the background and notify you when I have results."

Do NOT automatically queue background work - let the user decide if they want deeper research.`;

    return basePrompt + foregroundGuidance;
  }

  /**
   * Build the complete context for an LLM call
   */
  async buildContext(
    maxTokens: number = DEFAULT_MAX_CONTEXT_TOKENS,
  ): Promise<LLMMessage[]> {
    const conversation = await this.ensureConversation();
    const messages = await buildMessageContext(conversation.id);

    // Trim to fit within token budget
    return trimMessagesToTokenBudget(messages, maxTokens);
  }

  // ============================================================================
  // Intent Classification and Response Generation
  // ============================================================================

  /**
   * Classify user intent as work_request or regular_chat
   */
  private async classifyUserIntent(content: string): Promise<UserIntent> {
    const prompt = `Classify this user message:
"${content}"

- work_request: User explicitly asks for work, research, or analysis to be done
  Examples: "Research NVIDIA earnings", "Analyze my portfolio", "Find articles about AI"

- regular_chat: Questions, greetings, feedback, discussion, simple lookups
  Examples: "Hi", "Thanks!", "What do you think about tech stocks?", "What's TSLA at?"`;

    const result = await generateLLMObject(
      [{ role: "user", content: prompt }],
      UserIntentSchema,
      "Classify user intent",
      { ...this.llmOptions, temperature: 0 },
    );

    return result.intent;
  }

  /**
   * Generate a brief acknowledgment for work requests
   */
  private async generateWorkAcknowledgment(content: string): Promise<string> {
    const prompt = `The user just submitted this work request:
"${content}"

Generate a brief acknowledgment (1-2 sentences) that:
1. Shows you understand what they're asking for
2. Mentions you'll work on it and notify them via their inbox when done

Examples:
- "I'll research the latest NVIDIA earnings and notify you via your inbox when I have results."
- "I'll analyze your portfolio performance. You'll get a notification in your inbox once I'm done."`;

    const response = await generateLLMResponse(
      [{ role: "user", content: prompt }],
      this.buildSystemPrompt(),
      { ...this.llmOptions, maxOutputTokens: 100, temperature: 0.7 },
    );

    return response.content;
  }

  /**
   * Generate a full chat response with tools for regular conversation
   */
  private async generateChatResponse(
    content: string,
    conversation: Conversation,
  ): Promise<string> {
    // Load conversation history
    const history = await loadConversationHistory(conversation.id);
    const messages = messagesToLLMFormat(history);

    // Add the current user message
    const messagesWithNew: LLMMessage[] = [
      ...messages,
      { role: "user", content },
    ];

    const systemPrompt = this.buildForegroundSystemPrompt();
    const tools = getForegroundTools();
    const toolContext: ToolContext = {
      agentId: this.id,
      teamId: this.teamId,
      aideId: this.aideId,
      isLead: this.isLead(),
    };

    const result = await streamLLMResponseWithTools(
      messagesWithNew,
      systemPrompt,
      {
        ...this.llmOptions,
        tools,
        toolContext,
        maxSteps: 5,
        maxOutputTokens: DEFAULT_MAX_RESPONSE_TOKENS,
      },
    );

    // Consume the stream and get full response
    const fullResponse = await result.fullResponse;
    return fullResponse.text;
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
   * 3. Classifies intent (work_request or regular_chat)
   * 4a. Work request: generates ack, queues task
   * 4b. Regular chat: generates full response with tools
   * 5. Extracts memories in background
   * 6. Returns the response as a stream
   */
  async handleUserMessage(content: string): Promise<AsyncIterable<string>> {
    // 1. Load memories for user context (not knowledge items)
    await this.loadMemories();
    const conversation = await this.ensureConversation();

    // 2. Classify intent
    const intent = await this.classifyUserIntent(content);

    let response: string;

    if (intent === "work_request") {
      // 4a. Work request: Quick ack + queue task
      response = await this.generateWorkAcknowledgment(content);
    } else {
      // 4b. Regular chat: Full response with tools
      response = await this.generateChatResponse(content, conversation);
      // No task queued
    }

    // 5. Persist full turn atomically
    const { assistantMessage } = await createTurnMessages(
      conversation.id,
      { role: "user", content },
      { role: "assistant", content: response },
    );

    // 6. Queue background task only after persistence succeeds
    if (intent === "work_request") {
      await queueUserTask(this.id, this.getOwnerInfo(), content);
    }

    // 7. Extract memories in background
    this.extractMemoriesInBackground(content, response, assistantMessage.id);

    // 8. Return response as stream
    return this.streamResponse(response);
  }

  /**
   * Helper to stream a pre-generated response (for API compatibility)
   */
  private async *streamResponse(response: string): AsyncGenerator<string> {
    const words = response.split(" ");
    for (const word of words) {
      yield word + " ";
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  // ============================================================================
  // NEW: Background Work Session (Conversation-based processing)
  // ============================================================================

  /**
   * Run a work session to process queued tasks
   *
   * This is the main entry point for background processing:
   * 1. Gets or creates the background conversation for this agent
   * 2. Loads KNOWLEDGE for work context (not memories)
   * 3. Processes all pending tasks in queue
   * 4. When queue empty:
   *    - Extracts knowledge from conversation
   *    - Lead: decides on briefing
   *    - Schedules next run
   *
   * Note: Background conversation is persistent across work sessions (unlike the old session model)
   */
  async runWorkSession(): Promise<void> {
    // Check if there's work to do
    const queueStatus = await getQueueStatus(this.id);
    if (!queueStatus.hasPendingWork) {
      console.log(`[Agent ${this.name}] No pending work, skipping session`);
      return;
    }

    console.log(
      `[Agent ${this.name}] Starting work session with ${queueStatus.pendingCount} pending tasks`,
    );

    await this.setStatus("running");

    let processedAnyTasks = false;
    let encounteredFailure = false;

    try {
      // 1. Get or create background conversation for this agent
      const backgroundConversation = await getOrCreateConversation(
        this.id,
        "background",
      );
      const conversationId = backgroundConversation.id;

      // 2. Load KNOWLEDGE for work context (not memories)
      await this.loadKnowledge();

      // 3. Process all pending tasks in queue (loop)
      let task = await claimNextTask(this.id);
      while (task) {
        console.log(`[Agent ${this.name}] Processing task: ${task.id}`);

        try {
          const result = await this.processTask(conversationId, task);
          processedAnyTasks = true;
          await clearAgentBackoff(this.id);
          console.log(
            `[Agent ${this.name}] Task ${task.id} completed: ${result.slice(0, 100)}...`,
          );
        } catch (error) {
          console.error(`[Agent ${this.name}] Task ${task.id} failed:`, error);
          await this.scheduleBackoff();
          encounteredFailure = true;
          break;
        }

        // Get next task
        task = await claimNextTask(this.id);
      }

      if (!processedAnyTasks) {
        console.log(
          `[Agent ${this.name}] No tasks processed, skipping wrap-up`,
        );
        return;
      }

      if (encounteredFailure) {
        console.log(
          `[Agent ${this.name}] Task failed; backoff scheduled, leaving remaining tasks pending`,
        );
      } else {
        console.log(
          `[Agent ${this.name}] All tasks processed, wrapping up session`,
        );
      }

      // Extract knowledge from background conversation
      const conversationMessages = await getConversationContext(conversationId);
      const newKnowledge = await this.extractKnowledgeFromConversation(
        conversationId,
        conversationMessages,
      );
      console.log(
        `[Agent ${this.name}] Extracted ${newKnowledge.length} knowledge items from session`,
      );

      // No session to end - conversation persists across sessions

      // Lead: decide on briefing
      if (this.isLead()) {
        await this.decideBriefing(conversationId);
      }

      // Schedule next run (lead: 1 day, subordinate: none - triggered by delegation)
      if (this.isLead() && !encounteredFailure) {
        await this.scheduleNextRun(LEAD_NEXT_RUN_HOURS);
      }
    } catch (error) {
      console.error(`[Agent ${this.name}] Work session failed:`, error);
    } finally {
      await this.setStatus("idle");
    }
  }

  /**
   * Process a single task within the background conversation
   */
  async processTask(conversationId: string, task: AgentTask): Promise<string> {
    // 1. Add task as "user" message to conversation (agent is the user here)
    const taskMessage = `Task from ${task.source}: ${task.task}`;

    // 2. Build context from conversation messages + KNOWLEDGE
    const contextMessages = await getConversationContext(conversationId);
    const systemPrompt = this.buildBackgroundSystemPrompt();
    const contextWithTask: LLMMessage[] = [
      ...this.messagesToLLMFormat(contextMessages),
      { role: "user", content: taskMessage },
    ];

    // 3. Get tools for background work
    const tools = getBackgroundTools(this.isLead());
    const toolContext: ToolContext = {
      agentId: this.id,
      teamId: this.teamId,
      aideId: this.aideId,
      isLead: this.isLead(),
    };

    // 4. Call LLM with tools
    const result = await streamLLMResponseWithTools(
      contextWithTask,
      systemPrompt,
      {
        ...this.llmOptions,
        tools,
        toolContext,
        maxSteps: 10, // Allow multiple tool calls
        maxOutputTokens: DEFAULT_MAX_RESPONSE_TOKENS,
      },
    );

    // 5. Consume stream and get response
    const fullResponse = await result.fullResponse;

    // 6. Persist task turn + completion atomically
    await db.transaction(async (tx) => {
      await createTurnMessagesInTransaction(
        tx,
        conversationId,
        { role: "user", content: taskMessage },
        { role: "assistant", content: fullResponse.text },
      );
      await tx
        .update(agentTasks)
        .set({
          status: "completed",
          result: fullResponse.text,
          completedAt: new Date(),
        })
        .where(eq(agentTasks.id, task.id));
    });

    // 7. Check if should compact conversation
    await compactIfNeeded(
      conversationId,
      MAX_MESSAGES_BEFORE_COMPACT,
      this.llmOptions,
    );

    return fullResponse.text;
  }

  /**
   * Compute exponential backoff delay with jitter.
   */
  private computeBackoffDelayMs(attempt: number): number {
    const baseDelayMs = 60 * 1000; // 1 minute
    const maxDelayMs = 24 * 60 * 60 * 1000; // 24 hours
    const exponential = baseDelayMs * Math.pow(2, Math.max(0, attempt - 1));
    const jitter = Math.random() * (baseDelayMs * 0.2);
    return Math.min(maxDelayMs, exponential + jitter);
  }

  /**
   * Set agent backoff after a failed task attempt.
   */
  private async scheduleBackoff(): Promise<void> {
    const agent = await getAgentById(this.id);
    const nextAttempt = (agent?.backoffAttemptCount ?? 0) + 1;
    const delayMs = this.computeBackoffDelayMs(nextAttempt);
    const nextRun = new Date(Date.now() + delayMs);

    await setAgentBackoff(this.id, nextAttempt, nextRun);

    console.log(
      `[Agent ${this.name}] Backing off until ${nextRun.toISOString()} (attempt ${nextAttempt})`,
    );
  }

  /**
   * Convert messages to LLM format for background work
   * Maps database message roles to LLM roles
   */
  private messagesToLLMFormat(messages: Message[]): LLMMessage[] {
    return messages.map((m) => ({
      role: this.mapRoleToLLMRole(m.role),
      content: m.content,
    }));
  }

  /**
   * Map database message roles to LLM roles
   */
  private mapRoleToLLMRole(role: string): "user" | "assistant" | "system" {
    switch (role) {
      case "user":
        return "user";
      case "assistant":
      case "summary":
      case "tool":
        return "assistant";
      default:
        return "assistant";
    }
  }

  /**
   * Extract knowledge from background conversation messages
   */
  private async extractKnowledgeFromConversation(
    conversationId: string,
    messages: Message[],
  ): Promise<KnowledgeItem[]> {
    if (messages.length === 0) {
      return [];
    }

    // extractKnowledgeFromMessages accepts Message[] directly (only uses role and content)
    const extractedKnowledge = await extractKnowledgeFromMessages(
      messages,
      this.type,
      this.llmOptions,
    );

    if (extractedKnowledge.length === 0) {
      return [];
    }

    // Persist knowledge items to database
    const { createKnowledgeItem } =
      await import("@/lib/db/queries/knowledge-items");
    const persistedKnowledgeItems: KnowledgeItem[] = [];
    for (const item of extractedKnowledge) {
      const persisted = await createKnowledgeItem(
        this.id,
        item.type as "fact" | "technique" | "pattern" | "lesson",
        item.content,
        conversationId, // Pass conversationId as sourceThreadId (will be renamed in Phase 7)
        item.confidence,
      );
      persistedKnowledgeItems.push(persisted);
    }

    return persistedKnowledgeItems;
  }

  // ============================================================================
  // NEW: Briefing Decision (Lead Only)
  // ============================================================================

  /**
   * Decide whether to brief the user based on work session results
   */
  async decideBriefing(conversationId: string): Promise<void> {
    if (!this.isLead()) return;

    // Get conversation context for review
    const messages = await getConversationContext(conversationId);
    if (messages.length === 0) return;

    // Build summary of work done
    const workSummary = messages
      .filter((m) => m.role === "assistant")
      .map((m) => m.content)
      .join("\n\n")
      .slice(0, 2000); // Limit context size

    // Schema for briefing decision
    const BriefingDecisionSchema = z.object({
      shouldBrief: z
        .boolean()
        .describe("Whether this work warrants notifying the user"),
      reason: z.string().describe("Brief reason for the decision"),
      title: z
        .string()
        .optional()
        .describe("Title for the briefing if shouldBrief is true"),
      summary: z
        .string()
        .optional()
        .describe("Summary for inbox if shouldBrief is true"),
      fullMessage: z
        .string()
        .optional()
        .describe("Full briefing message if shouldBrief is true"),
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
        [{ role: "user", content: decisionPrompt }],
        BriefingDecisionSchema,
        "You are a thoughtful assistant deciding what warrants user attention.",
        {
          ...this.llmOptions,
          temperature: 0,
        },
      );

      if (
        decision.shouldBrief &&
        decision.title &&
        decision.summary &&
        decision.fullMessage
      ) {
        console.log(
          `[Agent ${this.name}] Creating briefing: ${decision.title}`,
        );

        // Get user ID based on owner type
        let userId: string | null = null;
        if (this.teamId) {
          const { getTeamUserId } = await import("@/lib/db/queries/teams");
          userId = await getTeamUserId(this.teamId);
        } else if (this.aideId) {
          const { getAideUserId } = await import("@/lib/db/queries/aides");
          userId = await getAideUserId(this.aideId);
        }

        if (!userId) {
          console.error(`[Agent ${this.name}] No user found for team/aide`);
          return;
        }

        // Create inbox item with appropriate owner
        const { createInboxItem } = await import("@/lib/db/queries/inboxItems");
        const ownerInfo = this.getOwnerInfo();
        await createInboxItem({
          userId,
          ...ownerInfo,
          agentId: this.id,
          type: "briefing",
          title: decision.title,
          content: decision.summary,
        });

        // Add full message to user conversation
        const conversation = await this.ensureConversation();
        await addAssistantMessage(conversation.id, decision.fullMessage);

        console.log(`[Agent ${this.name}] Briefing sent successfully`);
      } else {
        console.log(
          `[Agent ${this.name}] No briefing needed: ${decision.reason}`,
        );
      }
    } catch (error) {
      console.error(`[Agent ${this.name}] Failed to decide briefing:`, error);
    }
  }

  /**
   * Schedule the next work session run (for leads only)
   */
  private async scheduleNextRun(hours: number): Promise<void> {
    const { updateAgentLeadNextRunAt } =
      await import("@/lib/db/queries/agents");
    const nextRun = new Date(Date.now() + hours * 60 * 60 * 1000);
    await updateAgentLeadNextRunAt(this.id, nextRun);
    console.log(
      `[Agent ${this.name}] Next run scheduled for ${nextRun.toISOString()}`,
    );
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
  async handleMessage(content: string): Promise<AsyncIterable<string>> {
    // Ensure we have loaded memories and conversation
    await this.loadMemories();
    const conversation = await this.ensureConversation();

    // Build context
    const context = await this.buildContext();
    const systemPrompt = this.buildSystemPrompt();

    // Add the new user message to context
    const messagesWithNew: LLMMessage[] = [
      ...context,
      { role: "user", content },
    ];

    // Stream response from LLM
    const responseStream = await streamLLMResponse(
      messagesWithNew,
      systemPrompt,
      {
        ...this.llmOptions,
        maxOutputTokens: DEFAULT_MAX_RESPONSE_TOKENS,
      },
    );

    // Create a wrapper that collects the full response for memory extraction
    // Use arrow function to preserve 'this' context
    const extractMemories = this.extractMemoriesInBackground.bind(this);
    const wrappedStream = async function* (): AsyncGenerator<string> {
      let fullResponse = "";

      for await (const chunk of responseStream) {
        fullResponse += chunk;
        yield chunk;
      }

      // After streaming completes, persist the full turn and extract memories
      const { assistantMessage } = await createTurnMessages(
        conversation.id,
        { role: "user", content },
        { role: "assistant", content: fullResponse },
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
  async handleMessageSync(content: string): Promise<string> {
    const stream = await this.handleMessage(content);
    let fullResponse = "";

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
    sourceMessageId: string,
  ): void {
    extractAndPersistMemories(
      this.id,
      userMessage,
      assistantResponse,
      this.type,
      sourceMessageId,
      this.llmOptions,
    ).catch((error) => {
      console.error(`Memory extraction failed for agent ${this.id}:`, error);
    });
  }

  // ============================================================================
  // Agent Status
  // ============================================================================

  /**
   * Update this agent's status in the database
   */
  async setStatus(status: "idle" | "running" | "paused"): Promise<void> {
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
  llmOptions: StreamOptions = {},
): Promise<Agent | null> {
  return Agent.fromId(agentId, llmOptions);
}

/**
 * Create an agent from data
 */
export function createAgentFromData(
  data: AgentData,
  llmOptions: StreamOptions = {},
): Agent {
  return new Agent(data, llmOptions);
}
