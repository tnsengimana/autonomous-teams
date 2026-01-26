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
import { Separator } from "@/components/ui/separator";
import { auth } from "@/lib/auth/config";
import { getTeamWithAgents } from "@/lib/db/queries/teams";
import { EntityActions } from "@/components/entity-actions";

export default async function TeamDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const { id } = await params;
  const team = await getTeamWithAgents(id);

  if (!team || team.userId !== session.user.id) {
    notFound();
  }

  // Parse mission from purpose field
  const description = team.purpose?.split("\n")[0] || "";
  const mission = team.purpose?.includes("Mission:")
    ? team.purpose.split("Mission:")[1]?.trim()
    : team.purpose || "No mission set";

  // Find the team lead (agent with no parent)
  const teamLead = team.agents.find((a) => a.parentAgentId === null);

  // Get subordinate agents
  const subordinateAgents = team.agents.filter((a) => a.parentAgentId !== null);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/teams"
          className="text-sm text-muted-foreground hover:underline"
        >
          Back to Teams
        </Link>
        <div className="mt-2 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">{team.name}</h1>
            <p className="text-muted-foreground">{description}</p>
          </div>
          <EntityActions
            entityType="team"
            entityId={team.id}
            entityName={team.name}
            currentStatus={team.status as "active" | "paused" | "archived"}
            backUrl="/teams"
          />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Mission */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Mission</CardTitle>
          </CardHeader>
          <CardContent>
            <p>{mission}</p>
          </CardContent>
        </Card>

        {/* Stats */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Stats</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Agents</span>
              <span className="text-sm font-medium">{team.agents.length}</span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <Badge variant="secondary">{team.status}</Badge>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Created</span>
              <span className="text-sm">
                {new Date(team.createdAt).toLocaleDateString()}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Lead Agent */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Lead Agent</CardTitle>
              <CardDescription>
                The lead agent runs continuously and coordinates subordinate
                agents
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!teamLead ? (
            <p className="text-muted-foreground">No lead agent yet.</p>
          ) : (
            <Link
              href={`/teams/${team.id}/agents/${teamLead.id}`}
              className="block"
            >
              <div className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-accent">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{teamLead.name}</span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {teamLead.role}
                  </div>
                </div>
                <Badge
                  variant={
                    teamLead.status === "running" ? "default" : "secondary"
                  }
                >
                  {teamLead.status}
                </Badge>
              </div>
            </Link>
          )}
        </CardContent>
      </Card>

      {/* Subordinates */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Subordinates</CardTitle>
              <CardDescription>
                Subordinates spawn on-demand to handle specific tasks
              </CardDescription>
            </div>
            <Link href={`/teams/${team.id}/agents/new`}>
              <Button variant="outline" size="sm">
                Add Subordinate
              </Button>
            </Link>
          </div>
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
                  className="block"
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
