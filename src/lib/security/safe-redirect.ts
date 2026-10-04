import { getAppUrl } from '@/lib/utils/app-url';

const DEFAULT_REDIRECT = '/settings/integrations';

// Only allow same-origin relative paths. Browsers treat `\` as `/`, so `/\evil.com`
// resolves to `//evil.com` — reject backslashes and confirm the resolved origin.
export function sanitizeRedirect(state: string | null, appUrl: string = getAppUrl()): string {
  if (!state || !state.startsWith('/') || state.startsWith('//') || state.includes('\\') || state.includes('://')) {
    return DEFAULT_REDIRECT;
  }
  try {
    const base = new URL(appUrl);
    const resolved = new URL(state, base);
    if (resolved.origin !== base.origin) return DEFAULT_REDIRECT;
    // Dot segments normalize `/.//evil.com` into `//evil.com`, which callers
    // re-resolve as a protocol-relative URL — reject it after normalizing.
    if (resolved.pathname.startsWith('//')) return DEFAULT_REDIRECT;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return DEFAULT_REDIRECT;
  }
}
