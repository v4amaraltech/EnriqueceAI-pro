export interface ActivityAnalyticsKpis {
  totalActivities: number;
  activitiesToday: number;
  avgPerDay: number;
  goalAchievement: number;
}

export interface ChannelVolumeEntry {
  channel: string;
  label: string;
  count: number;
  color: string;
}

export interface DailyActivityEntry {
  date: string;
  label: string;
  count: number;
  target: number;
}

export interface ActivityTypeEntry {
  type: string;
  label: string;
  count: number;
  percentage: number;
  color: string;
}

export interface GoalData {
  target: number;
  actual: number;
  percentage: number;
}

export interface UserActivityRow {
  userId: string;
  name: string;
  leads: number;
  activitiesCompleted: number;
  activitiesTotal: number;
  onTimePercent: number | null;
  lost: number;
  won: number;
  wonPercent: number | null;
}

export interface ChannelCompletionEntry {
  channel: string;
  label: string;
  completedPercent: number;
}

export interface ActivityAnalyticsData {
  kpis: ActivityAnalyticsKpis;
  channelVolume: ChannelVolumeEntry[];
  dailyTrend: DailyActivityEntry[];
  activityTypes: ActivityTypeEntry[];
  goal: GoalData;
  leadsInPeriod: number;
  totalLost: number;
  totalWon: number;
  channelCompletion: ChannelCompletionEntry[];
  userBreakdown: UserActivityRow[];
}
