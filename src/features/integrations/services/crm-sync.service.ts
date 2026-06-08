import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { dispatchWebhookEvent } from '@/features/cadences/services/webhook-dispatch.service';
import { leadFieldLabel } from '@/features/leads/constants/lead-field-labels';

import type {
  CrmConnectionRow,
  CrmContact,
  CrmCredentials,
  FieldMapping,
  SyncResult,
} from '../types/crm';
import { CRMRegistry } from './crm-registry';
import { ensureFreshCredentials } from './crm-token';

interface LeadForSync {
  id: string;
  org_id: string;
  cnpj: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  email: string | null;
  telefone: string | null;
  porte: string | null;
  cnae: string | null;
  situacao_cadastral: string | null;
  faturamento_estimado: string | null;
  uf: string | null;
  lead_source: string | null;
  instagram: string | null;
  linkedin: string | null;
  website: string | null;
  notes: string | null;
  updated_at: string;
}

interface InteractionForSync {
  id: string;
  lead_id: string;
  channel: string;
  type: string;
  message_content: string | null;
  created_at: string;
}

export class CrmSyncService {
  /**
   * Run full bidirectional sync for a connection.
   * Called by /api/crm/sync route.
   */
  static async syncConnection(
    connectionId: string,
    suppliedClient?: SupabaseClient,
  ): Promise<{
    pull: SyncResult;
    push: SyncResult;
    activities: SyncResult;
  }> {
    // Cron context (no cookies) supplies a service-role client; manual UI calls
    // can rely on the cookie-based session client.
    const supabase = suppliedClient ?? (await createServerSupabaseClient());

    // Get connection with credentials
    const { data: connection } = (await from(supabase, 'crm_connections')
      .select('*')
      .eq('id', connectionId)
      .single()) as { data: CrmConnectionRow | null };

    if (!connection) {
      throw new Error('Connection not found');
    }

    const adapter = CRMRegistry.getAdapter(connection.crm_provider);
    const fieldMapping = connection.field_mapping ?? { leads: {} };
    const startTime = Date.now();

    let pullResult: SyncResult = { synced: 0, errors: 0, errorDetails: [] };
    let pushResult: SyncResult = { synced: 0, errors: 0, errorDetails: [] };
    let activityResult: SyncResult = { synced: 0, errors: 0, errorDetails: [] };

    try {
      // Check if token needs refresh
      const credentials = await ensureFreshCredentials(
        connection,
        adapter,
        supabase,
      );

      // 1. Pull contacts from CRM → EnriqueceAI leads
      pullResult = await CrmSyncService.pullContacts(
        supabase,
        adapter,
        credentials,
        connection,
        fieldMapping,
      );

      // 2. Push EnriqueceAI leads → CRM contacts
      pushResult = await CrmSyncService.pushLeads(
        supabase,
        adapter,
        credentials,
        connection,
        fieldMapping,
      );

      // 3. Push EnriqueceAI interactions → CRM activities
      activityResult = await CrmSyncService.pushActivities(
        supabase,
        adapter,
        credentials,
        connection,
      );

      // Update connection status
      await from(supabase, 'crm_connections')
        .update({
          status: 'connected',
          last_sync_at: new Date().toISOString(),
        } as Record<string, unknown>)
        .eq('id', connectionId);
    } catch (error) {
      // Mark connection as error
      await from(supabase, 'crm_connections')
        .update({ status: 'error' } as Record<string, unknown>)
        .eq('id', connectionId);
      throw error;
    }

    // Log sync results
    const totalSynced = pullResult.synced + pushResult.synced + activityResult.synced;
    const totalErrors = pullResult.errors + pushResult.errors + activityResult.errors;
    const allErrors = [
      ...pullResult.errorDetails,
      ...pushResult.errorDetails,
      ...activityResult.errorDetails,
    ];

    await from(supabase, 'crm_sync_log')
      .insert({
        connection_id: connectionId,
        direction: 'push',
        records_synced: totalSynced,
        errors: totalErrors,
        duration_ms: Date.now() - startTime,
        error_details: allErrors.length > 0 ? allErrors : null,
      } as Record<string, unknown>);

    // Dispatch crm.synced webhook
    dispatchWebhookEvent(supabase, connection.org_id, 'crm.synced', {
      connection_id: connectionId,
      crm_provider: connection.crm_provider,
      records_synced: totalSynced,
      errors: totalErrors,
      duration_ms: Date.now() - startTime,
    }).catch((err) => console.error('[webhook] crm.synced dispatch failed:', err));

    return { pull: pullResult, push: pushResult, activities: activityResult };
  }

