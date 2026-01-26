import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { MemoryType } from "@/lib/types";
import type { Memory } from "./types";
import { formatRelativeDate, getMemoryTypeBadgeVariant } from "./utils";

interface MemoriesListProps {
  items: Memory[];
}

export function MemoriesList({ items }: MemoriesListProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Memories</CardTitle>
        <CardDescription>
          User preferences and insights learned from conversations
        </CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="flex h-[300px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
            No memories yet.
          </div>
        ) : (
          <ScrollArea className="h-[300px]">
            <div className="space-y-3 pr-4">
              {items.map((memory) => (
                <div
                  key={memory.id}
                  className="rounded-lg border bg-card p-3 shadow-sm transition-all hover:bg-accent/50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="flex-1 text-sm">{memory.content}</p>
                    <Badge
                      variant={getMemoryTypeBadgeVariant(
                        memory.type as MemoryType
                      )}
                      className="shrink-0 text-[10px]"
                    >
                      {memory.type}
                    </Badge>
                  </div>
                  <div className="mt-2 flex items-center justify-end">
                    <p className="text-xs text-muted-foreground">
                      {formatRelativeDate(memory.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
