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
  const subordinateAgents = agents.filter((a) => a.parentAgentId);

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
          <Button>Add Subordinate</Button>
        </Link>
      </div>

      {/* Team Lead */}
      {leadAgent && (
        <Card>
          <CardHeader>
            <CardTitle>Team Lead</CardTitle>
            <CardDescription>
              The team lead runs continuously and coordinates subordinate agents
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

      {/* Subordinates */}
      <Card>
        <CardHeader>
          <CardTitle>Subordinates</CardTitle>
          <CardDescription>
            Subordinates spawn on-demand to handle specific tasks
          </CardDescription>
        </CardHeader>
        <CardContent>
          {subordinateAgents.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <p>No subordinate agents yet.</p>
              <Link href={`/teams/${team.id}/agents/new`}>
                <Button variant="link" className="mt-2">
                  Add your first subordinate agent
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {subordinateAgents.map((agent) => (
                <Link
                  key={agent.id}
                  href={`/teams/${team.id}/agents/${agent.id}`}
                >
                  <div className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-accent">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{agent.name}</span>
                        <Badge variant="outline" className="text-xs">
                          subordinate
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
