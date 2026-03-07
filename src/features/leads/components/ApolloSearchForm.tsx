'use client';

import { useState } from 'react';

import { Loader2, Search, X } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Separator } from '@/shared/components/ui/separator';
import { Switch } from '@/shared/components/ui/switch';

import type { SearchApolloInput } from '../actions/search-apollo';

const SENIORITY_OPTIONS = [
  { value: 'entry', label: 'Junior' },
  { value: 'senior', label: 'Senior' },
  { value: 'manager', label: 'Gerente' },
  { value: 'director', label: 'Diretor' },
  { value: 'vp', label: 'VP' },
  { value: 'c_suite', label: 'C-Level' },
];

const EMAIL_STATUS_OPTIONS = [
  { value: 'verified', label: 'Verificado' },
  { value: 'likely to engage', label: 'Provavel' },
  { value: 'unverified', label: 'Nao verificado' },
];

const EMPLOYEE_RANGE_OPTIONS = [
  { value: '1,10', label: '1-10' },
  { value: '11,50', label: '11-50' },
  { value: '51,200', label: '51-200' },
  { value: '201,500', label: '201-500' },
  { value: '501,1000', label: '501-1.000' },
  { value: '1001,5000', label: '1.001-5.000' },
  { value: '5001,100000', label: '5.001+' },
];

interface ApolloSearchFormProps {
  onSearch: (params: SearchApolloInput) => void;
  isLoading: boolean;
}

