"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

interface InboxItem {
  id: string;
  type: string;
  title: string;
  content: string;
  teamId: string | null;
  teamName: string | null;
  aideId: string | null;
  aideName: string | null;
  agentId: string;
  briefingId: string | null;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

// Helper functions for displaying source info
function getSourceName(item: InboxItem): string {
  return item.teamName ?? item.aideName ?? "Unknown";
}

function getSourceLabel(item: InboxItem): string {
  return item.teamId ? "Team" : "Aide";
}

function getItemLink(item: InboxItem): string {
  if (item.type === "briefing" && item.briefingId) {
    if (item.teamId) {
      return `/teams/${item.teamId}/briefings/${item.briefingId}`;
    }
    return `/aides/${item.aideId}/briefings/${item.briefingId}`;
  }

  if (item.teamId) {
    return `/teams/${item.teamId}/agents/${item.agentId}/chat`;
  }
  return `/aides/${item.aideId}/agents/${item.agentId}/chat`;
}

interface InboxResponse {
  items: InboxItem[];
  unreadCount: number;
  total: number;
}

function InboxItemBadge({ type }: { type: string }) {
  const variants: Record<
    string,
    "default" | "secondary" | "destructive" | "outline"
  > = {
    briefing: "default",
    feedback: "secondary",
  };
  const labels: Record<string, string> = {
    briefing: "Briefing",
    feedback: "Feedback",
  };
  return (
    <Badge variant={variants[type] || "outline"}>
      {labels[type] || type}
    </Badge>
  );
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
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

export default function InboxPage() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch inbox items on mount and periodically
  useEffect(() => {
    async function fetchInbox() {
      try {
        const response = await fetch("/api/inbox");
        if (!response.ok) {
          throw new Error("Failed to fetch inbox");
        }
        const data: InboxResponse = await response.json();
        setItems(data.items);
        setUnreadCount(data.unreadCount);
        if (data.items.length > 0) {
          setSelectedItem((current) => current ?? data.items[0]);
        }
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    }

    fetchInbox();

    // Refresh every 30 seconds (same cadence as nav unread count)
    const interval = setInterval(fetchInbox, 30000);
    return () => clearInterval(interval);
  }, []);

  // Mark item as read when selected
  const handleSelectItem = async (item: InboxItem) => {
    setSelectedItem(item);
    if (!item.read) {
      try {
        const response = await fetch(`/api/inbox/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ read: true }),
        });
        if (response.ok) {
          setItems((prev) =>
            prev.map((i) => (i.id === item.id ? { ...i, read: true } : i))
          );
          setUnreadCount((prev) => Math.max(0, prev - 1));
        }
      } catch (err) {
        console.error("Failed to mark as read:", err);
      }
    }
  };

  // Toggle read status
  const handleToggleRead = async (item: InboxItem) => {
    try {
      const response = await fetch(`/api/inbox/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read: !item.read }),
      });
      if (response.ok) {
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, read: !item.read } : i))
        );
        setUnreadCount((prev) => (item.read ? prev + 1 : Math.max(0, prev - 1)));
        if (selectedItem?.id === item.id) {
          setSelectedItem({ ...item, read: !item.read });
        }
      }
    } catch (err) {
      console.error("Failed to toggle read status:", err);
    }
  };

  // Delete item
  const handleDelete = async (itemId: string) => {
    try {
      const response = await fetch(`/api/inbox/${itemId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        const deletedItem = items.find((i) => i.id === itemId);
        setItems((prev) => prev.filter((i) => i.id !== itemId));
        if (!deletedItem?.read) {
          setUnreadCount((prev) => Math.max(0, prev - 1));
        }
        if (selectedItem?.id === itemId) {
          const remaining = items.filter((i) => i.id !== itemId);
          setSelectedItem(remaining.length > 0 ? remaining[0] : null);
        }
      }
    } catch (err) {
      console.error("Failed to delete item:", err);
    }
  };

  // Mark all as read
  const handleMarkAllRead = async () => {
    try {
      const response = await fetch("/api/inbox/mark-all-read", {
        method: "POST",
      });
      if (response.ok) {
        setItems((prev) => prev.map((i) => ({ ...i, read: true })));
        setUnreadCount(0);
        if (selectedItem) {
          setSelectedItem({ ...selectedItem, read: true });
        }
      }
    } catch (err) {
      console.error("Failed to mark all as read:", err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[400px]">
        <div className="text-muted-foreground">Loading inbox...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[400px]">
        <div className="text-destructive">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Inbox</h1>
          <p className="text-muted-foreground">
            {unreadCount > 0
              ? `${unreadCount} unread message${unreadCount !== 1 ? "s" : ""}`
              : "All caught up!"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleMarkAllRead}
            disabled={unreadCount === 0}
          >
            Mark All Read
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <p className="text-lg font-medium">Your inbox is empty</p>
              <p className="text-sm mt-2">
                Your agents will send briefings and feedback here.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Item List */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>Messages</CardTitle>
              <CardDescription>
                Briefings and feedback from your teams
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[500px]">
                <div className="divide-y">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => handleSelectItem(item)}
                      className={`cursor-pointer p-4 transition-colors hover:bg-accent ${
                        !item.read ? "bg-accent/50" : ""
                      } ${selectedItem?.id === item.id ? "bg-accent" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <InboxItemBadge type={item.type} />
                            {!item.read && (
                              <div className="h-2 w-2 rounded-full bg-primary" />
                            )}
                          </div>
                          <h3 className="mt-1 font-medium truncate">
                            {item.title}
                          </h3>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {getSourceName(item)} - {formatTimeAgo(item.createdAt)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Item Detail */}
          <Card className="lg:col-span-2">
            {selectedItem ? (
              <>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <InboxItemBadge type={selectedItem.type} />
                        <span className="text-sm text-muted-foreground">
                          {formatTimeAgo(selectedItem.createdAt)}
                        </span>
                      </div>
                      <CardTitle className="mt-2">{selectedItem.title}</CardTitle>
                      <CardDescription>From {getSourceName(selectedItem)}</CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleToggleRead(selectedItem)}
                      >
                        {selectedItem.read ? "Mark Unread" : "Mark Read"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(selectedItem.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    {selectedItem.content.split("\n").map((paragraph, index) => (
                      <p key={index}>{paragraph}</p>
                    ))}
                  </div>
                  <Separator className="my-6" />
                  <div className="text-sm text-muted-foreground">
                    <p>
                      <span className="font-medium">{getSourceLabel(selectedItem)}:</span>{" "}
                      {getSourceName(selectedItem)}
                    </p>
                    <p>
                      <span className="font-medium">Type:</span>{" "}
                      {selectedItem.type}
                    </p>
                    <p>
                      <span className="font-medium">Received:</span>{" "}
                      {new Date(selectedItem.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <Separator className="my-6" />
                  <div className="flex justify-center">
                    <Button asChild>
                      <Link href={getItemLink(selectedItem)}>
                        {selectedItem.type === "briefing" ? "View Briefing" : "View Conversation"}
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </>
            ) : (
              <CardContent className="py-12">
                <div className="text-center text-muted-foreground">
                  Select a message to view its content
                </div>
              </CardContent>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
