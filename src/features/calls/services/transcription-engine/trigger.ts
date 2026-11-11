import { shouldTriggerEngineOnHangup, isTranscriptionEngineEnabled } from './flag';

/**
 * Dispara o worker paralelo no hangup. Só chama a rede se a ligação for elegível
 * E a flag estiver ligada para a org. Fire-and-forget: nunca lança.
 * Independente do trigger do whisper (não passa por processCallTranscription).
 */
export async function triggerTranscriptionEngine(args: {
  callId: string;
  orgId: string;
  answered: boolean;
  durationSeconds: number;
  appUrl: string | null | undefined;
  serviceRoleKey: string | null | undefined;
  isEnabled?: (orgId: string) => Promise<boolean>;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const { appUrl, serviceRoleKey } = args;
  if (!appUrl || !serviceRoleKey) return false;
  // Portão barato primeiro: evita ler a flag para ligações que nunca entram.
  if (!shouldTriggerEngineOnHangup({ answered: args.answered, durationSeconds: args.durationSeconds, flagEnabled: true })) {
    return false;
  }
  try {
    const enabled = await (args.isEnabled ?? isTranscriptionEngineEnabled)(args.orgId);
    if (!shouldTriggerEngineOnHangup({ answered: args.answered, durationSeconds: args.durationSeconds, flagEnabled: enabled })) {
      return false;
    }
    const res = await (args.fetchImpl ?? fetch)(`${appUrl}/api/workers/transcribe-qualify-call`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ callId: args.callId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
