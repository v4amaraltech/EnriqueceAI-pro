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
  billing: 'Faturamento',
  prospecting: 'Prospecção',
  'daily-goals': 'Metas Diárias',
  'loss-reasons': 'Motivos de Perda',
  abm: 'Vendas Baseadas em Contas',
  access: 'Acesso aos Leads',
  blacklist: 'Blacklist de E-mails',
  'custom-fields': 'Campos Personalizados',
  'fit-score': 'Fit Score',
  'field-association': 'Associação de Campos',
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
  team: 'Equipe',
  performance: 'Desempenho',
  emails: 'E-mails',
  history: 'Histórico',
  ajustes: 'Ajustes',
  extrato: 'Extrato',
  'daily-targets': 'Metas Diárias',
  general: 'Geral',
  upgrade: 'Upgrade',
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  // Hide UUID segments from breadcrumb — the detail page handles its own title
  const visibleSegments = segments.filter((s) => !UUID_REGEX.test(s));

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
