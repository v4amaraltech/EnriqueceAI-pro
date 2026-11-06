'use client';

import { useEffect, useState } from 'react';

import { getWebphoneSipConfig } from '@/features/calls/actions/get-webphone-sip-config';

import { WebphonePanel } from './WebphonePanel';
import { startWebphone, stopWebphone } from './webphone-client';

/**
 * Liga o webphone da aba quando o gestor liberou para o usuário e monta o
 * painel flutuante (bloco 3). Para quem não tem o webphone liberado não
 * renderiza nada — nem o pill.
 */
export function Api4ComWebphoneMount() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getWebphoneSipConfig()
      .then((r) => {
        if (cancelled || !r.success || !r.data.enabled) return;
        setEnabled(true);
        return startWebphone({ sipDomain: r.data.sipDomain, ramal: r.data.ramal, sipPassword: r.data.sipPassword });
      })
      .catch((err: unknown) => console.error('[webphone] start failed:', err));
    return () => {
      cancelled = true;
      stopWebphone();
    };
  }, []);

  if (!enabled) return null;
  return <WebphonePanel />;
}
