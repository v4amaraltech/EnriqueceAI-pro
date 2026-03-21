'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Pause, Play, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';

import type { EnrollmentWithLead } from '../cadences.contract';
import type { EnrollmentStatus } from '../types';
import { removeEnrollment, updateEnrollmentStatus } from '../actions/manage-enrollments';

interface EnrollmentsListProps {
  enrollments: EnrollmentWithLead[];
}

const statusConfig: Record<EnrollmentStatus, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  active: { label: 'Ativo', variant: 'default' },
  paused: { label: 'Pausado', variant: 'secondary' },
  completed: { label: 'Completo', variant: 'outline' },
  replied: { label: 'Respondeu', variant: 'outline' },
  bounced: { label: 'Bounce', variant: 'destructive' },
  unsubscribed: { label: 'Desincrito', variant: 'secondary' },
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function EnrollmentsList({ enrollments }: EnrollmentsListProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleStatusChange(enrollmentId: string, newStatus: EnrollmentStatus) {
    startTransition(async () => {
      const result = await updateEnrollmentStatus(enrollmentId, newStatus);
      if (result.success) {
        toast.success(newStatus === 'paused' ? 'Enrollment pausado' : 'Enrollment retomado');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleRemove(enrollmentId: string) {
    startTransition(async () => {
      const result = await removeEnrollment(enrollmentId);
      if (result.success) {
        toast.success('Lead removido da cadência');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  if (enrollments.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        Nenhum lead inscrito nesta cadência ainda.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Lead</TableHead>
          <TableHead>CNPJ</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Step Atual</TableHead>
          <TableHead>Data Inscrição</TableHead>
          <TableHead className="text-right">Ações</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {enrollments.map((enrollment) => {
          const config = statusConfig[enrollment.status];
          return (
            <TableRow key={enrollment.id}>
              <TableCell className="font-medium">
                {enrollment.lead_name ?? '—'}
              </TableCell>
              <TableCell className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                {enrollment.lead_cnpj}
              </TableCell>
              <TableCell>
                <Badge variant={config.variant}>{config.label}</Badge>
              </TableCell>
              <TableCell>{enrollment.current_step}</TableCell>
              <TableCell className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                {formatDate(enrollment.enrolled_at)}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  {enrollment.status === 'active' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      disabled={isPending}
                      onClick={() => handleStatusChange(enrollment.id, 'paused')}
                      title="Pausar"
                    >
                      <Pause className="h-4 w-4" />
                    </Button>
                  )}
                  {enrollment.status === 'paused' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      disabled={isPending}
                      onClick={() => handleStatusChange(enrollment.id, 'active')}
                      title="Retomar"
                    >
                      <Play className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-red-500 hover:text-red-700"
                    disabled={isPending}
                    onClick={() => handleRemove(enrollment.id)}
                    title="Remover"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
