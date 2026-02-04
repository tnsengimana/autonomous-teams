import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { getEntityById } from "@/lib/db/queries/entities";
import { EntityChatView } from "./chat-view";

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
        systemPrompt: entity.systemPrompt,
      }}
    />
  );
}
