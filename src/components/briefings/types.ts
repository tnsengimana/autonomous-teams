import type { Briefing } from "@/lib/types";

export type BriefingOwnerContext = {
  type: "team" | "aide";
  id: string;
  name: string;
};

export type { Briefing };
