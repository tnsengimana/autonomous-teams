"use client";

import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AgentHeaderActions } from "@/components/agent-header-actions";

interface AutoRefreshProps {
  intervalMs?: number;
  onRefresh?: () => void;
}

export function AutoRefresh({
  intervalMs = 60000,
  onRefresh,
}: AutoRefreshProps) {
  const router = useRouter();

  const refresh = useCallback(() => {
    if (onRefresh) {
      onRefresh();
    } else {
      router.refresh();
    }
  }, [onRefresh, router]);

  useEffect(() => {
    const interval = setInterval(refresh, intervalMs);
    return () => clearInterval(interval);
  }, [refresh, intervalMs]);

  return (
    <AgentHeaderActions>
      <Button variant="outline" size="sm" onClick={refresh}>
        Refresh
      </Button>
    </AgentHeaderActions>
  );
}
