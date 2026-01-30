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
import { getEntitiesByUserId } from "@/lib/db/queries/entities";
import { getAgentsByEntityId } from "@/lib/db/queries/agents";

export default async function EntitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const { type } = await searchParams;
  const typeFilter = type === "team" || type === "aide" ? type : undefined;

  const entities = await getEntitiesByUserId(session.user.id, typeFilter);

  // Fetch agent counts for each entity
  const entitiesWithAgentCount = await Promise.all(
    entities.map(async (entity) => {
      const agents = await getAgentsByEntityId(entity.id);
      return {
        ...entity,
        agentCount: agents.length,
      };
    })
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Entities</h1>
          <p className="text-muted-foreground">
            Manage your autonomous AI teams and aides
          </p>
        </div>
        <Link href="/entities/new">
          <Button>Create Entity</Button>
        </Link>
      </div>

      {/* Type filter tabs */}
      <div className="flex gap-2">
        <Link href="/entities">
          <Button variant={!typeFilter ? "default" : "outline"} size="sm">
            All
          </Button>
        </Link>
        <Link href="/entities?type=team">
          <Button variant={typeFilter === "team" ? "default" : "outline"} size="sm">
            Teams
          </Button>
        </Link>
        <Link href="/entities?type=aide">
          <Button variant={typeFilter === "aide" ? "default" : "outline"} size="sm">
            Aides
          </Button>
        </Link>
      </div>

      {entitiesWithAgentCount.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <h3 className="text-lg font-semibold">No entities yet</h3>
            <p className="mt-2 text-center text-muted-foreground">
              Create your first autonomous team or aide to get started.
            </p>
            <Link href="/entities/new" className="mt-4">
              <Button>Create Your First Entity</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {entitiesWithAgentCount.map((entity) => (
            <Link key={entity.id} href={`/entities/${entity.id}`}>
              <Card className="h-full transition-colors hover:bg-accent/50">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-lg">{entity.name}</CardTitle>
                      <Badge variant="outline" className="capitalize">
                        {entity.type}
                      </Badge>
                    </div>
                    <Badge
                      variant={
                        entity.status === "active" ? "default" : "secondary"
                      }
                    >
                      {entity.status}
                    </Badge>
                  </div>
                  <CardDescription>
                    {entity.purpose?.split("\n")[0] || "No description"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="font-medium">Mission:</span>
                      <p className="text-muted-foreground line-clamp-2">
                        {entity.purpose?.includes("Mission:")
                          ? entity.purpose.split("Mission:")[1]?.trim()
                          : entity.purpose || "No mission set"}
                      </p>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>
                        {entity.agentCount} agent{entity.agentCount !== 1 && "s"}
                      </span>
                      <span>
                        Created{" "}
                        {new Date(entity.createdAt).toLocaleDateString()}
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
