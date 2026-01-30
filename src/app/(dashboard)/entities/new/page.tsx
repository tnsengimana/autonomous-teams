"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function NewEntityPage() {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    type: "team" as "team" | "aide",
    purpose: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    setError(null);

    try {
      const response = await fetch("/api/entities", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create entity");
      }

      const entity = await response.json();
      router.push(`/entities/${entity.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create entity");
      setIsCreating(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  const handleTypeChange = (value: "team" | "aide") => {
    setFormData((prev) => ({
      ...prev,
      type: value,
    }));
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href="/entities"
          className="text-sm text-muted-foreground hover:underline"
        >
          Back to Entities
        </Link>
        <h1 className="mt-2 text-3xl font-bold">Create New Entity</h1>
        <p className="text-muted-foreground">
          Define your entity&apos;s mission and we&apos;ll configure the lead automatically
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Entity Details</CardTitle>
            <CardDescription>
              Tell us what you want your entity to accomplish
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => handleTypeChange("team")}
                  className={`rounded-lg border p-4 text-left transition-colors ${
                    formData.type === "team"
                      ? "border-primary bg-primary/5"
                      : "border-input hover:bg-accent"
                  }`}
                >
                  <div className="font-medium">Team</div>
                  <div className="text-xs text-muted-foreground">
                    Multi-agent team with lead and subordinates
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleTypeChange("aide")}
                  className={`rounded-lg border p-4 text-left transition-colors ${
                    formData.type === "aide"
                      ? "border-primary bg-primary/5"
                      : "border-input hover:bg-accent"
                  }`}
                >
                  <div className="font-medium">Aide</div>
                  <div className="text-xs text-muted-foreground">
                    Personal assistant for individual tasks
                  </div>
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Teams have multiple agents working together. Aides are single-agent personal assistants.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                placeholder={formData.type === "team" ? "e.g., Research Team" : "e.g., Personal Research Aide"}
                value={formData.name}
                onChange={handleChange}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="purpose">Mission</Label>
              <textarea
                id="purpose"
                name="purpose"
                placeholder={
                  formData.type === "team"
                    ? "What should this team accomplish? Be specific about goals and deliverables."
                    : "What should this aide help you with? Describe the tasks and responsibilities."
                }
                value={formData.purpose}
                onChange={handleChange}
                className="min-h-[150px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                required
              />
              <p className="text-xs text-muted-foreground">
                The mission guides all activities. We&apos;ll automatically configure a lead based on your mission.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-4">
          <Button type="submit" disabled={isCreating}>
            {isCreating ? `Creating ${formData.type}...` : `Create ${formData.type === "team" ? "Team" : "Aide"}`}
          </Button>
          <Link href="/entities">
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
