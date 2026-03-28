export type DialerProvider = 'api4com' | null;

export interface InitiateCallResult {
  callId: string;
  providerCallId: string;
}

export interface DialerProviderInfo {
  provider: DialerProvider;
  label: string;
}
