import type { GraphNode } from "@/lib/types";
import type { ObserverOutput } from "./types";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMBEDDED_UUID_REGEX =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

type GraphNodeRef = Pick<GraphNode, "id" | "type" | "name">;

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function findUuidFromReference(reference: string): string | null {
  const trimmed = reference.trim();
  if (UUID_REGEX.test(trimmed)) {
    return trimmed;
  }

  const embeddedMatch = trimmed.match(EMBEDDED_UUID_REGEX);
  return embeddedMatch ? embeddedMatch[0] : null;
}

/**
 * Normalizes Observer output by converting `insights[].relevantNodeIds` references
 * (UUIDs, embedded UUIDs, `Type: Name`, or plain names) into canonical graph UUIDs.
 * Unknown or ambiguous references are dropped, and duplicate UUIDs are removed.
 */
export function normalizeObserverOutput(
  output: ObserverOutput,
  graphNodes: GraphNodeRef[],
): ObserverOutput {
  const nodesById = new Set<string>();
  const nodesByTypeAndName = new Map<string, string>();
  const nodesByName = new Map<string, string[]>();

  for (const node of graphNodes) {
    nodesById.add(node.id);
    nodesByTypeAndName.set(
      `${normalizeKey(node.type)}::${normalizeKey(node.name)}`,
      node.id,
    );

    const nameKey = normalizeKey(node.name);
    const nameMatches = nodesByName.get(nameKey) ?? [];
    nameMatches.push(node.id);
    nodesByName.set(nameKey, nameMatches);
  }

  let resolvedByUuid = 0;
  let resolvedByName = 0;
  const droppedReferences: string[] = [];

  const normalizedInsights = output.insights.map((insight) => {
    const dedupedIds = new Set<string>();
    const normalizedIds: string[] = [];

    for (const rawRef of insight.relevantNodeIds) {
      const trimmedRef = rawRef.trim();
      if (!trimmedRef) {
        droppedReferences.push(rawRef);
        continue;
      }

      const uuidRef = findUuidFromReference(trimmedRef);
      if (uuidRef && nodesById.has(uuidRef)) {
        if (!dedupedIds.has(uuidRef)) {
          dedupedIds.add(uuidRef);
          normalizedIds.push(uuidRef);
        }
        resolvedByUuid += 1;
        continue;
      }

      const typedRefMatch = trimmedRef.match(/^([^:]+):\s*(.+)$/);
      if (typedRefMatch) {
        const [, typeName, nodeName] = typedRefMatch;
        const typedMatchId = nodesByTypeAndName.get(
          `${normalizeKey(typeName)}::${normalizeKey(nodeName)}`,
        );
        if (typedMatchId) {
          if (!dedupedIds.has(typedMatchId)) {
            dedupedIds.add(typedMatchId);
            normalizedIds.push(typedMatchId);
          }
          resolvedByName += 1;
          continue;
        }
      }

      const nameMatches = nodesByName.get(normalizeKey(trimmedRef));
      if (nameMatches && nameMatches.length === 1) {
        const matchedId = nameMatches[0];
        if (!dedupedIds.has(matchedId)) {
          dedupedIds.add(matchedId);
          normalizedIds.push(matchedId);
        }
        resolvedByName += 1;
        continue;
      }

      droppedReferences.push(rawRef);
    }

    return {
      ...insight,
      relevantNodeIds: normalizedIds,
    };
  });

  if (droppedReferences.length > 0) {
    console.warn(
      `[Observer] normalizeObserverOutput dropped ${droppedReferences.length} unresolved relevantNodeIds (resolvedByUuid=${resolvedByUuid}, resolvedByName=${resolvedByName}). droppedReferences=${JSON.stringify(droppedReferences)}`,
    );
  }

  return {
    ...output,
    insights: normalizedInsights,
  };
}
