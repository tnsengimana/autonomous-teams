import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth/config";
import { getEntityById } from "@/lib/db/queries/entities";
import { Chat } from "@/components/chat";

function EntityChatView({
  entity,
}: {
  entity: { id: string; name: string };
}) {
  return (
    <div className="flex h-[calc(100vh-12rem)] flex-col space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href={`/entities/${entity.id}`}
            className="text-sm text-muted-foreground hover:underline"
          >
            Back to Entity
          </Link>
          <h1 className="mt-2 text-2xl font-bold">Chat with {entity.name}</h1>
        </div>
      </div>

      <Chat
        entityId={entity.id}
        entityName={entity.name}
        title="Conversation"
        description="Chat with your entity"
      />
    </div>
  );
}

export default async function EntityChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const { id } = await params;

  const entity = await getEntityById(id);
  if (!entity || entity.userId !== session.user.id) notFound();

  return (
    <EntityChatView
      entity={{
        id: entity.id,
        name: entity.name,
      }}
    />
  );
}