  /**
   * Pull contacts from CRM and update/create leads in EnriqueceAI.
   * Last-write-wins: CRM data overwrites EnriqueceAI if CRM updated_at is newer.
   */
  private static async pullContacts(
    supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
    adapter: ReturnType<typeof CRMRegistry.getAdapter>,
    credentials: CrmCredentials,
    connection: CrmConnectionRow,
    fieldMapping: FieldMapping,
  ): Promise<SyncResult> {
    const result: SyncResult = { synced: 0, errors: 0, errorDetails: [] };

    const contacts = await adapter.pullContacts(
      credentials,
      connection.last_sync_at ?? undefined,
    );

    // Build reverse mapping: CRM field -> EnriqueceAI field
    const reverseMapping: Record<string, string> = {};
    for (const [appField, crmField] of Object.entries(fieldMapping.leads)) {
      reverseMapping[crmField] = appField;
    }

    for (const contact of contacts) {
      try {
        await CrmSyncService.upsertLeadFromContact(
          supabase,
          contact,
          reverseMapping,
          connection.org_id,
        );
        result.synced++;
      } catch (error) {
        result.errors++;
        result.errorDetails.push({
          record_id: contact.external_id,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return result;
  }

  private static async upsertLeadFromContact(
    supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
    contact: CrmContact,
    reverseMapping: Record<string, string>,
    orgId: string,
  ) {
    // Map CRM properties to EnriqueceAI lead fields
    const leadData: Record<string, string | null> = {};
    for (const [crmField, value] of Object.entries(contact.properties)) {
      if (reverseMapping[crmField] && value) {
        leadData[reverseMapping[crmField]] = value;
      }
    }

    // Also map top-level fields
    if (contact.email) leadData.email = contact.email;
    if (contact.phone) leadData.telefone = contact.phone;
    if (contact.company_name) leadData.nome_fantasia = contact.company_name;

    // Try to find existing lead by email or CNPJ
    const cnpj = leadData.cnpj;
    const email = leadData.email;

    let existingId: string | null = null;

    if (cnpj) {
      const { data } = (await from(supabase, 'leads')
        .select('id, updated_at')
        .eq('org_id', orgId)
        .eq('cnpj', cnpj)
        .maybeSingle()) as { data: { id: string; updated_at: string } | null };
      if (data) existingId = data.id;
    }

    if (!existingId && email) {
      // Case-insensitive — matches CRM addresses regardless of stored casing.
      const { data } = (await from(supabase, 'leads')
        .select('id, updated_at')
        .eq('org_id', orgId)
        .ilike('email', email)
        .maybeSingle()) as { data: { id: string; updated_at: string } | null };
      if (data) existingId = data.id;
    }

    if (existingId) {
      // Update existing lead (last-write-wins)
      const updateData = { ...leadData };
      delete updateData.cnpj; // Don't update CNPJ

      // Diff against current values so the timeline records only real changes —
      // a CRM pull runs on a schedule and re-sends identical data every cycle,
      // so logging unconditionally would flood the lead history with noise.
      const fieldKeys = Object.keys(updateData);
      let changedFields: string[] = [];
      if (fieldKeys.length > 0) {
        const { data: current } = (await from(supabase, 'leads')
          .select(fieldKeys.join(','))
          .eq('id', existingId)
          .maybeSingle()) as { data: Record<string, unknown> | null };
        if (current) {
          changedFields = fieldKeys.filter((k) => (current[k] ?? null) !== (updateData[k] ?? null));
        }
      }

      await from(supabase, 'leads')
        .update(updateData as Record<string, unknown>)
        .eq('id', existingId);

      if (changedFields.length > 0) {
        // CRM-driven change has no user actor — insert the system event directly
        // (logLeadEvent requires a userId; performed_by stays null here).
        await from(supabase, 'interactions').insert({
          org_id: orgId,
          lead_id: existingId,
          channel: 'system',
          type: 'sent',
          message_content: `Campos atualizados via CRM: ${changedFields.map(leadFieldLabel).join(', ')}`,
          metadata: { system_event: 'fields_updated', source: 'crm_pull', changed_fields: changedFields },
          performed_by: null,
        } as Record<string, unknown>);
      }
    }
    // We don't auto-create leads from CRM pull — only update existing ones
  }

  /**
   * Push EnriqueceAI leads to CRM.
   * Pushes leads that were updated since last sync.
   */
  private static async pushLeads(
    supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
    adapter: ReturnType<typeof CRMRegistry.getAdapter>,
    credentials: CrmCredentials,
    connection: CrmConnectionRow,
    fieldMapping: FieldMapping,
  ): Promise<SyncResult> {
    const result: SyncResult = { synced: 0, errors: 0, errorDetails: [] };

    // Get leads updated since last sync
    let query = from(supabase, 'leads')
      .select('id, org_id, cnpj, razao_social, nome_fantasia, first_name, last_name, job_title, email, telefone, porte, cnae, situacao_cadastral, faturamento_estimado, uf, lead_source, instagram, linkedin, website, notes, custom_field_values, updated_at')
      .eq('org_id', connection.org_id)
      .is('deleted_at', null)
      .limit(200);

    if (connection.last_sync_at) {
      query = query.gte('updated_at', connection.last_sync_at);
    }

    const { data: leads } = (await query) as { data: LeadForSync[] | null };
    const leadList = leads ?? [];

    // Batch fetch existing CRM sync mappings for all leads (single query instead of N)
    const leadIds = leadList.map((l) => l.id);
    const syncMap = new Map<string, string>();
    if (leadIds.length > 0) {
      const { data: existingSyncs } = (await from(supabase, 'interactions')
        .select('lead_id, external_id')
        .in('lead_id', leadIds)
        .eq('type', 'crm_synced')) as { data: { lead_id: string; external_id: string }[] | null };

      for (const sync of existingSyncs ?? []) {
        syncMap.set(sync.lead_id, sync.external_id);
      }
    }

    for (const lead of leadList) {
      try {
        const leadRecord: Record<string, string | null> = {
          nome_fantasia: lead.nome_fantasia,
          razao_social: lead.razao_social,
          cnpj: lead.cnpj,
          first_name: lead.first_name,
          last_name: lead.last_name,
          job_title: lead.job_title,
          email: lead.email,
          telefone: lead.telefone,
          porte: lead.porte,
          cnae: lead.cnae,
          situacao_cadastral: lead.situacao_cadastral,
          faturamento_estimado: lead.faturamento_estimado,
          uf: lead.uf,
          lead_source: lead.lead_source,
          instagram: lead.instagram,
          linkedin: lead.linkedin,
          website: lead.website,
          notes: lead.notes,
        };

        // Include custom fields in lead record (for CRM field mapping)
        const cfv = (lead as unknown as Record<string, unknown>).custom_field_values as Record<string, string> | null;
        if (cfv) {
          for (const [fieldId, value] of Object.entries(cfv)) {
            if (value) {
              // Currency custom fields store in centavos — convert to reais for CRM
              const numVal = Number(value);
              const isLikelyCentavos = !isNaN(numVal) && numVal >= 100 && Number.isInteger(numVal);
              leadRecord[`custom_${fieldId}`] = isLikelyCentavos ? String(numVal / 100) : value;
            }
          }
        }

        const existingExternalId = syncMap.get(lead.id);

        const pushResult = await adapter.pushContact(
          credentials,
          leadRecord,
          fieldMapping.leads,
          existingExternalId,
        );

        // Record sync mapping if new
        if (!existingExternalId) {
          await from(supabase, 'interactions')
            .insert({
              org_id: connection.org_id,
              lead_id: lead.id,
              channel: 'crm',
              type: 'crm_synced',
              external_id: pushResult.external_id,
            } as Record<string, unknown>);
        }

        result.synced++;
      } catch (error) {
        result.errors++;
        result.errorDetails.push({
          record_id: lead.id,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return result;
  }

  /**
   * Push EnriqueceAI interactions (cadence activities) to CRM as notes/activities.
   */
  private static async pushActivities(
    supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
    adapter: ReturnType<typeof CRMRegistry.getAdapter>,
    credentials: CrmCredentials,
    connection: CrmConnectionRow,
  ): Promise<SyncResult> {
    const result: SyncResult = { synced: 0, errors: 0, errorDetails: [] };

    // Get interactions not yet synced to CRM (no external_id, type = 'sent')
    let query = from(supabase, 'interactions')
      .select('id, lead_id, channel, type, message_content, created_at')
      .eq('org_id', connection.org_id)
      .eq('type', 'sent')
      .is('external_id', null)
      .limit(100);

    if (connection.last_sync_at) {
      query = query.gte('created_at', connection.last_sync_at);
    }

    const { data: interactions } = (await query) as {
      data: InteractionForSync[] | null;
    };
    const interactionList = interactions ?? [];

    // Batch fetch CRM sync mappings for all lead_ids (single query instead of N)
    const activityLeadIds = [...new Set(interactionList.map((i) => i.lead_id))];
    const activitySyncMap = new Map<string, string>();
    if (activityLeadIds.length > 0) {
      const { data: crmSyncs } = (await from(supabase, 'interactions')
        .select('lead_id, external_id')
        .in('lead_id', activityLeadIds)
        .eq('type', 'crm_synced')) as { data: { lead_id: string; external_id: string }[] | null };

      for (const sync of crmSyncs ?? []) {
        activitySyncMap.set(sync.lead_id, sync.external_id);
      }
    }

    for (const interaction of interactionList) {
      try {
        const crmExternalId = activitySyncMap.get(interaction.lead_id);
        if (!crmExternalId) continue; // Skip if lead not synced to CRM

        const pushResult = await adapter.pushActivity(credentials, {
          contact_external_id: crmExternalId,
          type: interaction.channel,
          subject: `Cadência - ${interaction.channel}`,
          body: interaction.message_content ?? '',
          timestamp: interaction.created_at,
        });

        // Mark interaction as synced
        await from(supabase, 'interactions')
          .update({ external_id: pushResult.external_id } as Record<string, unknown>)
          .eq('id', interaction.id);

        result.synced++;
      } catch (error) {
        result.errors++;
        result.errorDetails.push({
          record_id: interaction.id,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return result;
  }
}
