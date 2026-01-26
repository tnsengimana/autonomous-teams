import { AgentNewForm } from "@/components/agents";

export default async function NewAgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <AgentNewForm ownerType="team" ownerId={id} />;
}
