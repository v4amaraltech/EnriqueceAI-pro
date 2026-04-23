import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { EnrichmentStatus, LeadStatus } from '../types';
import { EnrichmentStatusBadge, LeadStatusBadge } from './LeadStatusBadge';

describe('LeadStatusBadge', () => {
  const statuses: Array<{ status: LeadStatus; label: string }> = [
    { status: 'new', label: 'Novo' },
    { status: 'contacted', label: 'Contatado' },
    { status: 'qualified', label: 'Qualificado' },
    { status: 'unqualified', label: 'Não Qualificado' },
    { status: 'archived', label: 'Arquivado' },
  ];

  statuses.forEach(({ status, label }) => {
    it(`should render "${label}" for status "${status}" (default variant)`, () => {
      render(<LeadStatusBadge status={status} />);
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });
});

describe('LeadStatusBadge (meetime variant)', () => {
  const meetimeStatuses: Array<{ status: LeadStatus; label: string }> = [
    { status: 'new', label: 'NOVO' },
    { status: 'contacted', label: 'CONTATADO' },
    { status: 'qualified', label: 'QUALIFICADO' },
    { status: 'unqualified', label: 'NÃO QUALIFICADO' },
    { status: 'archived', label: 'ARQUIVADO' },
  ];

  meetimeStatuses.forEach(({ status, label }) => {
    it(`should render "${label}" for status "${status}" (meetime variant)`, () => {
      render(<LeadStatusBadge status={status} variant="meetime" />);
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });
});

describe('EnrichmentStatusBadge', () => {
  const statuses: Array<{ status: EnrichmentStatus; label: string }> = [
    { status: 'pending', label: 'Pendente' },
    { status: 'enriching', label: 'Enriquecendo' },
    { status: 'enriched', label: 'Enriquecido' },
    { status: 'enrichment_failed', label: 'Falhou' },
    { status: 'not_found', label: 'Não Encontrado' },
  ];

  statuses.forEach(({ status, label }) => {
    it(`should render "${label}" for status "${status}"`, () => {
      render(<EnrichmentStatusBadge status={status} />);
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });
});
