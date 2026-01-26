import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { getTeamById } from "@/lib/db/queries/teams";
import { getAgentById } from "@/lib/db/queries/agents";
import { Chat } from "@/components/chat";

export default async function AgentChatPage({
  params,
}: {
  params: Promise<{ id: string; agentId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const { id, agentId } = await params;

  const team = await getTeamById(id);
  if (!team || team.userId !== session.user.id) {
    notFound();
  }

  const agent = await getAgentById(agentId);
  if (!agent || agent.teamId !== id) {
    notFound();
  }

  return (
    <div className="flex h-[calc(100vh-12rem)] flex-col space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href={`/teams/${team.id}/agents/${agent.id}`}
            className="text-sm text-muted-foreground hover:underline"
          >
            Back to Agent
          </Link>
          <h1 className="mt-2 text-2xl font-bold">Chat with {agent.name}</h1>
        </div>
      </div>

      <Chat
        teamId={team.id}
        agentId={agent.id}
        agentName={agent.name}
        title="Direct Chat"
        description="Foreground conversation with the agent"
        mode="foreground"
      />
    </div>
  );
}
