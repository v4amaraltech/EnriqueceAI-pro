'use client';

import { Suspense } from 'react';
import { Activity, CheckCircle2, Mail, MessageSquareReply, AlertTriangle, CalendarCheck } from 'lucide-react';

import { OpportunityKpiCard } from '@/features/dashboard/components/OpportunityKpiCard';
import { RankingCard } from '@/features/dashboard/components/RankingCard';
import { LossReasonsChart } from '@/features/dashboard/components/LossReasonsChart';
import { ConversionByOriginChart } from '@/features/dashboard/components/ConversionByOriginChart';
import { StepRatesBarChart } from '@/features/cadences/components/StepRatesBarChart';
import { StepPerformanceTable } from '@/features/cadences/components/StepPerformanceTable';
import { LeadInfoPanel } from '@/features/leads/components/LeadInfoPanel';
import { LeadTable } from '@/features/leads/components/LeadTable';

import {
  opportunityKpi,
  demoMonth,
  leadsFinalizadosRanking,
  atividadesRanking,
  conversaoRanking,
  lossReasons,
  conversionByOrigin,
  cadenceSteps,
  cadenceKpis,
  enrichedLead,
  demoLeads,
  demoCadenceInfo,
  demoUserMap,
} from './demo-data';

function CadenceKpiCard({ label, value, icon: Icon }: { label: string; value: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-4">
      <div className="rounded-md bg-primary/10 p-2">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

export default function DemoPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground">
            F
          </div>
          <div>
            <h1 className="text-lg font-semibold">Flux</h1>
            <p className="text-xs text-muted-foreground">Plataforma de Sales Engagement</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-12 px-6 py-8">
        {/* Section 1: Dashboard */}
        <section>
          <SectionHeader
            title="Dashboard"
            subtitle="Visão geral de performance da equipe comercial"
          />

          <div className="space-y-6">
            {/* KPI de Oportunidades */}
            <OpportunityKpiCard kpi={opportunityKpi} month={demoMonth} />

            {/* Rankings */}
            <div className="grid gap-4 md:grid-cols-3">
              <RankingCard
                title="Leads Finalizados"
                icon={CheckCircle2}
                iconColor="bg-green-500/10"
                iconTextColor="text-green-600"
                data={leadsFinalizadosRanking}
                primaryColumnLabel="Finalizados"
                secondaryColumnLabel="Prospecção"
              />
              <RankingCard
                title="Atividades"
                icon={Activity}
                iconColor="bg-blue-500/10"
                iconTextColor="text-blue-600"
                data={atividadesRanking}
                primaryColumnLabel="Atividades"
              />
              <RankingCard
                title="Conversão"
                icon={CheckCircle2}
                iconColor="bg-purple-500/10"
                iconTextColor="text-purple-600"
                data={conversaoRanking}
                unit="%"
                primaryColumnLabel="Taxa"
              />
            </div>

            {/* Charts */}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border bg-card p-6">
                <h3 className="mb-4 text-sm font-medium">Motivos de Perda</h3>
                <LossReasonsChart data={lossReasons} />
              </div>
              <div className="rounded-lg border bg-card p-6">
                <h3 className="mb-4 text-sm font-medium">Conversão por Origem</h3>
                <ConversionByOriginChart data={conversionByOrigin} />
              </div>
            </div>
          </div>
        </section>

        {/* Section 2: Cadence Performance */}
        <section>
          <SectionHeader
            title="Performance de Cadência"
            subtitle="Outbound Enterprise Q1 — 5 steps de email"
          />

          <div className="space-y-6">
            {/* Mini KPIs */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
              <CadenceKpiCard
                label="Enviados"
                value={cadenceKpis.sent.toLocaleString('pt-BR')}
                icon={Mail}
              />
              <CadenceKpiCard
                label="Taxa de Abertura"
                value={`${cadenceKpis.openRate}%`}
                icon={Activity}
              />
              <CadenceKpiCard
                label="Taxa de Resposta"
                value={`${cadenceKpis.replyRate}%`}
                icon={MessageSquareReply}
              />
              <CadenceKpiCard
                label="Bounce Rate"
                value={`${cadenceKpis.bounceRate}%`}
                icon={AlertTriangle}
              />
              <CadenceKpiCard
                label="Reuniões Agendadas"
                value={String(cadenceKpis.meetings)}
                icon={CalendarCheck}
              />
            </div>

            {/* Step Rates Chart */}
            <div className="rounded-lg border bg-card p-6">
              <h3 className="mb-4 text-sm font-medium">Taxas por Step</h3>
              <StepRatesBarChart steps={cadenceSteps} />
            </div>

            {/* Step Performance Table */}
            <div className="rounded-lg border bg-card p-6">
              <h3 className="mb-4 text-sm font-medium">Performance Detalhada</h3>
              <StepPerformanceTable steps={cadenceSteps} />
            </div>
          </div>
        </section>

        {/* Section 3: Enriched Lead */}
        <section>
          <SectionHeader
            title="Lead Enriquecido"
            subtitle="Dados completos via enriquecimento CNPJ"
          />

          <div className="rounded-lg border bg-card">
            <LeadInfoPanel
              data={enrichedLead}
              showLeadHeader
              enrollment={{ cadence_name: 'Outbound Enterprise Q1', enrolled_by_email: 'ana.silva@empresa.com.br' }}
              cadenceConfig={{ cadenceName: 'Outbound Enterprise Q1', stepOrder: 2, totalSteps: 5 }}
              kpis={{ completed: 3, open: 2, conversations: 1 }}
            />
          </div>
        </section>

        {/* Section 4: Lead List */}
        <section>
          <SectionHeader
            title="Lista de Leads"
            subtitle="Gestão centralizada de leads B2B"
          />

          <div className="rounded-lg border bg-card">
            <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Carregando...</div>}>
              <LeadTable
                leads={demoLeads}
                total={demoLeads.length}
                cadenceInfo={demoCadenceInfo}
                userMap={demoUserMap}
              />
            </Suspense>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t bg-card py-6 text-center">
        <p className="text-xs text-muted-foreground">
          Dados fictícios para demonstração. Nenhuma informação real foi utilizada.
        </p>
      </footer>
    </div>
  );
}
