import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { getEntityById } from "@/lib/db/queries/entities";
import { KnowledgeGraphView } from "./knowledge-graph-view";

export default async function KnowledgeGraphPage({
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

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/entities/${entity.id}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          Back to {entity.name}
        </Link>
        <h1 className="mt-2 text-3xl font-bold">Knowledge Graph</h1>
        <p className="text-muted-foreground">
          Interactive visualization of {entity.name}&apos;s knowledge
        </p>
      </div>
      <div className="h-[calc(100vh-14rem)]">
        <KnowledgeGraphView entityId={entity.id} />
      </div>
    </div>
  );
}
