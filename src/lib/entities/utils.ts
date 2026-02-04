import type {
  Briefing,
  MemoryType,
} from "@/lib/types";

/**
 * Entity context passed to components that need entity information
 * Contains all info needed to construct URLs and display labels
 */
export interface EntityContext {
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
 * Build a path to the entity page
 * @param entity - The entity context
 * @returns Path like `/entities/[id]`
 */
export function buildEntityPath(entity: EntityContext): string {
  return `/entities/${entity.id}`;
}

// Re-export types that components need
export type { Briefing };
