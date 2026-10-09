'use client';

import { useEffect, useMemo, useState } from 'react';

import { toast } from 'sonner';

import { buildLeadTemplateVariables } from '@/features/cadences/utils/build-template-variables';
import { renderTemplate } from '@/features/cadences/utils/render-template';
import { fetchVendorVariables } from '@/features/cadences/actions/fetch-vendor-variables';

import { fetchGmailSignature } from '../actions/fetch-gmail-signature';
import { prepareActivityEmail, prepareActivityWhatsApp } from '../actions/prepare-activity-email';
import { fetchWhatsAppTemplates, type WhatsAppTemplateOption } from '../actions/fetch-whatsapp-templates';
import { fetchEmailTemplates, type EmailTemplateOption } from '../actions/fetch-email-templates';
import { checkWhatsAppConnected } from '../actions/check-whatsapp-status';
import { snoozeButtonLabel } from '../constants/skip-reasons';
import { resolveWhatsAppPhone, buildContactPhones } from '../utils/resolve-whatsapp-phone';
import type { PendingActivity } from '../types';

import { listLeadContacts } from '@/features/leads/actions/lead-contacts';
import type { LeadContact } from '@/features/leads/types';

import type { DialerProvider } from '@/features/calls/types/dialer-provider';

import { ActivityEmailCompose } from './ActivityEmailCompose';
import { ActivityWhatsAppCallPanel } from '@/features/whatsapp-calls/components/ActivityWhatsAppCallPanel';

import { ActivityPhonePanel } from './ActivityPhonePanel';
import { ActivityResearchPanel } from './ActivityResearchPanel';
import { ActivitySocialPointPanel } from './ActivitySocialPointPanel';
import { ActivityWhatsAppCompose } from './ActivityWhatsAppCompose';

interface ActivityExecutionSheetContentProps {
  activity: PendingActivity;
  isSending: boolean;
  onSend: (subject: string, body: string, aiGenerated: boolean, phone?: string, contactId?: string | null) => void;
  /** SDR já enviou por fora — registra como enviado sem disparar pela API. */
  onManualSend?: (subject: string, body: string, phone?: string, contactId?: string | null) => void;
  onSkip: () => void;
  /** Adiamentos restantes neste passo — vira "(1 restante)" no botão de adiar. */
  snoozesLeft?: number;
  onMarkDone: (notes: string) => void;
  onLeadLost?: () => void;
  onReportWhatsAppInvalid?: () => void;
  onCallResolved?: () => void;
  dialerProvider?: DialerProvider;
  quickMode?: boolean;
}

