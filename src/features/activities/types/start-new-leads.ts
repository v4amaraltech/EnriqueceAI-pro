export interface AvailableCadence {
  id: string;
  name: string;
  origin: 'inbound_active' | 'inbound_passive' | 'outbound';
  availableLeads: number;
  totalSteps: number;
  firstDayActivities: number;
  priority: 'high' | 'medium' | 'low';
}

export interface ForecastDay {
  dayOffset: number;
  dayLabel: string;
  existingActivities: number;
}
