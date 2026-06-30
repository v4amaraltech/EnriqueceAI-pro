'use client';

import { Fragment } from 'react';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/shared/components/ui/breadcrumb';
import { isUuid } from '@/shared/utils/uuid';

const pathLabels: Record<string, string> = {
  dashboard: 'Dashboard',
  leads: 'Leads',
  atividades: 'Atividades',
  cadences: 'Cadências',
  templates: 'Templates',
  reports: 'Relatórios',
  settings: 'Configurações',
  company: 'Empresa',
  profile: 'Perfil',
  users: 'Usuários',
  integrations: 'Integrações',
  'whatsapp-numbers': 'WhatsApp Números',
  'my-whatsapp-number': 'Ligação via WhatsApp',
  billing: 'Faturamento',
  prospecting: 'Prospecção',
  'daily-goals': 'Metas Diárias',
  'loss-reasons': 'Motivos de Perda',
  abm: 'Vendas Baseadas em Contas',
  access: 'Acesso aos Leads',
  blacklist: 'Blacklist de E-mails',
  'custom-fields': 'Campos Personalizados',
  closers: 'Closers',
  'closer-feedbacks': 'Feedbacks dos Closers',
  'fit-score': 'Fit Score',

  teams: 'Times',
  email: 'Config. de E-mail',
  import: 'Importar',
  imports: 'Importações',
  apollo: 'Apollo',
  new: 'Novo',
  execution: 'Execução',
  calls: 'Ligações',
  statistics: 'Estatísticas',
  activities: 'Atividades',
  conversion: 'Conversão',
  feedback: 'Feedbacks',
  team: 'Equipe',
  performance: 'Desempenho',
  emails: 'E-mails',
  history: 'Histórico',
  ajustes: 'Ajustes',
  extrato: 'Extrato',
  'daily-targets': 'Metas Diárias',
  general: 'Geral',
  upgrade: 'Upgrade',
  api: 'API',
  password: 'Alterar Senha',
};

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  // Hide UUID segments from breadcrumb — the detail page handles its own title
  const visibleSegments = segments.filter((s) => !isUuid(s));

  if (visibleSegments.length <= 1) return null;

  return (
    <Breadcrumb className="mb-4">
      <BreadcrumbList>
        {visibleSegments.map((segment, index) => {
          // Build href pointing to the original path up to this visible segment
          const originalIndex = segments.indexOf(segment);
          const href = '/' + segments.slice(0, originalIndex + 1).join('/');
          const label = pathLabels[segment] ?? segment;
          const isLast = index === visibleSegments.length - 1;

          return (
            <Fragment key={href}>
              {index > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={href}>{label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
