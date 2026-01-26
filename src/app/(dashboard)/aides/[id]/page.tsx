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
import { getAideWithAgents } from "@/lib/db/queries/aides";
import { getRecentBriefingsByOwner } from "@/lib/db/queries/briefings";
import { EntityActions } from "@/components/entity-actions";

export default async function AideDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const { id } = await params;
  const aide = await getAideWithAgents(id);

  if (!aide || aide.userId !== session.user.id) {
    notFound();
  }

  const recentBriefings = await getRecentBriefingsByOwner(
    { userId: session.user.id, aideId: aide.id },
    5,
  );

  // Parse purpose
  const purpose = aide.purpose || "No purpose set";

  // Find the lead agent (agent with no parent)
  const leadAgent = aide.agents.find((a) => a.parentAgentId === null);

  // Get subordinate agents
  const subordinateAgents = aide.agents.filter((a) => a.parentAgentId !== null);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/aides"
          className="text-sm text-muted-foreground hover:underline"
        >
          Back to Aides
        </Link>
        <div className="mt-2 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">{aide.name}</h1>
            <p className="text-muted-foreground">Personal AI assistant</p>
          </div>
          <EntityActions
            entityType="aide"
            entityId={aide.id}
            entityName={aide.name}
            currentStatus={aide.status as "active" | "paused" | "archived"}
            backUrl="/aides"
          />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Purpose */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Purpose</CardTitle>
          </CardHeader>
          <CardContent>
            <p>{purpose}</p>
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
              <span className="text-sm font-medium">{aide.agents.length}</span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <Badge variant="secondary">{aide.status}</Badge>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Created</span>
              <span className="text-sm">
                {new Date(aide.createdAt).toLocaleDateString()}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Agents */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="mb-2">Agents</CardTitle>
              <CardDescription>
                The lead agent runs continuously and coordinates subordinate
                agents. Subordinates are spawn on-demand to handle specific
                tasks.
              </CardDescription>
            </div>
            <Link href={`/aides/${aide.id}/agents/new`}>
              <Button variant="outline" size="sm">
                Add Subordinate
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {leadAgent && (
            <Link
              href={`/aides/${aide.id}/agents/${leadAgent.id}`}
              className="block"
            >
              <div className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-accent">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{leadAgent.name}</span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {leadAgent.type}
                  </div>
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
          )}
          {subordinateAgents.length > 0 && (
            <div className="space-y-4">
              {subordinateAgents.map((agent) => (
                <Link
                  key={agent.id}
                  href={`/aides/${aide.id}/agents/${agent.id}`}
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
                        {agent.type}
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

      {/* Briefings */}
      <Card>
        <CardHeader>
          <CardTitle className="mb-2">Briefings</CardTitle>
          <CardDescription>Recent briefings from this aide.</CardDescription>
        </CardHeader>
        <CardContent>
          {recentBriefings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No briefings yet.
            </p>
          ) : (
            <div className="space-y-4">
              {recentBriefings.map((briefing) => (
                <Link
                  key={briefing.id}
                  href={`/aides/${aide.id}/briefings/${briefing.id}`}
                  className="block"
                >
                  <div className="rounded-lg border p-4 transition-colors hover:bg-accent">
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-medium">{briefing.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(briefing.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {briefing.summary}
                    </p>
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
