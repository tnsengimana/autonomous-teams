import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { KnowledgeItemType } from "@/lib/types";
import type { KnowledgeItem } from "./types";
import { formatRelativeDate, getKnowledgeTypeBadgeVariant } from "./utils";

interface KnowledgeItemsListProps {
  items: KnowledgeItem[];
}

export function KnowledgeItemsList({ items }: KnowledgeItemsListProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Knowledge Base</CardTitle>
        <CardDescription>
          Professional knowledge and techniques extracted from work sessions
        </CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="flex h-[300px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
            No knowledge items yet.
          </div>
        ) : (
          <ScrollArea className="h-[300px]">
            <div className="space-y-3 pr-4">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border bg-card p-3 shadow-sm transition-all hover:bg-accent/50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="flex-1 text-sm">{item.content}</p>
                    <Badge
                      variant={getKnowledgeTypeBadgeVariant(
                        item.type as KnowledgeItemType
                      )}
                      className="shrink-0 text-[10px]"
                    >
                      {item.type}
                    </Badge>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      Confidence: {Math.round((item.confidence || 0) * 100)}%
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatRelativeDate(item.createdAt)}
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
