/**
 * Compara o JEV pela Typesafe e pela OpenRouter nas ligações mais recentes da V4.
 *
 * Não roda no CI. SOMENTE LEITURA no banco. O padrão é dry-run (lista ids curtos, não envia):
 *
 *   pnpm dlx tsx@4 scripts/compare-jev-providers.ts
 *   pnpm dlx tsx@4 scripts/compare-jev-providers.ts --send [--limit 15] [--env-file caminho]
 *
 * --send envia a transcrição de cada ligação 2x para a Typesafe e 1x para a OpenRouter.
 * Lê .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e, com --send,
 * JEV_API_KEY (ou TYPESAFE_API_KEY) e OPENROUTER_API_KEY. Nunca imprime chaves nem texto.
 */
import { createClient } from '@supabase/supabase-js';

import {
  COMPARE_ORG_ID,
  loadCompareSamples,
  missingCompareEnv,
  parseCompareArgs,
  runJevCompare,
} from '../src/features/calls/services/transcription-engine/jev-compare';

// eslint-disable-next-line no-console
const log = (line: string) => console.log(line);

async function main() {
  try {
    const args = parseCompareArgs(process.argv.slice(2));
    try {
      process.loadEnvFile(args.envFile);
    } catch {
      throw new Error(`Não consegui ler o arquivo de env: ${args.envFile}`);
    }
    const missing = missingCompareEnv(process.env, args.send);
    if (missing.length) throw new Error(`Faltam: ${missing.join(', ')}.`);
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
    const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    log(`Banco: ${new URL(url).host}`);
    const samples = await loadCompareSamples(db, COMPARE_ORG_ID, args.limit);
    const { exitCode } = await runJevCompare({ args, env: process.env, samples, log });
    process.exitCode = exitCode;
  } catch (err) {
    console.error(err instanceof Error ? err.message : 'Erro desconhecido.');
    process.exitCode = 1;
  }
}

void main();
