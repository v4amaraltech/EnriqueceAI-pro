'use server';

import { from } from '@/lib/supabase/from';
import { sendPlatformEmail } from '@/lib/email/platform-email';
import { createServiceRoleClient } from '@/lib/supabase/service';

type SupabaseClient = ReturnType<typeof createServiceRoleClient>;

interface MeetingBriefingParams {
  leadId: string;
  orgId: string;
  closerId: string;
  sdrUserId: string;
  meetingTitle: string;
  meetingStart: string;
  meetingEnd: string;
  meetLink?: string | null;
}

interface LeadData {
  nome_fantasia: string | null;
  razao_social: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  email: string | null;
  telefone: string | null;
  phones: Array<{ tipo: string; numero: string }> | null;
  cnpj: string | null;
  porte: string | null;
  cnae: string | null;
  faturamento_estimado: number | null;
  lead_source: string | null;
  website: string | null;
  instagram: string | null;
  linkedin: string | null;
  notes: string | null;
  fit_score: number | null;
  endereco: { logradouro?: string; bairro?: string; cidade?: string; uf?: string; cep?: string } | null;
  custom_field_values: Record<string, string> | null;
}

interface CloserData {
  name: string;
  email: string;
}

interface CustomFieldDef {
  id: string;
  field_name: string;
  field_type: string;
}

/**
 * Sends a meeting briefing email to the closer with full lead details.
 * Called fire-and-forget after scheduleMeeting when a closer is selected.
 */
export async function sendMeetingBriefingEmail(
  supabase: SupabaseClient,
  params: MeetingBriefingParams,
): Promise<void> {
  const { leadId, orgId, closerId, sdrUserId, meetingTitle, meetingStart, meetingEnd, meetLink } = params;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  try {
    // Fetch all data in parallel
    const [leadResult, closerResult, sdrResult, customFieldsResult] = await Promise.all([
      from(supabase, 'leads')
        .select('nome_fantasia, razao_social, first_name, last_name, job_title, email, telefone, phones, cnpj, porte, cnae, faturamento_estimado, lead_source, website, instagram, linkedin, notes, fit_score, endereco, custom_field_values')
        .eq('id', leadId)
        .single() as Promise<{ data: LeadData | null }>,
      from(supabase, 'closers')
        .select('name, email')
        .eq('id', closerId)
        .single() as Promise<{ data: CloserData | null }>,
      supabase.auth.admin.getUserById(sdrUserId),
      from(supabase, 'custom_fields')
        .select('id, field_name, field_type')
        .eq('org_id', orgId)
        .order('sort_order') as Promise<{ data: CustomFieldDef[] | null }>,
    ]);

    const lead = leadResult.data;
    const closer = closerResult.data;
    if (!lead || !closer) return;

    const sdrName = sdrResult.data?.user?.user_metadata?.name ?? sdrResult.data?.user?.email ?? 'Pré-vendas';
    const leadName = lead.nome_fantasia ?? lead.razao_social ?? 'Lead';

    const startDate = new Date(meetingStart);
    const endDate = new Date(meetingEnd);
    const dateStr = startDate.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = `${startDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} às ${endDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;

    // Create feedback request so the closer can respond after the meeting
    // Uses service role because closer_feedback_requests has no INSERT policy for members
    let feedbackUrl: string | null = null;
    const serviceSupabase = createServiceRoleClient();
    const { data: feedbackReq } = (await from(serviceSupabase, 'closer_feedback_requests')
      .insert({ org_id: orgId, lead_id: leadId, closer_id: closerId })
      .select('token')
      .single()) as { data: { token: string } | null };
    if (feedbackReq) {
      feedbackUrl = `${appUrl}/feedback/${feedbackReq.token}`;
    }

    const html = buildBriefingHtml({
      closerName: closer.name,
      leadName,
      lead,
      sdrName,
      meetingTitle,
      dateStr,
      timeStr,
      meetLink: meetLink ?? null,
      feedbackUrl,
      leadUrl: `${appUrl}/leads/${leadId}`,
      customFields: customFieldsResult.data ?? [],
    });

    await sendPlatformEmail({
      to: closer.email,
      subject: `Nova reunião agendada: ${leadName} — ${startDate.toLocaleDateString('pt-BR')} ${startDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
      html,
    });
  } catch (err) {
    console.error('[meeting-briefing] Error sending briefing:', err);
  }
}

function formatCurrency(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(value);
}

