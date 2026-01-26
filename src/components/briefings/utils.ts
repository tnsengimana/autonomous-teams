import type { BriefingOwnerContext } from "./types";

export function buildOwnerPath(owner: BriefingOwnerContext): string {
  return owner.type === "team" ? `/teams/${owner.id}` : `/aides/${owner.id}`;
}

export function getOwnerLabel(type: BriefingOwnerContext["type"]): string {
  return type === "team" ? "Team" : "Aide";
}
