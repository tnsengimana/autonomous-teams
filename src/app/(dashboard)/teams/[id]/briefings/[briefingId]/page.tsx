import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { getTeamById } from "@/lib/db/queries/teams";
import { getBriefingById } from "@/lib/db/queries/briefings";
import { BriefingDetailView } from "@/components/briefings";

export default async function TeamBriefingPage({
  params,
}: {
  params: Promise<{ id: string; briefingId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const { id, briefingId } = await params;

  const team = await getTeamById(id);
  if (!team || team.userId !== session.user.id) notFound();

  const briefing = await getBriefingById(briefingId);
  if (!briefing || briefing.userId !== session.user.id || briefing.teamId !== id) {
    notFound();
  }

  return (
    <BriefingDetailView
      owner={{ type: "team", id: team.id, name: team.name }}
      briefing={briefing}
    />
  );
}
