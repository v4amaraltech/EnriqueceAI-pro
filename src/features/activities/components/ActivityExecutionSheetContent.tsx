'use client';

import { useEffect, useMemo, useState } from 'react';

import { toast } from 'sonner';

import { buildLeadTemplateVariables } from '@/features/cadences/utils/build-template-variables';
import { renderTemplate } from '@/features/cadences/utils/render-template';
import { fetchVendorVariables } from '@/features/cadences/actions/fetch-vendor-variables';

import { fetchGmailSignature } from '../actions/fetch-gmail-signature';
import { prepareActivityEmail, prepareActivityWhatsApp } from '../actions/prepare-activity-email';
import { fetchWhatsAppTemplates, type WhatsAppTemplateOption } from '../actions/fetch-whatsapp-templates';
import { resolveWhatsAppPhone, getAllLeadPhones } from '../utils/resolve-whatsapp-phone';
import type { PendingActivity } from '../types';

import type { DialerProvider } from '@/features/calls/types/dialer-provider';

import { ActivityEmailCompose } from './ActivityEmailCompose';
import { ActivityPhonePanel } from './ActivityPhonePanel';
import { ActivityResearchPanel } from './ActivityResearchPanel';
import { ActivitySocialPointPanel } from './ActivitySocialPointPanel';
import { ActivityWhatsAppCompose } from './ActivityWhatsAppCompose';

interface ActivityExecutionSheetContentProps {
  activity: PendingActivity;
  isSending: boolean;
  onSend: (subject: string, body: string, aiGenerated: boolean, phone?: string) => void;
  onSkip: () => void;
  onMarkDone: (notes: string) => void;
  dialerProvider?: DialerProvider;
}

export function ActivityExecutionSheetContent({
  activity,
  isSending,
  onSend,
  onSkip,
  onMarkDone,
  dialerProvider,
}: ActivityExecutionSheetContentProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [subject, setSubject] = useState(activity.templateSubject ?? '');
  const [body, setBody] = useState(activity.templateBody ?? '');
  const [aiPersonalized, setAiPersonalized] = useState(false);
  const [signature, setSignature] = useState('');

  // Phone resolution for WhatsApp and Phone channels
  const phones = (activity.channel === 'whatsapp' || activity.channel === 'phone') ? getAllLeadPhones(activity.lead) : [];
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

  // LinkedIn / Social Point
  if (activity.channel === 'linkedin') {
    return (
      <ActivitySocialPointPanel
        leadName={leadName}
        isSending={isSending}
        onMarkDone={onMarkDone}
        onSkip={onSkip}
      />
    );
  }

  // Research
  if (activity.channel === 'research') {
    return (
      <ActivityResearchPanel
        leadName={leadName}
        isSending={isSending}
        onMarkDone={onMarkDone}
        onSkip={onSkip}
      />
    );
  }

  // Phone
  if (activity.channel === 'phone') {
    return (
      <ActivityPhonePanel
        leadName={leadName}
        leadId={activity.lead.id}
        phoneNumber={activity.lead.telefone}
        phones={phones}
        isSending={isSending}
        onMarkDone={onMarkDone}
        onSkip={onSkip}
        activityName={activity.activityName}
        callScript={activity.callScript}
        dialerProvider={dialerProvider}
      />
    );
  }

  // WhatsApp
  if (activity.channel === 'whatsapp') {
    return (
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
        onSend={() => onSend('', renderedPreview, aiPersonalized, to)}
        onSkip={onSkip}
      />
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
      onSubjectChange={setSubject}
      onBodyChange={setBody}
      onSend={() => onSend(renderedSubject, renderedPreview, aiPersonalized)}
      onSkip={onSkip}
    />
  );
}
