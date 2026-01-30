import type {
  Agent,
  Memory,
  KnowledgeItem,
  AgentTask,
  Briefing,
  MemoryType,
  KnowledgeItemType,
} from "@/lib/types";

/**
 * The entity type (team or aide)
 */
export type EntityType = "team" | "aide";

/**
 * Entity context passed to components that need entity information
 * Contains all info needed to construct URLs and display labels
 */
export interface EntityContext {
  type: EntityType;
  id: string;
  name: string;
}

/**
 * Badge variant type matching the Badge component
 */
type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

/**
 * Format a date as a relative time string
 * Returns "just now", "5m ago", "2h ago", "3d ago", or date string for older
 */
export function formatRelativeDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return "just now";
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  // For older dates, return a formatted date string
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

/**
 * Get badge variant for memory type
 * insight → default, preference → secondary, fact → outline
 */
export function getMemoryTypeBadgeVariant(type: MemoryType): BadgeVariant {
  switch (type) {
    case "insight":
      return "default";
    case "preference":
      return "secondary";
    case "fact":
      return "outline";
    default:
      return "default";
  }
}

/**
 * Get badge variant for knowledge item type
 * technique → default, pattern → secondary, lesson → destructive, fact → outline
 */
export function getKnowledgeTypeBadgeVariant(
  type: KnowledgeItemType
): BadgeVariant {
  switch (type) {
    case "technique":
      return "default";
    case "pattern":
      return "secondary";
    case "lesson":
      return "destructive";
    case "fact":
      return "outline";
    default:
      return "default";
  }
}

/**
 * Build a path to an agent page
 * @param entity - The entity context (team or aide)
 * @param agentId - The agent ID
 * @param suffix - Optional path suffix (e.g., "chat", "edit", "inspect")
 * @returns Path like `/entities/[id]/agents/[agentId]`
 */
export function buildAgentPath(
  entity: EntityContext,
  agentId: string,
  suffix?: string
): string {
  const basePath = `/entities/${entity.id}/agents/${agentId}`;
  return suffix ? `${basePath}/${suffix}` : basePath;
}

/**
 * Build a path to the entity page
 * @param entity - The entity context (team or aide)
 * @returns Path like `/entities/[id]`
 */
export function buildEntityPath(entity: EntityContext): string {
  return `/entities/${entity.id}`;
}

/**
 * Get the display label for an entity type
 * @param type - The entity type
 * @returns "Team" or "Aide"
 */
export function getEntityLabel(type: EntityType): string {
  return type === "team" ? "Team" : "Aide";
}

// Re-export types that components need
export type { Agent, Memory, KnowledgeItem, AgentTask, Briefing };
