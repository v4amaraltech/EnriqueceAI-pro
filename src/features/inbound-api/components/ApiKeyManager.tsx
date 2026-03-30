'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, Check, Key, Plus, Trash2, XCircle } from 'lucide-react';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';

import type { ApiKeySafe } from '../types';
import { revokeApiKeyAction, deleteApiKeyAction } from '../actions/manage-api-keys';
import { ApiKeyCreateDialog } from './ApiKeyCreateDialog';

interface Props {
  initialKeys: ApiKeySafe[];
}

export function ApiKeyManager({ initialKeys }: Props) {
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ type: 'revoke' | 'delete'; key: ApiKeySafe } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [copiedEndpoint, setCopiedEndpoint] = useState<string | null>(null);

  function handleRevoke(key: ApiKeySafe) {
    startTransition(async () => {
      const result = await revokeApiKeyAction(key.id);
      if (result.success) {
        toast.success('Chave revogada');
        router.refresh();
      } else {
        toast.error(result.error);
      }
      setConfirmAction(null);
    });
  }

  function handleDelete(key: ApiKeySafe) {
    startTransition(async () => {
      const result = await deleteApiKeyAction(key.id);
      if (result.success) {
        toast.success('Chave excluída');
        router.refresh();
      } else {
        toast.error(result.error);
      }
      setConfirmAction(null);
    });
  }

  function copyEndpoint(endpoint: string) {
    navigator.clipboard.writeText(endpoint);
    setCopiedEndpoint(endpoint);
    setTimeout(() => setCopiedEndpoint(null), 2000);
  }

  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const restEndpoint = `${appUrl}/api/v1/leads`;
  const webhookEndpoint = `${appUrl}/api/webhooks/inbound-leads`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Chaves de API</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            Gerencie chaves para receber leads de plataformas externas.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          Criar Chave
        </Button>
      </div>

      {/* Keys table */}
      {initialKeys.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
          <Key className="h-10 w-10 text-[var(--muted-foreground)]" />
          <p className="text-sm text-[var(--muted-foreground)]">Nenhuma chave de API criada.</p>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Criar Primeira Chave
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Prefixo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Último uso</TableHead>
                <TableHead>Criada em</TableHead>
                <TableHead>Expira em</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialKeys.map((key) => (
                <TableRow key={key.id}>
                  <TableCell className="font-medium">{key.name}</TableCell>
                  <TableCell>
                    <code className="rounded bg-[var(--muted)] px-1.5 py-0.5 text-xs">{key.key_prefix}...</code>
                  </TableCell>
                  <TableCell>
                    {key.is_active ? (
                      <Badge variant="outline" className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">Ativa</Badge>
                    ) : (
                      <Badge variant="outline" className="bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">Revogada</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-[var(--muted-foreground)]">
                    {key.last_used_at
                      ? new Date(key.last_used_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                      : 'Nunca'}
                  </TableCell>
                  <TableCell className="text-sm text-[var(--muted-foreground)]">
                    {new Date(key.created_at).toLocaleDateString('pt-BR')}
                  </TableCell>
                  <TableCell className="text-sm text-[var(--muted-foreground)]">
                    {key.expires_at
                      ? new Date(key.expires_at).toLocaleDateString('pt-BR')
                      : 'Sem expiração'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {key.is_active && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmAction({ type: 'revoke', key })}
                        >
                          <XCircle className="mr-1 h-3.5 w-3.5" />
                          Revogar
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:text-red-700"
                        onClick={() => setConfirmAction({ type: 'delete', key })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Endpoints documentation */}
      <div className="rounded-lg border p-4 space-y-4">
        <h3 className="text-sm font-semibold">Endpoints</h3>

        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-[var(--muted-foreground)]">REST API (lead único)</p>
              <Button variant="ghost" size="sm" onClick={() => copyEndpoint(restEndpoint)}>
                {copiedEndpoint === restEndpoint ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <code className="block rounded bg-[var(--muted)] p-2 text-xs font-mono break-all">
              POST {restEndpoint}
            </code>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-[var(--muted-foreground)]">Webhook (batch, field mapping automático)</p>
              <Button variant="ghost" size="sm" onClick={() => copyEndpoint(webhookEndpoint)}>
                {copiedEndpoint === webhookEndpoint ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <code className="block rounded bg-[var(--muted)] p-2 text-xs font-mono break-all">
              POST {webhookEndpoint}
            </code>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-[var(--muted-foreground)]">Exemplo curl</p>
          <pre className="overflow-x-auto rounded bg-[var(--muted)] p-3 text-xs font-mono">
{`curl -X POST ${restEndpoint} \\
  -H "Authorization: Bearer SUA_CHAVE_API" \\
  -H "Content-Type: application/json" \\
  -d '{"first_name":"Carlos","email":"carlos@empresa.com","empresa":"XPTO"}'`}
          </pre>
        </div>

        {/* Fields documentation */}
        <div>
          <p className="mb-2 text-xs font-medium text-[var(--muted-foreground)]">Campos disponíveis</p>
          <div className="overflow-x-auto rounded border border-[var(--border)]">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-[var(--muted)]/50">
                  <th className="p-2 text-left font-semibold">Campo</th>
                  <th className="p-2 text-left font-semibold">Tipo</th>
                  <th className="p-2 text-left font-semibold">Obrigatório</th>
                  <th className="p-2 text-left font-semibold">Descrição</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                <tr className="border-b"><td className="p-2">first_name</td><td className="p-2">string</td><td className="p-2 text-[#E53935]">Sim</td><td className="p-2 font-sans">Primeiro nome do contato</td></tr>
                <tr className="border-b"><td className="p-2">last_name</td><td className="p-2">string</td><td className="p-2">Não</td><td className="p-2 font-sans">Sobrenome</td></tr>
                <tr className="border-b"><td className="p-2">email</td><td className="p-2">string</td><td className="p-2">Não</td><td className="p-2 font-sans">E-mail do contato</td></tr>
                <tr className="border-b"><td className="p-2">telefone</td><td className="p-2">string</td><td className="p-2">Não</td><td className="p-2 font-sans">Telefone (formato livre)</td></tr>
                <tr className="border-b"><td className="p-2">empresa</td><td className="p-2">string</td><td className="p-2">Não</td><td className="p-2 font-sans">Nome da empresa (nome fantasia)</td></tr>
                <tr className="border-b"><td className="p-2">cnpj</td><td className="p-2">string</td><td className="p-2">Não</td><td className="p-2 font-sans">CNPJ (14 dígitos, sem pontuação)</td></tr>
                <tr className="border-b"><td className="p-2">job_title</td><td className="p-2">string</td><td className="p-2">Não</td><td className="p-2 font-sans">Cargo do contato</td></tr>
                <tr className="border-b"><td className="p-2">lead_source</td><td className="p-2">string</td><td className="p-2">Não</td><td className="p-2 font-sans">Origem (ex: Outbound, Inbound Marketing)</td></tr>
                <tr className="border-b"><td className="p-2">canal</td><td className="p-2">string</td><td className="p-2">Não</td><td className="p-2 font-sans">Canal (ex: Facebook, Google, Instagram)</td></tr>
                <tr className="border-b"><td className="p-2">is_inbound</td><td className="p-2">boolean</td><td className="p-2">Não</td><td className="p-2 font-sans">Se é lead inbound (default: true)</td></tr>
                <tr className="border-b"><td className="p-2">assigned_to</td><td className="p-2">UUID</td><td className="p-2">Não</td><td className="p-2 font-sans">ID do SDR responsável</td></tr>
                <tr className="border-b"><td className="p-2">notes</td><td className="p-2">string</td><td className="p-2">Não</td><td className="p-2 font-sans">Observações sobre o lead</td></tr>
                <tr className="border-b"><td className="p-2">linkedin</td><td className="p-2">string</td><td className="p-2">Não</td><td className="p-2 font-sans">URL do LinkedIn</td></tr>
                <tr className="border-b"><td className="p-2">website</td><td className="p-2">string</td><td className="p-2">Não</td><td className="p-2 font-sans">URL do site</td></tr>
                <tr><td className="p-2">custom_fields</td><td className="p-2">object</td><td className="p-2">Não</td><td className="p-2 font-sans">Campos personalizados {"{ \"campo_id\": \"valor\" }"}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Create dialog */}
      <ApiKeyCreateDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={() => router.refresh()}
      />

      {/* Confirm action dialog */}
      <Dialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmAction?.type === 'revoke' ? 'Revogar Chave' : 'Excluir Chave'}
            </DialogTitle>
            <DialogDescription>
              {confirmAction?.type === 'revoke'
                ? `Tem certeza que deseja revogar a chave "${confirmAction.key.name}"? Requisições usando esta chave serão rejeitadas.`
                : `Tem certeza que deseja excluir permanentemente a chave "${confirmAction?.key.name}"?`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() => {
                if (!confirmAction) return;
                if (confirmAction.type === 'revoke') {
                  handleRevoke(confirmAction.key);
                } else {
                  handleDelete(confirmAction.key);
                }
              }}
            >
              {isPending
                ? (confirmAction?.type === 'revoke' ? 'Revogando...' : 'Excluindo...')
                : (confirmAction?.type === 'revoke' ? 'Revogar' : 'Excluir')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
