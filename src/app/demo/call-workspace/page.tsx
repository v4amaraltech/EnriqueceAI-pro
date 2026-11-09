'use client';

import { TasksTab } from '@/features/cockpit/components/TasksTab';
import { EMPTY_GUARDRAILS } from '@/features/activities/utils/daily-guardrails';

import { FIXTURE_ACTIVITY, FIXTURE_HISTORY, FIXTURE_PREVIEW, FIXTURE_TASK_KEY } from './fixture';

/**
 * Fixture visual do painel de ligação. Não autentica, não disca, não cria
 * reunião e não grava histórico. Os nomes são explicitamente de teste.
 */
export default function CallWorkspaceFixturePage() {
  return (
    <main className="bg-background text-foreground min-h-screen p-4 md:p-6">
      <p className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800">
        Fixture de teste. Empresa, telefone, closer e histórico são fictícios. Nenhum convite ou ligação é enviado.
      </p>
      <TasksTab
        initialActivities={[FIXTURE_ACTIVITY]}
        progress={{ completed: 1, pending: 1, total: 2, target: 20, guardrails: EMPTY_GUARDRAILS }}
        autoSend={null}
        isOwn
        dialerProvider="api4com"
        targetUserId="55555555-5555-4555-8555-555555555555"
        initialSelectedKey={FIXTURE_TASK_KEY}
        callHistory={FIXTURE_HISTORY}
        schedulingPreview={FIXTURE_PREVIEW}
      />
    </main>
  );
}
