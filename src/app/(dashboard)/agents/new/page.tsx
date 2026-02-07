"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function NewAgentPage() {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    purpose: "",
    intervalValue: "60",
    intervalUnit: "minutes" as "minutes" | "hours" | "days",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    setError(null);

    // Convert interval to milliseconds
    const intervalValue = parseInt(formData.intervalValue, 10);
    if (isNaN(intervalValue) || intervalValue <= 0) {
      setError("Please enter a valid interval value");
      setIsCreating(false);
      return;
    }

    const multipliers = {
      minutes: 60 * 1000,
      hours: 60 * 60 * 1000,
      days: 24 * 60 * 60 * 1000,
    };
    const iterationIntervalMs =
      intervalValue * multipliers[formData.intervalUnit];

    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          purpose: formData.purpose,
          iterationIntervalMs,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create agent");
      }

      const agent = await response.json();
      router.push(`/agents/${agent.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
      setIsCreating(false);
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

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href="/agents"
          className="text-sm text-muted-foreground hover:underline"
        >
          Back to Agents
        </Link>
        <h1 className="mt-2 text-3xl font-bold">Create New Agent</h1>
        <p className="text-muted-foreground">
          Define your agent&apos;s mission. Everything else will be generated
          automatically.
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
            <CardTitle>Mission</CardTitle>
            <CardDescription>
              Describe what you want your agent to accomplish
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="purpose">Mission</Label>
              <textarea
                id="purpose"
                name="purpose"
                placeholder="What should this agent accomplish? Be specific about goals and deliverables. The agent's name and system prompt will be generated automatically based on this mission."
                value={formData.purpose}
                onChange={handleChange}
                className="min-h-[150px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                required
              />
              <p className="text-xs text-muted-foreground">
                Describe the mission clearly. The agent&apos;s name and
                configuration will be generated automatically.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="intervalValue">Iteration Interval</Label>
              <div className="flex gap-2">
                <input
                  id="intervalValue"
                  name="intervalValue"
                  type="number"
                  min="1"
                  placeholder="60"
                  value={formData.intervalValue}
                  onChange={handleChange}
                  className="w-24 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  required
                />
                <select
                  name="intervalUnit"
                  value={formData.intervalUnit}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      intervalUnit: e.target.value as
                        | "minutes"
                        | "hours"
                        | "days",
                    }))
                  }
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="minutes">Minutes</option>
                  <option value="hours">Hours</option>
                  <option value="days">Days</option>
                </select>
              </div>
              <p className="text-xs text-muted-foreground">
                How often the agent should run its background iteration cycle.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-4">
          <Button type="submit" disabled={isCreating}>
            {isCreating ? "Generating configuration..." : "Create Agent"}
          </Button>
          <Link href="/agents">
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
