/**
 * LLM Runtime - re-export all LLM modules
 */

// LLM provider abstraction
export {
  streamLLMResponse,
  generateLLMResponse,
  generateLLMObject,
  isProviderAvailable,
  getDefaultProvider,
  type StreamOptions,
  type GenerateOptions,
} from "./providers";

// Memory management
export {
  extractMemories,
  extractAndPersistMemories,
  formatMemoriesForContext,
  buildMemoryContextBlock,
} from "./memory";

// Conversation management
export {
  getActiveConversation,
  startNewConversation,
  getCurrentConversation,
  loadConversationHistory,
  loadRecentHistory,
  addAssistantMessage,
  getConversationLastMessage,
  messagesToLLMFormat,
  buildMessageContext,
  estimateTokenCount,
  trimMessagesToTokenBudget,
  hasMessages,
  getMessageCount,
  getConversationSummary,
  type ConversationSummary,
} from "./conversation";

// Conversation compaction
export {
  shouldCompact,
  compactIfNeeded,
  compactConversation,
  generateConversationSummary,
} from "./compaction";

// Tools infrastructure
export {
  registerTool,
  getTool,
  getAllTools,
  getToolSchemas,
  executeTool,
  toolSchemasToOpenAIFunctions,
  type Tool,
  type ToolSchema,
  type ToolContext,
  type ToolResult,
  type ToolHandler,
  type ToolParameter,
} from "./tools";

// Graph tools
export {
  registerGraphTools,
  addGraphNodeTool,
  addGraphEdgeTool,
  queryGraphTool,
  getGraphSummaryTool,
  createNodeTypeTool,
  createEdgeTypeTool,
  getGraphToolNames,
  type GraphToolContext,
} from "./tools/graph-tools";
