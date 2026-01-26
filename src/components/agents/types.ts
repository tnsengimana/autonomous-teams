import type { Agent, Memory, KnowledgeItem } from "@/lib/types";

/**
 * The entity type that owns an agent (team or aide)
 */
export type AgentOwnerType = "team" | "aide";

/**
 * Owner context passed to shared agent components
 * Contains all info needed to construct URLs and display labels
 */
export interface AgentOwnerContext {
  type: AgentOwnerType;
  id: string;
  name: string;
}

/**
 * Props common to agent page components that display agent details
 */
export interface AgentPageBaseProps {
  owner: AgentOwnerContext;
  agent: Agent;
}

// Re-export types that components need
export type { Agent, Memory, KnowledgeItem };
