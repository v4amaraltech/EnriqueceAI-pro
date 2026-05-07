'use client';

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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

import type { OrgMemberOption } from '../actions/fetch-org-members';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  onConfirm: () => void;
  isPending: boolean;
  variant?: 'default' | 'destructive';
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel,
  onConfirm,
  isPending,
  variant = 'destructive',
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant={variant} onClick={onConfirm} disabled={isPending}>
            {isPending ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface EnrichDialogProps {
  enrichType: 'apollo' | null;
  onClose: () => void;
  onConfirm: () => void;
  selectedSize: number;
  isPending: boolean;
}

export function EnrichConfirmDialog({ enrichType, onClose, onConfirm, selectedSize, isPending }: EnrichDialogProps) {
  return (
    <Dialog open={!!enrichType} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enriquecer leads</DialogTitle>
          <DialogDescription>
            {`Deseja enriquecer ${selectedSize} lead${selectedSize > 1 ? 's' : ''} via Apollo? Cada enriquecimento consome 1 crédito.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={onConfirm} disabled={isPending}>
            Enriquecer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface AssignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: OrgMemberOption[];
  assignTarget: string;
  onTargetChange: (value: string) => void;
  onConfirm: () => void;
  selectedSize: number;
  isPending: boolean;
}

export function AssignDialog({ open, onOpenChange, members, assignTarget, onTargetChange, onConfirm, selectedSize, isPending }: AssignDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Atribuir leads</DialogTitle>
          <DialogDescription>
            Selecione o responsável para {selectedSize} lead{selectedSize > 1 ? 's' : ''}.
          </DialogDescription>
        </DialogHeader>
        <Select value={assignTarget} onValueChange={onTargetChange}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione um responsável" />
          </SelectTrigger>
          <SelectContent>
            {members.map((m) => (
              <SelectItem key={m.userId} value={m.userId}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={onConfirm} disabled={!assignTarget || isPending}>
            {isPending ? 'Atribuindo...' : 'Atribuir'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface StatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  statusTarget: string;
  onTargetChange: (value: string) => void;
  onConfirm: () => void;
  selectedSize: number;
  isPending: boolean;
}

export function StatusDialog({ open, onOpenChange, statusTarget, onTargetChange, onConfirm, selectedSize, isPending }: StatusDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Alterar status</DialogTitle>
          <DialogDescription>
            Selecione o novo status para {selectedSize} lead{selectedSize > 1 ? 's' : ''}.
          </DialogDescription>
        </DialogHeader>
        <Select value={statusTarget} onValueChange={onTargetChange}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione um status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="new">Novo</SelectItem>
            <SelectItem value="contacted">Contatado</SelectItem>
            <SelectItem value="qualified">Qualificado</SelectItem>
            <SelectItem value="unqualified">Não Qualificado</SelectItem>
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={onConfirm} disabled={!statusTarget || isPending}>
            {isPending ? 'Alterando...' : 'Alterar status'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { ConfirmDialog };
