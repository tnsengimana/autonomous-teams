import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Eye, Edit } from "lucide-react";
import type { AgentOwnerContext, Agent, Memory, KnowledgeItem } from "./types";
import { buildAgentPath, buildOwnerPath, getOwnerLabel } from "./utils";
import { KnowledgeItemsList } from "./KnowledgeItemsList";
import { MemoriesList } from "./MemoriesList";

interface AgentDetailViewProps {
  owner: AgentOwnerContext;
  agent: Agent;
  memories: Memory[];
  knowledgeItems: KnowledgeItem[];
}

export function AgentDetailView({
  owner,
  agent,
  memories,
  knowledgeItems,
}: AgentDetailViewProps) {
  const agentType = agent.parentAgentId === null ? "lead" : "subordinate";

  return (
    <div className="flex flex-col space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href={buildOwnerPath(owner)}
            className="text-sm text-muted-foreground hover:underline"
          >
            Back to {getOwnerLabel(owner.type).toLowerCase()}
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
          <Link href={buildAgentPath(owner, agent.id, "edit")}>
            <Button variant="outline" size="sm" className="gap-2">
              <Edit className="h-4 w-4" />
              Edit
            </Button>
          </Link>
          <Link href={buildAgentPath(owner, agent.id, "inspect")}>
            <Button variant="outline" size="sm" className="gap-2">
              <Eye className="h-4 w-4" />
              Inspect
            </Button>
          </Link>
          <Link href={buildAgentPath(owner, agent.id, "chat")}>
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
                {getOwnerLabel(owner.type)}
              </div>
              <Link
                href={buildOwnerPath(owner)}
                className="mt-1 inline-block text-primary hover:underline"
              >
                {owner.name}
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
        <KnowledgeItemsList items={knowledgeItems} />

        {/* Memories Section */}
        <MemoriesList items={memories} />
      </div>
    </div>
  );
}
