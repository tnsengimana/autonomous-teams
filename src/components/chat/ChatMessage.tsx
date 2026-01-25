'use client';

import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Bot, User } from 'lucide-react';

export interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  agentName?: string;
}

export function ChatMessage({
  role,
  content,
  isStreaming = false,
  agentName,
}: ChatMessageProps) {
  const isUser = role === 'user';

  return (
    <div
      className={cn(
        'flex gap-3 p-4',
        isUser ? 'flex-row-reverse' : 'flex-row'
      )}
    >
      <Avatar className={cn('h-8 w-8', isUser ? 'bg-primary' : 'bg-muted')}>
        <AvatarFallback
          className={cn(
            'text-xs',
            isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
          )}
        >
          {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </AvatarFallback>
      </Avatar>

      <div
        className={cn(
          'flex max-w-[80%] flex-col gap-1',
          isUser ? 'items-end' : 'items-start'
        )}
      >
        <span className="text-xs font-medium text-muted-foreground">
          {isUser ? 'You' : agentName ?? 'Assistant'}
        </span>
        <div
          className={cn(
            'rounded-lg px-4 py-2 text-sm',
            isUser
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-foreground'
          )}
        >
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
          {isStreaming && (
            <span className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full bg-current" />
          )}
        </div>
      </div>
    </div>
  );
}
