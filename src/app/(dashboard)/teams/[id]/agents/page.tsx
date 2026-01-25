import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { auth } from "@/lib/auth/config";
import { getTeamById } from "@/lib/db/queries/teams";
import { getAgentsByTeamId } from "@/lib/db/queries/agents";

export default async function TeamAgentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const { id } = await params;
  const team = await getTeamById(id);

  if (!team || team.userId !== session.user.id) {
    notFound();
  }

  const agents = await getAgentsByTeamId(id);
  const leadAgent = agents.find((a) => !a.parentAgentId);
  const workerAgents = agents.filter((a) => a.parentAgentId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href={`/teams/${team.id}`}
            className="text-sm text-muted-foreground hover:underline"
          >
            Back to {team.name}
          </Link>
          <h1 className="mt-2 text-3xl font-bold">Agents</h1>
          <p className="text-muted-foreground">
            Manage agents in {team.name}
          </p>
        </div>
        <Link href={`/teams/${team.id}/agents/new`}>
          <Button>Add Worker Agent</Button>
        </Link>
      </div>

      {/* Team Lead */}
      {leadAgent && (
        <Card>
          <CardHeader>
            <CardTitle>Team Lead</CardTitle>
            <CardDescription>
              The team lead runs continuously and coordinates worker agents
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href={`/teams/${team.id}/agents/${leadAgent.id}`}>
              <div className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-accent">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{leadAgent.name}</span>
                    <Badge variant="outline" className="text-xs">
                      lead
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {leadAgent.role}
                  </p>
                </div>
                <Badge
                  variant={
                    leadAgent.status === "running" ? "default" : "secondary"
                  }
                >
                  {leadAgent.status}
                </Badge>
              </div>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Worker Agents */}
      <Card>
        <CardHeader>
          <CardTitle>Worker Agents</CardTitle>
          <CardDescription>
            Workers spawn on-demand to handle specific tasks
          </CardDescription>
        </CardHeader>
        <CardContent>
          {workerAgents.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <p>No worker agents yet.</p>
              <Link href={`/teams/${team.id}/agents/new`}>
                <Button variant="link" className="mt-2">
                  Add your first worker agent
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {workerAgents.map((agent) => (
                <Link
                  key={agent.id}
                  href={`/teams/${team.id}/agents/${agent.id}`}
                >
                  <div className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-accent">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{agent.name}</span>
                        <Badge variant="outline" className="text-xs">
                          worker
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {agent.role}
                      </p>
                    </div>
                    <Badge
                      variant={
                        agent.status === "running" ? "default" : "secondary"
                      }
                    >
                      {agent.status}
                    </Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
