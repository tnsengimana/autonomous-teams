import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth/config";
import { getEntityById } from "@/lib/db/queries/entities";
import { getAgentById } from "@/lib/db/queries/agents";
import { Chat } from "@/components/chat";
import { buildAgentPath, type EntityContext } from "@/lib/entities/utils";

function AgentChatView({
  entity,
  agent,
}: {
  entity: EntityContext;
  agent: { id: string; name: string };
}) {
  return (
    <div className="flex h-[calc(100vh-12rem)] flex-col space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href={buildAgentPath(entity, agent.id)}
            className="text-sm text-muted-foreground hover:underline"
          >
            Back to Agent
          </Link>
          <h1 className="mt-2 text-2xl font-bold">Chat with {agent.name}</h1>
        </div>
      </div>

      <Chat
        entityId={entity.id}
        agentId={agent.id}
        agentName={agent.name}
        title="Direct Chat"
        description="Foreground conversation with the agent"
        mode="foreground"
      />
    </div>
  );
}

export default async function AgentChatPage({
  params,
}: {
  params: Promise<{ id: string; agentId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const { id, agentId } = await params;

  const entity = await getEntityById(id);
  if (!entity || entity.userId !== session.user.id) notFound();

  const agent = await getAgentById(agentId);
  if (!agent || agent.entityId !== id) notFound();

  return (
    <AgentChatView
      entity={{
        type: entity.type as "team" | "aide",
        id: entity.id,
        name: entity.name,
      }}
      agent={agent}
    />
  );
}
