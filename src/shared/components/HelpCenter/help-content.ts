import type { LucideIcon } from 'lucide-react';
import { FileText, Mail, Upload, Zap } from 'lucide-react';

export interface HelpTip {
  title: string;
  description: string;
}

export interface QuickStart {
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
}

export const quickStarts: QuickStart[] = [
  {
    label: 'Importar Leads',
    description: 'Importe sua base de contatos via CSV',
    href: '/leads/import',
    icon: Upload,
  },
  {
    label: 'Criar Cadência',
    description: 'Monte sua primeira sequência de prospecção',
    href: '/cadences/new',
    icon: Zap,
  },
  {
    label: 'Conectar Email',
    description: 'Configure Gmail para envio automático',
    href: '/settings/integrations',
    icon: Mail,
  },
  {
    label: 'Criar Template',
    description: 'Crie modelos de email e WhatsApp',
    href: '/templates/new',
    icon: FileText,
  },
];

// Ordered by specificity — more specific routes first
const contextualTips: { pattern: string; tips: HelpTip[] }[] = [
  {
    pattern: '/leads/import',
    tips: [
      { title: 'Formato CSV', description: 'Prepare seu arquivo com colunas como Nome, Email, Telefone e CNPJ.' },
      { title: 'Duplicatas', description: 'O sistema detecta leads duplicados automaticamente pelo CNPJ.' },
    ],
  },
  {
    pattern: '/leads',
    tips: [
      { title: 'Importar leads', description: 'Use o botão "Importar CSV" para adicionar leads em lote.' },
      { title: 'Filtros', description: 'Filtre leads por status, origem ou vendedor para encontrar rapidamente.' },
      { title: 'Detalhes', description: 'Clique em um lead para ver histórico completo de interações.' },
    ],
  },
  {
    pattern: '/cadences/new',
    tips: [
      { title: 'Etapas', description: 'Adicione etapas de email e WhatsApp na sequência desejada.' },
      { title: 'Intervalo', description: 'Defina dias de espera entre cada etapa para não sobrecarregar o lead.' },
    ],
  },
  {
    pattern: '/cadences/',
    tips: [
      { title: 'Preview', description: 'Use o ícone de olho para pré-visualizar o email com dados reais de um lead.' },
      { title: 'Variáveis', description: 'Use {{primeiro_nome}}, {{empresa}} e outras variáveis para personalizar.' },
      { title: 'IA', description: 'Ative "Personalização com IA" para gerar textos únicos por lead.' },
    ],
  },
  {
    pattern: '/cadences',
    tips: [
      { title: 'Criar cadência', description: 'Monte sequências de email e WhatsApp para prospecção automática.' },
      { title: 'Ativar', description: 'Cadências em rascunho não enviam mensagens. Ative quando estiver pronta.' },
    ],
  },
  {
    pattern: '/atividades',
    tips: [
      { title: 'Fila de atividades', description: 'Execute tarefas pendentes na ordem de prioridade.' },
      { title: 'Ações rápidas', description: 'Envie email, ligue ou pule a atividade direto da fila.' },
    ],
  },
  {
    pattern: '/activities',
    tips: [
      { title: 'Fila de atividades', description: 'Execute tarefas pendentes na ordem de prioridade.' },
      { title: 'Ações rápidas', description: 'Envie email, ligue ou pule a atividade direto da fila.' },
    ],
  },
  {
    pattern: '/templates',
    tips: [
      { title: 'Templates', description: 'Crie modelos reutilizáveis para email e WhatsApp.' },
      { title: 'Variáveis', description: 'Use variáveis como {{primeiro_nome}} para personalizar mensagens.' },
    ],
  },
  {
    pattern: '/calls',
    tips: [
      { title: 'Ligações', description: 'Veja o histórico de ligações e ouça gravações.' },
      { title: 'API4Com', description: 'Configure o discador VoIP em Integrações para ligar direto da plataforma.' },
    ],
  },
  {
    pattern: '/settings/integrations',
    tips: [
      { title: 'Gmail', description: 'Conecte sua conta Google para enviar emails pelas cadências.' },
      { title: 'WhatsApp', description: 'Escaneie o QR Code para conectar seu WhatsApp.' },
      { title: 'Assinatura', description: 'Personalize sua assinatura de email no botão "Assinatura" do card Google.' },
    ],
  },
  {
    pattern: '/settings/prospecting',
    tips: [
      { title: 'Metas diárias', description: 'Defina quantas atividades cada SDR deve executar por dia.' },
      { title: 'Motivos de perda', description: 'Configure os motivos de perda para análise de funil.' },
    ],
  },
  {
    pattern: '/settings/users',
    tips: [
      { title: 'Equipe', description: 'Convide membros e gerencie permissões da organização.' },
      { title: 'Papéis', description: 'Managers têm acesso total. SDRs veem apenas seus próprios dados.' },
    ],
  },
  {
    pattern: '/settings/billing',
    tips: [
      { title: 'Plano', description: 'Gerencie sua assinatura e veja o consumo de créditos.' },
    ],
  },
  {
    pattern: '/statistics',
    tips: [
      { title: 'Métricas', description: 'Acompanhe o desempenho da equipe em tempo real.' },
      { title: 'Filtros', description: 'Filtre por período para comparar resultados entre semanas ou meses.' },
    ],
  },
  {
    pattern: '/reports',
    tips: [
      { title: 'Relatórios', description: 'Analise performance de cadências e SDRs com dados detalhados.' },
    ],
  },
  {
    pattern: '/dashboard',
    tips: [
      { title: 'Visão geral', description: 'Acompanhe suas métricas de prospecção e metas do mês.' },
      { title: 'Cadências ativas', description: 'Veja quantos leads estão em cadências ativas agora.' },
    ],
  },
];

const defaultTips: HelpTip[] = [
  { title: 'Navegação', description: 'Use o menu superior para acessar todas as funcionalidades.' },
  { title: 'Atalho', description: 'Comece importando leads e criando sua primeira cadência.' },
];

export function getTipsForRoute(pathname: string): HelpTip[] {
  const match = contextualTips.find((ct) => pathname.startsWith(ct.pattern));
  return match?.tips ?? defaultTips;
}
