'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Key, RefreshCw, Unplug, X } from 'lucide-react';
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

import { disconnectApi4ComOrg, setWebphoneEnabled, syncApi4ComExtensions } from '../actions/manage-api4com-org';
import type { Api4ComOrgOverview, Api4ComSyncReport } from '../types';
import { Api4ComOrgTokenModal } from './Api4ComOrgTokenModal';

interface Api4ComOrgCardProps {
  overview: Api4ComOrgOverview;
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
    pending.push(`${a.name}: mais de um ramal para ${a.email ?? 'o e-mail'} (${a.ramais.join(', ')}). Escolha um pelo "Gerenciar" do usuário.`);
  }
  for (const u of report.unmatched) {
    pending.push(`${u.name}: nenhum ramal na API4COM com o e-mail ${u.email ?? '(sem e-mail)'}.`);
  }
  for (const m of report.missing) {
    pending.push(`${m.name}: o ramal ${m.ramal} não existe mais na conta.`);
  }
  return { summary, pending };
}

export function Api4ComOrgCard({ overview }: Api4ComOrgCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [showDisconnect, setShowDisconnect] = useState(false);
  const [pending, setPending] = useState<string[]>([]);

  const { settings, team } = overview;

  function handleReport(report: Api4ComSyncReport) {
    const { summary, pending: items } = describeSyncReport(report);
    setPending(items);
    if (items.length === 0) toast.success(`Ramais sincronizados: ${summary}`);
    else toast.warning(`Ramais sincronizados: ${summary}. ${items.length} pendência(s) abaixo.`);
    router.refresh();
  }

  return (
    <div className="border-b border-[var(--border)] bg-[var(--muted)]/20 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-10 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Conta da organização</span>
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
              ? `Domínio ${settings.sip_domain ?? 'não identificado'} · Última sincronização: ${formatDateTime(settings.last_synced_at)}`
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

      {pending.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          {pending.map((item) => (
            <li key={item}>• {item}</li>
          ))}
        </ul>
      )}

      {team.length > 0 && (
        <table className="mt-3 w-full text-xs">
          <thead>
            <tr className="text-left text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              <th className="py-1 pr-3 font-medium">Pessoa</th>
              <th className="py-1 pr-3 font-medium">E-mail</th>
              <th className="py-1 pr-3 font-medium">Ramal</th>
              <th className="py-1 pr-3 font-medium">Senha SIP</th>
              <th className="py-1 pr-3 font-medium">Sincronizado</th>
              <th className="py-1 font-medium" title="Atende a ligação na própria página, sem a extensão do Chrome">Webphone</th>
            </tr>
          </thead>
          <tbody>
            {team.map((m) => (
              <tr key={m.userId} className="border-t border-[var(--border)]/60">
                <td className="py-1 pr-3">
                  {m.name}
                  {m.role === 'manager' && (
                    <span className="ml-1 text-[var(--muted-foreground)] dark:text-[var(--foreground)]">(gestor)</span>
                  )}
                </td>
                <td className="py-1 pr-3 text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{m.email ?? '—'}</td>
                <td className="py-1 pr-3">
                  {m.ramal ? (
                    <span className="font-medium">{m.ramal}</span>
                  ) : (
                    <span className="text-amber-700 dark:text-amber-300">sem ramal</span>
                  )}
                  {m.hasOwnToken && (
                    <span className="ml-1 text-[var(--muted-foreground)] dark:text-[var(--foreground)]">· token próprio</span>
                  )}
                </td>
                <td className="py-1 pr-3">{m.hasSipPassword ? 'sim' : '—'}</td>
                <td className="py-1 pr-3">{formatDateTime(m.syncedAt)}</td>
                <td className="py-1">
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5"
                      checked={m.webphoneEnabled}
                      disabled={isPending || !m.ramal || !m.hasSipPassword}
                      aria-label={`Webphone no navegador para ${m.name}`}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        startTransition(async () => {
                          const r = await setWebphoneEnabled({ userId: m.userId, enabled });
                          if (r.success) {
                            toast.success(enabled ? `${m.name}: webphone ligado. A extensão do Chrome dessa pessoa precisa ficar fechada.` : `${m.name}: webphone desligado`);
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
            ))}
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
