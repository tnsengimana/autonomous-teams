/**
 * Agent Core Runtime - re-export all agent modules
 */

// Agent class and factory
export { Agent, createAgent, createAgentFromData } from './agent';

// LLM provider abstraction
export {
  streamLLMResponse,
  generateLLMResponse,
  generateLLMObject,
  isProviderAvailable,
  getDefaultProvider,
  type StreamOptions,
  type GenerateOptions,
} from './llm';

// Memory management
export {
  extractMemories,
  extractAndPersistMemories,
  formatMemoriesForContext,
  buildMemoryContextBlock,
} from './memory';

// Conversation management
export {
  getActiveConversation,
  startNewConversation,
  getCurrentConversation,
  loadConversationHistory,
  loadRecentHistory,
  appendMessage,
  addUserMessage,
  addAssistantMessage,
  addSystemMessage,
  getConversationLastMessage,
  messagesToLLMFormat,
  buildMessageContext,
  estimateTokenCount,
  trimMessagesToTokenBudget,
  hasMessages,
  getMessageCount,
  getConversationSummary,
  type ConversationSummary,
} from './conversation';

// Thread management (ephemeral work sessions)
export {
  startWorkSession,
  getOrStartWorkSession,
  endWorkSession,
  hasActiveSession,
  getSessionThread,
  addToThread,
  addUserMessage as addThreadUserMessage,
  addAssistantMessage as addThreadAssistantMessage,
  addSystemMessage as addThreadSystemMessage,
  getMessages as getThreadMessages,
  buildThreadContext,
  threadMessagesToLLMFormat,
  estimateTokenCount as estimateThreadTokenCount,
  trimMessagesToTokenBudget as trimThreadMessagesToTokenBudget,
  shouldCompact,
  compactIfNeeded,
  compactWithSummary,
  clearThread,
  getThreadStats,
  initializeThreadWithPrompt,
  type WorkSession,
  type ThreadContext,
  type ThreadStats,
  type SummarizeFn,
} from './thread';

// Tools infrastructure
export {
  registerTool,
  getTool,
  getAllTools,
  getTeamLeadTools,
  getSubordinateTools,
  getToolSchemas,
  executeTool,
  toolSchemasToOpenAIFunctions,
  type Tool,
  type ToolSchema,
  type ToolContext,
  type ToolResult,
  type ToolHandler,
  type ToolParameter,
} from './tools';

// Team lead tools
export {
  registerTeamLeadTools,
  delegateToAgentTool,
  getTeamStatusTool,
  createInboxItemTool,
} from './tools/team-lead-tools';

// Subordinate tools
export {
  registerSubordinateTools,
  reportToLeadTool,
  requestInputTool,
} from './tools/subordinate-tools';

// Knowledge extraction and management
export {
  extractKnowledgeFromMessages,
  extractKnowledgeFromConversation,
  formatKnowledgeForContext,
  buildKnowledgeContextBlock,
  loadKnowledgeContext,
  loadKnowledge,
  type ExtractedKnowledgeItem,
} from './knowledge-items';
