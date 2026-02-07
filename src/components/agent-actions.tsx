"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AgentActionsProps {
  agentId: string;
  agentName: string;
  isActive: boolean;
  currentIntervalMs: number;
  backUrl: string;
  // Deprecated prop for backward compatibility
  agentType?: "team" | "aide";
}

type IntervalUnit = "minutes" | "hours" | "days";

function msToInterval(ms: number): { value: number; unit: IntervalUnit } {
  const days = ms / (24 * 60 * 60 * 1000);
  if (days >= 1 && Number.isInteger(days)) {
    return { value: days, unit: "days" };
  }
  const hours = ms / (60 * 60 * 1000);
  if (hours >= 1 && Number.isInteger(hours)) {
    return { value: hours, unit: "hours" };
  }
  return { value: ms / (60 * 1000), unit: "minutes" };
}

function intervalToMs(value: number, unit: IntervalUnit): number {
  const multipliers = {
    minutes: 60 * 1000,
    hours: 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
  };
  return value * multipliers[unit];
}

export function AgentActions({
  agentId,
  agentName,
  isActive,
  currentIntervalMs,
  backUrl,
}: AgentActionsProps) {
  const router = useRouter();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [editName, setEditName] = useState(agentName);
  const initialInterval = msToInterval(currentIntervalMs);
  const [editIntervalValue, setEditIntervalValue] = useState(initialInterval.value.toString());
  const [editIntervalUnit, setEditIntervalUnit] = useState<IntervalUnit>(initialInterval.unit);
  const [error, setError] = useState<string | null>(null);

  const handleToggleActive = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !isActive }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update agent");
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update agent");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEdit = async () => {
    if (!editName.trim()) {
      setError("Name is required");
      return;
    }

    const intervalValue = parseInt(editIntervalValue, 10);
    if (isNaN(intervalValue) || intervalValue <= 0) {
      setError("Please enter a valid interval value");
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const iterationIntervalMs = intervalToMs(intervalValue, editIntervalUnit);
      const response = await fetch(`/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName, iterationIntervalMs }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update agent");
      }

      setIsEditOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update agent");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/agents/${agentId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to delete agent");
      }

      router.push(backUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete agent");
      setIsLoading(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setEditName(agentName);
            const interval = msToInterval(currentIntervalMs);
            setEditIntervalValue(interval.value.toString());
            setEditIntervalUnit(interval.unit);
            setError(null);
            setIsEditOpen(true);
          }}
          disabled={isLoading}
        >
          Edit
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleToggleActive}
          disabled={isLoading}
        >
          {isLoading ? "..." : isActive ? "Pause" : "Resume"}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => {
            setError(null);
            setIsDeleteOpen(true);
          }}
          disabled={isLoading}
        >
          Delete
        </Button>
      </div>

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Agent</DialogTitle>
            <DialogDescription>
              Update the name of your agent.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Agent Name</Label>
              <Input
                id="name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Enter agent name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="intervalValue">Iteration Interval</Label>
              <div className="flex gap-2">
                <Input
                  id="intervalValue"
                  type="number"
                  min="1"
                  value={editIntervalValue}
                  onChange={(e) => setEditIntervalValue(e.target.value)}
                  className="w-24"
                />
                <select
                  value={editIntervalUnit}
                  onChange={(e) => setEditIntervalUnit(e.target.value as IntervalUnit)}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="minutes">Minutes</option>
                  <option value="hours">Hours</option>
                  <option value="days">Days</option>
                </select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsEditOpen(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button onClick={handleEdit} disabled={isLoading}>
              {isLoading ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Agent</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{agentName}&quot;? This action cannot
              be undone. All data associated with this agent will
              be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDeleteOpen(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isLoading}
            >
              {isLoading ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
