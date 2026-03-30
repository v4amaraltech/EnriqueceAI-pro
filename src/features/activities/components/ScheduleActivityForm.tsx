'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarIcon, Linkedin, Mail, MessageSquare, Phone, Search } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { Button } from '@/shared/components/ui/button';
import { Calendar } from '@/shared/components/ui/calendar';
import { Label } from '@/shared/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Textarea } from '@/shared/components/ui/textarea';
import { cn } from '@/lib/utils';

import { scheduleActivity } from '../actions/schedule-activity';

const CHANNELS = [
  { value: 'phone', label: 'Ligação', icon: Phone },
  { value: 'whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'linkedin', label: 'LinkedIn', icon: Linkedin },
  { value: 'research', label: 'Pesquisa', icon: Search },
] as const;

const HOURS = Array.from({ length: 12 }, (_, i) => {
  const h = i + 8; // 08:00 to 19:00
  return [`${h.toString().padStart(2, '0')}:00`, `${h.toString().padStart(2, '0')}:30`];
}).flat();

interface ScheduleActivityFormProps {
  leadId: string;
}

export function ScheduleActivityForm({ leadId }: ScheduleActivityFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [channel, setChannel] = useState<string>('phone');
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [time, setTime] = useState<string>('09:00');
  const [notes, setNotes] = useState('');

  function handleSubmit() {
    if (!date) {
      toast.error('Selecione uma data');
      return;
    }

    const [hours, minutes] = time.split(':').map(Number);
    const scheduledAt = new Date(date);
    scheduledAt.setHours(hours!, minutes!, 0, 0);

    startTransition(async () => {
      const result = await scheduleActivity({
        leadId,
        channel: channel as 'phone' | 'whatsapp' | 'email' | 'linkedin' | 'research',
        scheduledAt: scheduledAt.toISOString(),
        notes: notes.trim() || undefined,
        completeEnrollments: true,
      });

      if (result.success) {
        toast.success('Atividade agendada com sucesso');
        setDate(undefined);
        setNotes('');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Channel */}
      <div className="space-y-1.5">
        <Label>Tipo de atividade</Label>
        <Select value={channel} onValueChange={setChannel}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHANNELS.map((ch) => (
              <SelectItem key={ch.value} value={ch.value}>
                <div className="flex items-center gap-2">
                  <ch.icon className="h-4 w-4" />
                  {ch.label}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Date + Time */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Data</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn('w-full justify-start text-left font-normal', !date && 'text-muted-foreground')}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {date ? format(date, 'dd/MM/yyyy', { locale: ptBR }) : 'Selecionar'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
              <Calendar
                mode="single"
                selected={date}
                onSelect={setDate}
                locale={ptBR}
                disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className="space-y-1.5">
          <Label>Horário</Label>
          <Select value={time} onValueChange={setTime}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOURS.map((h) => (
                <SelectItem key={h} value={h}>{h}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-1.5">
        <Label>Observações (opcional)</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Ex: Ligar para confirmar interesse..."
          rows={3}
        />
      </div>

      {/* Submit */}
      <Button onClick={handleSubmit} disabled={isPending || !date} className="w-full">
        {isPending ? 'Agendando...' : 'Agendar atividade'}
      </Button>

      <p className="text-xs text-[var(--muted-foreground)] text-center">
        As cadências ativas deste lead serão encerradas automaticamente.
      </p>
    </div>
  );
}
