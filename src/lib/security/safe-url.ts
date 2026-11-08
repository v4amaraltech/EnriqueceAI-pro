/**
 * Validação de URLs de saída (anti-SSRF). Sem DNS: bloqueia por esquema e por
 * hostname literal (loopback, redes privadas, link-local/metadata, nomes internos).
 */

const MAX_REDIRECTS = 3;

function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** Hostname que aponta para a máquina local, rede privada ou metadados de nuvem. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.internal') || host.endsWith('.local') || host.endsWith('.lan')) return true;
  if (host === 'metadata' || host === 'metadata.google.internal') return true;
  if (host.includes(':')) {
    // IPv6: loopback, não especificado, ULA (fc00::/7), link-local (fe80::/10), IPv4 mapeado.
    return (
      host === '::1' ||
      host === '::' ||
      /^f[cd]/.test(host) ||
      /^fe[89ab]/.test(host) ||
      host.startsWith('::ffff:')
    );
  }
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/.test(host)) return true; // IP decimal/hex
  return isPrivateIPv4(host);
}

/** Retorna a URL parseada se for https e de host público; senão null. */
export function parsePublicHttpsUrl(raw: string, opts: { allowHttp?: boolean } = {}): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && !(opts.allowHttp && url.protocol === 'http:')) return null;
  if (url.username || url.password) return null;
  if (isPrivateHost(url.hostname)) return null;
  return url;
}

/** Host oficial da API4COM: api4com.com ou subdomínio. */
export function isApi4ComHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'api4com.com' || host.endsWith('.api4com.com');
}

/** URL base da API4COM válida: https e host da API4COM. */
export function isSafeApi4ComBaseUrl(raw: string): boolean {
  const url = parsePublicHttpsUrl(raw);
  return !!url && isApi4ComHost(url.hostname);
}

/**
 * fetch para URLs controladas por terceiros (ex.: recording_url): http(s) em
 * host público e redirects revalidados a cada salto. Retorna null se bloqueado.
 * http é aceito por compatibilidade com links de gravação legados; hosts
 * privados/loopback/metadata nunca.
 */
export async function fetchPublicHttps(raw: string, init: RequestInit = {}): Promise<Response | null> {
  const opts = { allowHttp: true };
  let current = parsePublicHttpsUrl(raw, opts);
  for (let hop = 0; current && hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(current.toString(), { ...init, redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return null;
      let next: string;
      try {
        next = new URL(location, current).toString();
      } catch {
        return null;
      }
      current = parsePublicHttpsUrl(next, opts);
      continue;
    }
    return response;
  }
  return null;
}
