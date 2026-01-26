import Link from "next/link";
import { Chat } from "@/components/chat";
import type { AgentOwnerContext, Agent } from "./types";
import { buildAgentPath } from "./utils";

interface AgentChatViewProps {
  owner: AgentOwnerContext;
  agent: Agent;
}

export function AgentChatView({ owner, agent }: AgentChatViewProps) {
  return (
    <div className="flex h-[calc(100vh-12rem)] flex-col space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href={buildAgentPath(owner, agent.id)}
            className="text-sm text-muted-foreground hover:underline"
          >
            Back to Agent
          </Link>
          <h1 className="mt-2 text-2xl font-bold">Chat with {agent.name}</h1>
        </div>
      </div>

      <Chat
        {...(owner.type === "team" ? { teamId: owner.id } : { aideId: owner.id })}
        agentId={agent.id}
        agentName={agent.name}
        title="Direct Chat"
        description="Foreground conversation with the agent"
        mode="foreground"
      />
    </div>
  );
}
