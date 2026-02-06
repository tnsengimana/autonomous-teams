"use client";

import { usePathname } from "next/navigation";

const subPageLabels: Record<string, string> = {
  chat: "Chat",
  "worker-iterations": "Worker Iterations",
  "knowledge-graph": "Knowledge Graph",
  "graph-node-types": "Graph Node Types",
  "graph-edge-types": "Graph Edge Types",
};

export function AgentDetailTitle({
  agentId,
  agentName,
}: {
  agentId: string;
  agentName: string;
}) {
  const pathname = usePathname();
  const basePath = `/agents/${agentId}`;

  let subPage = "Details";
  if (pathname !== basePath) {
    const segment = pathname.slice(basePath.length + 1).split("/")[0];
    subPage = subPageLabels[segment] || "Details";
  }

  return (
    <h1 className="text-xl font-bold">
      {agentName} <span className="text-muted-foreground font-normal">- {subPage}</span>
    </h1>
  );
}
