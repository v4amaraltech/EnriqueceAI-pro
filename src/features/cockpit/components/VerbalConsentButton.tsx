'use client';

import { useEffect, useState } from 'react';

import { CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';

import { LEAD_ANSWER_MAX_POLLS, LEAD_ANSWER_POLL_INTERVAL_MS } from '@/features/integrations/webphone/webphone-lead-answer';

import { getVerbalConsentStateAction, recordVerbalConsentAction, type VerbalConsentUiState } from '../actions/verbal-consent';

/**
 * Botão "Aceitou WhatsApp". Só aparece com a flag `consent_capture_v1` ligada para
 * a organização e depois que a ligação foi atendida (dentro da janela do servidor).
 * Registrar é idempotente por ligação.
 */
export function VerbalConsentButton({ callId }: { callId: string }) {
  const [state, setState] = useState<VerbalConsentUiState>('unknown');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;

    async function tick() {
      polls += 1;
      try {
        const res = await getVerbalConsentStateAction({ callId });
        if (cancelled) return;
        if (res.success) {
          setState(res.data.state);
          if (res.data.state !== 'unknown') return;
        }
      } catch {
        // Falha de rede: tenta de novo no próximo ciclo.
      }
      if (cancelled || polls >= LEAD_ANSWER_MAX_POLLS) return;
      timer = setTimeout(tick, LEAD_ANSWER_POLL_INTERVAL_MS);
    }

    timer = setTimeout(tick, LEAD_ANSWER_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [callId]);

  async function handleClick() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await recordVerbalConsentAction({ callId });
      if (res.success) {
        setState('recorded');
        toast.success(res.data.alreadyRecorded ? 'Aceite já registrado' : 'Aceite de WhatsApp registrado');
      } else {
        toast.error(res.error);
      }
    } catch {
      toast.error('Falha ao registrar o aceite');
    } finally {
      setSaving(false);
    }
  }

  if (state === 'recorded') {
    return (
      <p className="flex items-center gap-1.5 text-xs" data-testid="verbal-consent-recorded">
        <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
        Aceite de WhatsApp registrado
      </p>
    );
  }
  if (state !== 'available') return null;
  return (
    <Button size="sm" variant="outline" onClick={handleClick} disabled={saving} data-testid="verbal-consent-button">
      Aceitou WhatsApp
    </Button>
  );
}
