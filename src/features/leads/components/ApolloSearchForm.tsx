'use client';

import { useEffect, useState, useTransition } from 'react';

import { Loader2, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Separator } from '@/shared/components/ui/separator';
import { Switch } from '@/shared/components/ui/switch';

import {
  deleteApolloSearch,
  listApolloSearches,
  saveApolloSearch,
  type ApolloSavedSearch,
} from '../actions/apollo-saved-searches';
import type { SearchApolloInput } from '../actions/search-apollo';

const EMAIL_STATUS_OPTIONS = [
  { value: 'verified', label: 'Verificado' },
  { value: 'likely to engage', label: 'Provavel' },
  { value: 'unverified', label: 'Nao verificado' },
];

// Real Apollo industry_tag_id values discovered via organization enrichment API
const INDUSTRY_OPTIONS = [
  { value: '5567cd4773696439b10b0000', label: 'Tecnologia da Informação' },
  { value: '5567cd4d736964397e020000', label: 'Internet' },
  { value: '5567cdd67369643e64020000', label: 'Serviços Financeiros' },
  { value: '5567cdde73696439812c0000', label: 'Saúde' },
  { value: '5567cd4c73696453e1300000', label: 'Educação' },
  { value: '5567ced173696450cb580000', label: 'Varejo / E-commerce' },
  { value: '5567ce9d7369643bc19c0000', label: 'Hotelaria e Turismo' },
  { value: '5567cd477369645401010000', label: 'Imobiliário' },
  { value: '5567cdd47369643dbf260000', label: 'Consultoria' },
  { value: '5567cd467369644d39040000', label: 'Marketing e Publicidade' },
  { value: '5567cd4c7369644d39080000', label: 'Telecomunicações' },
  { value: '5567cd4773696439dd350000', label: 'Construção' },
  { value: '5567cd4973696439d53c0000', label: 'Manufatura / Maquinário' },
  { value: '5567e8bb7369641a658f0000', label: 'Logística e Transporte' },
  { value: '5567ce1e7369643b806a0000', label: 'Alimentos e Bebidas' },
  { value: '5567cdf27369644cfd800000', label: 'Automotivo' },
  { value: '5567cdd973696453d93f0000', label: 'Seguros' },
  { value: '5567cdd97369645624020000', label: 'Energia' },
  { value: '5567e1b3736964208b280000', label: 'Agronegócio' },
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
  const [titles, setTitles] = useState('');
  const [locations, setLocations] = useState('');
  const [keywords, setKeywords] = useState('');
  const [domains, setDomains] = useState('');

  // Multi-select arrays
  const [emailStatuses, setEmailStatuses] = useState<string[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [employeeRanges, setEmployeeRanges] = useState<string[]>([]);

  // Toggle
  const [includeSimilarTitles, setIncludeSimilarTitles] = useState(true);

  // Filtros salvos (presets por SDR)
  const [savedSearches, setSavedSearches] = useState<ApolloSavedSearch[]>([]);
  const [selectedSearchId, setSelectedSearchId] = useState('');
  const [presetName, setPresetName] = useState('');
  const [isSavingPreset, startPresetTransition] = useTransition();

  useEffect(() => {
    // Falha silenciosa: se a action não resolver (ex.: aba aberta numa versão
    // anterior a um deploy), só não lista presets — não derruba a tela.
    listApolloSearches()
      .then((r) => {
        if (r.success) setSavedSearches(r.data);
      })
      .catch(() => {});
  }, []);

  function currentFilterState() {
    return { titles, locations, keywords, domains, emailStatuses, industries, employeeRanges, includeSimilarTitles };
  }

  function applyPreset(id: string) {
    setSelectedSearchId(id);
    const preset = savedSearches.find((s) => s.id === id);
    if (!preset) return;
    const f = preset.filters;
    setTitles(f.titles ?? '');
    setLocations(f.locations ?? '');
    setKeywords(f.keywords ?? '');
    setDomains(f.domains ?? '');
    setEmailStatuses(f.emailStatuses ?? []);
    setIndustries(f.industries ?? []);
    setEmployeeRanges(f.employeeRanges ?? []);
    setIncludeSimilarTitles(f.includeSimilarTitles ?? true);
  }

  // Toast amigável quando a server action não resolve (ex.: deployment skew —
  // aba aberta antes de um deploy). Sem o try/catch, o erro do transition sobe
  // para o error boundary e derruba a tela.
  const STALE_DEPLOY_MSG =
    'Não foi possível concluir. Recarregue a página (Ctrl/Cmd+Shift+R) e tente de novo.';

  function handleSavePreset() {
    const name = presetName.trim();
    if (!name) return;
    startPresetTransition(async () => {
      try {
        const r = await saveApolloSearch({ name, filters: currentFilterState() });
        if (!r.success) {
          toast.error(r.error);
          return;
        }
        const list = await listApolloSearches();
        if (list.success) {
          setSavedSearches(list.data);
          setSelectedSearchId(r.data.id);
        }
        setPresetName('');
        toast.success('Filtro salvo');
      } catch {
        toast.error(STALE_DEPLOY_MSG);
      }
    });
  }

  function handleDeletePreset() {
    if (!selectedSearchId) return;
    startPresetTransition(async () => {
      try {
        const r = await deleteApolloSearch(selectedSearchId);
        if (!r.success) {
          toast.error(r.error);
          return;
        }
        setSavedSearches((prev) => prev.filter((s) => s.id !== selectedSearchId));
        setSelectedSearchId('');
        toast.success('Filtro excluído');
      } catch {
        toast.error(STALE_DEPLOY_MSG);
      }
    });
  }

  function handleSearch() {
    const params: SearchApolloInput = {
      page: 1,
      perPage: 25,
    };

    if (titles) params.personTitles = splitCommaSeparated(titles);
    if (locations) {
      const locs = splitCommaSeparated(locations);
      params.personLocations = locs;
      params.organizationLocations = locs;
    }
    if (keywords) params.organizationKeywords = splitCommaSeparated(keywords);
    if (industries.length) params.organizationIndustryTagIds = industries;
    if (domains) params.organizationDomains = splitCommaSeparated(domains);
    if (emailStatuses.length) params.contactEmailStatus = emailStatuses;
    if (employeeRanges.length) params.employeeRanges = employeeRanges;
    params.includeSimilarTitles = includeSimilarTitles;

    onSearch(params);
  }

  function handleClear() {
    setTitles('');
    setLocations('');
    setKeywords('');
    setDomains('');
    setEmailStatuses([]);
    setIndustries([]);
    setEmployeeRanges([]);
    setIncludeSimilarTitles(true);
    setSelectedSearchId('');
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

      {/* Filtros salvos (presets por SDR) */}
      <Separator />
      <div className="space-y-2">
        <Label>Filtros salvos</Label>
        {savedSearches.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              value={selectedSearchId}
              onChange={(e) => applyPreset(e.target.value)}
              disabled={isLoading || isSavingPreset}
              className="h-9 w-full rounded-md border bg-transparent px-2 text-sm disabled:opacity-60"
            >
              <option value="">Carregar filtro salvo…</option>
              {savedSearches.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {selectedSearchId && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0 text-[var(--muted-foreground)] hover:text-red-600"
                onClick={handleDeletePreset}
                disabled={isSavingPreset}
                aria-label="Excluir filtro salvo"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}
        <div className="flex items-center gap-2">
          <Input
            placeholder="Nome do filtro"
            value={presetName}
            maxLength={80}
            onChange={(e) => setPresetName(e.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={handleSavePreset}
            disabled={isSavingPreset || !presetName.trim()}
          >
            Salvar
          </Button>
        </div>
      </div>

      {/* Pessoa */}
      <Separator />
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Pessoa
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="apollo-titles">Cargo</Label>
          <Input
            id="apollo-titles"
            placeholder="CEO, Diretor Comercial, Gerente de Vendas"
            value={titles}
            onChange={(e) => setTitles(e.target.value)}
          />
          <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Separe com virgula</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="apollo-loc">Localização</Label>
          <Input
            id="apollo-loc"
            placeholder="Sao Paulo, Brasil"
            value={locations}
            onChange={(e) => setLocations(e.target.value)}
          />
          <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Cidade, estado ou pais. Separe com virgula</p>
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
          <Label htmlFor="apollo-similar-titles">Incluir cargos similares</Label>
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
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Empresa
        </p>

        <div className="space-y-2">
          <Label>Indústria</Label>
          <div className="grid grid-cols-1 gap-y-1.5 max-h-48 overflow-y-auto pr-1">
            {INDUSTRY_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={industries.includes(opt.value)}
                  onCheckedChange={() => setIndustries((prev) => toggleInArray(prev, opt.value))}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="apollo-org-keywords">Palavras-chave</Label>
          <Input
            id="apollo-org-keywords"
            placeholder="saas, fintech, real estate"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
          />
          <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Termos livres para busca ampla. Separe com virgula</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="apollo-domains">Dominios</Label>
          <Input
            id="apollo-domains"
            placeholder="empresa.com.br, startup.io"
            value={domains}
            onChange={(e) => setDomains(e.target.value)}
          />
          <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Busca em empresas especificas</p>
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
