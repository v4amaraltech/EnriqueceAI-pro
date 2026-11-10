'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, Send } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/components/ui/tooltip';

import { sanitizeChatHtml } from './body';
import { CHAT_COPY } from './constants';
import {
  formatChatTime,
  groupByDay,
  groupEmailThreads,
  groupRuns,
  mergeOlder,
  type ChatChannel,
  type ChatCursor,
  type ChatMessage,
  type DayGroup,
} from './model';
import { chatInitials, formatChatPhone, type ChatPeer } from './peer';
import { fetchLeadChannelPage } from './read';

function MessageBody({ message, outbound }: { message: ChatMessage; outbound: boolean }) {
  if (message.missingBody || !message.html) {
    return (
      <p className={`whitespace-pre-wrap break-words ${message.missingBody ? 'italic opacity-80' : ''}`}>
        {message.text}
      </p>
    );
  }
  const link = message.channel === 'whatsapp' && outbound
    ? '[&_a]:text-zinc-50'
    : '[&_a]:text-primary';
  return (
    <div
      className={`break-words text-sm leading-relaxed [&_a]:break-all [&_a]:underline [&_b]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_div+div]:mt-3 [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-3 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 ${link}`}
      dangerouslySetInnerHTML={{ __html: sanitizeChatHtml(message.html) }}
    />
  );
}

function Tick({ message }: { message: ChatMessage }) {
  const tick = message.deliveryTick;
  if (tick === 'sent') return <span aria-label={CHAT_COPY.sent}>✓</span>;
  if (tick === 'delivered') return <span aria-label={CHAT_COPY.delivered}>✓✓</span>;
  if (tick === 'read') return <span aria-label={CHAT_COPY.readWhatsapp} className="text-sky-400">✓✓</span>;
  if (tick === 'failed') {
    return (
      <span className="inline-flex items-center gap-0.5 text-red-400" aria-label={CHAT_COPY.failed}>
        <AlertCircle className="h-3 w-3" />
        {CHAT_COPY.failed}
      </span>
    );
  }
  if (!message.delivery) return null;
  return <span>{message.delivery}</span>;
}

function Bubble({ message }: { message: ChatMessage }) {
  const outbound = message.direction === 'out';
  return (
    <div className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
      <div
        data-chat-bubble=""
        data-direction={message.direction}
        className={
          outbound
            ? 'max-w-[80%] rounded-2xl rounded-br-sm bg-zinc-900 px-3 py-2 text-sm text-zinc-50 dark:bg-zinc-800'
            : 'max-w-[80%] rounded-2xl rounded-bl-sm border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50'
        }
      >
        <MessageBody message={message} outbound={outbound} />
        <p className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${outbound ? 'text-zinc-300' : 'text-zinc-500 dark:text-zinc-400'}`}>
          <span>{formatChatTime(message.createdAt)}</span>
          <Tick message={message} />
          {message.aiGenerated ? <span>{CHAT_COPY.ai}</span> : null}
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
          <p className="mx-auto w-fit rounded-full bg-black/10 px-3 py-0.5 text-[11px] text-zinc-700 dark:bg-white/10 dark:text-zinc-200">
            {group.label}
          </p>
          {channel === 'email'
            ? group.messages.map((message) => <MailCard key={message.id} message={message} />)
            : groupRuns(group.messages).map((run) => (
              <div key={run[0]?.id} className="space-y-1">
                {run.map((message) => <Bubble key={message.id} message={message} />)}
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

function Header({ peer, channel }: { peer: ChatPeer; channel: ChatChannel }) {
  const address = channel === 'whatsapp' ? formatChatPhone(peer.address) : peer.address;
  return (
    <header className="flex items-center gap-3 border-b border-border bg-card px-3 py-2">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold text-white" aria-hidden>
        {chatInitials(peer.name)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{peer.name}</p>
        {address ? <p className="truncate text-xs text-muted-foreground">{address}</p> : null}
      </div>
      {peer.chips.length > 0 ? (
        <div className="flex max-w-[40%] flex-wrap justify-end gap-1">
          {peer.chips.map((chip) => (
            <span key={chip} className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
              {chip}
            </span>
          ))}
        </div>
      ) : null}
    </header>
  );
}

function Composer({ senderName }: { senderName: string }) {
  const placeholder = `${CHAT_COPY.replyAs} ${senderName}...`;
  return (
    <form className="flex items-center gap-2 border-t border-border bg-card px-3 py-2" onSubmit={(event) => event.preventDefault()}>
      <Tooltip>
        <TooltipTrigger asChild>
          <input
            disabled
            title={CHAT_COPY.composerDisabled}
            placeholder={placeholder}
            aria-label={placeholder}
            className="h-10 min-w-0 flex-1 rounded-full border border-border bg-muted/50 px-4 text-sm text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-70"
          />
        </TooltipTrigger>
        <TooltipContent>{CHAT_COPY.composerDisabled}</TooltipContent>
      </Tooltip>
      <button
        type="button"
        disabled
        title={CHAT_COPY.composerDisabled}
        aria-label={CHAT_COPY.send}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Send className="h-4 w-4" />
      </button>
    </form>
  );
}

export function ChatWindow({
  channel,
  peer,
  senderName,
  messages,
  loading,
  error,
  hasMore,
  onLoadOlder,
}: {
  channel: ChatChannel;
  peer: ChatPeer;
  senderName: string;
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  onLoadOlder: () => void;
}) {
  const empty = channel === 'email' ? CHAT_COPY.emptyEmail : CHAT_COPY.emptyWhatsapp;
  const hasInbound = messages.some((message) => message.direction === 'in');
  return (
    <section className="flex h-[32rem] flex-col overflow-hidden rounded-lg border border-border bg-card">
      <Header peer={peer} channel={channel} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-[#f4f1ec] px-3 py-3 dark:bg-zinc-950">
        {hasMore ? (
          <Button type="button" variant="outline" size="sm" onClick={onLoadOlder} disabled={loading} className="self-center">
            {loading ? CHAT_COPY.loading : CHAT_COPY.loadOlder}
          </Button>
        ) : null}
        {loading && messages.length === 0 ? <p className="text-center text-sm text-muted-foreground">{CHAT_COPY.loading}</p> : null}
        {error ? <p className="text-center text-sm text-destructive">{error}</p> : null}
        {!loading && !error && messages.length === 0 ? <p className="text-center text-sm text-muted-foreground">{empty}</p> : null}
        {channel === 'email'
          ? groupEmailThreads(messages).map((thread) => (
            <section key={thread.id} className="space-y-2">
              <h3 className="text-sm font-medium text-foreground">{thread.subject}</h3>
              <DayBlocks groups={groupByDay(thread.messages)} channel="email" />
            </section>
          ))
          : <DayBlocks groups={groupByDay(messages)} channel="whatsapp" />}
        {channel === 'whatsapp' && !loading && !error && messages.length > 0 && !hasInbound ? (
          <p className="text-center text-[11px] text-muted-foreground">{CHAT_COPY.inboundHint}</p>
        ) : null}
      </div>
      {channel === 'whatsapp' ? <Composer senderName={senderName} /> : null}
    </section>
  );
}

export function ChannelChat({
  leadId,
  channel,
  peer,
  senderName,
}: {
  leadId: string;
  channel: ChatChannel;
  peer: ChatPeer;
  senderName: string;
}) {
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

  return (
    <ChatWindow
      channel={channel}
      peer={peer}
      senderName={senderName}
      messages={messages}
      loading={loading}
      error={error}
      hasMore={hasMore}
      onLoadOlder={() => void loadOlder()}
    />
  );
}
