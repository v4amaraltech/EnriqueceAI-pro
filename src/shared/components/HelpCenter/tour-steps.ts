import type { DriveStep } from 'driver.js';

export const appTourSteps: DriveStep[] = [
  {
    element: '[data-tour="logo"]',
    popover: {
      title: 'Bem-vindo ao Enriquece AI!',
      description:
        'Esta é sua plataforma de prospecção B2B. Vamos fazer um tour rápido para você conhecer as principais funcionalidades.',
      side: 'bottom',
      align: 'start',
    },
  },
  {
    element: '[data-tour="nav"]',
    popover: {
      title: 'Menu de Navegação',
      description:
        'Acesse todas as seções: Dashboard para visão geral, Prospecção para gerenciar leads e cadências, Ligações para o discador VoIP, e Estatísticas para acompanhar resultados.',
      side: 'bottom',
      align: 'center',
    },
  },
  {
    element: '[data-tour="toolbar"]',
    popover: {
      title: 'Barra de Ferramentas',
      description:
        'Altere o tema (claro/escuro), acesse a ajuda, veja notificações em tempo real e gerencie seu perfil.',
      side: 'bottom',
      align: 'end',
    },
  },
  {
    element: '[data-tour="main-content"]',
    popover: {
      title: 'Área Principal',
      description:
        'Aqui aparece o conteúdo de cada seção. Comece importando seus leads e criando sua primeira cadência de prospecção!',
      side: 'top',
      align: 'center',
    },
  },
];
