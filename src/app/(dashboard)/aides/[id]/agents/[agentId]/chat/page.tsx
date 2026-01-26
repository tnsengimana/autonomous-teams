import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { getAideById } from "@/lib/db/queries/aides";
import { getAgentById } from "@/lib/db/queries/agents";
import { AgentChatView } from "@/components/agents";

export default async function AideAgentChatPage({
  params,
}: {
  params: Promise<{ id: string; agentId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const { id, agentId } = await params;

  const aide = await getAideById(id);
  if (!aide || aide.userId !== session.user.id) notFound();

  const agent = await getAgentById(agentId);
  if (!agent || agent.aideId !== id) notFound();

  return (
    <AgentChatView
      owner={{ type: "aide", id: aide.id, name: aide.name }}
      agent={agent}
    />
  );
}
