'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

import type {
  ThreeCPlusAgentStatus,
  ThreeCPlusQualification,
  ThreeCPlusSocketCallData,
} from '@/features/integrations/types/threecplus';

interface UseThreeCPlusSocketOptions {
  domain: string;
  token: string;
  enabled: boolean;
}

interface UseThreeCPlusSocketReturn {
  status: ThreeCPlusAgentStatus;
  currentCallData: ThreeCPlusSocketCallData | null;
  isConnected: boolean;
  connect: () => void;
  disconnect: () => void;
}

export function useThreeCPlusSocket({
  domain,
  token,
  enabled,
}: UseThreeCPlusSocketOptions): UseThreeCPlusSocketReturn {
  const socketRef = useRef<Socket | null>(null);
  const [status, setStatus] = useState<ThreeCPlusAgentStatus>('disconnected');
  const [currentCallData, setCurrentCallData] = useState<ThreeCPlusSocketCallData | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const connect = useCallback(() => {
    if (socketRef.current?.connected) return;
    if (!domain || !token) return;

    // 3CPlus Socket.io server — uses api_token as query param
    const socketUrl = `https://${domain}.3c.plus`;

    const socket = io(socketUrl, {
      query: { api_token: token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });

    socket.on('connect', () => {
      setIsConnected(true);
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
      setStatus('disconnected');
    });

    socket.on('connect_error', (err) => {
      console.error('[3cplus-socket] Connection error:', err.message);
      setIsConnected(false);
    });

    // Agent status events (per official 3CPlus API docs)
    socket.on('agent-is-idle', () => {
      setStatus('idle');
      setCurrentCallData(null);
    });

    socket.on('agent-login-failed', (data: { message?: string }) => {
      setStatus('login_failed');
      console.error('[3cplus-socket] Login failed:', data.message);
    });

    socket.on('agent-was-logged-out', () => {
      setStatus('logged_out');
      setCurrentCallData(null);
    });

    socket.on('agent-entered-manual', () => {
      setStatus('manual_mode');
    });

    socket.on('agent-entered-work-break', () => {
      setStatus('work_break');
    });

    // Call events
    socket.on('call-was-connected', (data: {
      callId?: string;
      phone?: string;
      qualifications?: ThreeCPlusQualification[];
      mailingData?: Record<string, unknown>;
    }) => {
      setStatus('connected');
      setCurrentCallData({
        callId: data.callId ?? '',
        phone: data.phone ?? '',
        qualifications: data.qualifications ?? [],
        mailingData: data.mailingData,
      });
    });

    socket.on('call-was-ended', () => {
      setStatus('acw');
    });

    socket.on('agent-in-acw', () => {
      setStatus('acw');
    });

    socket.on('call-was-answered', () => {
      // Call answered by remote party — status already 'connected' from call-was-connected
    });

    socket.on('call-was-abandoned', () => {
      setStatus('idle');
      setCurrentCallData(null);
    });

    socketRef.current = socket;
  }, [domain, token]);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
      setIsConnected(false);
      setStatus('disconnected');
      setCurrentCallData(null);
    }
  }, []);

  // Auto-connect when enabled and credentials are available
  useEffect(() => {
    if (enabled && domain && token) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [enabled, domain, token, connect, disconnect]);

  return {
    status,
    currentCallData,
    isConnected,
    connect,
    disconnect,
  };
}
