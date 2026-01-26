import { AgentNewForm } from "@/components/agents";

export default async function NewAideAgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <AgentNewForm ownerType="aide" ownerId={id} />;
}
