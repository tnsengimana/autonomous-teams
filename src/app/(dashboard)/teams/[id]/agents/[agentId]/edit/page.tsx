import { AgentEditForm } from "@/components/agents";

export default async function EditAgentPage({
  params,
}: {
  params: Promise<{ id: string; agentId: string }>;
}) {
  const { id, agentId } = await params;

  return <AgentEditForm ownerType="team" ownerId={id} agentId={agentId} />;
}
