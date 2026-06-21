import type { Metadata } from 'next';

import { ApiDocsContent } from './ApiDocsContent';

export const metadata: Metadata = {
  title: 'API de Leads — Enriquece AI Developers',
  description:
    'Documentação da API REST do Enriquece AI: autenticação por chave, envio de leads (único e em lote), campos disponíveis, limites de uso e códigos de erro.',
  openGraph: {
    title: 'API de Leads — Enriquece AI Developers',
    description:
      'Integre leads à sua organização no Enriquece AI via API REST. Autenticação por chave, envio único ou em lote.',
  },
};

export default function ApiDocsPage() {
  return <ApiDocsContent />;
}
