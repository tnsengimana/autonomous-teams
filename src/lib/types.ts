/**
 * Core types for the Autonomous Agents system
 *
 * Database types are inferred from the Drizzle schema to ensure type safety.
 * Application-specific types are defined here for domain logic.
 */

import type { InferSelectModel } from 'drizzle-orm';
import type {
  briefings,
  conversations,
  entities,
  graphEdges,
  graphEdgeTypes,
  graphEdgeTypeSourceTypes,
  graphEdgeTypeTargetTypes,
  graphNodes,
  graphNodeTypes,
  memories,
  messages,
  userApiKeys,
  llmInteractions,
} from '@/lib/db/schema';

// ============================================================================
// Database Model Types (inferred from Drizzle schema)
// ============================================================================

export type Briefing = InferSelectModel<typeof briefings>;
export type Conversation = InferSelectModel<typeof conversations>;
export type Entity = InferSelectModel<typeof entities>;
export type Memory = InferSelectModel<typeof memories>;
export type Message = InferSelectModel<typeof messages>;
export type UserApiKey = InferSelectModel<typeof userApiKeys>;
export type LLMInteraction = InferSelectModel<typeof llmInteractions>;

// Knowledge Graph Types
export type GraphNodeType = InferSelectModel<typeof graphNodeTypes>;
export type GraphEdgeType = InferSelectModel<typeof graphEdgeTypes>;
export type GraphEdgeTypeSourceType = InferSelectModel<typeof graphEdgeTypeSourceTypes>;
export type GraphEdgeTypeTargetType = InferSelectModel<typeof graphEdgeTypeTargetTypes>;
export type GraphNode = InferSelectModel<typeof graphNodes>;
export type GraphEdge = InferSelectModel<typeof graphEdges>;

// ============================================================================
// Status Types
// ============================================================================

export type EntityStatus = 'active' | 'paused' | 'archived';
export type MemoryType = 'preference' | 'insight' | 'fact';
export type MessageRole = 'user' | 'assistant' | 'tool' | 'summary';

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
  content: string;
  thinking?: string | null;
  toolCalls?: unknown;
  toolCallId?: string;
  previousMessageId?: string;
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
}

// ============================================================================
// LLM Provider Types
// ============================================================================

export type LLMProvider = 'openai' | 'anthropic' | 'google' | 'lmstudio';

// ============================================================================
// LLM Types
// ============================================================================

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
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

export type InboxItemType = 'briefing' | 'feedback' | 'insight';

export interface InboxItem {
  id: string;
  userId: string;
  entityId: string;
  briefingId: string | null;
  type: InboxItemType;
  title: string;
  content: string;
  readAt: Date | null;
  createdAt: Date;
}

// ============================================================================
// Knowledge Graph Types
// ============================================================================

export type GraphTypeCreatedBy = 'system' | 'agent' | 'user';

// Convenience type with resolved relations for edge types
export interface GraphEdgeTypeWithConstraints extends GraphEdgeType {
  sourceNodeTypes: GraphNodeType[];
  targetNodeTypes: GraphNodeType[];
}

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
