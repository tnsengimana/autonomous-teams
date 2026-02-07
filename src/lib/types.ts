/**
 * Core types for the Autonomous Agents system
 *
 * Database types are inferred from the Drizzle schema to ensure type safety.
 * Application-specific types are defined here for domain logic.
 */

import type { InferSelectModel } from "drizzle-orm";
import type {
  conversations,
  agents,
  graphEdges,
  graphEdgeTypes,
  graphNodes,
  graphNodeTypes,
  memories,
  messages,
  userApiKeys,
  llmInteractions,
} from "@/lib/db/schema";

// ============================================================================
// Database Model Types (inferred from Drizzle schema)
// ============================================================================

export type Conversation = InferSelectModel<typeof conversations>;
export type Agent = InferSelectModel<typeof agents>;
export type Memory = InferSelectModel<typeof memories>;
export type Message = InferSelectModel<typeof messages>;
export type UserApiKey = InferSelectModel<typeof userApiKeys>;
export type LLMInteraction = InferSelectModel<typeof llmInteractions>;

// Knowledge Graph Types
export type GraphNodeType = InferSelectModel<typeof graphNodeTypes>;
export type GraphEdgeType = InferSelectModel<typeof graphEdgeTypes>;
export type GraphNode = InferSelectModel<typeof graphNodes>;
export type GraphEdge = InferSelectModel<typeof graphEdges>;

// ============================================================================
// Status Types
// ============================================================================

export type MemoryType = "preference" | "insight" | "fact";
export type MessageRole = "user" | "llm" | "summary";

// ============================================================================
// Message Content Types (JSON structure for messages.content)
// ============================================================================

/** Content for role === 'user' */
export interface UserMessageContent {
  text: string;
}

/** Content for role === 'llm' */
export interface LLMMessageContent {
  text: string;
  thinking?: string;
  toolCalls?: Array<{
    toolName: string;
    args: Record<string, unknown>;
  }>;
  toolResults?: Array<{
    toolName: string;
    result: unknown;
  }>;
}

/** Content for role === 'summary' */
export interface SummaryMessageContent {
  text: string;
}

/** Union type for all message content types */
export type MessageContent =
  | UserMessageContent
  | LLMMessageContent
  | SummaryMessageContent;

// ============================================================================
// Extended Types
// ============================================================================

export interface ExtractedMemory {
  type: MemoryType;
  content: string;
}

export interface NewMessage {
  conversationId: string;
  role: MessageRole;
  content: MessageContent;
  previousMessageId?: string;
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
}

// ============================================================================
// LLM Provider Types
// ============================================================================

export type LLMProvider = "openai" | "anthropic" | "google" | "lmstudio";

// ============================================================================
// LLM Types
// ============================================================================

export interface LLMMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LLMStreamOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMResponse {
  content: string;
  thinking?: string;
}

// ============================================================================
// Inbox Types
// ============================================================================

export interface InboxItem {
  id: string;
  userId: string;
  agentId: string;
  title: string;
  content: string;
  readAt: Date | null;
  createdAt: Date;
}

// ============================================================================
// Knowledge Graph Types
// ============================================================================

export type GraphTypeCreator = "system" | "agent" | "user";

// Helper types for graph traversal
export interface GraphNeighbors {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  nodesByType: Record<string, number>;
  edgesByType: Record<string, number>;
}
