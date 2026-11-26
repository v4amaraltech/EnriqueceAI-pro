'use client';

import { useRef, useState, type FormEvent, type MouseEvent } from 'react';

import { toast } from 'sonner';

import { upsertLeadContact } from '@/features/leads/actions/lead-contacts';
import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';

import { validateCallbackAt } from '../utils/callback-slots';
import { appendNoteLine, EMPTY_REFERRAL, parseReferral, referralCallNote, referralReturnNote, type Referral, type ReferralForm } from '../utils/referral';

import { CallbackWhenPicker, formatWhen, useCallbackWhen } from './CallbackWhenPicker';
import type { ScheduleCallbackFn } from './MotorCallbackDialog';

interface ReferContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  /** Mesmo caminho do "Ligar depois". Ausente (fixture /demo): só avisa. */
  scheduleCallback?: ScheduleCallbackFn;
  /** Simulado/fixture: nenhum contato é cadastrado. */
  simulated: boolean;
  previewOnly?: boolean;
  /** Acrescenta a linha na anotação da ligação, grava pelo caminho das anotações e devolve o texto completo. */
  appendCallNote: (leadId: string, line: string) => string;
}

/** O indicado já salvo (e, se já houve tentativa, o horário que ficou valendo). */
interface Saved {
  referral: Referral;
  /** Id do contato cadastrado; null no simulado. */
  contactId: string | null;
  /** O retorno já foi agendado, mas o desfecho falhou: o horário não muda mais (o reenvio manda só o desfecho). */
  scheduledAt: Date | null;
}

/** Nome maior que isso não cabe no botão (largura do celular). */
const MAX_NAME_IN_BUTTON = 12;

const WARNING_CANCELS = 'Isso cancela qualquer retorno já agendado para este lead.';

