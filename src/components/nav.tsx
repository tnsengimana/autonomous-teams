"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useUnreadInboxItemsCount } from "@/hooks/useUnreadInboxItemsCount";

const navItems = [
  { href: "/inbox", label: "Inbox" },
  { href: "/agents", label: "Agents" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  const pathname = usePathname();
  const unreadCount = useUnreadInboxItemsCount();

  return (
    <nav className="flex flex-col gap-1 p-4">
      {navItems.map((item) => {
        const isActive =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link key={item.href} href={item.href}>
            <Button
              variant={isActive ? "secondary" : "ghost"}
              className={cn("w-full justify-start", isActive && "bg-secondary")}
            >
              <span className="flex-1 text-left">{item.label}</span>
              {item.href.endsWith("/inbox") && unreadCount > 0 && (
                <Badge variant="secondary" className="ml-2 px-2 py-0 text-xs">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </Badge>
              )}
            </Button>
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const unreadCount = useUnreadInboxItemsCount();

  return (
    <nav className="flex gap-1 overflow-x-auto p-2">
      {navItems.map((item) => {
        const isActive =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link key={item.href} href={item.href}>
            <Button
              variant={isActive ? "secondary" : "ghost"}
              size="sm"
              className={cn(isActive && "bg-secondary", "relative")}
            >
              {item.label}
              {item.href.endsWith("/inbox") && unreadCount > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-1 px-1.5 py-0 text-xs min-w-[1.25rem] h-5"
                >
                  {unreadCount > 99 ? "99+" : unreadCount}
                </Badge>
              )}
            </Button>
          </Link>
        );
      })}
    </nav>
  );
}
