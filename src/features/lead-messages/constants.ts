export const LEAD_MESSAGES_CAPTURE_FLAG = 'lead_messages_capture';

export const LEAD_MESSAGE_CHANNELS = ['whatsapp', 'email'] as const;
export const LEAD_MESSAGE_DIRECTIONS = ['inbound', 'outbound'] as const;
export const LEAD_MESSAGE_PROVIDERS = ['evolution', 'meta', 'gmail', 'ana_n8n', 'legacy_interactions'] as const;
export const LEAD_MESSAGE_STATUSES = ['sent', 'delivered', 'read', 'failed'] as const;
