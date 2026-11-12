// `instance_id` do JsSIP (vai no Contact como `+sip.instance="<urn:uuid:...>"`).
//
// O guia da API4COM (Webphone próprio / arquitetura SIP) pede "um UUID por
// navegador" e trata o webphone como singleton por ramal. Sem a opção, o JsSIP
// sorteia um UUID novo a cada `new UA`, então o registrar via uma instância
// diferente a cada recarga ou aba. Aqui o UUID é por NAVEGADOR (localStorage) e
// não por aba, de propósito: a trava entre abas (`webphone-tab-lock.ts`)
// garante um único REGISTER por vez, e quando o SDR assume o ramal em outra aba
// o registrar vê o mesmo dispositivo reconectar, em vez de duas instâncias
// brigando pelo ramal.

export const WEBPHONE_INSTANCE_ID_KEY = 'enriqueceai.webphone.instance_id';

// Mesmo formato que o `Grammar.parse(..., 'uuid')` do JsSIP aceita. Fora dele o
// JsSIP descarta o valor e volta a sortear um UUID por UA.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidInstanceId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

interface InstanceIdStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface InstanceIdDeps {
  storage: InstanceIdStorage | null;
  randomUUID: () => string;
}

/** UUID v4 com `crypto.getRandomValues` (para navegador sem `randomUUID`). */
function fallbackUUID(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function')
    crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function newInstanceUUID(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      const id = crypto.randomUUID();
      if (isValidInstanceId(id)) return id;
    }
  } catch {
    /* cai no fallback */
  }
  return fallbackUUID();
}

function browserStorage(): InstanceIdStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

// Sem localStorage (modo restrito), o UUID vale só para esta aba nesta sessão.
let memoryInstanceId: string | null = null;

/**
 * UUID estável deste navegador para o `instance_id` do JsSIP. Gera e grava na
 * primeira vez; valor inválido no storage é descartado e regerado. Nunca lança.
 */
export function getWebphoneInstanceId(deps?: Partial<InstanceIdDeps>): string {
  const storage = deps && 'storage' in deps ? (deps.storage ?? null) : browserStorage();
  const randomUUID = deps?.randomUUID ?? newInstanceUUID;

  let stored: string | null = null;
  try {
    stored = storage?.getItem(WEBPHONE_INSTANCE_ID_KEY) ?? null;
  } catch {
    stored = null;
  }
  if (isValidInstanceId(stored)) return stored.toLowerCase();

  if (!storage && isValidInstanceId(memoryInstanceId)) return memoryInstanceId;

  let id = randomUUID();
  if (!isValidInstanceId(id)) id = fallbackUUID();
  id = id.toLowerCase();
  try {
    if (!storage) throw new Error('sem storage');
    storage.setItem(WEBPHONE_INSTANCE_ID_KEY, id);
  } catch {
    if (isValidInstanceId(memoryInstanceId)) return memoryInstanceId;
    memoryInstanceId = id;
  }
  return id;
}

export function resetWebphoneInstanceIdForTests(): void {
  memoryInstanceId = null;
}
