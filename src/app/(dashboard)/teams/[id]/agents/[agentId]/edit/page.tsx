"use client";

import { useState, useEffect } from "react";
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

export default function EditAgentPage() {
  const router = useRouter();
  const params = useParams();
  const teamId = params.id as string;
  const agentId = params.agentId as string;

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    role: "",
    systemPrompt: "",
  });

  // Fetch agent details on mount
  useEffect(() => {
    const fetchAgent = async () => {
      try {
        const response = await fetch(`/api/teams/${teamId}/agents/${agentId}`);
        if (!response.ok) {
          throw new Error("Failed to fetch agent details");
        }
        const data = await response.json();
        setFormData({
          name: data.name,
          role: data.role,
          systemPrompt: data.systemPrompt || "",
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load agent");
      } finally {
        setIsLoading(false);
      }
    };

    fetchAgent();
  }, [teamId, agentId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/teams/${teamId}/agents/${agentId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update agent");
      }

      router.push(`/teams/${teamId}/agents/${agentId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update agent");
      setIsSaving(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  if (isLoading) {
    return <div>Loading agent details...</div>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href={`/teams/${teamId}/agents/${agentId}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          Back to Agent
        </Link>
        <h1 className="mt-2 text-3xl font-bold">Edit Agent</h1>
        <p className="text-muted-foreground">
          Update the agent&apos;s identity and behavior
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
            <CardTitle>Agent Configuration</CardTitle>
            <CardDescription>
              Modify how this agent appears and behaves within the team
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
            </div>

            <div className="space-y-2">
              <Label htmlFor="systemPrompt">System Prompt</Label>
              <textarea
                id="systemPrompt"
                name="systemPrompt"
                placeholder="Define the agent's personality, expertise, and approach."
                value={formData.systemPrompt}
                onChange={handleChange}
                className="min-h-[150px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                required
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-4">
          <Button type="submit" disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Changes"}
          </Button>
          <Link href={`/teams/${teamId}/agents/${agentId}`}>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
