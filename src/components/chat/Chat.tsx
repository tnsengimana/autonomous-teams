"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChatMessages, type Message } from "./ChatMessages";
import { ChatInput } from "./ChatInput";

export interface ChatProps {
  agentId: string;
  agentName?: string;
  title?: string;
  description?: string;
  readOnly?: boolean;
}

export function Chat({
  agentId,
  agentName,
  title = "Conversation",
  description = "Chat with your AI assistant.",
  readOnly = false,
}: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Load existing conversation history on mount
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const response = await fetch(`/api/conversations/${agentId}`);
        if (response.ok) {
          const data = await response.json();
          if (data.messages && Array.isArray(data.messages)) {
            setMessages(
              data.messages.map(
                (m: { id: string; role: string; content: string }) => ({
                  id: m.id,
                  role: m.role as "user" | "assistant",
                  content: m.content,
                }),
              ),
            );
          }
        }
      } catch (err) {
        console.error("Failed to load conversation history:", err);
      }
    };

    loadHistory();
  }, [agentId]);

  const handleSendMessage = useCallback(
    async (content: string) => {
      if (isLoading) return;

      // Add user message immediately
      const userMessage: Message = {
        id: `temp-${Date.now()}`,
        role: "user",
        content,
      };
      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);
      setIsStreaming(true);
      setStreamingContent("");
      setError(null);

      try {
        const response = await fetch("/api/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            agentId,
            content,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || "Failed to send message");
        }

        // Handle streaming response
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let fullContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          fullContent += chunk;
          setStreamingContent(fullContent);
        }

        // Add the complete assistant message
        const assistantMessage: Message = {
          id: `msg-${Date.now()}`,
          role: "assistant",
          content: fullContent,
        };
        setMessages((prev) => [...prev, assistantMessage]);
      } catch (err) {
        console.error("Failed to send message:", err);
        setError(err instanceof Error ? err.message : "Failed to send message");
        // Remove the user message on error
        setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
      } finally {
        setIsLoading(false);
        setIsStreaming(false);
        setStreamingContent("");
      }
    },
    [agentId, isLoading],
  );

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader className="shrink-0">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-muted/30">
          <ChatMessages
            messages={messages}
            isStreaming={isStreaming}
            streamingContent={streamingContent}
            agentName={agentName}
          />
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {!readOnly && (
          <ChatInput
            onSendMessage={handleSendMessage}
            disabled={isLoading}
            placeholder={
              isLoading ? "Waiting for response..." : "Type your message..."
            }
          />
        )}
      </CardContent>
    </Card>
  );
}
