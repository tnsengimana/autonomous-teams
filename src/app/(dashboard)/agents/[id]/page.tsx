"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AgentActions } from "@/components/agent-actions";
import { AgentHeaderActions } from "@/components/agent-header-actions";
import { AutoRefresh } from "@/components/auto-refresh";

interface Agent {
  id: string;
  name: string;
  purpose: string | null;
  isActive: boolean;
  iterationIntervalMs: number;
  createdAt: string;
}

export default function AgentDetailPage() {
  const params = useParams();
  const agentId = params.id as string;
  const [agent, setAgent] = useState<Agent | null>(null);
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
    return null;
  }

  // Parse mission from purpose field
  const mission = agent.purpose?.includes("Mission:")
    ? agent.purpose.split("Mission:")[1]?.trim()
    : agent.purpose || "No mission set";

  return (
    <div className="space-y-6">
      <AutoRefresh onRefresh={loadAgent} />

      <AgentHeaderActions>
        <AgentActions
          agentType="team"
          agentId={agent.id}
          agentName={agent.name}
          isActive={agent.isActive}
          currentIntervalMs={agent.iterationIntervalMs}
          backUrl="/agents"
        />
      </AgentHeaderActions>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Mission */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Mission</CardTitle>
          </CardHeader>
          <CardContent>
            <p>{mission}</p>
          </CardContent>
        </Card>

        {/* Stats */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Stats</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <Badge variant={agent.isActive ? "secondary" : "outline"}>
                {agent.isActive ? "Active" : "Paused"}
              </Badge>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Created</span>
              <span className="text-sm">
                {new Date(agent.createdAt).toLocaleDateString()}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
