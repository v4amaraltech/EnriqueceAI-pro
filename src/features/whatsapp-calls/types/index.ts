// Tipos do módulo WhatsApp Calls (Epic 7 — Ligação via WhatsApp).
// Sessão = 1 número WhatsApp pareado por SDR <-> sessão do microserviço de voz.

export type WhatsAppCallSessionStatus = 'disconnected' | 'pairing' | 'connected';

// Linha da tabela whatsapp_call_sessions (migration 20260628120100).
export interface WhatsAppCallSessionRow {
  id: string;
  org_id: string;
  user_id: string;
  service_session_id: string;
  // NULL enquanto status='pairing' — o número só é conhecido após o QR.
  phone_number: string | null;
  status: WhatsAppCallSessionStatus;
  paired_at: string | null;
  created_at: string;
  updated_at: string;
}

// Insert (sem campos auto-gerados).
export interface WhatsAppCallSessionInsert {
  org_id: string;
  user_id: string;
  service_session_id: string;
  phone_number?: string | null;
  status?: WhatsAppCallSessionStatus;
  paired_at?: string | null;
}
