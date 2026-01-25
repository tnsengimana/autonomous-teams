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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link
            href="/teams"
            className="text-sm text-muted-foreground hover:underline"
          >
            Back to Teams
          </Link>
          <h1 className="mt-2 text-3xl font-bold">{team.name}</h1>
          <p className="text-muted-foreground">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={team.status === "active" ? "default" : "secondary"}>
            {team.status}
          </Badge>
          <Link href={`/teams/${team.id}/chat`}>
            <Button>Chat with Team</Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Mission */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Mission</CardTitle>
          </CardHeader>
          <CardContent>
            <p>{mission}</p>
          </CardContent>
        </Card>

        {/* Quick Stats */}
        <Card>
          <CardHeader>
            <CardTitle>Stats</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-2xl font-bold">{team.agents.length}</div>
              <div className="text-sm text-muted-foreground">Agents</div>
            </div>
            <Separator />
            <div>
              <div className="text-sm font-medium">Created</div>
              <div className="text-sm text-muted-foreground">
                {new Date(team.createdAt).toLocaleDateString()}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Agents */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Agents</CardTitle>
              <CardDescription>
                Team members and their current status
              </CardDescription>
            </div>
            <Link href={`/teams/${team.id}/agents`}>
              <Button variant="outline" size="sm">
                Manage Agents
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {team.agents.length === 0 ? (
            <p className="text-muted-foreground">No agents yet.</p>
          ) : (
            <div className="space-y-4">
              {team.agents.map((agent) => (
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
                          {agent.parentAgentId ? "subordinate" : "lead"}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {agent.role}
                      </div>
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

      {/* Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
          <CardDescription>Manage your team</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline">Edit Team</Button>
            <Button variant="outline">Add Subordinate</Button>
            {team.status === "active" ? (
              <Button variant="outline">Pause Team</Button>
            ) : (
              <Button variant="outline">Resume Team</Button>
            )}
            <Button variant="destructive">Delete Team</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
