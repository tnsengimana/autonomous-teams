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

  // Parse mission from purpose field
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
          <Button variant="outline">Interactions</Button>
        </Link>
        <Link href={`/entities/${entity.id}/briefings`}>
          <Button variant="outline">Briefings</Button>
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
    </div>
  );
}
