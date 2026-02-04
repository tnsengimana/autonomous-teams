"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
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

interface LLMInteraction {
  id: string;
  entityId: string;
  systemPrompt: string;
  request: Record<string, unknown>;
  response: Record<string, unknown> | null;
  createdAt: string;
  completedAt: string | null;
}

function InteractionItem({ interaction }: { interaction: LLMInteraction }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const systemPromptSnippet = interaction.systemPrompt.length > 100
    ? interaction.systemPrompt.slice(0, 100) + "..."
    : interaction.systemPrompt;

  const requestPreview = JSON.stringify(interaction.request).slice(0, 150);
  const responsePreview = interaction.response
    ? JSON.stringify(interaction.response).slice(0, 150)
    : "Pending...";

  const isComplete = interaction.completedAt !== null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-medium">
                {new Date(interaction.createdAt).toLocaleString()}
              </CardTitle>
              <Badge variant={isComplete ? "default" : "secondary"}>
                {isComplete ? "Completed" : "In Progress"}
              </Badge>
            </div>
            <CardDescription className="text-xs">
              {systemPromptSnippet}
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? "Collapse" : "Expand"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!isExpanded && (
          <div className="space-y-2 text-xs text-muted-foreground">
            <div>
              <span className="font-medium">Request: </span>
              {requestPreview}...
            </div>
            <div>
              <span className="font-medium">Response: </span>
              {responsePreview}...
            </div>
          </div>
        )}
        {isExpanded && (
          <div className="space-y-4 pt-4">
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
                {interaction.response
                  ? JSON.stringify(interaction.response, null, 2)
                  : "Pending..."}
              </pre>
            </div>
            {interaction.completedAt && (
              <div className="text-xs text-muted-foreground">
                Completed at: {new Date(interaction.completedAt).toLocaleString()}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function InteractionsPage() {
  const params = useParams();
  const entityId = params.id as string;
  const [interactions, setInteractions] = useState<LLMInteraction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadInteractions() {
      try {
        const response = await fetch(`/api/entities/${entityId}/interactions`);
        if (!response.ok) {
          throw new Error("Failed to load interactions");
        }
        const data = await response.json();
        setInteractions(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load interactions");
      } finally {
        setIsLoading(false);
      }
    }

    loadInteractions();
  }, [entityId]);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/entities/${entityId}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          Back to Entity
        </Link>
        <h1 className="mt-2 text-3xl font-bold">LLM Interactions</h1>
        <p className="text-muted-foreground">
          Background LLM interactions for this entity
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="text-center text-muted-foreground">Loading...</div>
      ) : interactions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <h3 className="text-lg font-semibold">No interactions yet</h3>
            <p className="mt-2 text-center text-muted-foreground">
              Background LLM interactions will appear here as the entity runs.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {interactions.map((interaction) => (
            <InteractionItem key={interaction.id} interaction={interaction} />
          ))}
        </div>
      )}
    </div>
  );
}
