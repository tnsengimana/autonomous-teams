import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth/config";
import { getEntityById } from "@/lib/db/queries/entities";
import { getAgentById } from "@/lib/db/queries/agents";
import { getRecentMemories } from "@/lib/db/queries/memories";
import { getGraphStats } from "@/lib/db/queries/graph-data";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageSquare, Eye, Edit, ListTodo } from "lucide-react";
import type { MemoryType, GraphStats } from "@/lib/types";
import {
  buildAgentPath,
  buildEntityPath,
  getEntityLabel,
  formatRelativeDate,
  getMemoryTypeBadgeVariant,
  type EntityContext,
  type Memory,
} from "@/lib/entities/utils";

function GraphStatsCard({ stats }: { stats: GraphStats }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Knowledge Graph</CardTitle>
        <CardDescription>
          Structured knowledge discovered from work sessions
        </CardDescription>
      </CardHeader>
      <CardContent>
        {stats.nodeCount === 0 ? (
          <div className="flex h-[300px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
            No knowledge in graph yet.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg border p-4 text-center">
                <div className="text-2xl font-bold">{stats.nodeCount}</div>
                <div className="text-xs text-muted-foreground">Nodes</div>
              </div>
              <div className="rounded-lg border p-4 text-center">
                <div className="text-2xl font-bold">{stats.edgeCount}</div>
                <div className="text-xs text-muted-foreground">Relationships</div>
              </div>
            </div>
            <div>
              <div className="text-sm font-medium mb-2">Nodes by Type</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(stats.nodesByType).map(([type, count]) => (
                  <Badge key={type} variant="outline">
                    {type}: {count}
                  </Badge>
                ))}
              </div>
            </div>
            {Object.keys(stats.edgesByType).length > 0 && (
              <div>
                <div className="text-sm font-medium mb-2">Relationships by Type</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(stats.edgesByType).map(([type, count]) => (
                    <Badge key={type} variant="secondary">
                      {type}: {count}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MemoriesList({ items }: { items: Memory[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Memories</CardTitle>
        <CardDescription>
          User preferences and insights learned from conversations
        </CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="flex h-[300px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
            No memories yet.
          </div>
        ) : (
          <ScrollArea className="h-[300px]">
            <div className="space-y-3 pr-4">
              {items.map((memory) => (
                <div
                  key={memory.id}
                  className="rounded-lg border bg-card p-3 shadow-sm transition-all hover:bg-accent/50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="flex-1 text-sm">{memory.content}</p>
                    <Badge
                      variant={getMemoryTypeBadgeVariant(
                        memory.type as MemoryType
                      )}
                      className="shrink-0 text-[10px]"
                    >
                      {memory.type}
                    </Badge>
                  </div>
                  <div className="mt-2 flex items-center justify-end">
                    <p className="text-xs text-muted-foreground">
                      {formatRelativeDate(memory.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

function AgentDetailView({
  entity,
  agent,
  memories,
  graphStats,
}: {
  entity: EntityContext;
  agent: {
    id: string;
    name: string;
    type: string;
    status: string;
    systemPrompt: string | null;
    parentAgentId: string | null;
  };
  memories: Memory[];
  graphStats: GraphStats;
}) {
  const agentType = agent.parentAgentId === null ? "lead" : "subordinate";

  return (
    <div className="flex flex-col space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href={buildEntityPath(entity)}
            className="text-sm text-muted-foreground hover:underline"
          >
            Back to {getEntityLabel(entity.type).toLowerCase()}
          </Link>
          <div className="flex items-center gap-3 mt-2">
            <h1 className="text-3xl font-bold">{agent.name}</h1>
            <Badge variant="outline">{agentType}</Badge>
            <Badge
              variant={agent.status === "running" ? "default" : "secondary"}
            >
              {agent.status}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={buildAgentPath(entity, agent.id, "edit")}>
            <Button variant="outline" size="sm" className="gap-2">
              <Edit className="h-4 w-4" />
              Edit
            </Button>
          </Link>
          <Link href={buildAgentPath(entity, agent.id, "inspect")}>
            <Button variant="outline" size="sm" className="gap-2">
              <Eye className="h-4 w-4" />
              Inspect
            </Button>
          </Link>
          <Link href={buildAgentPath(entity, agent.id, "tasks")}>
            <Button variant="outline" size="sm" className="gap-2">
              <ListTodo className="h-4 w-4" />
              Tasks
            </Button>
          </Link>
          <Link href={buildAgentPath(entity, agent.id, "chat")}>
            <Button size="sm" className="gap-2">
              <MessageSquare className="h-4 w-4" />
              Chat
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Agent Info */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="text-sm font-medium text-muted-foreground">
                Type
              </div>
              <p className="mt-1">{agent.type}</p>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">
                {getEntityLabel(entity.type)}
              </div>
              <Link
                href={buildEntityPath(entity)}
                className="mt-1 inline-block text-primary hover:underline"
              >
                {entity.name}
              </Link>
            </div>
            <div className="md:col-span-2">
              <div className="text-sm font-medium text-muted-foreground">
                System Prompt
              </div>
              <div className="mt-2 rounded-lg border bg-muted/50 p-4 text-sm font-mono text-muted-foreground whitespace-pre-wrap">
                {agent.systemPrompt || "No custom system prompt configured."}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Knowledge Graph Section */}
        <GraphStatsCard stats={graphStats} />

        {/* Memories Section */}
        <MemoriesList items={memories} />
      </div>
    </div>
  );
}

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string; agentId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const { id, agentId } = await params;

  const entity = await getEntityById(id);
  if (!entity || entity.userId !== session.user.id) notFound();

  const agent = await getAgentById(agentId);
  if (!agent || agent.entityId !== id) notFound();

  const [memories, graphStats] = await Promise.all([
    getRecentMemories(agentId, 20),
    getGraphStats(entity.id),
  ]);

  return (
    <AgentDetailView
      entity={{
        type: entity.type as "team" | "aide",
        id: entity.id,
        name: entity.name,
      }}
      agent={agent}
      memories={memories}
      graphStats={graphStats}
    />
  );
}
