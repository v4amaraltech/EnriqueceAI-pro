'use client';

import { useMemo } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';

import { getAllLeadPhones } from '@/features/activities/utils/resolve-whatsapp-phone';
import type { LeadRow } from '@/features/leads/types';

import { ActivityWhatsAppCallPanel } from './ActivityWhatsAppCallPanel';

/**
 * Ligação via WhatsApp avulsa, disparada pelo botão "Ligar" da tela do lead
 * (fora da fila de atividades). Reusa o discador validado da cadência sem o
 * contexto de enrollment/step — o painel só registra a ligação (calls + BI +
 * gravação→transcrição→SPICED). Ver ActivityWhatsAppCallPanel.
 */
export function LeadWhatsAppCallDialog({
  lead,
  open,
  onOpenChange,
}: {
  lead: LeadRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const phones = useMemo(() => getAllLeadPhones(lead), [lead]);

  const contactName = lead.first_name
    ? `${lead.first_name} ${lead.last_name ?? ''}`.trim()
    : null;
  const companyName = lead.nome_fantasia ?? lead.razao_social ?? null;
  const leadName = contactName ?? companyName ?? 'Lead';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ligar via WhatsApp</DialogTitle>
          <DialogDescription className="sr-only">
            Discador nativo de Ligação via WhatsApp para {leadName}.
          </DialogDescription>
        </DialogHeader>
        {phones.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Este lead não possui número de telefone para ligar.
          </p>
        ) : (
          <ActivityWhatsAppCallPanel
            leadId={lead.id}
            leadName={leadName}
            leadEmail={lead.email}
            leadFirstName={lead.first_name}
            phones={phones}
            activityName={null}
            callScript={null}
            onResolved={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
