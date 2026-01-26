import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { getTeamById } from "@/lib/db/queries/teams";
import { getAgentById } from "@/lib/db/queries/agents";
import { AgentInspectView } from "@/components/agents";

export default async function AgentInspectPage({
  params,
}: {
  params: Promise<{ id: string; agentId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const { id, agentId } = await params;

  const team = await getTeamById(id);
  if (!team || team.userId !== session.user.id) notFound();

  const agent = await getAgentById(agentId);
  if (!agent || agent.teamId !== id) notFound();

  return (
    <AgentInspectView
      owner={{ type: "team", id: team.id, name: team.name }}
      agent={agent}
    />
  );
}
