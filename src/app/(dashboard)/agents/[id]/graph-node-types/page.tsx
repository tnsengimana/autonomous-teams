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

interface NodeType {
  id: string;
  agentId: string | null;
  name: string;
  description: string;
  propertiesSchema: unknown;
  exampleProperties: unknown;
  createdBy: string;
  createdAt: string;
}

function NodeTypeCard({ nodeType }: { nodeType: NodeType }) {
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
              <CardTitle className="text-lg">{nodeType.name}</CardTitle>
              <Badge variant="outline">
                {nodeType.agentId ? "Agent" : "Global"}
              </Badge>
              <Badge variant="secondary">{nodeType.createdBy}</Badge>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4">
            {nodeType.description && (
              <p className="text-sm text-muted-foreground">
                {nodeType.description}
              </p>
            )}

            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Properties Schema
              </p>
              <pre className="bg-muted rounded-md p-3 text-xs overflow-auto max-h-48">
                {JSON.stringify(nodeType.propertiesSchema, null, 2)}
              </pre>
            </div>

            {nodeType.exampleProperties != null && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  Example Properties
                </p>
                <pre className="bg-muted rounded-md p-3 text-xs overflow-auto max-h-48">
                  {JSON.stringify(nodeType.exampleProperties, null, 2)}
                </pre>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

export default function GraphNodeTypesPage() {
  const params = useParams();
  const agentId = params.id as string;
  const [nodeTypes, setNodeTypes] = useState<NodeType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadNodeTypes = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/agents/${agentId}/graph-node-types`,
      );
      if (!response.ok) {
        throw new Error("Failed to load node types");
      }
      const data = await response.json();
      setNodeTypes(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load node types",
      );
    } finally {
      setIsLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    loadNodeTypes();
  }, [loadNodeTypes]);

  return (
    <div className="space-y-6">
      <AutoRefresh onRefresh={loadNodeTypes} />
      {error && (
        <div className="rounded-md bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="text-center text-muted-foreground">Loading...</div>
      ) : nodeTypes.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No node types defined yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {nodeTypes.map((nodeType) => (
            <NodeTypeCard key={nodeType.id} nodeType={nodeType} />
          ))}
        </div>
      )}
    </div>
  );
}
