import type { PendingActivity } from '@/features/activities/types';

import type { SchedulingPreview } from '@/features/cockpit/components/CallMeetingDialogs';
import type { CallHistoryEntry } from '@/features/cockpit/utils/call-history';

const LEAD = '11111111-1111-4111-8111-111111111111';
const ENROLLMENT = '22222222-2222-4222-8222-222222222222';
const STEP = '33333333-3333-4333-8333-333333333333';
const CADENCE = '44444444-4444-4444-8444-444444444444';
const USER = '55555555-5555-4555-8555-555555555555';

/** Dados fictícios para a fixture visual. Não são leads, telefones nem reuniões reais. */
export const FIXTURE_ACTIVITY: PendingActivity = {
  enrollmentId: ENROLLMENT,
  cadenceId: CADENCE,
  cadenceName: 'Prospecção fixture',
  cadenceCreatedBy: USER,
  stepId: STEP,
  stepOrder: 2,
  stepDay: 3,
  totalSteps: 6,
  channel: 'phone',
  templateId: null,
  templateSubject: null,
  templateBody: null,
  aiPersonalization: false,
  nextStepDue: '2026-11-09T13:00:00.000Z',
  isCurrentStep: true,
  activityName: 'Ligação - Dia 3',
  callScript: 'Perguntar quem decide e se já houve contato anterior. Fixture.',
  callProvider: null,
  snoozeCount: 0,
  lead: {
    id: LEAD,
    org_id: '66666666-6666-4666-8666-666666666666',
    nome_fantasia: 'Empresa Fixture Ltda',
    razao_social: 'Empresa Fixture Ltda',
    cnpj: '00000000000191',
    email: 'contato.fixture@example.com',
    telefone: '11900000000',
    municipio: 'São Paulo',
    uf: 'SP',
    porte: 'Médio',
    first_name: 'Contato',
    last_name: 'de Teste',
    primeiro_nome: 'Contato',
    socios: null,
    endereco: null,
    instagram: null,
    linkedin: null,
    website: 'https://example.com',
    status: 'contacted',
    meeting_scheduled_at: null,
    enrichment_status: 'enriched',
    notes: null,
    fit_score: 70,
    engagement_score: 20,
    is_inbound: false,
    created_at: '2026-11-01T12:00:00.000Z',
    phones: null,
    emails: null,
    job_title: 'Diretoria',
    lead_source: 'Fixture',
    canal: 'Outbound',
    segmento: 'Serviços',
    assigned_to: USER,
    custom_field_values: null,
  },
};

export const FIXTURE_HISTORY: CallHistoryEntry[] = [
  { id: 'h1', at: '2026-11-07T14:00:00.000Z', title: 'Envio · e-mail', detail: 'Mensagem inicial de teste, sem envio real.' },
  { id: 'h2', at: '2026-11-08T15:30:00.000Z', title: 'Respondeu · e-mail', detail: 'Pediu para ligar nesta semana. Texto de fixture.' },
];

export const FIXTURE_PREVIEW: SchedulingPreview = {
  now: new Date('2026-11-09T12:30:00.000Z'),
  organizerEmail: 'sdr.fixture@example.com',
  skipSubmit: true,
  busy: [{ start: '2026-11-09T14:00:00.000Z', end: '2026-11-09T15:00:00.000Z' }],
  closersSchedulable: [{ id: 'closer-1', name: 'Closer Fixture', email: 'closer.fixture@example.com' }],
  closersAll: [
    { id: 'closer-1', name: 'Closer Fixture', email: 'closer.fixture@example.com' },
    { id: 'closer-2', name: 'Outro Fixture', email: 'outro.fixture@example.com' },
  ],
};

export const FIXTURE_TASK_KEY = `${ENROLLMENT}:${STEP}`;
