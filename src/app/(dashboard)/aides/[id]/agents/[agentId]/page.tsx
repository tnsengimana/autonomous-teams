import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { getAideById } from "@/lib/db/queries/aides";
import { getAgentById } from "@/lib/db/queries/agents";
import { getRecentMemories } from "@/lib/db/queries/memories";
import { getRecentKnowledgeItems } from "@/lib/db/queries/knowledge-items";
import { AgentDetailView } from "@/components/agents";

export default async function AideAgentDetailPage({
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

  const [memories, knowledgeItems] = await Promise.all([
    getRecentMemories(agentId, 20),
    getRecentKnowledgeItems(agentId, 20),
  ]);

  return (
    <AgentDetailView
      owner={{ type: "aide", id: aide.id, name: aide.name }}
      agent={agent}
      memories={memories}
      knowledgeItems={knowledgeItems}
    />
  );
}
