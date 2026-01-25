import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { auth } from '@/lib/auth/config';
import { getTeamById } from '@/lib/db/queries/teams';
import { getAgentById } from '@/lib/db/queries/agents';
import { getRecentMemories } from '@/lib/db/queries/memories';
import { Chat } from '@/components/chat';
import type { MemoryType } from '@/lib/types';

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string; agentId: string }>;
}) {
  // Check authentication
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/auth/signin');
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

  // Get recent memories for this agent (limit to 20)
  const memories = await getRecentMemories(agentId, 20);

  const agentType = agent.parentAgentId === null ? 'lead' : 'subordinate';

  // Helper function to get badge variant for memory type
  const getMemoryTypeBadgeVariant = (type: MemoryType) => {
    switch (type) {
      case 'insight':
        return 'default';
      case 'preference':
        return 'secondary';
      case 'fact':
        return 'outline';
      default:
        return 'outline';
    }
  };

  // Helper function to format date nicely
  const formatDate = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="flex flex-col space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href={`/teams/${team.id}/agents`}
            className="text-sm text-muted-foreground hover:underline"
          >
            Back to Agents
          </Link>
          <h1 className="mt-2 text-2xl font-bold">{agent.name}</h1>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant="outline">{agentType}</Badge>
            <Badge
              variant={agent.status === 'running' ? 'default' : 'secondary'}
            >
              {agent.status}
            </Badge>
          </div>
        </div>
        <Button variant="outline">Edit Agent</Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Agent Info */}
        <Card>
          <CardHeader>
            <CardTitle>Agent Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-sm font-medium">Role</div>
              <p className="text-sm text-muted-foreground">{agent.role}</p>
            </div>
            <div>
              <div className="text-sm font-medium">System Prompt</div>
              <p className="mt-1 rounded-lg border bg-muted/50 p-3 text-sm">
                {agent.systemPrompt || 'No custom system prompt configured.'}
              </p>
            </div>
            <div>
              <div className="text-sm font-medium">Team</div>
              <Link
                href={`/teams/${team.id}`}
                className="text-sm text-primary hover:underline"
              >
                {team.name}
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Direct Chat */}
        <Chat
          teamId={team.id}
          agentId={agent.id}
          agentName={agent.name}
          title="Direct Chat"
          description={`Chat directly with ${agent.name}`}
        />
      </div>

      {/* Memories Section */}
      <Card>
        <CardHeader>
          <CardTitle>Memories</CardTitle>
          <CardDescription>
            What this agent has learned from conversations
          </CardDescription>
        </CardHeader>
        <CardContent>
          {memories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No memories yet. Start a conversation to help this agent learn.
            </p>
          ) : (
            <ScrollArea className="h-[300px]">
              <div className="space-y-3 pr-4">
                {memories.map((memory) => (
                  <div
                    key={memory.id}
                    className="rounded-lg border bg-muted/30 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="flex-1 text-sm">{memory.content}</p>
                      <Badge
                        variant={getMemoryTypeBadgeVariant(memory.type as MemoryType)}
                        className="shrink-0"
                      >
                        {memory.type}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {formatDate(memory.createdAt)}
                    </p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
