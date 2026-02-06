"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { XIcon } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";

// Dynamically import GraphCanvas to avoid SSR issues
const GraphCanvas = dynamic(
  () => import("reagraph").then((mod) => mod.GraphCanvas),
  { ssr: false }
);

interface GraphNode {
  id: string;
  label: string;
  type: string;
  data: {
    type: string;
    properties: Record<string, unknown>;
    createdAt: string;
  };
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  data: {
    type: string;
    properties: Record<string, unknown>;
    createdAt: string;
  };
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface KnowledgeGraphViewProps {
  agentId: string;
}

type SelectedItem =
  | { type: "node"; data: GraphNode }
  | { type: "edge"; data: GraphEdge }
  | null;

export function KnowledgeGraphView({ agentId }: KnowledgeGraphViewProps) {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedItem>(null);
  const [selections, setSelections] = useState<string[]>([]);

  const fetchGraph = useCallback(async () => {
    try {
      const response = await fetch(`/api/agents/${agentId}/knowledge-graph`);
      if (!response.ok) {
        throw new Error("Failed to fetch graph data");
      }
      const data = await response.json();
      setGraphData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelected({ type: "node", data: node });
    setSelections([node.id]);
  }, []);

  const handleEdgeClick = useCallback((edge: GraphEdge) => {
    setSelected({ type: "edge", data: edge });
    setSelections([edge.id]);
  }, []);

  const handleClose = useCallback(() => {
    setSelected(null);
    setSelections([]);
  }, []);

  if (loading) {
    return (
      <>
        <AutoRefresh onRefresh={fetchGraph} />
        <div className="flex items-center justify-center h-full">
          <p className="text-muted-foreground">Loading graph...</p>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <AutoRefresh onRefresh={fetchGraph} />
        <div className="flex items-center justify-center h-full">
          <p className="text-destructive">Error: {error}</p>
        </div>
      </>
    );
  }

  if (!graphData || graphData.nodes.length === 0) {
    return (
      <>
        <AutoRefresh onRefresh={fetchGraph} />
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <p className="text-muted-foreground">No knowledge graph data yet.</p>
            <p className="text-sm text-muted-foreground mt-1">
              The agent will build its knowledge graph as it works.
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
    <AutoRefresh onRefresh={fetchGraph} />
    <div className="flex h-full gap-4">
      {/* Graph visualization */}
      <div className="flex-1 border rounded-lg overflow-hidden bg-background relative">
        <div className="absolute inset-0">
          <GraphCanvas
            layoutType="forceDirected3d"
            cameraMode="rotate"
            minDistance={100}
            maxDistance={5000}
            nodes={graphData.nodes}
            edges={graphData.edges}
            selections={selections}
            onNodeClick={(node) => handleNodeClick(node as unknown as GraphNode)}
            onEdgeClick={(edge) => handleEdgeClick(edge as unknown as GraphEdge)}
            labelType="all"
            draggable
          />
        </div>
      </div>

      {/* Details panel */}
      {selected && (
        <Card className="w-80 flex-shrink-0">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                {selected.type === "node" ? "Node Details" : "Edge Details"}
              </CardTitle>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={handleClose}
              >
                <XIcon className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[calc(100vh-16rem)]">
              {selected.type === "node" ? (
                <NodeDetails node={selected.data} />
              ) : (
                <EdgeDetails edge={selected.data} nodes={graphData.nodes} />
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
    </>
  );
}

function NodeDetails({ node }: { node: GraphNode }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">Name</p>
        <p className="font-medium">{node.label}</p>
      </div>
      <div>
        <p className="text-sm text-muted-foreground">Type</p>
        <Badge variant="secondary">{node.data.type}</Badge>
      </div>
      <div>
        <p className="text-sm text-muted-foreground">Created</p>
        <p className="text-sm">
          {new Date(node.data.createdAt).toLocaleString()}
        </p>
      </div>
      {Object.keys(node.data.properties).length > 0 && (
        <div>
          <p className="text-sm text-muted-foreground mb-2">Properties</p>
          <div className="space-y-2">
            {Object.entries(node.data.properties).map(([key, value]) => (
              <div key={key} className="text-sm">
                <span className="text-muted-foreground">{key}:</span>{" "}
                <span className="break-words">
                  {typeof value === "object"
                    ? JSON.stringify(value, null, 2)
                    : String(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EdgeDetails({
  edge,
  nodes,
}: {
  edge: GraphEdge;
  nodes: GraphNode[];
}) {
  const sourceNode = nodes.find((n) => n.id === edge.source);
  const targetNode = nodes.find((n) => n.id === edge.target);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">Relationship</p>
        <Badge variant="secondary">{edge.label}</Badge>
      </div>
      <div>
        <p className="text-sm text-muted-foreground">From</p>
        <p className="font-medium">{sourceNode?.label ?? edge.source}</p>
        {sourceNode && (
          <Badge variant="outline" className="mt-1">
            {sourceNode.data.type}
          </Badge>
        )}
      </div>
      <div>
        <p className="text-sm text-muted-foreground">To</p>
        <p className="font-medium">{targetNode?.label ?? edge.target}</p>
        {targetNode && (
          <Badge variant="outline" className="mt-1">
            {targetNode.data.type}
          </Badge>
        )}
      </div>
      <div>
        <p className="text-sm text-muted-foreground">Created</p>
        <p className="text-sm">
          {new Date(edge.data.createdAt).toLocaleString()}
        </p>
      </div>
      {Object.keys(edge.data.properties).length > 0 && (
        <div>
          <p className="text-sm text-muted-foreground mb-2">Properties</p>
          <div className="space-y-2">
            {Object.entries(edge.data.properties).map(([key, value]) => (
              <div key={key} className="text-sm">
                <span className="text-muted-foreground">{key}:</span>{" "}
                <span className="break-words">
                  {typeof value === "object"
                    ? JSON.stringify(value, null, 2)
                    : String(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
