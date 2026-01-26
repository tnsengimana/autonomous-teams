import Link from "next/link";
import { notFound, redirect } from "next/navigation";
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
import { auth } from "@/lib/auth/config";
import { getTeamById } from "@/lib/db/queries/teams";
import { getAgentById } from "@/lib/db/queries/agents";
import { getRecentMemories } from "@/lib/db/queries/memories";
import { getRecentKnowledgeItems } from "@/lib/db/queries/knowledge-items";
import type { MemoryType, KnowledgeItemType } from "@/lib/types";
import { MessageSquare, Eye, Edit } from "lucide-react";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string; agentId: string }>;
}) {
  // Check authentication
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const { id, agentId } = await params;

  // Get team and verify ownership
  const team = await getTeamById(id);
  if (!team || team.userId !== session.user.id) {
    notFound();
  }

  // Get agent and verify it belongs to the team
  const agent = await getAgentById(agentId);
  if (!agent || agent.teamId !== id) {
    notFound();
  }

  // Get recent memories (limit to 20)
  const memories = await getRecentMemories(agentId, 20);

  // Get recent knowledge items (limit to 20)
  const knowledgeItems = await getRecentKnowledgeItems(agentId, 20);

  const agentType = agent.parentAgentId === null ? "lead" : "subordinate";

  // Helper function to get badge variant for memory type
  const getMemoryTypeBadgeVariant = (type: MemoryType) => {
    switch (type) {
      case "insight":
        return "default";
      case "preference":
        return "secondary";
      case "fact":
        return "outline";
      default:
        return "outline";
    }
  };

  // Helper function to get badge variant for knowledge item type
  const getKnowledgeTypeBadgeVariant = (type: KnowledgeItemType) => {
    switch (type) {
      case "fact":
        return "outline";
      case "technique":
        return "default";
      case "pattern":
        return "secondary";
      case "lesson":
        return "destructive";
      default:
        return "outline";
    }
  };

  // Helper function to format date nicely
  const formatDate = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="flex flex-col space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href={`/teams/${team.id}`}
            className="text-sm text-muted-foreground hover:underline"
          >
            Back to team
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
          <Link href={`/teams/${team.id}/agents/${agent.id}/edit`}>
            <Button variant="outline" size="sm" className="gap-2">
              <Edit className="h-4 w-4" />
              Edit
            </Button>
          </Link>
          <Link href={`/teams/${team.id}/agents/${agent.id}/inspect`}>
            <Button variant="outline" size="sm" className="gap-2">
              <Eye className="h-4 w-4" />
              Inspect
            </Button>
          </Link>
          <Link href={`/teams/${team.id}/agents/${agent.id}/chat`}>
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
                Team
              </div>
              <Link
                href={`/teams/${team.id}`}
                className="mt-1 inline-block text-primary hover:underline"
              >
                {team.name}
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

        {/* Knowledge Items Section */}
        <Card>
          <CardHeader>
            <CardTitle>Knowledge Base</CardTitle>
            <CardDescription>
              Professional knowledge and techniques extracted from work sessions
            </CardDescription>
          </CardHeader>
          <CardContent>
            {knowledgeItems.length === 0 ? (
              <div className="flex h-[300px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                No knowledge items yet.
              </div>
            ) : (
              <ScrollArea className="h-[300px]">
                <div className="space-y-3 pr-4">
                  {knowledgeItems.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-lg border bg-card p-3 shadow-sm transition-all hover:bg-accent/50"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="flex-1 text-sm">{item.content}</p>
                        <Badge
                          variant={getKnowledgeTypeBadgeVariant(
                            item.type as KnowledgeItemType,
                          )}
                          className="shrink-0 text-[10px]"
                        >
                          {item.type}
                        </Badge>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">
                          Confidence: {Math.round((item.confidence || 0) * 100)}
                          %
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(item.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {/* Memories Section */}
        <Card>
          <CardHeader>
            <CardTitle>Memories</CardTitle>
            <CardDescription>
              User preferences and insights learned from conversations
            </CardDescription>
          </CardHeader>
          <CardContent>
            {memories.length === 0 ? (
              <div className="flex h-[300px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                No memories yet.
              </div>
            ) : (
              <ScrollArea className="h-[300px]">
                <div className="space-y-3 pr-4">
                  {memories.map((memory) => (
                    <div
                      key={memory.id}
                      className="rounded-lg border bg-card p-3 shadow-sm transition-all hover:bg-accent/50"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="flex-1 text-sm">{memory.content}</p>
                        <Badge
                          variant={getMemoryTypeBadgeVariant(
                            memory.type as MemoryType,
                          )}
                          className="shrink-0 text-[10px]"
                        >
                          {memory.type}
                        </Badge>
                      </div>
                      <div className="mt-2 flex items-center justify-end">
                        <p className="text-xs text-muted-foreground">
                          {formatDate(memory.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
