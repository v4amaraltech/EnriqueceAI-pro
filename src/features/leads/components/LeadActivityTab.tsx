'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Clock } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

import { scheduleActivity } from '@/features/activities/actions/schedule-activity';

interface LeadActivityTabProps {
  leadId: string;
}

export function LeadActivityTab({ leadId }: LeadActivityTabProps) {
  const router = useRouter();
  const [channel, setChannel] = useState<'phone' | 'whatsapp' | 'email' | 'linkedin' | 'research'>('phone');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('09:00');
  const [notes, setNotes] = useState('');
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        Agendar Atividade
      </h4>

      <div>
        <Label className="text-xs">Tipo de atividade</Label>
        <Select value={channel} onValueChange={(v) => setChannel(v as typeof channel)}>
          <SelectTrigger className="mt-1 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="phone">Ligação</SelectItem>
            <SelectItem value="whatsapp">WhatsApp</SelectItem>
            <SelectItem value="email">Email</SelectItem>
            <SelectItem value="linkedin">LinkedIn</SelectItem>
            <SelectItem value="research">Pesquisa</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Data</Label>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs">Hora</Label>
          <Input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="mt-1"
          />
        </div>
      </div>

      <div>
        <Label className="text-xs">Observações</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Ex: Retornar para verificar interesse..."
          className="mt-1 min-h-[60px]"
        />
      </div>

      <Button
        className="w-full"
        disabled={!date || !time || isPending}
        onClick={() => {
          const scheduledAt = new Date(`${date}T${time}:00`).toISOString();

          startTransition(async () => {
            const result = await scheduleActivity({
              leadId,
              channel,
              scheduledAt,
              notes: notes || undefined,
              completeEnrollments: false,
            });

            if (result.success) {
              toast.success('Atividade agendada!');
              setDate('');
              setNotes('');
              router.refresh();
            } else {
              toast.error(result.error);
            }
          });
        }}
      >
        <Clock className="mr-2 h-4 w-4" />
        {isPending ? 'Agendando...' : 'Agendar Atividade'}
      </Button>
    </div>
  );
}
