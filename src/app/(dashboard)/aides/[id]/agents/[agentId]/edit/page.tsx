import { AgentEditForm } from "@/components/agents";

export default async function EditAideAgentPage({
  params,
}: {
  params: Promise<{ id: string; agentId: string }>;
}) {
  const { id, agentId } = await params;

  return <AgentEditForm ownerType="aide" ownerId={id} agentId={agentId} />;
}
