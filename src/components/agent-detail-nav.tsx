"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

function getNavItems(agentId: string) {
  return [
    { href: `/agents/${agentId}`, label: "Details", exactMatch: true },
    { href: `/agents/${agentId}/chat`, label: "Open Chat", exactMatch: false },
    {
      href: `/agents/${agentId}/worker-iterations`,
      label: "Worker Iterations",
      exactMatch: false,
    },
    {
      href: `/agents/${agentId}/knowledge-graph`,
      label: "Knowledge Graph",
      exactMatch: false,
    },
    {
      href: `/agents/${agentId}/graph-node-types`,
      label: "Graph Node Types",
      exactMatch: false,
    },
    {
      href: `/agents/${agentId}/graph-edge-types`,
      label: "Graph Edge Types",
      exactMatch: false,
    },
  ];
}

export function AgentDetailNav({ agentId }: { agentId: string }) {
  const pathname = usePathname();
  const navItems = getNavItems(agentId);

  return (
    <nav className="flex flex-col gap-1">
      {navItems.map((item) => {
        const isActive = item.exactMatch
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link key={item.href} href={item.href}>
            <Button
              variant={isActive ? "secondary" : "ghost"}
              className={cn("w-full justify-start", isActive && "bg-secondary")}
            >
              {item.label}
            </Button>
          </Link>
        );
      })}
    </nav>
  );
}
