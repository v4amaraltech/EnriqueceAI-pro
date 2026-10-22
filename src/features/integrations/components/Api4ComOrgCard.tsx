'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Check, Key, Pencil, RefreshCw, Unplug, X } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';

import {
  assignApi4ComExtension,
  disconnectApi4ComOrg,
  setWebphoneEnabled,
  syncApi4ComExtensions,
} from '../actions/manage-api4com-org';
import type { Api4ComOrgOverview, Api4ComSyncReport, Api4ComTeamMember } from '../types';
import { Api4ComOrgTokenModal } from './Api4ComOrgTokenModal';

interface Api4ComOrgCardProps {
  overview: Api4ComOrgOverview;
  /**
   * Com o token da org configurado, o cartão é a ÚNICA linha da API4Com do
   * gestor (logo + título); sem token, fica como sub-linha abaixo do ramal
   * individual, só para configurar o token.
   */
  standalone?: boolean;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return 'nunca';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/** Resumo em uma frase + pendências que o gestor precisa resolver. */
export function describeSyncReport(report: Api4ComSyncReport): { summary: string; pending: string[] } {
  const summary = `${report.linked.length} ramal(is) confirmado(s), ${report.created.length} novo(s)`;
  const pending: string[] = [];
  for (const a of report.ambiguous) {
    pending.push(`${a.name}: o e-mail tem mais de um ramal (${a.ramais.join(', ')}). Escolha o ramal na tabela.`);
  }
  for (const u of report.unmatched) {
    pending.push(`${u.name}: nenhum ramal na API4COM com o e-mail ${u.email ?? '(sem e-mail)'}. Informe o ramal na tabela.`);
  }
  for (const m of report.missing) {
    pending.push(`${m.name}: o ramal ${m.ramal} não existe mais na conta.`);
  }
  return { summary, pending };
}

export type Api4ComMemberState = 'ready' | 'needs_sync' | 'no_ramal';

/** Pronto = tem ramal e senha SIP (liga pela página ou pela extensão). */
export function memberState(m: Pick<Api4ComTeamMember, 'ramal' | 'hasSipPassword'>): Api4ComMemberState {
  if (!m.ramal) return 'no_ramal';
  return m.hasSipPassword ? 'ready' : 'needs_sync';
}

const STATE_BADGE: Record<Api4ComMemberState, { label: string; className: string }> = {
  ready: { label: 'Pronto', className: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' },
  needs_sync: {
    label: 'Falta sincronizar',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  },
  no_ramal: { label: 'Sem ramal', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
};

interface RamalCellProps {
  member: Api4ComTeamMember;
  suggestions: string[];
  disabled: boolean;
  onSave: (ramal: string) => Promise<boolean>;
}

/** Ramal da pessoa: número + lápis para trocar; sem ramal, campo + sugestões da última sincronização. */
function RamalCell({ member, suggestions, disabled, onSave }: RamalCellProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(member.ramal ?? '');

  async function save(ramal: string) {
    if (await onSave(ramal)) setEditing(false);
  }

  if (!editing && member.ramal) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="font-medium">{member.ramal}</span>
        <button
          type="button"
          className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] dark:text-[var(--foreground)]"
          aria-label={`Trocar o ramal de ${member.name}`}
          title="Trocar ramal"
          disabled={disabled}
          onClick={() => setEditing(true)}
        >
          <Pencil className="h-3 w-3" />
        </button>
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {suggestions.map((r) => (
        <Button
          key={r}
          variant="outline"
          size="sm"
          className="h-6 px-2 text-xs"
          disabled={disabled}
          onClick={() => void save(r)}
        >
          {r}
        </Button>
      ))}
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void save(value);
        }}
      >
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Ramal"
          inputMode="numeric"
          aria-label={`Ramal de ${member.name}`}
          className="h-6 w-20 px-2 text-xs"
          disabled={disabled}
        />
        <Button type="submit" size="sm" className="h-6 px-2 text-xs" disabled={disabled || !value.trim()}>
          Salvar
        </Button>
        {member.ramal && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => {
              setValue(member.ramal ?? '');
              setEditing(false);
            }}
          >
            Cancelar
          </Button>
        )}
      </form>
    </div>
  );
}

