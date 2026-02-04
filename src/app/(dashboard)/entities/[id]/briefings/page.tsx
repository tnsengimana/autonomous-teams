import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { auth } from "@/lib/auth/config";
import { getEntityById } from "@/lib/db/queries/entities";
import { getRecentBriefingsByEntity } from "@/lib/db/queries/briefings";

export default async function BriefingsPage({
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

  const briefings = await getRecentBriefingsByEntity(
    { userId: session.user.id, entityId: entity.id },
    50,
  );

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/entities/${entity.id}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          Back to {entity.name}
        </Link>
        <h1 className="mt-2 text-3xl font-bold">Briefings</h1>
        <p className="text-muted-foreground">
          Briefings from {entity.name}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Briefings</CardTitle>
          <CardDescription>
            Insights and updates from this entity.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {briefings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No briefings yet.</p>
          ) : (
            <div className="space-y-4">
              {briefings.map((briefing) => (
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
