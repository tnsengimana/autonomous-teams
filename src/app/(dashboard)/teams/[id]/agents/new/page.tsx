"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
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

export default function NewSubordinatePage() {
  const router = useRouter();
  const params = useParams();
  const teamId = params.id as string;

  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    role: "",
    systemPrompt: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    setError(null);

    try {
      const response = await fetch(`/api/teams/${teamId}/agents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create agent");
      }

      router.push(`/teams/${teamId}/agents`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
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

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href={`/teams/${teamId}/agents`}
          className="text-sm text-muted-foreground hover:underline"
        >
          Back to Agents
        </Link>
        <h1 className="mt-2 text-3xl font-bold">Add Subordinate</h1>
        <p className="text-muted-foreground">
          Create a new subordinate agent to handle specific tasks for your team
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
            <CardTitle>Agent Details</CardTitle>
            <CardDescription>
              Define the subordinate agent&apos;s identity and capabilities
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Agent Name</Label>
              <Input
                id="name"
                name="name"
                placeholder="e.g., Data Analyst"
                value={formData.name}
                onChange={handleChange}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="role">Role / Specialty</Label>
              <Input
                id="role"
                name="role"
                placeholder="e.g., Analyzes data and generates reports"
                value={formData.role}
                onChange={handleChange}
                required
              />
              <p className="text-xs text-muted-foreground">
                Describe what this agent specializes in and its primary function.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="systemPrompt">System Prompt</Label>
              <textarea
                id="systemPrompt"
                name="systemPrompt"
                placeholder="Define the agent's personality, expertise, and approach. This shapes how the agent thinks and responds."
                value={formData.systemPrompt}
                onChange={handleChange}
                className="min-h-[150px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                required
              />
              <p className="text-xs text-muted-foreground">
                Example: &quot;You are a data analyst expert skilled in statistical
                analysis and data visualization. You provide clear, actionable
                insights from complex datasets.&quot;
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-4">
          <Button type="submit" disabled={isCreating}>
            {isCreating ? "Creating..." : "Create Agent"}
          </Button>
          <Link href={`/teams/${teamId}/agents`}>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
