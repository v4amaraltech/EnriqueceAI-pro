'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Copy, FileText, Mail, MessageSquare, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { Input } from '@/shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';

import type { MessageTemplateRow } from '../../cadences/types';
import { deleteTemplate, duplicateTemplate } from '../actions/manage-templates';

interface TemplateListViewProps {
  templates: MessageTemplateRow[];
  total: number;
  page: number;
  perPage: number;
  userMap: Record<string, string>;
}

const ALL_VALUE = '__all__';

const channelLabel: Record<string, string> = {
  email: 'Email',
  whatsapp: 'WhatsApp',
};

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
}

export function TemplateListView({ templates, total, page, perPage, userMap }: TemplateListViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const currentChannel = searchParams.get('channel') ?? ALL_VALUE;
  const currentSearch = searchParams.get('search') ?? '';

  const [activeChannel, setActiveChannel] = useState(currentChannel);
  const [searchValue, setSearchValue] = useState(currentSearch);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSearchValue(currentSearch);
  }, [currentSearch]);

  useEffect(() => {
    setActiveChannel(currentChannel);
  }, [currentChannel]);

  const filteredTemplates = activeChannel === ALL_VALUE
    ? templates
    : templates.filter((t) => t.channel === activeChannel);

  function updateParams(updates: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value || value === ALL_VALUE) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    params.set('page', '1');
    router.push(`/templates?${params.toString()}`);
  }

  function handleChannelChange(channel: string) {
    setActiveChannel(channel);
    updateParams({ channel });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteTemplate(id);
      if (result.success) {
        toast.success('Template deletado');
        router.refresh();
      } else {
        toast.error(result.error);
      }
      setDeleteId(null);
    });
  }

  function handleDuplicate(id: string) {
    startTransition(async () => {
      const result = await duplicateTemplate(id);
      if (result.success) {
        toast.success('Template duplicado');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Templates de Mensagem</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            {filteredTemplates.length} template{filteredTemplates.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button onClick={() => router.push('/templates/new')}>
          <Plus className="mr-2 h-4 w-4" />
          Novo Template
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <Tabs
          value={activeChannel}
          onValueChange={handleChannelChange}
        >
          <TabsList>
            <TabsTrigger value={ALL_VALUE}>Todos</TabsTrigger>
            <TabsTrigger value="email">Email</TabsTrigger>
            <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-[var(--muted-foreground)]" />
          <Input
            placeholder="Buscar por nome, assunto ou corpo..."
            value={searchValue}
            className="pl-9"
            onChange={(e) => {
              const v = e.target.value;
              setSearchValue(v);
              if (debounceRef.current) clearTimeout(debounceRef.current);
              debounceRef.current = setTimeout(() => {
                updateParams({ search: v });
              }, 400);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (debounceRef.current) clearTimeout(debounceRef.current);
                updateParams({ search: searchValue });
              }
            }}
          />
        </div>

        <Select
          value={searchParams.get('is_system') ?? ALL_VALUE}
          onValueChange={(v) => updateParams({ is_system: v })}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>Todos</SelectItem>
            <SelectItem value="true">Sistema</SelectItem>
            <SelectItem value="false">Personalizados</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Template list */}
      {filteredTemplates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 rounded-full bg-[var(--muted)] p-4">
            <FileText className="h-10 w-10 text-[var(--muted-foreground)]" />
          </div>
          <h3 className="mb-2 text-lg font-semibold">Nenhum template encontrado</h3>
          <p className="mb-6 max-w-sm text-sm text-[var(--muted-foreground)]">
            Crie seu primeiro template para usar nas cadências.
          </p>
          <Button onClick={() => router.push('/templates/new')}>
            <Plus className="mr-2 h-4 w-4" />
            Criar Template
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--border)]">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[25%] pl-4">Nome</TableHead>
              <TableHead className="w-[40%]">Conteúdo</TableHead>
              <TableHead className="w-[15%]">Responsável</TableHead>
              <TableHead className="w-[12%]">Criado</TableHead>
              <TableHead className="w-[8%]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTemplates.map((template) => {
              const ChannelIcon = template.channel === 'whatsapp' ? MessageSquare : Mail;
              const bodyPreview = stripHtml(template.body);
              return (
                <TableRow
                  key={template.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/templates/${template.id}`)}
                >
                  <TableCell className="pl-4">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{template.name}</span>
                      <Badge variant="outline" className="text-xs gap-1 shrink-0">
                        <ChannelIcon className="h-3 w-3" />
                        {channelLabel[template.channel] ?? template.channel}
                      </Badge>
                      {template.is_system && (
                        <Badge variant="secondary" className="text-xs shrink-0">Sistema</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="text-sm font-medium truncate">
                        {template.subject || '(Sem assunto)'}
                      </p>
                      <p className="text-xs text-[var(--muted-foreground)] truncate">
                        {bodyPreview}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-[var(--muted-foreground)]">
                    {template.created_by ? (userMap[template.created_by] ?? '—') : '—'}
                  </TableCell>
                  <TableCell className="text-sm text-[var(--muted-foreground)] whitespace-nowrap">
                    {formatShortDate(template.created_at)}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          aria-label={`Ações para ${template.name}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); router.push(`/templates/${template.id}`); }}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleDuplicate(template.id); }}>
                          <Copy className="mr-2 h-4 w-4" />
                          Duplicar
                        </DropdownMenuItem>
                        {!template.is_system && (
                          <DropdownMenuItem
                            className="text-red-600"
                            onClick={(e) => { e.stopPropagation(); setDeleteId(template.id); }}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Deletar
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => {
              const params = new URLSearchParams(searchParams.toString());
              params.set('page', String(page - 1));
              router.push(`/templates?${params.toString()}`);
            }}
          >
            Anterior
          </Button>
          <span className="text-sm text-[var(--muted-foreground)]">
            Página {page} de {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => {
              const params = new URLSearchParams(searchParams.toString());
              params.set('page', String(page + 1));
              router.push(`/templates?${params.toString()}`);
            }}
          >
            Próxima
          </Button>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deletar template</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja deletar este template? Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() => deleteId && handleDelete(deleteId)}
            >
              {isPending ? 'Deletando...' : 'Deletar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
