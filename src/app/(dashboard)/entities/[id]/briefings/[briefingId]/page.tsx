import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { auth } from "@/lib/auth/config";
import { getEntityById } from "@/lib/db/queries/entities";
import { getBriefingById } from "@/lib/db/queries/briefings";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Briefing, Entity } from "@/lib/types";

function BriefingDetailView({
  entity,
  briefing,
}: {
  entity: Entity;
  briefing: Briefing;
}) {
  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/entities/${entity.id}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          Back to {entity.name}
        </Link>
        <h1 className="text-3xl font-bold mt-2">{briefing.title}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
          <CardDescription>{briefing.summary}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            {new Date(briefing.createdAt).toLocaleString()}
          </div>
          <Separator className="mb-6" />
          <div className="prose prose-sm max-w-none dark:prose-invert">
            <ReactMarkdown>{briefing.content}</ReactMarkdown>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default async function EntityBriefingPage({
  params,
}: {
  params: Promise<{ id: string; briefingId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const { id, briefingId } = await params;

  const entity = await getEntityById(id);
  if (!entity || entity.userId !== session.user.id) notFound();

  const briefing = await getBriefingById(briefingId);
  if (
    !briefing ||
    briefing.userId !== session.user.id ||
    briefing.entityId !== id
  ) {
    notFound();
  }

  return <BriefingDetailView entity={entity} briefing={briefing} />;
}
