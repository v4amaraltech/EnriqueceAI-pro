'use client';

import { useSyncExternalStore } from 'react';

import {
  getWebphoneCallContextState,
  initialWebphoneCallContextState,
  subscribeWebphoneCallContext,
  type WebphoneCallContextState,
} from './webphone-call-context';

const getServerSnapshot = () => initialWebphoneCallContextState;

/** Contexto (lead, `callId`) e anotações da ligação em andamento nesta aba. */
export function useWebphoneCallContext(): WebphoneCallContextState {
  return useSyncExternalStore(subscribeWebphoneCallContext, getWebphoneCallContextState, getServerSnapshot);
}
