'use client';

import { useSyncExternalStore } from 'react';

import { getWebphoneState, subscribeWebphone } from './webphone-client';
import { initialWebphoneState, type WebphoneState } from './webphone-state';

const getServerSnapshot = () => initialWebphoneState;

/** Estado do webphone desta aba (registro SIP + ligação em andamento). */
export function useApi4ComWebphone(): WebphoneState {
  return useSyncExternalStore(subscribeWebphone, getWebphoneState, getServerSnapshot);
}
