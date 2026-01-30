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
import { getEntityWithAgents } from "@/lib/db/queries/entities";
import { getRecentBriefingsByEntity } from "@/lib/db/queries/briefings";
import { EntityActions } from "@/components/entity-actions";

export default async function EntityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const { id } = await params;
  const entity = await getEntityWithAgents(id);

  if (!entity || entity.userId !== session.user.id) {
    notFound();
  }

  const recentBriefings = await getRecentBriefingsByEntity(
    { userId: session.user.id, entityId: entity.id },
    5,
  );

  // Parse mission from purpose field
  const description = entity.purpose?.split("\n")[0] || "";
  const mission = entity.purpose?.includes("Mission:")
    ? entity.purpose.split("Mission:")[1]?.trim()
    : entity.purpose || "No mission set";

  // Find the lead (agent with no parent)
  const leadAgent = entity.agents.find((a) => a.parentAgentId === null);

  // Get subordinate agents
  const subordinateAgents = entity.agents.filter((a) => a.parentAgentId !== null);

  const entityTypeLabel = entity.type === "team" ? "Team" : "Aide";

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/entities"
          className="text-sm text-muted-foreground hover:underline"
        >
          Back to Entities
        </Link>
        <div className="mt-2 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold">{entity.name}</h1>
              <Badge variant="outline" className="capitalize">
                {entity.type}
              </Badge>
            </div>
            <p className="text-muted-foreground">{description}</p>
          </div>
          <EntityActions
            entityType={entity.type as "team" | "aide"}
            entityId={entity.id}
            entityName={entity.name}
            currentStatus={entity.status as "active" | "paused" | "archived"}
            backUrl="/entities"
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
              <span className="text-sm text-muted-foreground">Type</span>
              <Badge variant="outline" className="capitalize">{entity.type}</Badge>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Agents</span>
              <span className="text-sm font-medium">{entity.agents.length}</span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <Badge variant="secondary">{entity.status}</Badge>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Created</span>
              <span className="text-sm">
                {new Date(entity.createdAt).toLocaleDateString()}
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
                {entity.type === "team"
                  ? "The lead agent runs continuously and coordinates subordinate agents. Subordinates are spawned on-demand to handle specific tasks."
                  : "Your personal aide agent that handles tasks for you."}
              </CardDescription>
            </div>
            {entity.type === "team" && (
              <Link href={`/entities/${entity.id}/agents/new`}>
                <Button variant="outline" size="sm">
                  Add Subordinate
                </Button>
              </Link>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {leadAgent && (
            <Link
              href={`/entities/${entity.id}/agents/${leadAgent.id}`}
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
            <div className="mt-4 space-y-4">
              {subordinateAgents.map((agent) => (
                <Link
                  key={agent.id}
                  href={`/entities/${entity.id}/agents/${agent.id}`}
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
          <CardDescription>Recent briefings from this {entityTypeLabel.toLowerCase()}.</CardDescription>
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
                  href={`/entities/${entity.id}/briefings/${briefing.id}`}
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
