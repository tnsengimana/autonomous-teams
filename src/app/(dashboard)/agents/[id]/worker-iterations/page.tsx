"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";

interface LLMInteraction {
  id: string;
  phase: string | null;
  systemPrompt: string;
  request: Record<string, unknown>;
  response: Record<string, unknown> | null;
  createdAt: string;
  completedAt: string | null;
}

interface WorkerIteration {
  id: string;
  agentId: string;
  status: string;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  llmInteractions: LLMInteraction[];
}

function getPhaseLabel(phase: string | null): string {
  switch (phase) {
    case "query_identification":
      return "Query Identification";
    case "insight_identification":
      return "Insight Identification";
    case "knowledge_acquisition":
      return "Knowledge Acquisition";
    case "analysis_generation":
      return "Analysis Generation";
    case "advice_generation":
      return "Advice Generation";
    case "graph_construction":
      return "Graph Construction";
    default:
      return "Unknown";
  }
}

function getPhaseVariant(phase: string | null): "secondary" | "outline" {
  switch (phase) {
    case "query_identification":
      return "outline";
    case "insight_identification":
      return "outline";
    case "knowledge_acquisition":
      return "secondary";
    case "graph_construction":
      return "secondary";
    case "analysis_generation":
      return "secondary";
    case "advice_generation":
      return "secondary";
    default:
      return "outline";
  }
}

function InteractionDetail({ interaction }: { interaction: LLMInteraction }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const systemPromptSnippet =
    interaction.systemPrompt.length > 100
      ? interaction.systemPrompt.slice(0, 100) + "..."
      : interaction.systemPrompt;

  const response = interaction.response;
  const responseStr = response ? JSON.stringify(response) : "";
  const responsePreview = responseStr
    ? responseStr.slice(0, 200) + (responseStr.length > 200 ? "..." : "")
    : "Pending...";

  const isComplete = interaction.completedAt !== null;

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant={getPhaseVariant(interaction.phase)}>
              {getPhaseLabel(interaction.phase)}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {new Date(interaction.createdAt).toLocaleTimeString()}
            </span>
            {!isComplete && (
              <Badge variant="secondary" className="text-xs">
                In Progress
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{systemPromptSnippet}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? "Collapse" : "Expand"}
        </Button>
      </div>

      {!isExpanded && (
        <div className="mt-3 text-sm text-muted-foreground">
          <span className="font-medium">Response: </span>
          {responsePreview}
        </div>
      )}

      {isExpanded && (
        <div className="mt-4 space-y-4">
          <div>
            <h4 className="mb-2 text-sm font-medium">System Prompt</h4>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
              {interaction.systemPrompt}
            </pre>
          </div>
          <div>
            <h4 className="mb-2 text-sm font-medium">Request</h4>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(interaction.request, null, 2)}
            </pre>
          </div>

          <div>
            <h4 className="mb-2 text-sm font-medium">Response</h4>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
              {response ? JSON.stringify(response, null, 2) : "Pending..."}
            </pre>
          </div>

          {interaction.completedAt && (
            <div className="text-xs text-muted-foreground">
              Completed at: {new Date(interaction.completedAt).toLocaleString()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IterationItem({ iteration }: { iteration: WorkerIteration }) {
  const [isOpen, setIsOpen] = useState(false);

  const statusVariant =
    iteration.status === "completed"
      ? "secondary"
      : iteration.status === "failed"
        ? "outline"
        : "outline";

  const queryInteraction = iteration.llmInteractions.find(
    (i) => i.phase === "query_identification",
  );
  const insightInteraction = iteration.llmInteractions.find(
    (i) => i.phase === "insight_identification",
  );

  let queryCount = 0;
  let insightCount = 0;

  if (queryInteraction || insightInteraction) {
    queryCount = (queryInteraction?.response as any)?.queries?.length ?? 0;
    insightCount = (insightInteraction?.response as any)?.insights?.length ?? 0;
  }

  const outputSummary =
    queryCount > 0 || insightCount > 0
      ? `${queryCount} queries, ${insightCount} insights`
      : null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card>
        <CollapsibleTrigger className="w-full text-left">
          <CardHeader className="cursor-pointer hover:bg-muted/50">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <CardTitle className="text-sm font-medium">
                    {new Date(iteration.createdAt).toLocaleString()}
                  </CardTitle>
                  <Badge variant={statusVariant}>
                    {iteration.status.charAt(0).toUpperCase() +
                      iteration.status.slice(1)}
                  </Badge>
                  {outputSummary && (
                    <Badge variant="outline">{outputSummary}</Badge>
                  )}
                </div>
                <CardDescription className="text-xs">
                  {iteration.llmInteractions.length} interaction
                  {iteration.llmInteractions.length !== 1 ? "s" : ""}
                  {iteration.completedAt &&
                    ` - Duration: ${Math.round((new Date(iteration.completedAt).getTime() - new Date(iteration.createdAt).getTime()) / 1000)}s`}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4">
            {iteration.errorMessage && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <span className="font-medium">Error: </span>
                {iteration.errorMessage}
              </div>
            )}
            <div className="space-y-3">
              {iteration.llmInteractions.map((interaction) => (
                <InteractionDetail
                  key={interaction.id}
                  interaction={interaction}
                />
              ))}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

export default function WorkerIterationsPage() {
  const params = useParams();
  const agentId = params.id as string;
  const [iterations, setIterations] = useState<WorkerIteration[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadIterations = useCallback(async () => {
    try {
      const response = await fetch(`/api/agents/${agentId}/worker-iterations`);
      if (!response.ok) {
        throw new Error("Failed to load iterations");
      }
      const data = await response.json();
      setIterations(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load iterations",
      );
    } finally {
      setIsLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    loadIterations();
  }, [loadIterations]);

  return (
    <div className="space-y-6">
      <AutoRefresh onRefresh={loadIterations} />
      {error && (
        <div className="rounded-md bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="text-center text-muted-foreground">Loading...</div>
      ) : iterations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <h3 className="text-lg font-semibold">No iterations yet</h3>
            <p className="mt-2 text-center text-muted-foreground">
              Background worker iterations will appear here as the agent runs.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {iterations.map((iteration) => (
            <IterationItem key={iteration.id} iteration={iteration} />
          ))}
        </div>
      )}
    </div>
  );
}
