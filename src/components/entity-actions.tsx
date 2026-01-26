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

type EntityType = "team" | "aide";

interface EntityActionsProps {
  entityType: EntityType;
  entityId: string;
  entityName: string;
  currentStatus: "active" | "paused" | "archived";
  backUrl: string;
}

export function EntityActions({
  entityType,
  entityId,
  entityName,
  currentStatus,
  backUrl,
}: EntityActionsProps) {
  const router = useRouter();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [editName, setEditName] = useState(entityName);
  const [error, setError] = useState<string | null>(null);

  const apiPath = entityType === "team" ? "teams" : "aides";
  const label = entityType === "team" ? "Team" : "Aide";

  const handleToggleStatus = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const newStatus = currentStatus === "active" ? "paused" : "active";
      const response = await fetch(`/api/${apiPath}/${entityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || `Failed to update ${label}`);
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to update ${label}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEdit = async () => {
    if (!editName.trim()) {
      setError("Name is required");
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/${apiPath}/${entityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || `Failed to update ${label}`);
      }

      setIsEditOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to update ${label}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/${apiPath}/${entityId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || `Failed to delete ${label}`);
      }

      router.push(backUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to delete ${label}`);
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
            setEditName(entityName);
            setError(null);
            setIsEditOpen(true);
          }}
          disabled={isLoading}
        >
          Edit {label}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleToggleStatus}
          disabled={isLoading}
        >
          {isLoading ? "..." : currentStatus === "active" ? `Pause ${label}` : `Resume ${label}`}
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
          Delete {label}
        </Button>
      </div>

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {label}</DialogTitle>
            <DialogDescription>
              Update the name of your {label.toLowerCase()}.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">{label} Name</Label>
              <Input
                id="name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder={`Enter ${label.toLowerCase()} name`}
              />
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
            <DialogTitle>Delete {label}</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{entityName}&quot;? This action cannot
              be undone. All agents and data associated with this {label.toLowerCase()} will
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
              {isLoading ? "Deleting..." : `Delete ${label}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
