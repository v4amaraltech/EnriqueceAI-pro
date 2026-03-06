'use client';

import { useState } from 'react';

import { Loader2, Search } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

import type { SearchApolloInput } from '../actions/search-apollo';

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

export function ApolloSearchForm({ onSearch, isLoading }: ApolloSearchFormProps) {
  const [titles, setTitles] = useState('');
  const [personLocations, setPersonLocations] = useState('');
  const [orgLocations, setOrgLocations] = useState('');
  const [keywords, setKeywords] = useState('');
  const [domains, setDomains] = useState('');
  const [employeeRange, setEmployeeRange] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const params: SearchApolloInput = {
      page: 1,
      perPage: 25,
    };

    if (titles) params.personTitles = splitCommaSeparated(titles);
    if (personLocations) params.personLocations = splitCommaSeparated(personLocations);
    if (orgLocations) params.organizationLocations = splitCommaSeparated(orgLocations);
    if (keywords) params.organizationKeywords = splitCommaSeparated(keywords);
    if (domains) params.organizationDomains = splitCommaSeparated(domains);
    if (employeeRange) params.employeeRanges = [employeeRange];

    onSearch(params);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="apollo-titles">Cargo</Label>
          <Input
            id="apollo-titles"
            placeholder="CEO, CTO, Diretor Comercial"
            value={titles}
            onChange={(e) => setTitles(e.target.value)}
          />
          <p className="text-xs text-[var(--muted-foreground)]">Separe múltiplos com vírgula</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="apollo-person-loc">Localização da pessoa</Label>
          <Input
            id="apollo-person-loc"
            placeholder="São Paulo, Brasil"
            value={personLocations}
            onChange={(e) => setPersonLocations(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="apollo-keywords">Palavras-chave da empresa</Label>
          <Input
            id="apollo-keywords"
            placeholder="SaaS, fintech, e-commerce"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="apollo-domains">Domínios</Label>
          <Input
            id="apollo-domains"
            placeholder="empresa.com.br, startup.io"
            value={domains}
            onChange={(e) => setDomains(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="apollo-org-loc">Localização da empresa</Label>
          <Input
            id="apollo-org-loc"
            placeholder="São Paulo, Rio de Janeiro"
            value={orgLocations}
            onChange={(e) => setOrgLocations(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="apollo-employees">Tamanho da empresa</Label>
          <Select value={employeeRange || 'any'} onValueChange={(v) => setEmployeeRange(v === 'any' ? '' : v)}>
            <SelectTrigger id="apollo-employees">
              <SelectValue placeholder="Qualquer tamanho" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Qualquer tamanho</SelectItem>
              {EMPLOYEE_RANGE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label} funcionários
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button type="submit" disabled={isLoading}>
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
    </form>
  );
}
