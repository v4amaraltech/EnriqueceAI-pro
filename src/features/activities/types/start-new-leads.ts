export interface AvailableCadence {
  id: string;
  name: string;
  origin: 'inbound_active' | 'inbound_passive' | 'outbound';
  availableLeads: number;
  totalSteps: number;
  priority: 'high' | 'medium' | 'low';
}

export interface ForecastDay {
  day: number;
  label: string;
  calls: number;
  messages: number;
}

export interface StartNewLeadsData {
  availableCadences: AvailableCadence[];
  forecast: ForecastDay[];
  totalAvailable: number;
}
