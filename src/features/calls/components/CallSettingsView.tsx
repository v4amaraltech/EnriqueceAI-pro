'use client';

import type { CallDailyTargetRow, CallSettingsRow, PhoneBlacklistRow } from '../types';
import { CallDailyTargets } from './CallDailyTargets';
import { CallGeneralSettings } from './CallGeneralSettings';
import { PhoneBlacklistSettings } from './PhoneBlacklistSettings';

interface MemberInfo {
  userId: string;
  name: string;
  role: string;
}

interface CallSettingsViewProps {
  settings: CallSettingsRow | null;
  dailyTargets: CallDailyTargetRow[];
  blacklist: PhoneBlacklistRow[];
  members: MemberInfo[];
}

export function CallSettingsView({
  settings,
  dailyTargets,
  blacklist,
  members,
}: CallSettingsViewProps) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Ajustes de Ligações</h1>
        <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Configure o módulo de ligações da sua organização.
        </p>
      </div>

      <CallGeneralSettings initial={settings} />

      <hr className="border-[var(--border)]" />

      <CallDailyTargets
        orgDefault={settings?.daily_call_target ?? 20}
        members={members}
        initialTargets={dailyTargets}
      />

      <hr className="border-[var(--border)]" />

      <PhoneBlacklistSettings initial={blacklist} />
    </div>
  );
}
