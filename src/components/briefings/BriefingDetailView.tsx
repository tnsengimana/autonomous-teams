import Link from "next/link";
import ReactMarkdown from "react-markdown";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { BriefingOwnerContext, Briefing } from "./types";
import { buildOwnerPath, getOwnerLabel } from "./utils";

interface BriefingDetailViewProps {
  owner: BriefingOwnerContext;
  briefing: Briefing;
}

export function BriefingDetailView({
  owner,
  briefing,
}: BriefingDetailViewProps) {
  return (
    <div className="space-y-6">
      <div>
        <Link
          href={buildOwnerPath(owner)}
          className="text-sm text-muted-foreground hover:underline"
        >
          Back to {getOwnerLabel(owner.type).toLowerCase()}
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
