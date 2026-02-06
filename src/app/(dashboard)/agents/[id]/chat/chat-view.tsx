"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Chat } from "@/components/chat";
import { AgentHeaderActions } from "@/components/agent-header-actions";

export function AgentChatView({
  agent,
}: {
  agent: { id: string; name: string; systemPrompt: string };
}) {
  const [isSystemPromptOpen, setIsSystemPromptOpen] = useState(false);

  return (
    <div className="flex h-[calc(100vh-16rem)] flex-col space-y-4">
      <AgentHeaderActions>
        <Dialog open={isSystemPromptOpen} onOpenChange={setIsSystemPromptOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              View System Prompt
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[80vh] max-w-2xl overflow-hidden">
            <DialogHeader>
              <DialogTitle>System Prompt</DialogTitle>
              <DialogDescription>
                The system prompt that guides this agent&apos;s behavior.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[60vh] overflow-auto">
              <pre className="whitespace-pre-wrap rounded-md bg-muted p-4 text-sm">
                {agent.systemPrompt}
              </pre>
            </div>
          </DialogContent>
        </Dialog>
      </AgentHeaderActions>

      <Chat
        agentId={agent.id}
        agentName={agent.name}
        title="Conversation"
        description="Chat with your agent"
      />
    </div>
  );
}
