import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { getAgentById } from "@/lib/db/queries/agents";
import { AgentDetailNav } from "@/components/agent-detail-nav";
import { AgentDetailTitle } from "@/components/agent-detail-title";
import {
  AgentHeaderActionsProvider,
  AgentHeaderActionsSlot,
} from "@/components/agent-header-actions";

export default async function AgentDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const { id } = await params;
  const agent = await getAgentById(id);

  if (!agent || agent.userId !== session.user.id) {
    notFound();
  }

  return (
    <AgentHeaderActionsProvider>
      <div className="flex gap-6">
        <aside className="w-56 flex-shrink-0 space-y-4">
          <Link
            href="/agents"
            className="text-sm text-muted-foreground hover:underline whitespace-nowrap"
          >
            Back to Agents
          </Link>
          <AgentDetailNav agentId={agent.id} />
        </aside>
        <div className="flex-1 min-w-0 space-y-6">
          <div className="flex items-center gap-4">
            <AgentDetailTitle agentId={agent.id} agentName={agent.name} />
            <div className="ml-auto flex items-center gap-2">
              <AgentHeaderActionsSlot />
            </div>
          </div>
          {children}
        </div>
      </div>
    </AgentHeaderActionsProvider>
  );
}
