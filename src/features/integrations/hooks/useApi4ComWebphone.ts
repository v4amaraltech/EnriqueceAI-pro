'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type WebphoneStatus = 'disconnected' | 'connecting' | 'registered' | 'error';
export type CallStatus = 'idle' | 'ringing' | 'in-call' | 'ended';

export interface WebphoneCall {
  id: string;
  phone: string;
  direction: 'inbound' | 'outbound';
  startedAt: number;
  isApiInitiated: boolean;
  /** DB call record ID, set via webphone:call-context event */
  callRecordId?: string;
  /** Lead ID, set via webphone:call-context event */
  leadId?: string;
  /** Duration in ms, computed when call ends */
  durationMs?: number;
}

interface UseApi4ComWebphoneOptions {
  sipDomain: string;
  ramal: string;
  sipPassword: string;
  enabled: boolean;
}

interface UseApi4ComWebphoneReturn {
  webphoneStatus: WebphoneStatus;
  callStatus: CallStatus;
  currentCall: WebphoneCall | null;
  /** Call info retained after call.ended for classification dialog */
  endedCall: WebphoneCall | null;
  isMuted: boolean;
  toggleMute: () => void;
  hangup: () => void;
  answer: () => void;
  reject: () => void;
  /** Dismiss the ended state and return to idle */
  dismissEnded: () => void;
}

interface LibWebphoneInstance {
  on: (event: string, handler: (data?: LibWebphoneCall) => void) => void;
  stop: () => void;
}

interface LibWebphoneCall {
  id?: string;
  direction?: string;
  remoteIdentity?: string;
  _session?: { request?: { getHeader?: (name: string) => string | undefined }; remote_identity?: { uri?: { user?: string; toString: () => string } } };
  request?: { getHeader?: (name: string) => string | undefined };
  remote_identity?: { uri?: { user?: string; toString: () => string } };
  answer: () => void;
  reject: () => void;
  terminate: () => void;
  mute: () => void;
  unmute: () => void;
  isPrimary?: () => boolean;
}

/**
 * Core hook that manages a singleton libwebphone SIP/WebRTC instance.
 * Handles registration, auto-answer for API-initiated calls, and call controls.
 */
