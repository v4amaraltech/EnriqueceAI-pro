'use client';

import { useEffect } from 'react';

import { TasksTab } from '@/features/cockpit/components/TasksTab';
import { EMPTY_GUARDRAILS } from '@/features/activities/utils/daily-guardrails';

import { FIXTURE_ACTIVITY, FIXTURE_HISTORY, FIXTURE_PREVIEW, FIXTURE_TASK_KEY } from './fixture';

const CARD_NOW = new Date('2026-11-11T15:00:00.000Z');

function cardActivity() {
  return {
    ...FIXTURE_ACTIVITY,
    stepOrder: 3,
    totalSteps: 3,
    lead: {
      ...FIXTURE_ACTIVITY.lead,
      first_name: 'Contato',
      last_name: 'Fixture',
      nome_fantasia: 'Empresa Fixture Ltda',
      telefone: '+5511900000000',
      job_title: 'Coordenador',
      segmento: 'Indústria',
      email: 'contato.fixture@example.com',
      lead_source: 'Blackbox',
      canal: 'Google',
      cnpj: '00000000000191',
      lost_at: '2026-04-17T10:22:48.000Z',
      loss_reason_name: 'Deixou de responder',
      loss_notes: 'Cadência concluída sem resposta',
    },
  };
}

/**
 * Fixture visual. `leadCard` só muda o meio do painel. Não disca e não grava.
 */
export function CallWorkspaceFixture({ leadCard, theme }: { leadCard: boolean; theme: 'light' | 'dark' }) {
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    return () => document.documentElement.classList.remove('dark');
  }, [theme]);

  const activity = leadCard ? cardActivity() : FIXTURE_ACTIVITY;

  return (
    <main className="bg-background text-foreground min-h-screen p-4 md:p-6">
      <p className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
        Fixture de teste. Empresa, telefone, closer e histórico são fictícios. Nenhum convite ou ligação é enviado.
      </p>
      <TasksTab
        initialActivities={[activity]}
        progress={{ completed: 1, pending: 1, total: 2, target: 20, guardrails: EMPTY_GUARDRAILS }}
        autoSend={null}
        isOwn
        dialerProvider="api4com"
        targetUserId="55555555-5555-4555-8555-555555555555"
        initialSelectedKey={FIXTURE_TASK_KEY}
        callHistory={FIXTURE_HISTORY}
        schedulingPreview={FIXTURE_PREVIEW}
        leadCardEnabled={leadCard}
        cardNow={leadCard ? CARD_NOW : undefined}
      />
    </main>
  );
}

export { CARD_NOW };
