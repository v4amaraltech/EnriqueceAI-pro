'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/shared/components/ui/button';

import { CHAT_COPY } from './constants';
import {
  formatChatTime,
  groupByDay,
  groupEmailThreads,
  mergeOlder,
  type ChatChannel,
  type ChatCursor,
  type ChatMessage,
  type DayGroup,
} from './model';
import { fetchLeadChannelPage } from './read';

function Bubble({ message }: { message: ChatMessage }) {
  const outbound = message.direction === 'out';
  return (
    <div className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
      <div
        className={
          outbound
            ? 'max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground'
            : 'max-w-[80%] rounded-2xl rounded-bl-sm border border-border bg-muted px-3 py-2 text-sm text-foreground'
        }
      >
        <p className="whitespace-pre-wrap break-words">{message.text}</p>
        <p className={`mt-1 text-[10px] ${outbound ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
          {formatChatTime(message.createdAt)}
          {message.delivery ? ` ${message.delivery}` : ''}
          {message.aiGenerated ? ` ${CHAT_COPY.ai}` : ''}
        </p>
      </div>
    </div>
  );
}

function DayBlocks({ groups }: { groups: DayGroup[] }) {
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.label} className="space-y-2">
          <p className="text-center text-xs text-muted-foreground">{group.label}</p>
          {group.messages.map((message) => (
            <Bubble key={message.id} message={message} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ChannelChat({ leadId, channel }: { leadId: string; channel: ChatChannel }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [cursor, setCursor] = useState<ChatCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);

  useEffect(() => {
    let cancel = false;
    void fetchLeadChannelPage({ leadId, channel }).then((result) => {
      if (cancel) return;
      setLoading(false);
      if (!result.success) {
        setError(result.error);
        return;
      }
      if (!result.data.enabled) {
        setDisabled(true);
        return;
      }
      setMessages(result.data.messages);
      setHasMore(result.data.hasMore);
      setCursor(result.data.cursor);
    });
    return () => {
      cancel = true;
    };
  }, [leadId, channel]);

  async function loadOlder() {
    if (!cursor || loading) return;
    setLoading(true);
    const result = await fetchLeadChannelPage({ leadId, channel, before: cursor });
    setLoading(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    if (!result.data.enabled) {
      setDisabled(true);
      return;
    }
    const page = result.data;
    setMessages((current) => mergeOlder(current, page.messages));
    setHasMore(page.hasMore);
    setCursor(page.cursor);
  }

  if (disabled) {
    return <p className="text-sm text-muted-foreground">{CHAT_COPY.disabled}</p>;
  }

  const empty = channel === 'email' ? CHAT_COPY.emptyEmail : CHAT_COPY.emptyWhatsapp;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-background p-4">
      {hasMore ? (
        <Button type="button" variant="outline" size="sm" onClick={() => void loadOlder()} disabled={loading}>
          {loading ? CHAT_COPY.loading : CHAT_COPY.loadOlder}
        </Button>
      ) : null}
      {loading && messages.length === 0 ? <p className="text-sm text-muted-foreground">{CHAT_COPY.loading}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loading && !error && messages.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : null}
      {channel === 'email'
        ? groupEmailThreads(messages).map((thread) => (
          <section key={thread.id} className="space-y-2">
            <h3 className="text-sm font-medium">{thread.subject}</h3>
            <DayBlocks groups={groupByDay(thread.messages)} />
          </section>
        ))
        : <DayBlocks groups={groupByDay(messages)} />}
    </div>
  );
}