export function ActivityExecutionSheetContent({
  activity,
  isSending,
  onSend,
  onManualSend,
  onSkip,
  snoozesLeft,
  onMarkDone,
  onLeadLost,
  onReportWhatsAppInvalid,
  onCallResolved,
  dialerProvider,
  quickMode = false,
}: ActivityExecutionSheetContentProps) {
  const skipLabel = snoozeButtonLabel(snoozesLeft);
  const [isLoading, setIsLoading] = useState(true);
  const [waConnected, setWaConnected] = useState<boolean | null>(null);
  const [subject, setSubject] = useState(activity.templateSubject ?? '');
  const [body, setBody] = useState(activity.templateBody ?? '');
  const [aiPersonalized, setAiPersonalized] = useState(false);
  const [signature, setSignature] = useState('');

  // Múltiplos contatos: cada número passa a mostrar de quem é. Buscamos os
  // contatos do lead e reconstruímos a lista quando o lead muda (lead:updated).
  // Até carregar (ou se o lead não tiver contatos), buildContactPhones cai no
  // getAllLeadPhones — mesma lista de antes.
  const [contacts, setContacts] = useState<LeadContact[]>([]);
  useEffect(() => {
    if (activity.channel !== 'whatsapp' && activity.channel !== 'phone') return;
    let cancelled = false;
    const load = () => {
      void listLeadContacts(activity.lead.id).then((r) => {
        if (!cancelled && r.success) setContacts(r.data);
      });
    };
    load();
    const onUpdated = (e: Event) => {
      const detail = (e as CustomEvent<{ leadId?: string }>).detail;
      if (!detail?.leadId || detail.leadId === activity.lead.id) load();
    };
    window.addEventListener('lead:updated', onUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener('lead:updated', onUpdated);
    };
  }, [activity.lead.id, activity.channel]);

  // Phone resolution for WhatsApp and Phone channels
  const phones = (activity.channel === 'whatsapp' || activity.channel === 'phone')
    ? buildContactPhones(contacts, activity.lead)
    : [];
  const defaultPhone = activity.channel === 'whatsapp'
    ? (resolveWhatsAppPhone(activity.lead)?.formatted ?? '')
    : '';

  // Resolve email: socios enriched emails (by ranking) → lead.email fallback
  const resolvedEmail = activity.channel !== 'whatsapp'
    ? ((activity.lead.socios ?? [])
        .flatMap((s) => s.emails ?? [])
        .sort((a, b) => a.ranking - b.ranking)[0]?.email
      ?? activity.lead.email
      ?? '')
    : '';

  const [to, setTo] = useState(
    activity.channel === 'whatsapp'
      ? defaultPhone
      : resolvedEmail,
  );

  // WhatsApp templates
  const [waTemplates, setWaTemplates] = useState<WhatsAppTemplateOption[]>([]);
  // Email templates — permite ao SDR escolher/trocar o template na hora de
  // executar, inclusive quando o passo da cadência não tem template vinculado.
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplateOption[]>([]);
  const [currentTemplateId, setCurrentTemplateId] = useState<string | null>(activity.templateId);
  const [vendorVars, setVendorVars] = useState<Record<string, string | null>>({});

  const leadName = activity.lead.nome_fantasia ?? activity.lead.razao_social ?? activity.lead.cnpj;

  // Fetch prepared message on mount (key prop on parent forces remount per activity)
  useEffect(() => {
    let cancelled = false;

    // Fetch vendor variables for client-side template rendering
    fetchVendorVariables().then((r) => {
      if (!cancelled && r.success) setVendorVars({ ...r.data });
    });

    if (activity.channel === 'whatsapp') {
      // Check WhatsApp connection status
      checkWhatsAppConnected().then((connected) => {
        if (!cancelled) setWaConnected(connected);
      });

      // Fetch templates in parallel with preparing the message
      fetchWhatsAppTemplates().then((result) => {
        if (!cancelled && result.success) {
          setWaTemplates(result.data);
        }
      });

      prepareActivityWhatsApp({
        lead: activity.lead,
        templateSubject: activity.templateSubject,
        templateBody: activity.templateBody,
        aiPersonalization: activity.aiPersonalization,
        channel: 'whatsapp',
      }).then((result) => {
        if (cancelled) return;
        if (result.success) {
          setTo(result.data.to);
          setBody(result.data.body);
          setAiPersonalized(result.data.aiPersonalized);
        } else {
          toast.error(result.error);
        }
        setIsLoading(false);
      }).catch(() => {
        if (!cancelled) setIsLoading(false);
      });
    } else if (activity.channel === 'email') {
      // Fetch signature in parallel with preparing the email
      fetchGmailSignature().then((r) => {
        if (!cancelled && r.success && r.data) setSignature(r.data);
      });

      // Fetch email templates in parallel — used by the template selector
      fetchEmailTemplates().then((result) => {
        if (!cancelled && result.success) {
          setEmailTemplates(result.data);
        }
      });

      prepareActivityEmail({
        lead: activity.lead,
        templateSubject: activity.templateSubject,
        templateBody: activity.templateBody,
        aiPersonalization: activity.aiPersonalization,
        channel: activity.channel,
      }).then((result) => {
        if (cancelled) return;
        if (result.success) {
          if (result.data.to) setTo(result.data.to);
          setSubject(result.data.subject);
          setBody(result.data.body);
          setAiPersonalized(result.data.aiPersonalized);
        } else {
          toast.error(result.error);
        }
        setIsLoading(false);
      }).catch(() => {
        if (!cancelled) setIsLoading(false);
      });
    } else {
      // phone, linkedin, research — no auto-prepare needed
      setIsLoading(false);
    }

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity.enrollmentId]);

  // Compute template variables (lead + vendor), passing socioNome for primeiro_nome fallback
  const socioNome = (activity.lead.socios ?? [])[0]?.nome ?? null;
  const templateVariables = useMemo(
    () => ({ ...buildLeadTemplateVariables(activity.lead, socioNome), ...vendorVars }),
    [activity.lead, socioNome, vendorVars],
  );

  // Compute rendered preview by resolving any {{variables}} in body and subject
  const renderedPreview = useMemo(
    () => renderTemplate(body, templateVariables),
    [body, templateVariables],
  );

  const renderedSubject = useMemo(
    () => renderTemplate(subject, templateVariables),
    [subject, templateVariables],
  );

  function handleTemplateChange(templateId: string) {
    const tpl = waTemplates.find((t) => t.id === templateId);
    if (!tpl) return;
    setCurrentTemplateId(templateId);

    // Render variables immediately so the textarea shows resolved text
    setBody(renderTemplate(tpl.body, templateVariables));
    setAiPersonalized(false);
  }

  function handleEmailTemplateChange(templateId: string) {
    const tpl = emailTemplates.find((t) => t.id === templateId);
    if (!tpl) return;
    setCurrentTemplateId(templateId);
    setAiPersonalized(false);

    // Render no servidor (mesmo caminho do carregamento inicial) para resolver
    // variáveis de vendedor/{{referencia}} com escaping dos valores do lead.
    prepareActivityEmail({
      lead: activity.lead,
      templateSubject: tpl.subject,
      templateBody: tpl.body,
      aiPersonalization: false,
      channel: 'email',
    }).then((result) => {
      if (result.success) {
        setSubject(result.data.subject);
        setBody(result.data.body);
      } else {
        toast.error(result.error);
      }
    });
  }

  // LinkedIn / Social Point
  if (activity.channel === 'linkedin') {
    return (
      <ActivitySocialPointPanel
        leadName={leadName}
        isSending={isSending}
        onMarkDone={onMarkDone}
        onSkip={onSkip}
        skipLabel={skipLabel}
      />
    );
  }

  // Research
  if (activity.channel === 'research') {
    return (
      <ActivityResearchPanel
        leadName={leadName}
        leadId={activity.lead.id}
        cnpj={activity.lead.cnpj}
        website={activity.lead.website}
        isSending={isSending}
        onMarkDone={onMarkDone}
        onSkip={onSkip}
        skipLabel={skipLabel}
      />
    );
  }

  // Phone
  // Ligação via WhatsApp (passo phone + call_provider='whatsapp', Epic 7) usa o
  // discador WebRTC nativo, não o painel de telefonia (API4COM). EXCEÇÃO: no
  // Modo Execução Rápida a ligação é sempre por API4COM (o modo é de discagem
  // rápida em lote), então ignoramos o call_provider e caímos no painel API4COM
  // abaixo — assim o SDR nunca fica travado se o WhatsApp dele não estiver pareado.
  if (activity.channel === 'phone' && activity.callProvider === 'whatsapp' && !quickMode) {
    return (
      <ActivityWhatsAppCallPanel
        enrollmentId={activity.enrollmentId}
        stepId={activity.stepId}
        cadenceId={activity.cadenceId}
        leadId={activity.lead.id}
        leadName={leadName}
        leadEmail={resolvedEmail || activity.lead.email}
        leadFirstName={activity.lead.primeiro_nome ?? (activity.lead.socios ?? [])[0]?.nome?.split(' ')[0] ?? null}
        phones={phones}
        activityName={activity.activityName}
        callScript={activity.callScript}
        onResolved={() => onCallResolved?.()}
        onLeadLost={onLeadLost}
      />
    );
  }

  if (activity.channel === 'phone') {
    return (
      <ActivityPhonePanel
        leadName={leadName}
        leadId={activity.lead.id}
        leadEmail={resolvedEmail || activity.lead.email}
        leadFirstName={activity.lead.primeiro_nome ?? (activity.lead.socios ?? [])[0]?.nome?.split(' ')[0] ?? null}
        phoneNumber={activity.lead.telefone}
        phones={phones}
        isSending={isSending}
        onMarkDone={onMarkDone}
        onSkip={onSkip}
        skipLabel={skipLabel}
        onLeadLost={onLeadLost}
        canMarkNoShow={!!activity.lead.meeting_scheduled_at}
        activityName={activity.activityName}
        callScript={activity.callScript}
        dialerProvider={dialerProvider}
        cadenceStep={
          activity.enrollmentId.startsWith('scheduled:')
            ? undefined
            : { enrollmentId: activity.enrollmentId, stepId: activity.stepId }
        }
      />
    );
  }

  // WhatsApp
  if (activity.channel === 'whatsapp') {
    return (
      <>
        {waConnected === false && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
            <span className="text-lg">⚠️</span>
            WhatsApp não conectado. Conecte em Configurações &gt; Integrações antes de enviar.
          </div>
        )}
        <ActivityWhatsAppCompose
        to={to}
        body={body}
        renderedPreview={renderedPreview}
        aiPersonalized={aiPersonalized}
        isLoading={isLoading}
        isSending={isSending}
        phones={phones}
        templates={waTemplates}
        currentTemplateId={currentTemplateId}
        onPhoneChange={setTo}
        onBodyChange={setBody}
        onTemplateChange={handleTemplateChange}
        onSend={() => onSend('', renderedPreview, aiPersonalized, to, phones.find((p) => p.formatted === to)?.contactId ?? null)}
        onManualSend={onManualSend
          ? () => onManualSend('', renderedPreview, to, phones.find((p) => p.formatted === to)?.contactId ?? null)
          : undefined}
        onSkip={onSkip}
        skipLabel={skipLabel}
        onReportInvalid={onReportWhatsAppInvalid ?? (() => undefined)}
      />
      </>
    );
  }

  // Email (default)
  return (
    <ActivityEmailCompose
      to={to}
      subject={subject}
      body={body}
      signature={signature}
      aiPersonalized={aiPersonalized}
      isLoading={isLoading}
      isSending={isSending}
      draftKey={`${activity.enrollmentId}:${activity.stepId}`}
      templates={emailTemplates}
      currentTemplateId={currentTemplateId}
      onTemplateChange={handleEmailTemplateChange}
      onSubjectChange={setSubject}
      onBodyChange={setBody}
      onSend={() => onSend(renderedSubject, renderedPreview, aiPersonalized)}
      onManualSend={onManualSend ? () => onManualSend(renderedSubject, renderedPreview) : undefined}
      onSkip={onSkip}
      skipLabel={skipLabel}
    />
  );
}
