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

export default async function EntitiesPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const entities = await getEntitiesByUserId(session.user.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Entities</h1>
          <p className="text-muted-foreground">
            Manage your autonomous AI entities
          </p>
        </div>
        <Link href="/entities/new">
          <Button>Create Entity</Button>
        </Link>
      </div>

      {entities.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <h3 className="text-lg font-semibold">No entities yet</h3>
            <p className="mt-2 text-center text-muted-foreground">
              Create your first autonomous entity to get started.
            </p>
            <Link href="/entities/new" className="mt-4">
              <Button>Create Your First Entity</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {entities.map((entity) => (
            <Link key={entity.id} href={`/entities/${entity.id}`}>
              <Card className="h-full transition-colors hover:bg-accent/50">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-lg">{entity.name}</CardTitle>
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
                    <div className="text-muted-foreground">
                      Created{" "}
                      {new Date(entity.createdAt).toLocaleDateString()}
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