function splitCommaSeparated(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function toggleInArray(arr: string[], value: string): string[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

export function ApolloSearchForm({ onSearch, isLoading }: ApolloSearchFormProps) {
  // Text inputs
  const [qKeywords, setQKeywords] = useState('');
  const [titles, setTitles] = useState('');
  const [personLocations, setPersonLocations] = useState('');
  const [keywords, setKeywords] = useState('');
  const [domains, setDomains] = useState('');
  const [orgLocations, setOrgLocations] = useState('');
  const [technologies, setTechnologies] = useState('');

  // Multi-select arrays
  const [seniorities, setSeniorities] = useState<string[]>([]);
  const [emailStatuses, setEmailStatuses] = useState<string[]>([]);
  const [employeeRanges, setEmployeeRanges] = useState<string[]>([]);

  // Revenue range
  const [revenueMin, setRevenueMin] = useState('');
  const [revenueMax, setRevenueMax] = useState('');

  // Toggle
  const [includeSimilarTitles, setIncludeSimilarTitles] = useState(true);

  function handleSearch() {
    const params: SearchApolloInput = {
      page: 1,
      perPage: 25,
    };

    if (qKeywords) params.qKeywords = qKeywords;
    if (titles) params.personTitles = splitCommaSeparated(titles);
    if (personLocations) params.personLocations = splitCommaSeparated(personLocations);
    if (keywords) params.organizationKeywords = splitCommaSeparated(keywords);
    if (domains) params.organizationDomains = splitCommaSeparated(domains);
    if (orgLocations) params.organizationLocations = splitCommaSeparated(orgLocations);
    if (technologies) params.technologyUids = splitCommaSeparated(technologies);
    if (seniorities.length) params.personSeniorities = seniorities;
    if (emailStatuses.length) params.contactEmailStatus = emailStatuses;
    if (employeeRanges.length) params.employeeRanges = employeeRanges;
    if (revenueMin || revenueMax) {
      params.revenueRange = {};
      if (revenueMin) params.revenueRange.min = Number(revenueMin);
      if (revenueMax) params.revenueRange.max = Number(revenueMax);
    }
    params.includeSimilarTitles = includeSimilarTitles;

    onSearch(params);
  }

  function handleClear() {
    setQKeywords('');
    setTitles('');
    setPersonLocations('');
    setKeywords('');
    setDomains('');
    setOrgLocations('');
    setTechnologies('');
    setSeniorities([]);
    setEmailStatuses([]);
    setEmployeeRanges([]);
    setRevenueMin('');
    setRevenueMax('');
    setIncludeSimilarTitles(true);
  }

  return (
    <div className="space-y-4">
      <Button type="button" className="w-full" disabled={isLoading} onClick={handleSearch}>
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Buscando...
          </>
        ) : (
          <>
            <Search className="mr-2 h-4 w-4" />
            Buscar no Apollo
          </>
        )}
      </Button>

      {/* Busca Geral */}
      <Separator />
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Busca Geral
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="apollo-keywords-general">Palavras-chave</Label>
          <Input
            id="apollo-keywords-general"
            placeholder="Ex: SaaS, vendas, fintech"
            value={qKeywords}
            onChange={(e) => setQKeywords(e.target.value)}
          />
        </div>
      </div>

      {/* Pessoa */}
      <Separator />
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Pessoa
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="apollo-titles">Cargo</Label>
          <Input
            id="apollo-titles"
            placeholder="CEO, CTO, Diretor Comercial"
            value={titles}
            onChange={(e) => setTitles(e.target.value)}
          />
          <p className="text-xs text-[var(--muted-foreground)]">Separe com virgula</p>
        </div>

        <div className="space-y-2">
          <Label>Senioridade</Label>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {SENIORITY_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={seniorities.includes(opt.value)}
                  onCheckedChange={() => setSeniorities((prev) => toggleInArray(prev, opt.value))}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="apollo-person-loc">Localizacao</Label>
          <Input
            id="apollo-person-loc"
            placeholder="Sao Paulo, Brasil"
            value={personLocations}
            onChange={(e) => setPersonLocations(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Status do email</Label>
          <div className="space-y-1.5">
            {EMAIL_STATUS_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={emailStatuses.includes(opt.value)}
                  onCheckedChange={() => setEmailStatuses((prev) => toggleInArray(prev, opt.value))}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="apollo-similar-titles">Cargos similares</Label>
          <Switch
            id="apollo-similar-titles"
            checked={includeSimilarTitles}
            onCheckedChange={setIncludeSimilarTitles}
          />
        </div>
      </div>

      {/* Empresa */}
      <Separator />
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Empresa
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="apollo-org-keywords">Palavras-chave</Label>
          <Input
            id="apollo-org-keywords"
            placeholder="SaaS, fintech, e-commerce"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="apollo-domains">Dominios</Label>
          <Input
            id="apollo-domains"
            placeholder="empresa.com.br, startup.io"
            value={domains}
            onChange={(e) => setDomains(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="apollo-org-loc">Localizacao</Label>
          <Input
            id="apollo-org-loc"
            placeholder="Sao Paulo, Rio de Janeiro"
            value={orgLocations}
            onChange={(e) => setOrgLocations(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Tamanho (funcionarios)</Label>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {EMPLOYEE_RANGE_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={employeeRanges.includes(opt.value)}
                  onCheckedChange={() => setEmployeeRanges((prev) => toggleInArray(prev, opt.value))}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Faturamento (USD)</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              placeholder="Min"
              value={revenueMin}
              onChange={(e) => setRevenueMin(e.target.value)}
              className="w-full"
            />
            <span className="text-sm text-[var(--muted-foreground)]">-</span>
            <Input
              type="number"
              placeholder="Max"
              value={revenueMax}
              onChange={(e) => setRevenueMax(e.target.value)}
              className="w-full"
            />
          </div>
        </div>
      </div>

      {/* Tecnologia */}
      <Separator />
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Tecnologia
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="apollo-tech">Tecnologias utilizadas</Label>
          <Input
            id="apollo-tech"
            placeholder="Salesforce, HubSpot, Slack"
            value={technologies}
            onChange={(e) => setTechnologies(e.target.value)}
          />
          <p className="text-xs text-[var(--muted-foreground)]">Separe com virgula</p>
        </div>
      </div>

      {/* Limpar filtros */}
      <Separator />
      <Button type="button" variant="ghost" size="sm" className="w-full" onClick={handleClear}>
        <X className="mr-2 h-3.5 w-3.5" />
        Limpar filtros
      </Button>
    </div>
  );
}
