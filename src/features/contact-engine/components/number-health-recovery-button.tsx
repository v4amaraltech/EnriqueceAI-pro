'use client';

import { useState } from 'react';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/components/ui/dialog';
import { Textarea } from '@/shared/components/ui/textarea';
import { Label } from '@/shared/components/ui/label';
import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import { authorizeNumberRecoveryAction } from '@/features/contact-engine/actions/authorize-number-recovery';
import type { NumberHealthState } from '@/features/contact-engine/types';

interface NumberHealthRecoveryButtonProps {
  instanceId: string;
  instanceName: string;
  healthState: NumberHealthState;
  pauseReason: string | null;
  connectionStatus: string;
  /** Flag ligada para a organizacao (validado no servidor, mas passado para UI). */
  flagEnabled: boolean;
  onRecovered?: () => void;
}

/**
 * Botao de recuperacao autorizada para numeros pausados pela saude.
 *
 * Exibe dialogo com motivo da pausa e campo de justificativa (minimo 10 caracteres).
 * Somente habilitado para gestor da mesma org com flag ligada, estado paused/review
 * e WhatsApp reconectado.
 *
 * Actor e role derivam da sessao validada no servidor. Cliente nao tem escrita
 * privilegiada: toda validacao e aplicacao ocorrem no servidor via action.
 */
export function NumberHealthRecoveryButton({
  instanceId,
  instanceName,
  healthState,
  pauseReason,
  connectionStatus,
  flagEnabled,
  onRecovered,
}: NumberHealthRecoveryButtonProps) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Botao so e habilitado para estados paused ou review, com WhatsApp reconectado E flag ligada.
  const canRecover =
    flagEnabled && (healthState === 'paused' || healthState === 'review') && connectionStatus === 'connected';

  const handleRecover = async () => {
    if (note.trim().length < 10) {
      setError('Justificativa deve ter no mínimo 10 caracteres');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await authorizeNumberRecoveryAction(instanceId, note.trim());

      if (result.success) {
        setOpen(false);
        setNote('');
        onRecovered?.();
      } else {
        setError(result.error ?? 'Erro ao recuperar numero');
      }
    } catch (err) {
      console.error('[recovery-button] Error:', err);
      setError('Erro ao recuperar numero');
    } finally {
      setLoading(false);
    }
  };

  if (!canRecover) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Recuperar número
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>Recuperar {instanceName}</DialogTitle>
          <DialogDescription>
            Autorize a recuperação do número pausado pela saúde. A recuperação volta o número para o estágio
            warming, preservando o estágio de rampa, tetos e histórico. Reconectar sozinho não despausa.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {pauseReason && (
            <Alert>
              <AlertDescription>
                <strong>Motivo da pausa:</strong> {pauseReason}
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="note">
              Justificativa da recuperação <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="note"
              placeholder="Descreva a razão para recuperar este número (mínimo 10 caracteres)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              disabled={loading}
            />
            <p className="text-sm text-muted-foreground">{note.trim().length} / 10 caracteres mínimos</p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleRecover} disabled={loading || note.trim().length < 10}>
            {loading ? 'Recuperando...' : 'Recuperar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
