"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { KnowledgeGraphView } from "./knowledge-graph-view";

interface AgentData {
  id: string;
  name: string;
}

export default function KnowledgeGraphPage() {
  const params = useParams();
  const agentId = params.id as string;
  const [agent, setAgent] = useState<AgentData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAgent = useCallback(async () => {
    try {
      const response = await fetch(`/api/agents/${agentId}`);
      if (!response.ok) {
        throw new Error("Failed to load agent");
      }
      const data = await response.json();
      setAgent(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agent");
    } finally {
      setIsLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    loadAgent();
  }, [loadAgent]);

  if (isLoading) {
    return (
      <div className="text-center text-muted-foreground">Loading...</div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-destructive/10 p-4 text-destructive">
        {error}
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="rounded-md bg-destructive/10 p-4 text-destructive">
        Agent not found
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        Interactive visualization of {agent.name}&apos;s knowledge
      </p>
      <div className="h-[calc(100vh-16rem)]">
        <KnowledgeGraphView agentId={agentId} />
      </div>
    </div>
  );
}
