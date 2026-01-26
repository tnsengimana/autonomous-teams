import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { getAideById } from "@/lib/db/queries/aides";
import { getBriefingById } from "@/lib/db/queries/briefings";
import { BriefingDetailView } from "@/components/briefings";

export default async function AideBriefingPage({
  params,
}: {
  params: Promise<{ id: string; briefingId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const { id, briefingId } = await params;

  const aide = await getAideById(id);
  if (!aide || aide.userId !== session.user.id) notFound();

  const briefing = await getBriefingById(briefingId);
  if (!briefing || briefing.userId !== session.user.id || briefing.aideId !== id) {
    notFound();
  }

  return (
    <BriefingDetailView
      owner={{ type: "aide", id: aide.id, name: aide.name }}
      briefing={briefing}
    />
  );
}
