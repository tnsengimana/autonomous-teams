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
import { ScrollArea } from "@/components/ui/scroll-area";
import { auth } from "@/lib/auth/config";
import { getTeamsByUserId } from "@/lib/db/queries/teams";
import { getRecentInboxItems, getUnreadCount } from "@/lib/db/queries/inboxItems";
import { db } from "@/lib/db/client";
import { agents, teams } from "@/lib/db/schema";
import { eq, count } from "drizzle-orm";

function InboxItemBadge({ type }: { type: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    briefing: "default",
    signal: "secondary",
    alert: "destructive",
    insight: "outline",
    question: "outline",
  };
  return <Badge variant={variants[type] || "outline"}>{type}</Badge>;
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? "s" : ""} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
  return date.toLocaleDateString();
}

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const userId = session.user.id;

  // Fetch real data
  const [userTeams, recentInbox, unreadInboxCount] = await Promise.all([
    getTeamsByUserId(userId),
    getRecentInboxItems(userId, 5),
    getUnreadCount(userId),
  ]);

  // Get agent counts for teams
  const teamsWithAgentCounts = await Promise.all(
    userTeams.map(async (team) => {
      const agentCountResult = await db
        .select({ count: count() })
        .from(agents)
        .where(eq(agents.teamId, team.id));
      return {
        ...team,
        agentCount: agentCountResult[0]?.count ?? 0,
      };
    })
  );

  // Get team names for inbox items
  const inboxWithTeamNames = await Promise.all(
    recentInbox.map(async (item) => {
      const teamResult = await db
        .select({ name: teams.name })
        .from(teams)
        .where(eq(teams.id, item.teamId))
        .limit(1);
      return {
        ...item,
        teamName: teamResult[0]?.name ?? "Unknown Team",
        read: item.readAt !== null,
      };
    })
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <Link href="/teams/new">
          <Button>Create Team</Button>
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Teams List */}
        <Card>
          <CardHeader>
            <CardTitle>Your Teams</CardTitle>
            <CardDescription>
              Active teams and their current status
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px]">
              <div className="space-y-4">
                {teamsWithAgentCounts.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">
                    <p>No teams yet.</p>
                    <Link href="/teams/new">
                      <Button variant="link">Create your first team</Button>
                    </Link>
                  </div>
                ) : (
                  teamsWithAgentCounts.map((team) => (
                    <Link
                      key={team.id}
                      href={`/teams/${team.id}`}
                      className="block"
                    >
                      <div className="rounded-lg border p-4 transition-colors hover:bg-accent">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-semibold">{team.name}</h3>
                            <p className="text-sm text-muted-foreground">
                              {team.purpose || "No description"}
                            </p>
                          </div>
                          <Badge
                            variant={
                              team.status === "active" ? "default" : "secondary"
                            }
                          >
                            {team.status}
                          </Badge>
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          {team.agentCount} agent{team.agentCount !== 1 && "s"}
                        </div>
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Inbox Preview */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  Inbox
                  {unreadInboxCount > 0 && (
                    <Badge variant="destructive" className="ml-2">
                      {unreadInboxCount} unread
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  Recent briefings, signals, and alerts
                </CardDescription>
              </div>
              <Link href="/inbox">
                <Button variant="outline" size="sm">
                  View All
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px]">
              <div className="space-y-4">
                {inboxWithTeamNames.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">
                    <p>No items in inbox.</p>
                    <p className="text-sm">
                      Your agents will send updates here.
                    </p>
                  </div>
                ) : (
                  inboxWithTeamNames.map((item) => (
                    <Link
                      key={item.id}
                      href="/inbox"
                      className="block"
                    >
                      <div
                        className={`rounded-lg border p-4 transition-colors hover:bg-accent ${
                          !item.read ? "bg-accent/50" : ""
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <InboxItemBadge type={item.type} />
                              <span className="text-xs text-muted-foreground">
                                {formatTimeAgo(item.createdAt)}
                              </span>
                            </div>
                            <h3 className="mt-1 font-medium">{item.title}</h3>
                            <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                              {item.content.substring(0, 100)}
                              {item.content.length > 100 ? "..." : ""}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              From {item.teamName}
                            </p>
                          </div>
                          {!item.read && (
                            <div className="h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                          )}
                        </div>
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
