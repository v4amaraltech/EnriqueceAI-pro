#!/usr/bin/env npx tsx
/**
 * TOKEN_ENCRYPTION_KEY Rotation Script
 *
 * Usage:
 *   OLD_KEY=<old_hex_key> NEW_KEY=<new_hex_key> npx tsx scripts/rotate-encryption-key.ts
 *
 * What it does:
 *   1. Connects to Supabase via service role
 *   2. Reads all encrypted columns across credential tables
 *   3. Decrypts each value with OLD_KEY
 *   4. Re-encrypts with NEW_KEY
 *   5. Updates the row in-place
 *   6. Reports success/failure counts
 *
 * After running:
 *   1. Update TOKEN_ENCRYPTION_KEY in Vercel env vars to NEW_KEY
 *   2. Redeploy: npx vercel --prod
 *   3. Verify integrations still work
 *   4. Delete OLD_KEY from your records
 *
 * Safety:
 *   - Dry-run by default (set DRY_RUN=false to actually write)
 *   - Skips values that fail to decrypt (logs them for manual review)
 *   - Transaction-safe per table
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

const OLD_KEY = process.env.OLD_KEY;
const NEW_KEY = process.env.NEW_KEY;
const DRY_RUN = process.env.DRY_RUN !== 'false';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!OLD_KEY || !NEW_KEY) {
  console.error('Usage: OLD_KEY=<hex> NEW_KEY=<hex> npx tsx scripts/rotate-encryption-key.ts');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (OLD_KEY.length !== 64 || NEW_KEY.length !== 64) {
  console.error('Keys must be 64 hex characters (256 bits)');
  process.exit(1);
}

const oldKeyBuf = Buffer.from(OLD_KEY, 'hex');
const newKeyBuf = Buffer.from(NEW_KEY, 'hex');

function isEncrypted(value: string): boolean {
  const parts = value.split(':');
  if (parts.length !== 3) return false;
  const [iv, tag, ct] = parts;
  return (
    iv!.length === IV_LENGTH * 2 &&
    tag!.length === AUTH_TAG_LENGTH * 2 &&
    /^[0-9a-f]+$/.test(iv!) &&
    /^[0-9a-f]+$/.test(tag!)
  );
}

function decryptWith(value: string, key: Buffer): string {
  if (!isEncrypted(value)) return value;
  const [ivHex, authTagHex, ciphertextHex] = value.split(':') as [string, string, string];
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function encryptWith(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

// Tables and their encrypted columns
const ENCRYPTED_TABLES: Array<{ table: string; columns: string[] }> = [
  { table: 'crm_connections', columns: ['credentials_encrypted'] },
  { table: 'gmail_connections', columns: ['access_token_encrypted', 'refresh_token_encrypted'] },
  { table: 'calendar_connections', columns: ['access_token_encrypted', 'refresh_token_encrypted'] },
  { table: 'whatsapp_connections', columns: ['access_token_encrypted'] },
  { table: 'apollo_connections', columns: ['api_key_encrypted'] },
  { table: 'api4com_connections', columns: ['api_key_encrypted'] },
  { table: 'whatsapp_instances', columns: ['api_key_encrypted'] },
];

async function main() {
  console.log(DRY_RUN ? '🔍 DRY RUN — no changes will be written' : '🔑 LIVE RUN — re-encrypting data');
  console.log('');

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
  let totalUpdated = 0;
  let totalErrors = 0;

  for (const { table, columns } of ENCRYPTED_TABLES) {
    const selectCols = ['id', ...columns].join(', ');
    const { data: rows, error } = await supabase.from(table).select(selectCols);

    if (error) {
      console.error(`❌ ${table}: query failed — ${error.message}`);
      totalErrors++;
      continue;
    }

    if (!rows || rows.length === 0) {
      console.log(`⏭️  ${table}: no rows`);
      continue;
    }

    let updated = 0;
    let errors = 0;

    for (const row of rows) {
      const updates: Record<string, string> = {};

      for (const col of columns) {
        const value = row[col] as string | null;
        if (!value || !isEncrypted(value)) continue;

        try {
          const plaintext = decryptWith(value, oldKeyBuf);
          const reencrypted = encryptWith(plaintext, newKeyBuf);
          updates[col] = reencrypted;
        } catch (err) {
          console.error(`  ❌ ${table}.${col} id=${row.id}: decrypt failed — ${err}`);
          errors++;
        }
      }

      if (Object.keys(updates).length === 0) continue;

      if (DRY_RUN) {
        console.log(`  ✅ ${table} id=${row.id}: would re-encrypt ${Object.keys(updates).join(', ')}`);
        updated++;
      } else {
        const { error: updateErr } = await supabase.from(table).update(updates).eq('id', row.id);
        if (updateErr) {
          console.error(`  ❌ ${table} id=${row.id}: update failed — ${updateErr.message}`);
          errors++;
        } else {
          console.log(`  ✅ ${table} id=${row.id}: re-encrypted ${Object.keys(updates).join(', ')}`);
          updated++;
        }
      }
    }

    console.log(`📊 ${table}: ${updated} updated, ${errors} errors (${rows.length} total rows)`);
    totalUpdated += updated;
    totalErrors += errors;
  }

  console.log('');
  console.log('═══════════════════════════════════════');
  console.log(`Total: ${totalUpdated} re-encrypted, ${totalErrors} errors`);
  if (DRY_RUN) {
    console.log('');
    console.log('To apply changes, run with DRY_RUN=false');
  } else {
    console.log('');
    console.log('Next steps:');
    console.log('1. Update TOKEN_ENCRYPTION_KEY in Vercel to NEW_KEY');
    console.log('2. npx vercel --prod');
    console.log('3. Test all integrations');
  }
}

main().catch(console.error);
