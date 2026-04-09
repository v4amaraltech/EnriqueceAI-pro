'use client';

import { Badge } from '@/shared/components/ui/badge';
import { Label } from '@/shared/components/ui/label';

import { AVAILABLE_TEMPLATE_VARIABLES, VENDOR_TEMPLATE_VARIABLES } from '../cadence.schemas';

const VARIABLE_LABELS: Record<string, string> = {
  primeiro_nome: 'Primeiro Nome',
  nome_completo: 'Nome Completo',
  empresa: 'Empresa',
  nome_fantasia: 'Nome Fantasia',
  razao_social: 'Razão Social',
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

export function VariableInsertBar({ onInsert, disabled }: VariableInsertBarProps) {
  return (
    <div className="space-y-2">
      <div>
        <Label className="text-xs text-muted-foreground">Campos dinâmicos</Label>
        <p className="text-xs text-muted-foreground mt-0.5">Clique para inserir no texto.</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground mr-1">Lead:</span>
        {AVAILABLE_TEMPLATE_VARIABLES.map((v) => (
          <Badge
            key={v}
            variant="outline"
            className="cursor-pointer select-none text-xs hover:bg-primary/10 hover:border-primary/30"
            onClick={() => !disabled && onInsert(v)}
            aria-disabled={disabled}
          >
            {VARIABLE_LABELS[v] ?? v}
          </Badge>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground mr-1">Vendedor:</span>
        {VENDOR_TEMPLATE_VARIABLES.map((v) => (
          <Badge
            key={v}
            variant="outline"
            className="cursor-pointer select-none text-xs hover:bg-primary/10 hover:border-primary/30"
            onClick={() => !disabled && onInsert(v)}
            aria-disabled={disabled}
          >
            {VARIABLE_LABELS[v] ?? v}
          </Badge>
        ))}
      </div>
    </div>
  );
}
