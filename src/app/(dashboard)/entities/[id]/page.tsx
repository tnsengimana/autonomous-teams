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
import { getEntityById } from "@/lib/db/queries/entities";
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
  const entity = await getEntityById(id);

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
            <h1 className="text-3xl font-bold">{entity.name}</h1>
            <p className="text-muted-foreground">{description}</p>
          </div>
          <EntityActions
            entityType="team"
            entityId={entity.id}
            entityName={entity.name}
            currentStatus={entity.status as "active" | "paused" | "archived"}
            backUrl="/entities"
          />
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-4">
        <Link href={`/entities/${entity.id}/chat`}>
          <Button>Chat</Button>
        </Link>
        <Link href={`/entities/${entity.id}/interactions`}>
          <Button variant="outline">View Interactions</Button>
        </Link>
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

      {/* System Prompt */}
      <Card>
        <CardHeader>
          <CardTitle>System Prompt</CardTitle>
          <CardDescription>
            The system prompt that guides this entity&apos;s behavior.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-4 text-sm">
            {entity.systemPrompt}
          </pre>
        </CardContent>
      </Card>

      {/* Briefings */}
      <Card>
        <CardHeader>
          <CardTitle className="mb-2">Briefings</CardTitle>
          <CardDescription>Recent briefings from this entity.</CardDescription>
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
