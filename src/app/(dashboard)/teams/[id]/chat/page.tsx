import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth/config';
import { getTeamById } from '@/lib/db/queries/teams';
import { getTeamLead } from '@/lib/db/queries/agents';
import { Chat } from '@/components/chat';

export default async function TeamChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Check authentication
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/auth/signin');
  }

  const { id } = await params;

  // Get team and verify ownership
  const team = await getTeamById(id);
  if (!team || team.userId !== session.user.id) {
    notFound();
  }

  // Get team lead agent
  const teamLead = await getTeamLead(id);

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href={`/teams/${team.id}`}
            className="text-sm text-muted-foreground hover:underline"
          >
            Back to {team.name}
          </Link>
          <h1 className="text-2xl font-bold">Chat with {team.name}</h1>
        </div>
      </div>

      {teamLead ? (
        <Chat
          teamId={team.id}
          agentId={teamLead.id}
          agentName={teamLead.name}
          title={`${teamLead.name} (Team Lead)`}
          description={`Chat with your team lead agent. ${teamLead.role}`}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center rounded-lg border bg-muted/30">
          <div className="text-center">
            <p className="text-lg font-medium text-muted-foreground">
              No Team Lead
            </p>
            <p className="text-sm text-muted-foreground">
              This team does not have a team lead agent configured.
            </p>
            <Link
              href={`/teams/${team.id}/agents`}
              className="mt-4 inline-block text-sm text-primary hover:underline"
            >
              Configure agents
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
