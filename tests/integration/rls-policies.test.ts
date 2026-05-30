import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createAdminClient,
  createAuthenticatedClient,
  createTestUser,
} from '../helpers/supabase-test-client';

// Run only against a REAL local Supabase. A real service-role key is a JWT
// (starts with "eyJ"); the dummy placeholder injected by tests/setup.ts for unit
// tests must not trip this gate, otherwise these tests try to reach a Supabase
// that isn't running and fail instead of skipping.
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_RUNNING = !!serviceRoleKey && serviceRoleKey.startsWith('eyJ');

describe.skipIf(!SUPABASE_RUNNING)('RLS Policies - Integration', () => {
  let adminClient: SupabaseClient;
  let userAClient: SupabaseClient;
  let userBClient: SupabaseClient;
  let userAId: string;
  let userBId: string;

  beforeAll(async () => {
    adminClient = createAdminClient();

    // Create test users (trigger creates org + member automatically)
    userAId = await createTestUser(adminClient, 'rls-test-a@test.com', 'test12345678');
    userBId = await createTestUser(adminClient, 'rls-test-b@test.com', 'test12345678');

    // Login as each user
    userAClient = await createAuthenticatedClient('rls-test-a@test.com', 'test12345678');
    userBClient = await createAuthenticatedClient('rls-test-b@test.com', 'test12345678');
  });

  afterAll(async () => {
    // Cleanup test users
    if (userAId) await adminClient.auth.admin.deleteUser(userAId);
    if (userBId) await adminClient.auth.admin.deleteUser(userBId);
  });

  it('User A can only read their own organization', async () => {
    const { data } = await userAClient.from('organizations').select('*');
    expect(data).toHaveLength(1);
  });

  it('User A cannot see User B organization', async () => {
    // Get User B org via admin
    const { data: userBOrg } = await adminClient
      .from('organization_members')
      .select('org_id')
      .eq('user_id', userBId)
      .single();

    expect(userBOrg).toBeDefined();

    // Try to read User B org as User A
    const { data } = await userAClient
      .from('organizations')
      .select('*')
      .eq('id', userBOrg!.org_id as string);

    expect(data).toHaveLength(0);
  });

  it('User A can read members of their own org', async () => {
    const { data } = await userAClient.from('organization_members').select('*');
    expect(data).toHaveLength(1);
    expect(data![0].user_id).toBe(userAId);
  });

  it('Manager can update their organization', async () => {
    const { data: orgs } = await userAClient.from('organizations').select('id');
    expect(orgs).toBeDefined();
    const orgId = orgs![0]!.id as string;

    const { error } = await userAClient
      .from('organizations')
      .update({ name: 'Updated Org Name' })
      .eq('id', orgId);

    expect(error).toBeNull();
  });

  it('Non-owner cannot update organization', async () => {
    // Get User A org via admin
    const { data: userAOrg } = await adminClient
      .from('organization_members')
      .select('org_id')
      .eq('user_id', userAId)
      .single();

    // User B tries to update User A org
    const { data } = await userBClient
      .from('organizations')
      .update({ name: 'Hacked Name' })
      .eq('id', userAOrg!.org_id)
      .select();

    // RLS should prevent update — no rows affected
    expect(data).toHaveLength(0);
  });

  // --- Lead RLS Tests ---

  it('User A can insert a lead in their own org', async () => {
    const { data: orgs } = await userAClient.from('organizations').select('id');
    const orgId = orgs![0]!.id as string;

    const { error } = await userAClient.from('leads').insert({
      org_id: orgId,
      cnpj: '11222333000181',
      status: 'new',
      enrichment_status: 'pending',
    });

    expect(error).toBeNull();
  });

  it('User A can read their own leads', async () => {
    const { data } = await userAClient.from('leads').select('*');
    expect(data!.length).toBeGreaterThanOrEqual(1);
  });

  it('User B cannot see User A leads', async () => {
    // User B should not see any leads (they haven't created any)
    const { data } = await userBClient.from('leads').select('*');
    expect(data).toHaveLength(0);
  });

  it('User B cannot insert a lead into User A org', async () => {
    const { data: userAOrgs } = await adminClient
      .from('organization_members')
      .select('org_id')
      .eq('user_id', userAId)
      .single();

    const { error } = await userBClient.from('leads').insert({
      org_id: userAOrgs!.org_id,
      cnpj: '22333444000192',
      status: 'new',
      enrichment_status: 'pending',
    });

    expect(error).not.toBeNull();
  });

  it('User A can update their own lead', async () => {
    const { data: leads } = await userAClient.from('leads').select('id').limit(1);
    expect(leads!.length).toBeGreaterThan(0);

    const { error } = await userAClient
      .from('leads')
      .update({ status: 'contacted' })
      .eq('id', leads![0]!.id);

    expect(error).toBeNull();
  });
});
