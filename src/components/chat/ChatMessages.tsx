'use client';

import { useRef, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatMessage } from './ChatMessage';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatMessagesProps {
  messages: Message[];
  isStreaming?: boolean;
  streamingContent?: string;
  agentName?: string;
}

export function ChatMessages({
  messages,
  isStreaming = false,
  streamingContent = '',
  agentName,
}: ChatMessagesProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive or streaming content updates
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  return (
    <ScrollArea className="h-full" ref={scrollRef}>
      <div className="flex flex-col p-2">
        {messages.length === 0 && !isStreaming && (
          <div className="flex h-full items-center justify-center p-8 text-muted-foreground">
            <div className="text-center">
              <p className="text-lg font-medium">Start a conversation</p>
              <p className="text-sm">
                Send a message to begin chatting with your AI assistant.
              </p>
            </div>
          </div>
        )}

        {messages
          .filter((message) => message.content && message.content.trim() !== '')
          .map((message) => (
            <ChatMessage
              key={message.id}
              role={message.role}
              content={message.content}
              agentName={agentName}
            />
          ))}

        {isStreaming && streamingContent && (
          <ChatMessage
            role="assistant"
            content={streamingContent}
            isStreaming={true}
            agentName={agentName}
          />
        )}

        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