function ReferForm({
  form,
  setForm,
  saving,
  error,
  onSubmit,
  onCancel,
}: {
  form: ReferralForm;
  setForm: (next: ReferralForm) => void;
  saving: boolean;
  error: string | null;
  onSubmit: (e: FormEvent) => void;
  onCancel: () => void;
}) {
  const field = (key: 'name' | 'phone' | 'email' | 'jobTitle', label: string, type = 'text') => (
    <div className="space-y-1">
      <Label htmlFor={`refer-${key}`} className="text-muted-foreground text-xs">
        {label}
      </Label>
      <Input id={`refer-${key}`} type={type} value={form[key]} disabled={saving} autoComplete="off" onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </div>
  );
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3">
      {field('name', 'Nome (obrigatório)')}
      {field('phone', 'Telefone/WhatsApp (obrigatório se não houver e-mail)', 'tel')}
      <div className="flex items-center gap-2">
        <Checkbox id="refer-whatsapp" checked={form.isWhatsApp} disabled={saving} onCheckedChange={(v) => setForm({ ...form, isWhatsApp: v === true })} />
        <Label htmlFor="refer-whatsapp" className="text-xs">
          É WhatsApp
        </Label>
      </div>
      {field('email', 'E-mail', 'email')}
      {field('jobTitle', 'Cargo')}
      {error && (
        <p className="text-destructive text-xs" role="alert" data-testid="refer-error">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={saving} data-testid="refer-save">
          {saving ? 'Salvando…' : 'Salvar contato'}
        </Button>
      </DialogFooter>
    </form>
  );
}

function NextStep({
  leadId,
  saved,
  sending,
  error,
  onChoose,
}: {
  leadId: string;
  saved: Saved;
  sending: boolean;
  error: string | null;
  onChoose: (at: Date, openLead: boolean) => void;
}) {
  const when = useCallbackWhen('next-business-day-9h');
  const locked = saved.scheduledAt;
  const at = locked ?? when.at;
  const validation = at && !locked ? validateCallbackAt(at, when.openedAt) : null;
  const canGo = Boolean(at && validation?.ok !== false) && !sending;
  const { name, firstName } = saved.referral;

  const choose = (openLead: boolean) => {
    if (at && canGo) onChoose(at, openLead);
  };
  const callNow = (e: MouseEvent) => {
    if (!canGo) {
      e.preventDefault();
      return;
    }
    choose(true);
  };

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium" data-testid="refer-saved">
        {name} salvo. Quando retornar?
      </p>
      <CallbackWhenPicker when={when} testIdPrefix="refer" disabled={sending || locked !== null} />
      {at && (
        <p className="text-sm font-medium" data-testid="refer-when">
          Retorno: {formatWhen(at)}
        </p>
      )}
      {validation && !validation.ok && (
        <p className="text-destructive text-xs" role="alert">
          {validation.error}
        </p>
      )}
      <p className="rounded-md border border-amber-500/60 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">{WARNING_CANCELS}</p>
      <p className="text-muted-foreground text-xs">Quando o retorno vencer, ligue para {name} pelo lead; o motor ainda disca o contato principal.</p>
      {error && (
        <p className="text-destructive text-xs" role="alert" data-testid="refer-error">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <Button type="button" size="sm" disabled={!canGo} onClick={() => choose(false)} data-testid="refer-continue">
          Agendar retorno e seguir a fila
        </Button>
        <Button asChild size="sm" variant="outline">
          <a
            href={`/leads/${leadId}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!canGo}
            className={canGo ? undefined : 'pointer-events-none opacity-50'}
            onClick={callNow}
            data-testid="refer-call-now"
          >
            {firstName.length <= MAX_NAME_IN_BUTTON ? `Agendar retorno e abrir o lead de ${firstName}` : 'Agendar retorno e abrir o lead'}
          </a>
        </Button>
        {sending && <p className="text-muted-foreground text-xs">Registrando…</p>}
      </div>
    </div>
  );
}

/**
 * "Indicou outra pessoa": (1) cadastra o indicado como contato NÃO principal e anota na ligação; (2) o SDR escolhe o próximo
 * passo. As duas saídas agendam o retorno (pausa a cadência) e gravam o desfecho `referred_contact`;
 * a segunda ainda abre o lead em nova aba e pausa a fila.
 * O estado vive aqui fora (não no conteúdo): fechar e reabrir não cadastra o indicado de novo. Montar com `key={leadId}`.
 */
export function ReferContactDialog({ open, onOpenChange, leadId, scheduleCallback, simulated, previewOnly = false, appendCallNote }: ReferContactDialogProps) {
  const [form, setForm] = useState<ReferralForm>(EMPTY_REFERRAL);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Trava contra duplo clique (o `disabled` só vale depois do render).
  const inFlight = useRef(false);
  const dry = simulated || previewOnly;

  async function run(work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function save(e: FormEvent) {
    e.preventDefault();
    const parsed = parseReferral(form);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    const r = parsed.data;
    void run(async () => {
      if (dry) {
        setSaved({ referral: r, contactId: null, scheduledAt: null });
        return;
      }
      const result = await upsertLeadContact({
        leadId,
        first_name: r.firstName,
        last_name: r.lastName,
        job_title: r.jobTitle,
        emails: r.email ? [{ tipo: 'corporativo', email: r.email }] : [],
        phones: r.phone ? [{ tipo: r.phoneType, numero: r.phone }] : [],
        // O indicado nunca vira o decisor do lead, nem quando é o primeiro contato cadastrado.
        neverPrimary: true,
      }).catch(() => null);
      if (!result?.success) {
        setError(result && !result.success ? result.error : 'Não consegui salvar o contato. Tente de novo.');
        return;
      }
      setSaved({ referral: r, contactId: result.data.id, scheduledAt: null });
      appendCallNote(leadId, referralCallNote(r));
    });
  }

  function conclude(at: Date, openLead: boolean) {
    if (!saved) return;
    const r = saved.referral;
    void run(async () => {
      if (!scheduleCallback) {
        toast.message('Fixture de teste: nada é registrado.');
        onOpenChange(false);
        return;
      }
      const line = referralCallNote(r);
      // Texto completo da anotação (com o que o SDR escreveu depois): vai junto com o desfecho.
      const callNotes = dry ? appendNoteLine('', line) : appendCallNote(leadId, line);
      const result = await scheduleCallback({
        scheduledAt: at,
        notes: referralReturnNote(r),
        callNotes,
        disposition: 'referred_contact',
        // Quem vai ligar para o indicado agora não quer o motor discando o próximo lead.
        ...(openLead ? { pauseQueueFor: r.firstName } : {}),
      }).catch(() => null);
      if (result?.ok) {
        onOpenChange(false);
        return;
      }
      if (result && !result.ok && result.retornoSaved) setSaved({ ...saved, scheduledAt: at });
      setError(`Salvei ${r.firstName}, mas não consegui registrar o desfecho. Tentar de novo.${result && !result.ok ? ` (${result.error})` : ''}`);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && inFlight.current) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="bg-background max-h-[90vh] w-full max-w-[480px] overflow-y-auto sm:max-w-[480px]" data-testid="refer-dialog">
        <DialogHeader className="text-left">
          <DialogTitle className="text-base font-semibold">Indicou outra pessoa</DialogTitle>
          <DialogDescription className="text-sm">
            Cadastre quem foi indicado. Fica um retorno e a cadência pausa até lá; ao abrir o lead, a fila também pausa.
          </DialogDescription>
        </DialogHeader>
        {saved ? (
          <NextStep leadId={leadId} saved={saved} sending={busy} error={error} onChoose={conclude} />
        ) : (
          <ReferForm form={form} setForm={setForm} saving={busy} error={error} onSubmit={save} onCancel={() => onOpenChange(false)} />
        )}
        {dry && <p className="text-muted-foreground text-xs">Simulado: nada é registrado.</p>}
      </DialogContent>
    </Dialog>
  );
}
