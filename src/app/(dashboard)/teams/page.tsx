import Link from "next/link";
import { redirect } from "next/navigation";
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
import { getTeamsByUserId } from "@/lib/db/queries/teams";
import { getAgentsByTeamId } from "@/lib/db/queries/agents";

export default async function TeamsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const teams = await getTeamsByUserId(session.user.id);

  // Fetch agent counts for each team
  const teamsWithAgentCount = await Promise.all(
    teams.map(async (team) => {
      const agents = await getAgentsByTeamId(team.id);
      return {
        ...team,
        agentCount: agents.length,
      };
    })
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Teams</h1>
          <p className="text-muted-foreground">
            Manage your autonomous AI teams
          </p>
        </div>
        <Link href="/teams/new">
          <Button>Create Team</Button>
        </Link>
      </div>

      {teamsWithAgentCount.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <h3 className="text-lg font-semibold">No teams yet</h3>
            <p className="mt-2 text-center text-muted-foreground">
              Create your first autonomous team to get started.
            </p>
            <Link href="/teams/new" className="mt-4">
              <Button>Create Your First Team</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {teamsWithAgentCount.map((team) => (
            <Link key={team.id} href={`/teams/${team.id}`}>
              <Card className="h-full transition-colors hover:bg-accent/50">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-lg">{team.name}</CardTitle>
                    <Badge
                      variant={
                        team.status === "active" ? "default" : "secondary"
                      }
                    >
                      {team.status}
                    </Badge>
                  </div>
                  <CardDescription>
                    {team.purpose?.split("\n")[0] || "No description"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="font-medium">Mission:</span>
                      <p className="text-muted-foreground line-clamp-2">
                        {team.purpose?.includes("Mission:")
                          ? team.purpose.split("Mission:")[1]?.trim()
                          : team.purpose || "No mission set"}
                      </p>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>
                        {team.agentCount} agent{team.agentCount !== 1 && "s"}
                      </span>
                      <span>
                        Created{" "}
                        {new Date(team.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
