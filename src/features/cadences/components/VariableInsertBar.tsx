'use client';

import { useState } from 'react';

import { ChevronDown } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Label } from '@/shared/components/ui/label';

import {
  AVAILABLE_TEMPLATE_VARIABLES,
  PRIMARY_TEMPLATE_VARIABLES,
  PRIMARY_VENDOR_VARIABLES,
  VENDOR_TEMPLATE_VARIABLES,
} from '../cadence.schemas';

const VARIABLE_LABELS: Record<string, string> = {
  primeiro_nome: 'Primeiro Nome',
  nome_completo: 'Nome Completo',
  empresa: 'Empresa',
  nome_fantasia: 'Nome Fantasia',
  razao_social: 'Razão Social',
  referencia: 'Referência',
  cargo: 'Cargo',
  email: 'E-mail',
  telefone: 'Telefone',
  cnpj: 'CNPJ',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  website: 'Website',
  origem: 'Origem',
  sub_origem: 'Sub-origem',
  estado: 'Estado',
  cidade: 'Cidade',
  porte: 'Porte',
  faturamento: 'Faturamento',
  cadencia: 'Cadência',
  etapa: 'Etapa',
  nome_vendedor: 'Nome do Vendedor',
  email_vendedor: 'E-mail do Vendedor',
};

interface VariableInsertBarProps {
  onInsert: (variable: string) => void;
  disabled?: boolean;
}

// Variables not in the primary set live behind the "Mais variáveis" toggle.
// Análise dos templates ativos da V4 Amaral em 26/05/2026 mostrou que essas
// 12 variáveis nunca foram usadas — manter visíveis polui a barra e atrapalha
// na escolha das 3 que realmente importam.
const SECONDARY_LEAD = AVAILABLE_TEMPLATE_VARIABLES.filter(
  (v) => !(PRIMARY_TEMPLATE_VARIABLES as readonly string[]).includes(v),
);
const SECONDARY_VENDOR = VENDOR_TEMPLATE_VARIABLES.filter(
  (v) => !(PRIMARY_VENDOR_VARIABLES as readonly string[]).includes(v),
);
const HAS_SECONDARY = SECONDARY_LEAD.length + SECONDARY_VENDOR.length > 0;

export function VariableInsertBar({ onInsert, disabled }: VariableInsertBarProps) {
  const [showAll, setShowAll] = useState(false);

  function renderBadge(v: string) {
    return (
      <Badge
        key={v}
        variant="outline"
        className="cursor-pointer select-none text-xs hover:bg-primary/10 hover:border-primary/30"
        onClick={() => !disabled && onInsert(v)}
        aria-disabled={disabled}
      >
        {VARIABLE_LABELS[v] ?? v}
      </Badge>
    );
  }

  return (
    <div className="space-y-2">
      <div>
        <Label className="text-xs text-muted-foreground">Campos dinâmicos</Label>
        <p className="text-xs text-muted-foreground mt-0.5">Clique para inserir no texto.</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground mr-1">Lead:</span>
        {PRIMARY_TEMPLATE_VARIABLES.map(renderBadge)}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground mr-1">Vendedor:</span>
        {PRIMARY_VENDOR_VARIABLES.map(renderBadge)}
      </div>
      {HAS_SECONDARY && (
        <>
          <button
            type="button"
            onClick={() => setShowAll((prev) => !prev)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown
              className={`h-3 w-3 transition-transform ${showAll ? 'rotate-180' : ''}`}
            />
            {showAll ? 'Esconder mais variáveis' : `Mais variáveis (${SECONDARY_LEAD.length + SECONDARY_VENDOR.length})`}
          </button>
          {showAll && (
            <div className="space-y-2 pl-1 border-l-2 border-muted">
              {SECONDARY_LEAD.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground mr-1">Lead:</span>
                  {SECONDARY_LEAD.map(renderBadge)}
                </div>
              )}
              {SECONDARY_VENDOR.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground mr-1">Vendedor:</span>
                  {SECONDARY_VENDOR.map(renderBadge)}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
