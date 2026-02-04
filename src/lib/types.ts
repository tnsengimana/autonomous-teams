/**
 * Core types for the Autonomous Teams agent system
 *
 * Database types are inferred from the Drizzle schema to ensure type safety.
 * Application-specific types are defined here for domain logic.
 */

import type { InferSelectModel } from 'drizzle-orm';
import type {
  agents,
  agentTasks,
  briefings,
  conversations,
  entities,
  graphEdges,
  graphEdgeTypes,
  graphEdgeTypeSourceTypes,
  graphEdgeTypeTargetTypes,
  graphNodes,
  graphNodeTypes,
  knowledgeItems,
  memories,
  messages,
  userApiKeys,
} from '@/lib/db/schema';

// ============================================================================
// Database Model Types (inferred from Drizzle schema)
// ============================================================================

export type Agent = InferSelectModel<typeof agents>;
export type AgentTask = InferSelectModel<typeof agentTasks>;
export type Briefing = InferSelectModel<typeof briefings>;
export type Conversation = InferSelectModel<typeof conversations>;
export type Entity = InferSelectModel<typeof entities>;
export type KnowledgeItem = InferSelectModel<typeof knowledgeItems>;
export type Memory = InferSelectModel<typeof memories>;
export type Message = InferSelectModel<typeof messages>;
export type UserApiKey = InferSelectModel<typeof userApiKeys>;

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

export type AgentStatus = 'idle' | 'running' | 'paused';
export type AgentType = 'lead' | 'subordinate';
export type AgentTaskStatus = 'pending' | 'completed';
export type AgentTaskSource = 'delegation' | 'user' | 'system' | 'self';
export type EntityType = 'team' | 'aide';
export type EntityStatus = 'active' | 'paused' | 'archived';
export type MemoryType = 'preference' | 'insight' | 'fact';
export type MessageRole = 'user' | 'assistant' | 'tool' | 'summary';
export type ConversationMode = 'foreground' | 'background';
export type KnowledgeItemType = 'fact' | 'technique' | 'pattern' | 'lesson';

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

export interface AgentWithRelations extends Agent {
  entity?: Entity;
  parentAgent?: Agent | null;
  childAgents?: Agent[];
  conversations?: Conversation[];
  memories?: Memory[];
}

export interface EntityWithAgents extends Entity {
  agents: Agent[];
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

export type InboxItemType = 'briefing' | 'feedback';

export interface InboxItem {
  id: string;
  userId: string;
  agentId: string;
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
