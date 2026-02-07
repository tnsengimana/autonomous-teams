"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";

interface EdgeType {
  id: string;
  agentId: string | null;
  name: string;
  description: string;
  propertiesSchema: unknown;
  exampleProperties: unknown;
  createdBy: string;
  createdAt: string;
}

function EdgeTypeCard({ edgeType }: { edgeType: EdgeType }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card>
        <CollapsibleTrigger className="w-full text-left">
          <CardHeader className="cursor-pointer hover:bg-muted/50">
            <div className="flex items-center gap-2">
              {isOpen ? (
                <ChevronDown className="h-4 w-4 shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0" />
              )}
              <CardTitle className="text-lg">{edgeType.name}</CardTitle>
              <Badge variant="outline">
                {edgeType.agentId ? "Agent" : "Global"}
              </Badge>
              <Badge variant="secondary">{edgeType.createdBy}</Badge>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4">
            {edgeType.description && (
              <p className="text-sm text-muted-foreground">
                {edgeType.description}
              </p>
            )}

            {edgeType.propertiesSchema != null && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  Properties Schema
                </p>
                <pre className="bg-muted rounded-md p-3 text-xs overflow-auto max-h-48">
                  {JSON.stringify(edgeType.propertiesSchema, null, 2)}
                </pre>
              </div>
            )}

            {edgeType.exampleProperties != null && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  Example Properties
                </p>
                <pre className="bg-muted rounded-md p-3 text-xs overflow-auto max-h-48">
                  {JSON.stringify(edgeType.exampleProperties, null, 2)}
                </pre>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

export default function GraphEdgeTypesPage() {
  const params = useParams();
  const agentId = params.id as string;
  const [edgeTypes, setEdgeTypes] = useState<EdgeType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadEdgeTypes = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/agents/${agentId}/graph-edge-types`,
      );
      if (!response.ok) {
        throw new Error("Failed to load edge types");
      }
      const data = await response.json();
      setEdgeTypes(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load edge types",
      );
    } finally {
      setIsLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    loadEdgeTypes();
  }, [loadEdgeTypes]);

  return (
    <div className="space-y-6">
      <AutoRefresh onRefresh={loadEdgeTypes} />
      {error && (
        <div className="rounded-md bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="text-center text-muted-foreground">Loading...</div>
      ) : edgeTypes.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No edge types defined yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {edgeTypes.map((edgeType) => (
            <EdgeTypeCard key={edgeType.id} edgeType={edgeType} />
          ))}
        </div>
      )}
    </div>
  );
}
