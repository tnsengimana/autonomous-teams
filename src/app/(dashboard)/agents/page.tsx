import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { auth } from "@/lib/auth/config";
import { getAgentsByUserId } from "@/lib/db/queries/agents";

export default async function AgentsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const agents = await getAgentsByUserId(session.user.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Agents</h1>
          <p className="text-muted-foreground">
            Manage your autonomous AI agents
          </p>
        </div>
        <Link href="/agents/new">
          <Button>Create Agent</Button>
        </Link>
      </div>

      {agents.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <h3 className="text-lg font-semibold">No agents yet</h3>
            <p className="mt-2 text-center text-muted-foreground">
              Create your first autonomous agent to get started.
            </p>
            <Link href="/agents/new" className="mt-4">
              <Button>Create Your First Agent</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <Link key={agent.id} href={`/agents/${agent.id}`}>
              <Card className="h-full transition-colors hover:bg-accent/50">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-lg">{agent.name}</CardTitle>
                    <Badge
                      variant={agent.isActive ? "secondary" : "outline"}
                    >
                      {agent.isActive ? "Active" : "Paused"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="font-medium">Mission:</span>
                      <p className="text-muted-foreground line-clamp-2">
                        {agent.purpose?.includes("Mission:")
                          ? agent.purpose.split("Mission:")[1]?.trim()
                          : agent.purpose || "No mission set"}
                      </p>
                    </div>
                    <div className="text-muted-foreground">
                      Created {new Date(agent.createdAt).toLocaleDateString()}
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
