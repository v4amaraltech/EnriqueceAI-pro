'use client';

import { useState, useTransition } from 'react';
import { Check, Copy, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Textarea } from '@/shared/components/ui/textarea';

import { sendWhatsAppInvite } from '../actions/send-whatsapp-invite';

interface MeetingDetails {
  title: string;
  date: string;
  time: string;
  duration: string;
  meetLink?: string | null;
}

interface WhatsAppInviteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  leadName: string;
  /** First name of the contact person — used for the greeting. Falls back to leadName. */
  recipientFirstName?: string | null;
  hasWhatsApp: boolean;
  meeting: MeetingDetails;
}

function buildInviteMessage(greetingName: string, meeting: MeetingDetails): string {
  const dateObj = new Date(`${meeting.date}T${meeting.time}:00`);
  const formattedDate = dateObj.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });
  const formattedTime = meeting.time;

  let msg = `Olá ${greetingName}! 👋\n\n`;
  msg += `Sua reunião foi agendada:\n\n`;
  msg += `📋 *${meeting.title}*\n`;
  msg += `📅 ${formattedDate}\n`;
  msg += `🕐 ${formattedTime} (${meeting.duration} min)\n`;

  if (meeting.meetLink) {
    msg += `\n🔗 Link da reunião:\n${meeting.meetLink}\n`;
  }

  msg += `\nTe esperamos lá! 🤝`;

  return msg;
}

export function WhatsAppInviteModal({
  open,
  onOpenChange,
  leadId,
  leadName,
  recipientFirstName,
  hasWhatsApp,
  meeting,
}: WhatsAppInviteModalProps) {
  const greetingName = recipientFirstName?.trim() || leadName;
  const [message, setMessage] = useState(() => buildInviteMessage(greetingName, meeting));
  const [isPending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  function handleSend() {
    startTransition(async () => {
      const result = await sendWhatsAppInvite({ leadId, message });
      if (result.success) {
        toast.success('Invite enviado via WhatsApp!');
        onOpenChange(false);
      } else if (result.code === 'NO_PHONE') {
        toast.error('Lead não possui telefone cadastrado');
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleCopy() {
    navigator.clipboard.writeText(message);
    setCopied(true);
    toast.success('Mensagem copiada!');
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-emerald-500">
            <MessageCircle className="h-5 w-5" />
            Enviar invite via WhatsApp
          </DialogTitle>
          <p className="text-sm text-[var(--muted-foreground)]">
            Envie os detalhes da reunião para {leadName} no WhatsApp.
          </p>
        </DialogHeader>

        <div className="mt-4 space-y-3">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={10}
            className="resize-none text-sm"
          />
        </div>

        <DialogFooter className="mt-4 gap-2">
          <Button variant="outline" onClick={handleCopy} className="gap-1.5">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copiado' : 'Copiar'}
          </Button>
          {hasWhatsApp ? (
            <Button
              onClick={handleSend}
              disabled={isPending || !message.trim()}
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <MessageCircle className="h-4 w-4" />
              {isPending ? 'Enviando...' : 'Enviar WhatsApp'}
            </Button>
          ) : (
            <Button variant="outline" disabled className="gap-1.5">
              <MessageCircle className="h-4 w-4" />
              WhatsApp não conectado
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