function buildBriefingHtml(data: {
  closerName: string;
  leadName: string;
  lead: LeadData;
  sdrName: string;
  meetingTitle: string;
  dateStr: string;
  timeStr: string;
  meetLink: string | null;
  feedbackUrl: string | null;
  leadUrl: string;
  customFields: CustomFieldDef[];
}): string {
  const { closerName, leadName, lead, sdrName, meetingTitle, dateStr, timeStr, meetLink, feedbackUrl, leadUrl, customFields } = data;

  const contactName = [lead.first_name, lead.last_name].filter(Boolean).join(' ');

  // Build info rows helper
  function row(label: string, value: string | null | undefined): string {
    if (!value) return '';
    return `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;width:140px;vertical-align:top;">${label}:</td><td style="padding:4px 0;color:#1a1a1a;font-size:13px;">${value}</td></tr>`;
  }

  function linkRow(label: string, value: string | null | undefined, href?: string): string {
    if (!value) return '';
    const display = href
      ? `<a href="${href}" style="color:#E53935;text-decoration:none;">${value}</a>`
      : value;
    return `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;width:140px;vertical-align:top;">${label}:</td><td style="padding:4px 0;font-size:13px;">${display}</td></tr>`;
  }

  // Address
  const endereco = lead.endereco;
  let enderecoStr = '';
  if (endereco && typeof endereco === 'object') {
    const parts = [endereco.logradouro, endereco.bairro, endereco.cidade, endereco.uf].filter(Boolean);
    enderecoStr = parts.join(', ');
    if (endereco.cep) enderecoStr += ` — ${endereco.cep}`;
  }

  // Phones
  let phonesHtml = '';
  if (lead.phones && Array.isArray(lead.phones) && lead.phones.length > 0) {
    phonesHtml = lead.phones.map((p) => `${p.tipo}: ${p.numero}`).join('<br>');
  } else if (lead.telefone) {
    phonesHtml = lead.telefone;
  }

  // Custom fields
  let customFieldsHtml = '';
  if (lead.custom_field_values && customFields.length > 0) {
    const cfRows = customFields
      .map((cf) => {
        const val = lead.custom_field_values?.[cf.id];
        if (!val) return '';
        return row(cf.field_name, val);
      })
      .filter(Boolean)
      .join('');
    if (cfRows) {
      customFieldsHtml = `
        <tr><td colspan="2" style="padding:16px 0 8px;"><strong style="color:#1a1a1a;font-size:14px;">Campos personalizados</strong></td></tr>
        ${cfRows}`;
    }
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background: #1a1a1a; padding: 24px 32px;">
              <h1 style="color: white; margin: 0; font-size: 20px; font-weight: 600;">EnriqueceAI</h1>
              <p style="color: #9ca3af; font-size: 13px; margin: 4px 0 0;">Nova reunião agendada</p>
            </td>
          </tr>

          <!-- Meeting Info Banner -->
          <tr>
            <td style="background: #E53935; padding: 20px 32px;">
              <h2 style="color: white; margin: 0 0 4px; font-size: 16px; font-weight: 600;">${meetingTitle}</h2>
              <p style="color: rgba(255,255,255,0.9); margin: 0; font-size: 14px;">
                📅 ${dateStr}<br>
                🕐 ${timeStr}
              </p>
              ${meetLink ? `<p style="margin: 8px 0 0;"><a href="${meetLink}" style="color: white; font-weight: 600; text-decoration: underline;">🔗 Entrar no Google Meet</a></p>` : ''}
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 32px;">
              <p style="color: #4a4a4a; line-height: 1.6; margin: 0 0 24px; font-size: 15px;">
                Olá, <strong>${closerName}</strong>!<br>
                Confira abaixo tudo o que você precisa saber sobre o seu lead.
              </p>

              <!-- Lead Info Section -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; border-radius: 8px; padding: 16px 20px; margin-bottom: 20px;">
                <tr><td colspan="2" style="padding:0 0 8px;"><strong style="color:#1a1a1a;font-size:14px;">Sobre o lead</strong></td></tr>
                ${row('Empresa', leadName)}
                ${row('Contato', contactName)}
                ${row('Cargo', lead.job_title)}
                ${linkRow('E-mail', lead.email, lead.email ? `mailto:${lead.email}` : undefined)}
                ${row('Telefone(s)', phonesHtml)}
                ${row('CNPJ', lead.cnpj)}
                ${row('Porte', lead.porte)}
                ${row('CNAE', lead.cnae)}
                ${row('Faturamento', formatCurrency(lead.faturamento_estimado))}
                ${row('Origem', lead.lead_source)}
                ${row('Fit Score', lead.fit_score !== null ? `${lead.fit_score}/100` : null)}
                ${linkRow('Website', lead.website, lead.website ? (lead.website.startsWith('http') ? lead.website : `https://${lead.website}`) : undefined)}
                ${linkRow('LinkedIn', lead.linkedin, lead.linkedin ?? undefined)}
                ${linkRow('Instagram', lead.instagram, lead.instagram ? (lead.instagram.startsWith('http') ? lead.instagram : `https://instagram.com/${lead.instagram.replace('@', '')}`) : undefined)}
                ${row('Endereço', enderecoStr || null)}
                ${row('Pré-vendedor', sdrName)}
                ${customFieldsHtml}
              </table>

              <!-- Notes -->
              ${lead.notes ? `
              <table width="100%" cellpadding="0" cellspacing="0" style="background: #fffbeb; border-radius: 8px; padding: 16px 20px; margin-bottom: 20px; border-left: 4px solid #f59e0b;">
                <tr><td style="padding:0 0 8px;"><strong style="color:#1a1a1a;font-size:14px;">📝 Notas do pré-vendas</strong></td></tr>
                <tr><td style="color:#4a4a4a;font-size:13px;line-height:1.6;white-space:pre-wrap;">${lead.notes}</td></tr>
              </table>
              ` : ''}

              <!-- CTAs -->
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="padding: 8px 0 0;">
                    <a href="${leadUrl}" style="display: inline-block; background: #E53935; color: white; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px;">
                      Ver lead na plataforma
                    </a>
                  </td>
                </tr>
                ${feedbackUrl ? `
                <tr>
                  <td align="center" style="padding: 16px 0 0;">
                    <a href="${feedbackUrl}" style="display: inline-block; background: #1a1a1a; color: white; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px;">
                      Enviar feedback da reunião
                    </a>
                    <p style="color: #9ca3af; font-size: 12px; margin: 8px 0 0;">
                      Após a reunião, clique acima para avaliar o lead (expira em 7 dias)
                    </p>
                  </td>
                </tr>
                ` : ''}
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background: #f9fafb; padding: 16px 32px; border-top: 1px solid #e5e7eb;">
              <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                Enviado automaticamente pelo EnriqueceAI
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}