export function Api4ComOrgCard({ overview, standalone = false }: Api4ComOrgCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [showDisconnect, setShowDisconnect] = useState(false);
  const [pending, setPending] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<Record<string, string[]>>({});

  const { settings, team } = overview;
  const readyCount = team.filter((m) => memberState(m) === 'ready').length;
  const attentionCount = team.length - readyCount;

  function handleReport(report: Api4ComSyncReport) {
    const { summary, pending: items } = describeSyncReport(report);
    setPending(items);
    setSuggestions(Object.fromEntries(report.ambiguous.map((a) => [a.userId, a.ramais])));
    if (items.length === 0) toast.success(`Ramais sincronizados: ${summary}`);
    else toast.warning(`Ramais sincronizados: ${summary}. ${items.length} pendência(s) abaixo.`);
    router.refresh();
  }

  function assignRamal(member: Api4ComTeamMember, ramal: string): Promise<boolean> {
    return new Promise((resolve) => {
      startTransition(async () => {
        const r = await assignApi4ComExtension({ userId: member.userId, ramal });
        if (r.success) {
          toast.success(`${member.name}: ramal ${r.data.ramal} salvo`);
          setPending((items) => items.filter((i) => !i.startsWith(`${member.name}:`)));
          router.refresh();
        } else {
          toast.error(r.error);
        }
        resolve(r.success);
      });
    });
  }

  return (
    <div className={`border-b border-[var(--border)] px-4 py-3 ${standalone ? '' : 'bg-[var(--muted)]/20'}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex w-10 shrink-0 items-center justify-center">
          {standalone && (
            <Image src="/logos/api4com-logo.png" alt="API4Com" width={32} height={32} className="rounded-lg" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {standalone && <span className="font-medium">API4Com ·</span>}
            <span className={standalone ? 'font-medium' : 'text-sm font-medium'}>Conta da organização</span>
            {settings.configured ? (
              <Badge variant="outline" className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                <Check className="mr-1 h-3 w-3" />
                Token configurado
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                <X className="mr-1 h-3 w-3" />
                Sem token
              </Badge>
            )}
          </div>
          <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            {settings.configured
              ? `Um token para todo o time · Domínio ${settings.sip_domain ?? 'não identificado'} · Última sincronização: ${formatDateTime(settings.last_synced_at)}`
              : 'Um token da conta pai para todos os ramais. Os ramais do time são preenchidos pelo e-mail de cada pessoa.'}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {settings.configured && (
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const r = await syncApi4ComExtensions();
                  if (r.success) handleReport(r.data);
                  else toast.error(r.error);
                })
              }
            >
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isPending ? 'animate-spin' : ''}`} />
              Sincronizar ramais
            </Button>
          )}
          <Button variant={settings.configured ? 'outline' : 'default'} size="sm" onClick={() => setShowTokenModal(true)}>
            <Key className="mr-1.5 h-3.5 w-3.5" />
            {settings.configured ? 'Trocar token' : 'Configurar token'}
          </Button>
          {settings.configured && (
            <Button
              variant="ghost"
              size="sm"
              className="text-[var(--muted-foreground)] dark:text-[var(--foreground)] hover:text-red-600"
              onClick={() => setShowDisconnect(true)}
            >
              <Unplug className="mr-1.5 h-3.5 w-3.5" />
              Remover
            </Button>
          )}
        </div>
      </div>

      {settings.configured && team.length > 0 && (
        <p className="mt-3 text-xs">
          <span className="font-medium">
            {readyCount} de {team.length} prontos para ligar
          </span>
          {attentionCount > 0 && (
            <span className="text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              {' '}
              · {attentionCount} sem ramal ou faltando sincronizar
            </span>
          )}
        </p>
      )}

      {pending.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          {pending.map((item) => (
            <li key={item}>• {item}</li>
          ))}
        </ul>
      )}

      {settings.configured && team.length > 0 && (
        <table className="mt-3 w-full text-xs">
          <thead>
            <tr className="text-left text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              <th className="py-1 pr-3 font-medium">Pessoa</th>
              <th className="py-1 pr-3 font-medium">Ramal</th>
              <th className="py-1 pr-3 font-medium">Situação</th>
              <th className="py-1 font-medium" title="Atende a ligação na própria página, sem a extensão do Chrome">
                Webphone
              </th>
            </tr>
          </thead>
          <tbody>
            {team.map((m) => {
              const state = memberState(m);
              const badge = STATE_BADGE[state];
              return (
                <tr key={m.userId} className="border-t border-[var(--border)]/60 align-middle">
                  <td className="py-1.5 pr-3">
                    <div>
                      {m.name}
                      {m.role === 'manager' && (
                        <span className="ml-1 text-[var(--muted-foreground)] dark:text-[var(--foreground)]">(gestor)</span>
                      )}
                    </div>
                    <div className="text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{m.email ?? '—'}</div>
                  </td>
                  <td className="py-1.5 pr-3">
                    <RamalCell
                      member={m}
                      suggestions={suggestions[m.userId] ?? []}
                      disabled={isPending}
                      onSave={(ramal) => assignRamal(m, ramal)}
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <Badge
                      variant="outline"
                      className={badge.className}
                      title={state === 'ready' ? `Sincronizado em ${formatDateTime(m.syncedAt)}` : undefined}
                    >
                      {badge.label}
                    </Badge>
                  </td>
                  <td className="py-1.5">
                    <label className="inline-flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5"
                        checked={m.webphoneEnabled}
                        disabled={isPending || state !== 'ready'}
                        aria-label={`Webphone no navegador para ${m.name}`}
                        onChange={(e) => {
                          const enabled = e.target.checked;
                          startTransition(async () => {
                            const r = await setWebphoneEnabled({ userId: m.userId, enabled });
                            if (r.success) {
                              toast.success(
                                enabled
                                  ? `${m.name}: webphone ligado. A extensão do Chrome dessa pessoa precisa ficar fechada.`
                                  : `${m.name}: webphone desligado`,
                              );
                              router.refresh();
                            } else {
                              toast.error(r.error);
                            }
                          });
                        }}
                      />
                      <span>{m.webphoneEnabled ? 'ligado' : 'desligado'}</span>
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <Api4ComOrgTokenModal
        open={showTokenModal}
        onOpenChange={setShowTokenModal}
        defaultBaseUrl={settings.base_url}
        hasExistingToken={settings.configured}
        onSaved={handleReport}
      />

      <Dialog open={showDisconnect} onOpenChange={setShowDisconnect}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover token da organização?</DialogTitle>
            <DialogDescription>
              Os ramais já sincronizados continuam cadastrados, mas as ligações voltam a depender do token
              próprio de cada pessoa. Quem não tiver token próprio deixa de conseguir ligar.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDisconnect(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const r = await disconnectApi4ComOrg();
                  if (r.success) {
                    toast.success('Token da organização removido');
                    setShowDisconnect(false);
                    router.refresh();
                  } else {
                    toast.error(r.error);
                  }
                })
              }
            >
              Remover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
