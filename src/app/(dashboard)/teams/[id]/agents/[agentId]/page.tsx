import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { auth } from '@/lib/auth/config';
import { getTeamById } from '@/lib/db/queries/teams';
import { getAgentById } from '@/lib/db/queries/agents';
import { Chat } from '@/components/chat';

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

  const agentType = agent.parentAgentId === null ? 'lead' : 'worker';

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col space-y-4">
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

      <div className="grid flex-1 gap-4 lg:grid-cols-2">
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
    </div>
  );
}