export function useApi4ComWebphone({
  sipDomain,
  ramal,
  sipPassword,
  enabled,
}: UseApi4ComWebphoneOptions): UseApi4ComWebphoneReturn {
  const lwpRef = useRef<LibWebphoneInstance>(null);
  const activeCallRef = useRef<LibWebphoneCall>(null);

  const [webphoneStatus, setWebphoneStatus] = useState<WebphoneStatus>('disconnected');
  const [callStatus, setCallStatus] = useState<CallStatus>('idle');
  const [currentCall, setCurrentCall] = useState<WebphoneCall | null>(null);
  const [endedCall, setEndedCall] = useState<WebphoneCall | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  // Listen for call context events (callRecordId + leadId from initiateCall callers)
  useEffect(() => {
    function handleCallContext(e: Event) {
      const detail = (e as CustomEvent<{ callRecordId: string; leadId?: string }>).detail;
      setCurrentCall((prev) =>
        prev ? { ...prev, callRecordId: detail.callRecordId, leadId: detail.leadId } : prev,
      );
    }
    window.addEventListener('webphone:call-context', handleCallContext);
    return () => window.removeEventListener('webphone:call-context', handleCallContext);
  }, []);

  // Initialize libwebphone SIP/WebRTC instance
  useEffect(() => {
    if (!enabled || !sipDomain || !ramal || !sipPassword) return;

    const win = window as unknown as Record<string, unknown>;
    const LibWebphone = win.libwebphone as (new (config: Record<string, unknown>) => LibWebphoneInstance) | undefined;

    if (!LibWebphone) {
      console.error('[api4com-webphone] libwebphone not found on window');
      return;
    }

    // Don't recreate if already initialized with same credentials
    if (lwpRef.current) return;

    try {
      const lwp = new LibWebphone({
        debug: false,
        userAgent: {
          transport: {
            sockets: [`wss://${sipDomain}:6443`],
          },
          uri: `sip:${ramal}@${sipDomain}`,
          password: sipPassword,
          register: true,
          session_timers: false,
          register_expires: 300,
        },
        audioContext: {
          enabled: true,
        },
        mediaDevices: {
          enabled: true,
        },
      });

      lwpRef.current = lwp;

      // User Agent events
      lwp.on('userAgent.connected', () => {
        setWebphoneStatus('connecting');
      });

      lwp.on('userAgent.registered', () => {
        setWebphoneStatus('registered');
      });

      lwp.on('userAgent.unregistered', () => {
        setWebphoneStatus('disconnected');
      });

      lwp.on('userAgent.disconnected', () => {
        setWebphoneStatus('disconnected');
      });

      lwp.on('userAgent.registrationFailed', () => {
        console.error('[api4com-webphone] SIP registration failed');
        setWebphoneStatus('error');
      });

      // Call events
      lwp.on('call.created', (callSession) => {
        if (!callSession) return;
        // If there's already an active call, reject secondary calls
        if (activeCallRef.current) {
          try { callSession.reject(); } catch { /* ignore */ }
          return;
        }

        activeCallRef.current = callSession;

        // Check for API-initiated call header
        const isApiInitiated = checkApiInitiatedHeader(callSession);

        const callInfo: WebphoneCall = {
          id: callSession.id ?? String(Date.now()),
          phone: extractRemoteNumber(callSession),
          direction: callSession.direction === 'outgoing' ? 'outbound' : 'inbound',
          startedAt: Date.now(),
          isApiInitiated,
        };

        setCurrentCall(callInfo);

        if (isApiInitiated) {
          // Auto-answer API-initiated calls (click-to-call flow)
          setCallStatus('in-call');
          try { callSession.answer(); } catch { /* ignore */ }
        } else {
          setCallStatus('ringing');
        }
      });

      lwp.on('call.confirmed', () => {
        setCallStatus('in-call');
      });

      lwp.on('call.ended', () => {
        activeCallRef.current = null;
        setIsMuted(false);
        setCurrentCall((prev) => {
          // For API-initiated calls (from ActivityPhonePanel/PowerDialer),
          // the calling component handles classification — go straight to idle.
          if (prev?.isApiInitiated) {
            setCallStatus('idle');
            return null;
          }
          // For non-API calls (inbound), retain info for classification dialog
          if (prev) {
            setEndedCall({ ...prev, durationMs: Date.now() - prev.startedAt });
            setCallStatus('ended');
          } else {
            setCallStatus('idle');
          }
          return null;
        });
      });

      lwp.on('call.failed', () => {
        activeCallRef.current = null;
        setCallStatus('idle');
        setCurrentCall(null);
        setIsMuted(false);
      });
    } catch (err) {
      console.error('[api4com-webphone] Init error:', err);
      // Status will remain 'disconnected' — the component shows appropriate UI
    }

    return () => {
      if (lwpRef.current) {
        try {
          lwpRef.current.stop();
        } catch { /* ignore cleanup errors */ }
        lwpRef.current = null;
        activeCallRef.current = null;
        setWebphoneStatus('disconnected');
        setCallStatus('idle');
        setCurrentCall(null);
        setIsMuted(false);
      }
    };
  }, [enabled, sipDomain, ramal, sipPassword]);

  const toggleMute = useCallback(() => {
    const call = activeCallRef.current;
    if (!call) return;
    try {
      if (isMuted) {
        call.unmute();
      } else {
        call.mute();
      }
      setIsMuted(!isMuted);
    } catch { /* ignore */ }
  }, [isMuted]);

  const hangup = useCallback(() => {
    const call = activeCallRef.current;
    if (!call) return;
    try { call.terminate(); } catch { /* ignore */ }
  }, []);

  const answer = useCallback(() => {
    const call = activeCallRef.current;
    if (!call) return;
    try {
      call.answer();
      setCallStatus('in-call');
    } catch { /* ignore */ }
  }, []);

  const reject = useCallback(() => {
    const call = activeCallRef.current;
    if (!call) return;
    try { call.reject(); } catch { /* ignore */ }
  }, []);

  const dismissEnded = useCallback(() => {
    setEndedCall(null);
    setCallStatus('idle');
  }, []);

  return {
    webphoneStatus,
    callStatus,
    currentCall,
    endedCall,
    isMuted,
    toggleMute,
    hangup,
    answer,
    reject,
    dismissEnded,
  };
}

function checkApiInitiatedHeader(callSession: LibWebphoneCall): boolean {
  try {
    // libwebphone exposes SIP headers via the underlying JsSIP/SipJS session
    const request = callSession?._session?.request ?? callSession?.request;
    if (request) {
      const header = request.getHeader?.('X-Api4comintegratedcall');
      return header === 'true';
    }
  } catch { /* ignore */ }
  return false;
}

function extractRemoteNumber(callSession: LibWebphoneCall): string {
  try {
    const uri = callSession?._session?.remote_identity?.uri ?? callSession?.remote_identity?.uri;
    if (uri) return uri.user ?? uri.toString();
    return callSession?.remoteIdentity ?? 'Desconhecido';
  } catch {
    return 'Desconhecido';
  }
}
