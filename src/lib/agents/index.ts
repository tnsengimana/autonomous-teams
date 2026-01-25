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
