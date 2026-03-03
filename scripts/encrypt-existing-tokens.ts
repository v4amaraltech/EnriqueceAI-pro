/**
 * One-time script to encrypt existing plaintext tokens in the database.
 *
 * Prerequisites:
 *   - TOKEN_ENCRYPTION_KEY must be set in environment
 *   - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set
 *
 * Usage:
 *   npx tsx scripts/encrypt-existing-tokens.ts
 *   npx tsx scripts/encrypt-existing-tokens.ts --dry-run
 */

import { createClient } from '@supabase/supabase-js';
import { createCipheriv, randomBytes } from 'node:crypto';

// --- Inline encryption (avoid importing from src/ which needs Next.js context) ---

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

function isEncrypted(value: string): boolean {
  const parts = value.split(':');
  if (parts.length !== 3) return false;
  const [iv, tag, ct] = parts;
  return (
    iv !== undefined &&
    tag !== undefined &&
    ct !== undefined &&
    iv.length === IV_LENGTH * 2 &&
    tag.length === AUTH_TAG_LENGTH * 2 &&
    ct.length >= 2 &&
    /^[0-9a-f]+$/.test(iv) &&
    /^[0-9a-f]+$/.test(tag) &&
    /^[0-9a-f]+$/.test(ct)
  );
}

function encrypt(plaintext: string): string {
  if (isEncrypted(plaintext)) return plaintext;

  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

// --- Main ---

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  // Validate key before starting
  getKey();

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);

  let totalUpdated = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // 1. Gmail connections
  totalUpdated += await encryptTable(db, 'gmail_connections', [
    'access_token_encrypted',
    'refresh_token_encrypted',
  ]);

  // 2. Calendar connections
  totalUpdated += await encryptTable(db, 'calendar_connections', [
    'access_token_encrypted',
    'refresh_token_encrypted',
  ]);

  // 3. WhatsApp connections
  totalUpdated += await encryptTable(db, 'whatsapp_connections', [
    'access_token_encrypted',
  ]);

  // 4. API4COM connections
  totalUpdated += await encryptTable(db, 'api4com_connections', [
    'api_key_encrypted',
  ]);

  // 5. CRM connections (credentials_encrypted is now TEXT — may contain JSON or already encrypted)
  totalUpdated += await encryptTable(db, 'crm_connections', [
    'credentials_encrypted',
  ]);

  console.log(`\nDone. Total rows updated: ${totalUpdated}`);
  if (DRY_RUN) {
    console.log('(Dry run — no actual changes were made)');
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function encryptTable(
  supabase: any,
  table: string,
  columns: string[],
): Promise<number> {
  console.log(`--- ${table} ---`);

  const selectCols = ['id', ...columns].join(', ');
  const { data: rows, error } = await supabase
    .from(table)
    .select(selectCols);

  if (error) {
    console.error(`  Error fetching ${table}: ${error.message}`);
    return 0;
  }

  if (!rows || rows.length === 0) {
    console.log('  No rows found');
    return 0;
  }

  let updated = 0;

  for (const row of rows) {
    const updates: Record<string, string> = {};
    let needsUpdate = false;

    for (const col of columns) {
      const value = row[col] as string | null;
      if (!value) continue;

      // If already encrypted, skip
      if (isEncrypted(value)) continue;

      updates[col] = encrypt(value);
      needsUpdate = true;
    }

    if (!needsUpdate) continue;

    const colNames = Object.keys(updates).join(', ');
    console.log(`  Encrypting ${table}.id=${row.id as string} [${colNames}]`);

    if (!DRY_RUN) {
      const { error: updateError } = await supabase
        .from(table)
        .update(updates)
        .eq('id', row.id as string);

      if (updateError) {
        console.error(`  Error updating ${table}.id=${row.id as string}: ${updateError.message}`);
        continue;
      }
    }

    updated++;
  }

  console.log(`  ${updated}/${rows.length} rows ${DRY_RUN ? 'would be' : ''} updated`);
  return updated;
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
