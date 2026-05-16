'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Calendar, Video } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';

import { getCalendarAuthUrl } from '@/features/integrations/actions/manage-calendar';
import { scheduleMeeting, getLoggedUserEmail, checkCalendarConnected, getLeadFaturamento } from '@/features/integrations/actions/schedule-meeting';
import { getMissingMeetingFields } from '../actions/get-missing-meeting-fields';
import type { MissingRequiredField } from '../utils/required-field-validation';
import { listClosers, type CloserRow } from '@/features/settings-prospecting/actions/closers-crud';

function parseFaturamentoInput(input: string): number | null {
  const cleaned = input.replace(/[^\d,]/g, '').replace(',', '.');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function formatFaturamentoForInput(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

interface LeadScheduleTabProps {
  leadId: string;
  leadEmail: string | null;
  companyName: string | null;
}

export function LeadScheduleTab({ leadId, leadEmail, companyName }: LeadScheduleTabProps) {
  const router = useRouter();
  const [meetingDate, setMeetingDate] = useState('');
  const [meetingTime, setMeetingTime] = useState('09:00');
  const [meetingDuration, setMeetingDuration] = useState('30');
  const [meetingTitle, setMeetingTitle] = useState('');
  const [meetingAttendee, setMeetingAttendee] = useState('');
  const [meetingMeetLink, setMeetingMeetLink] = useState(true);
  const [isMeetingPending, startMeetingTransition] = useTransition();

  // Closer selection
  const [closers, setClosers] = useState<CloserRow[]>([]);
  const [closersLoaded, setClosersLoaded] = useState(false);
  const [selectedCloserId, setSelectedCloserId] = useState('');
  const [sdrEmail, setSdrEmail] = useState('');
  const [calendarConnected, setCalendarConnected] = useState<boolean | null>(null);
  const [faturamentoStr, setFaturamentoStr] = useState('');
  const [missingFields, setMissingFields] = useState<MissingRequiredField[]>([]);

  // Build attendee list from available emails
  function buildAttendees(closerEmail?: string, currentSdrEmail?: string) {
    const emails = [
      leadEmail,
      closerEmail,
      currentSdrEmail ?? sdrEmail,
    ].filter((e): e is string => !!e && e.trim() !== '');
    // Deduplicate
    return [...new Set(emails)].join(', ');
  }

  useEffect(() => {
    Promise.all([
      listClosers(),
      getLoggedUserEmail(),
      checkCalendarConnected(),
      getLeadFaturamento(leadId),
      getMissingMeetingFields(leadId),
    ]).then(([closersResult, emailResult, calResult, faturamentoResult, missingResult]) => {
      if (closersResult.success) setClosers(closersResult.data);
      setClosersLoaded(true);
      const userEmail = emailResult.success ? emailResult.data : '';
      setSdrEmail(userEmail);
      setMeetingAttendee(buildAttendees(undefined, userEmail));
      if (calResult.success) setCalendarConnected(calResult.data);
      if (faturamentoResult.success && faturamentoResult.data !== null) {
        setFaturamentoStr(formatFaturamentoForInput(faturamentoResult.data));
      }
      if (missingResult.success) setMissingFields(missingResult.data);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  const defaultTitle = `V4 Company + ${companyName ?? 'Lead'}`;

  return (
    <div className="space-y-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        Agendar Reunião
      </h4>

      {calendarConnected === false && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 p-3 text-sm text-amber-800 dark:text-amber-200">
          Google Calendar não conectado. Conecte em <strong>Integrações</strong> para agendar reuniões.
        </div>
      )}

      <div>
        <Label className="text-xs">Título</Label>
        <Input
          value={meetingTitle}
          onChange={(e) => setMeetingTitle(e.target.value)}
          placeholder={defaultTitle}
          className="mt-1"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Data</Label>
          <Input
            type="date"
            value={meetingDate}
            onChange={(e) => setMeetingDate(e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs">Hora</Label>
          <Input
            type="time"
            value={meetingTime}
            onChange={(e) => setMeetingTime(e.target.value)}
            className="mt-1"
          />
        </div>
      </div>

      <div>
        <Label className="text-xs">Duração</Label>
        <select
          className="mt-1 flex h-9 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1 text-sm"
          value={meetingDuration}
          onChange={(e) => setMeetingDuration(e.target.value)}
        >
          <option value="15">15 min</option>
          <option value="30">30 min</option>
          <option value="45">45 min</option>
          <option value="60">1 hora</option>
          <option value="90">1h30</option>
        </select>
      </div>

      <div>
        <Label className="text-xs">Closer (participante)</Label>
        <select
          className="mt-1 flex h-9 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1 text-sm"
          value={selectedCloserId}
          disabled={!closersLoaded}
          onChange={(e) => {
            const closerId = e.target.value;
            setSelectedCloserId(closerId);
            const closer = closers.find((c) => c.id === closerId);
            setMeetingAttendee(buildAttendees(closer?.email));
          }}
        >
          {!closersLoaded ? (
            <option value="">Carregando closers...</option>
          ) : closers.length === 0 ? (
            <option value="">Nenhum closer cadastrado</option>
          ) : (
            <>
              <option value="">Selecione um closer...</option>
              {closers.map((closer) => (
                <option key={closer.id} value={closer.id}>
                  {closer.name} ({closer.email})
                </option>
              ))}
            </>
          )}
        </select>
      </div>

      <div>
        <Label className="text-xs">Emails dos participantes</Label>
        <Input
          value={meetingAttendee}
          onChange={(e) => setMeetingAttendee(e.target.value)}
          placeholder="lead@exemplo.com, sdr@empresa.com"
          className="mt-1"
        />
        <p className="text-[10px] text-[var(--muted-foreground)] mt-1">Separe múltiplos emails com vírgula</p>
      </div>

      <div>
        <Label className="text-xs">
          Faturamento estimado do lead (R$) <span className="text-destructive">*</span>
        </Label>
        <Input
          value={faturamentoStr}
          onChange={(e) => setFaturamentoStr(e.target.value)}
          onBlur={() => {
            const n = parseFaturamentoInput(faturamentoStr);
            if (n !== null) setFaturamentoStr(formatFaturamentoForInput(n));
          }}
          placeholder="R$ 0,00"
          inputMode="decimal"
          className="mt-1"
        />
        <p className="text-[10px] text-[var(--muted-foreground)] mt-1">
          Vai no briefing do closer — obrigatório antes de agendar.
        </p>
      </div>

      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={meetingMeetLink}
          onChange={(e) => setMeetingMeetLink(e.target.checked)}
          className="rounded"
        />
        <Video className="h-3.5 w-3.5" />
        Gerar link do Google Meet
      </label>

      {missingFields.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <p className="font-semibold text-amber-700 dark:text-amber-300">
            ⚠️ Preencha estes campos antes de agendar (vão para o briefing do closer):
          </p>
          <ul className="mt-1.5 ml-4 list-disc text-amber-700 dark:text-amber-300">
            {missingFields.map((f) => <li key={f.key}>{f.label}</li>)}
          </ul>
        </div>
      )}

      <Button
        className="w-full"
        disabled={!meetingDate || !meetingTime || isMeetingPending || parseFaturamentoInput(faturamentoStr) === null || missingFields.length > 0}
        onClick={() => {
          // Send local datetime string (no UTC conversion) — Google Calendar uses timeZone param
          const startIso = `${meetingDate}T${meetingTime}:00`;
          const endMs = new Date(startIso).getTime() + parseInt(meetingDuration, 10) * 60 * 1000;
          const endDate = new Date(endMs);
          const endIso = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}T${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}:00`;
          const title = meetingTitle || defaultTitle;

          const faturamento = parseFaturamentoInput(faturamentoStr);
          if (faturamento === null) {
            toast.error('Informe o faturamento estimado do lead (em R$) antes de agendar.');
            return;
          }

          startMeetingTransition(async () => {
            const result = await scheduleMeeting(leadId, {
              title,
              startTime: startIso,
              endTime: endIso,
              attendeeEmails: (meetingAttendee || leadEmail)
                ? (meetingAttendee || leadEmail || '').split(',').map((e: string) => e.trim()).filter(Boolean)
                : undefined,
              generateMeetLink: meetingMeetLink,
              closerId: selectedCloserId || undefined,
            }, faturamento);

            if (result.success) {
              const meetInfo = result.data.meetLink ? ` | Meet: ${result.data.meetLink}` : '';
              toast.success(`Reunião agendada!${meetInfo}`);
              setMeetingDate('');
              setMeetingTitle('');
              setSelectedCloserId('');
              setMeetingAttendee('');
              router.refresh();
            } else if (result.code === 'GCAL_TOKEN_EXPIRED') {
              toast.info('Reconectando ao Google Calendar...');
              const authResult = await getCalendarAuthUrl();
              if (authResult.success) {
                window.location.href = authResult.data.url;
              } else {
                toast.error('Conexão com o Google expirou. Reconecte em Configurações > Integrações.', { duration: 8000 });
                setTimeout(() => { window.location.href = '/settings/integrations'; }, 1500);
              }
            } else {
              toast.error(result.error);
            }
          });
        }}
      >
        <Calendar className="mr-2 h-4 w-4" />
        {isMeetingPending ? 'Agendando...' : 'Agendar Reunião'}
      </Button>
    </div>
  );
}
