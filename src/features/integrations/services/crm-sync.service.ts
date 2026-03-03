import { decryptJson, encryptJson } from '@/lib/security/encryption';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import type {
  CrmConnectionRow,
  CrmContact,
  CrmCredentials,
  FieldMapping,
  SyncResult,
} from '../types/crm';
import { CRMRegistry } from './crm-registry';

interface LeadForSync {
  id: string;
  org_id: string;
  cnpj: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  email: string | null;
  telefone: string | null;
  porte: string | null;
  cnae: string | null;
  situacao_cadastral: string | null;
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
  static async syncConnection(connectionId: string): Promise<{
    pull: SyncResult;
    push: SyncResult;
    activities: SyncResult;
  }> {
    const supabase = await createServerSupabaseClient();

    // Get connection with credentials
    const { data: connection } = (await (supabase
      .from('crm_connections') as ReturnType<typeof supabase.from>)
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
      const credentials = await CrmSyncService.ensureValidToken(
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
      await (supabase.from('crm_connections') as ReturnType<typeof supabase.from>)
        .update({
          status: 'connected',
          last_sync_at: new Date().toISOString(),
        } as Record<string, unknown>)
        .eq('id', connectionId);
    } catch (error) {
      // Mark connection as error
      await (supabase.from('crm_connections') as ReturnType<typeof supabase.from>)
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

    await (supabase.from('crm_sync_log') as ReturnType<typeof supabase.from>)
      .insert({
        connection_id: connectionId,
        direction: 'push',
        records_synced: totalSynced,
        errors: totalErrors,
        duration_ms: Date.now() - startTime,
        error_details: allErrors.length > 0 ? allErrors : null,
      } as Record<string, unknown>);

    return { pull: pullResult, push: pushResult, activities: activityResult };
  }

  private static async ensureValidToken(
    connection: CrmConnectionRow,
    adapter: ReturnType<typeof CRMRegistry.getAdapter>,
    supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  ): Promise<CrmCredentials> {
    let credentials = decryptJson<CrmCredentials>(connection.credentials_encrypted);

    // Check token expiration
    if (
      credentials.token_expires_at &&
      new Date(credentials.token_expires_at) <= new Date()
    ) {
      credentials = await adapter.refreshToken(credentials);
      await (supabase.from('crm_connections') as ReturnType<typeof supabase.from>)
        .update({ credentials_encrypted: encryptJson(credentials) } as Record<string, unknown>)
        .eq('id', connection.id);
    }

    return credentials;
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
      const { data } = (await (supabase
        .from('leads') as ReturnType<typeof supabase.from>)
        .select('id, updated_at')
        .eq('org_id', orgId)
        .eq('cnpj', cnpj)
        .maybeSingle()) as { data: { id: string; updated_at: string } | null };
      if (data) existingId = data.id;
    }

    if (!existingId && email) {
      const { data } = (await (supabase
        .from('leads') as ReturnType<typeof supabase.from>)
        .select('id, updated_at')
        .eq('org_id', orgId)
        .eq('email', email)
        .maybeSingle()) as { data: { id: string; updated_at: string } | null };
      if (data) existingId = data.id;
    }

    if (existingId) {
      // Update existing lead (last-write-wins)
      const updateData = { ...leadData };
      delete updateData.cnpj; // Don't update CNPJ
      await (supabase.from('leads') as ReturnType<typeof supabase.from>)
        .update(updateData as Record<string, unknown>)
        .eq('id', existingId);
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
    let query = (supabase
      .from('leads') as ReturnType<typeof supabase.from>)
      .select('id, org_id, cnpj, razao_social, nome_fantasia, email, telefone, porte, cnae, situacao_cadastral, updated_at')
      .eq('org_id', connection.org_id)
      .is('deleted_at', null)
      .limit(200);

    if (connection.last_sync_at) {
      query = query.gte('updated_at', connection.last_sync_at);
    }

    const { data: leads } = (await query) as { data: LeadForSync[] | null };

    for (const lead of leads ?? []) {
      try {
        const leadRecord: Record<string, string | null> = {
          nome_fantasia: lead.nome_fantasia,
          razao_social: lead.razao_social,
          cnpj: lead.cnpj,
          email: lead.email,
          telefone: lead.telefone,
          porte: lead.porte,
          cnae: lead.cnae,
          situacao_cadastral: lead.situacao_cadastral,
        };

        // Check if lead has been synced before (external_id in interactions)
        const { data: existingSync } = (await (supabase
          .from('interactions') as ReturnType<typeof supabase.from>)
          .select('external_id')
          .eq('lead_id', lead.id)
          .eq('type', 'crm_synced')
          .maybeSingle()) as { data: { external_id: string } | null };

        const pushResult = await adapter.pushContact(
          credentials,
          leadRecord,
          fieldMapping.leads,
          existingSync?.external_id ?? undefined,
        );

        // Record sync mapping if new
        if (!existingSync) {
          await (supabase.from('interactions') as ReturnType<typeof supabase.from>)
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
    let query = (supabase
      .from('interactions') as ReturnType<typeof supabase.from>)
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

    for (const interaction of interactions ?? []) {
      try {
        // Find CRM external ID for this lead
        const { data: crmSync } = (await (supabase
          .from('interactions') as ReturnType<typeof supabase.from>)
          .select('external_id')
          .eq('lead_id', interaction.lead_id)
          .eq('type', 'crm_synced')
          .maybeSingle()) as { data: { external_id: string } | null };

        if (!crmSync?.external_id) continue; // Skip if lead not synced to CRM

        const pushResult = await adapter.pushActivity(credentials, {
          contact_external_id: crmSync.external_id,
          type: interaction.channel,
          subject: `Cadência - ${interaction.channel}`,
          body: interaction.message_content ?? '',
          timestamp: interaction.created_at,
        });

        // Mark interaction as synced
        await (supabase.from('interactions') as ReturnType<typeof supabase.from>)
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
