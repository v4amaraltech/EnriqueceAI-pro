'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/shared/components/ui/button';

import { sanitizeChatHtml } from './body';
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

function MessageBody({ message, outbound }: { message: ChatMessage; outbound: boolean }) {
  if (!message.html) {
    return <p className="whitespace-pre-wrap break-words">{message.text}</p>;
  }
  const link = message.channel === 'whatsapp' && outbound
    ? '[&_a]:text-primary-foreground'
    : '[&_a]:text-primary';
  return (
    <div
      className={`break-words text-sm leading-relaxed [&_a]:break-all [&_a]:underline [&_b]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_div+div]:mt-3 [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-3 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 ${link}`}
      dangerouslySetInnerHTML={{ __html: sanitizeChatHtml(message.html) }}
    />
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const outbound = message.direction === 'out';
  return (
    <div className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
      <div
        data-chat-bubble=""
        className={
          outbound
            ? 'max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground'
            : 'max-w-[80%] rounded-2xl rounded-bl-sm border border-border bg-muted px-3 py-2 text-sm text-foreground'
        }
      >
        <MessageBody message={message} outbound={outbound} />
        <p className={`mt-1 text-[10px] ${outbound ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
          {formatChatTime(message.createdAt)}
          {message.delivery ? ` ${message.delivery}` : ''}
          {message.aiGenerated ? ` ${CHAT_COPY.ai}` : ''}
        </p>
      </div>
    </div>
  );
}

function MailCard({ message }: { message: ChatMessage }) {
  const outbound = message.direction === 'out';
  return (
    <article
      data-mail-card=""
      className={
        outbound
          ? 'w-full rounded-lg border border-border border-l-2 border-l-primary bg-card px-4 py-3 text-card-foreground'
          : 'w-full rounded-lg border border-border bg-muted/50 px-4 py-3 text-foreground'
      }
    >
      <div className="mb-3 flex items-baseline justify-between gap-3 text-xs">
        <p className="font-medium text-foreground">{outbound ? CHAT_COPY.you : CHAT_COPY.lead}</p>
        <p className="shrink-0 text-muted-foreground">
          {formatChatTime(message.createdAt)}
          {message.delivery ? ` ${message.delivery}` : ''}
          {message.aiGenerated ? ` ${CHAT_COPY.ai}` : ''}
        </p>
      </div>
      <MessageBody message={message} outbound={outbound} />
    </article>
  );
}

function DayBlocks({ groups, channel }: { groups: DayGroup[]; channel: ChatChannel }) {
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.label} className="space-y-2">
          <p className="text-center text-xs text-muted-foreground">{group.label}</p>
          {group.messages.map((message) => (
            channel === 'email'
              ? <MailCard key={message.id} message={message} />
              : <Bubble key={message.id} message={message} />
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
            <DayBlocks groups={groupByDay(thread.messages)} channel="email" />
          </section>
        ))
        : <DayBlocks groups={groupByDay(messages)} channel="whatsapp" />}
    </div>
  );
}
