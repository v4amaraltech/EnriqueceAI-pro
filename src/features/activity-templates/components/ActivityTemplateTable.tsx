'use client';

import { useState, useTransition } from 'react';
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';

import { channelConfig } from '@/features/cadences/components/ActivityTypeSidebar';
import type { ChannelType } from '@/features/cadences/types';

import { deleteActivityTemplate } from '../actions/manage-activity-templates';
import type { ActivityTemplateRow } from '../types';
import type { CategoryKey } from './ActivityTemplateCategorySidebar';
import { categories } from './ActivityTemplateCategorySidebar';
import { ActivityTemplateDialog } from './ActivityTemplateDialog';

interface Props {
  activeCategory: CategoryKey;
  templates: ActivityTemplateRow[];
  onTemplatesChange: (templates: ActivityTemplateRow[]) => void;
}

export function ActivityTemplateTable({ activeCategory, templates, onTemplatesChange }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ActivityTemplateRow | undefined>();
  const [_isPending, startTransition] = useTransition();

  const cat = categories.find((c) => c.key === activeCategory)!;
  const filtered = templates.filter((t) => cat.channels.includes(t.channel));
  const isSocialPoint = activeCategory === 'social';

  // Use the first channel in the category for new templates (for non-social categories)
  const defaultChannel = cat.channels[0] as ChannelType;

  // Pick icon/color from the first channel config
  const config = channelConfig[defaultChannel];

  function handleAdd() {
    setEditingTemplate(undefined);
    setDialogOpen(true);
  }

  function handleEdit(template: ActivityTemplateRow) {
    setEditingTemplate(template);
    setDialogOpen(true);
  }

  function handleDelete(template: ActivityTemplateRow) {
    startTransition(async () => {
      const result = await deleteActivityTemplate(template.id);
      if (result.success) {
        toast.success('Template excluído');
        onTemplatesChange(templates.filter((t) => t.id !== template.id));
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleSaved(saved: ActivityTemplateRow) {
    if (editingTemplate) {
      onTemplatesChange(templates.map((t) => (t.id === saved.id ? saved : t)));
    } else {
      onTemplatesChange([...templates, saved]);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className={cn('flex h-12 w-12 items-center justify-center rounded-full', config.bgColor)}>
          <config.icon className={cn('h-6 w-6', config.color)} />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold">{cat.label}</h2>
          <p className="text-muted-foreground text-sm">
            {filtered.length} {filtered.length === 1 ? 'template' : 'templates'}
          </p>
        </div>
        <Button size="sm" onClick={handleAdd}>
          <Plus className="mr-1 h-4 w-4" />
          Novo template
        </Button>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-muted-foreground flex flex-1 items-center justify-center py-12 text-sm">
          Nenhum template nesta categoria. Clique em &ldquo;Novo template&rdquo; para criar.
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Instruções</TableHead>
                {isSocialPoint && <TableHead className="w-28">Canal</TableHead>}
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="text-muted-foreground max-w-xs truncate">
                    {t.instructions || '—'}
                  </TableCell>
                  {isSocialPoint && (
                    <TableCell>
                      <span className="text-xs">{channelConfig[t.channel]?.label ?? t.channel}</span>
                    </TableCell>
                  )}
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleEdit(t)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleDelete(t)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ActivityTemplateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        channel={defaultChannel}
        isSocialPoint={isSocialPoint}
        template={editingTemplate}
        onSaved={handleSaved}
      />
    </div>
  );
}
