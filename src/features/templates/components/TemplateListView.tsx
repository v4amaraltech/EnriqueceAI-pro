'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Copy, FileText, Mail, MessageSquare, MoreHorizontal, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
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

  const [searchValue, setSearchValue] = useState(currentSearch);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Optimistic overrides for instant feedback
  const paramsKey = searchParams.toString();
  const [lastParamsKey, setLastParamsKey] = useState(paramsKey);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  if (paramsKey !== lastParamsKey) {
    setLastParamsKey(paramsKey);
    setOverrides({});
    setSearchValue(searchParams.get('search') ?? '');
  }

  const activeChannel = overrides.channel ?? currentChannel;
  const activeIsSystem = overrides.is_system ?? (searchParams.get('is_system') ?? ALL_VALUE);

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

  const currentSortBy = searchParams.get('sort_by') ?? 'created_at';
  const currentSortDir = searchParams.get('sort_dir') ?? 'desc';

  function handleSort(column: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (currentSortBy === column) {
      params.set('sort_dir', currentSortDir === 'asc' ? 'desc' : 'asc');
    } else {
      params.set('sort_by', column);
      params.set('sort_dir', column === 'name' ? 'asc' : 'desc');
    }
    params.set('page', '1');
    router.push(`/templates?${params.toString()}`);
  }

  function sortIcon(column: string) {
    if (currentSortBy !== column) return <ArrowUpDown className="ml-1 h-3 w-3 opacity-40" />;
    if (currentSortDir === 'asc') return <ArrowUp className="ml-1 h-3 w-3" />;
    return <ArrowDown className="ml-1 h-3 w-3" />;
  }

  function handleChannelChange(channel: string) {
    setOverrides((prev) => ({ ...prev, channel }));
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
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <FileText className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Templates de Mensagem</h1>
            <p className="text-sm text-muted-foreground">
              {filteredTemplates.length} template{filteredTemplates.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <Button onClick={() => router.push('/templates/new')}>
          <Plus className="mr-2 h-4 w-4" />
          Novo Template
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={activeChannel}
          onValueChange={handleChannelChange}
        >
          <TabsList>
            <TabsTrigger value={ALL_VALUE}>Todos</TabsTrigger>
            <TabsTrigger value="email">
              <Mail className="mr-1.5 h-3.5 w-3.5" />
              Email
            </TabsTrigger>
            <TabsTrigger value="whatsapp">
              <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
              WhatsApp
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, assunto ou corpo..."
            value={searchValue}
            className="pl-9 pr-8"
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
          {searchValue && (
            <button
              type="button"
              className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
              onClick={() => {
                setSearchValue('');
                if (debounceRef.current) clearTimeout(debounceRef.current);
                updateParams({ search: '' });
              }}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <Select
          value={activeIsSystem}
          onValueChange={(v) => { setOverrides((prev) => ({ ...prev, is_system: v })); updateParams({ is_system: v }); }}
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
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <div className="mb-4 rounded-full bg-muted p-4">
            <FileText className="h-10 w-10 text-muted-foreground" />
          </div>
          <h3 className="mb-2 text-lg font-semibold">Nenhum template encontrado</h3>
          <p className="mb-6 max-w-sm text-sm text-muted-foreground">
            Crie seu primeiro template para usar nas cadências.
          </p>
          <Button onClick={() => router.push('/templates/new')}>
            <Plus className="mr-2 h-4 w-4" />
            Criar Template
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="w-[25%] pl-4 font-semibold text-foreground">
                <button type="button" className="inline-flex items-center" onClick={() => handleSort('name')}>
                  Nome {sortIcon('name')}
                </button>
              </TableHead>
              <TableHead className="w-[40%] font-semibold text-foreground">Conteúdo</TableHead>
              <TableHead className="w-[15%] font-semibold text-foreground">Responsável</TableHead>
              <TableHead className="w-[12%] font-semibold text-foreground">
                <button type="button" className="inline-flex items-center" onClick={() => handleSort('created_at')}>
                  Criado {sortIcon('created_at')}
                </button>
              </TableHead>
              <TableHead className="w-[8%]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTemplates.map((template) => {
              const isWhatsApp = template.channel === 'whatsapp';
              const ChannelIcon = isWhatsApp ? MessageSquare : Mail;
              const bodyPreview = stripHtml(template.body);
              return (
                <TableRow
                  key={template.id}
                  className="cursor-pointer transition-colors hover:bg-muted/40"
                  onClick={() => router.push(`/templates/${template.id}`)}
                >
                  <TableCell className="pl-4">
                    <div className="flex items-center gap-2">
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${isWhatsApp ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'}`}>
                        <ChannelIcon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <span className="font-medium text-foreground">{template.name}</span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 shrink-0 ${isWhatsApp ? 'border-green-500/30 text-green-600 dark:text-green-400' : 'border-blue-500/30 text-blue-600 dark:text-blue-400'}`}>
                            {channelLabel[template.channel] ?? template.channel}
                          </Badge>
                          {template.is_system && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">Sistema</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {template.subject || '(Sem assunto)'}
                      </p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5 max-w-[400px]">
                        {bodyPreview}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-foreground">
                    {template.created_by ? (userMap[template.created_by] ?? '—') : '—'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
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
          <span className="text-sm text-muted-foreground">
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
