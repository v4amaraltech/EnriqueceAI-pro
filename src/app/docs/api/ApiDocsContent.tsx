'use client';

import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';

// Base URL de produção — mesma usada nos exemplos da plataforma.
const BASE_URL = 'https://app.enriqueceai.com.br';

interface NavItem {
  id: string;
  label: string;
}

const NAV: NavItem[] = [
  { id: 'introducao', label: 'Introdução' },
  { id: 'autenticacao', label: 'Autenticação' },
  { id: 'limites', label: 'Limites de uso' },
  { id: 'criar-lead', label: 'Criar lead (REST)' },
  { id: 'enviar-lote', label: 'Enviar em lote (Webhook)' },
  { id: 'health', label: 'Health check' },
  { id: 'campos', label: 'Campos do lead' },
  { id: 'erros', label: 'Códigos de erro' },
];

interface LeadField {
  name: string;
  type: string;
  required: boolean;
  desc: string;
}

// Espelha exatamente o schema inboundLeadSchema (inbound-lead.schemas.ts).
const FIELDS: LeadField[] = [
  { name: 'first_name', type: 'string', required: true, desc: 'Nome do contato' },
  { name: 'last_name', type: 'string', required: false, desc: 'Sobrenome do contato' },
  { name: 'email', type: 'string', required: true, desc: 'E-mail do contato' },
  { name: 'telefone', type: 'string', required: true, desc: 'Telefone principal (formato livre, ex: +5511999999999)' },
  { name: 'job_title', type: 'string', required: false, desc: 'Cargo do contato' },
  { name: 'empresa', type: 'string', required: true, desc: 'Nome fantasia da empresa' },
  { name: 'razao_social', type: 'string', required: false, desc: 'Razão social (nome jurídico registrado)' },
  { name: 'cnpj', type: 'string', required: false, desc: 'CNPJ (aceita com ou sem pontuação)' },
  { name: 'porte', type: 'string', required: false, desc: 'Porte da empresa (ex: MEI, ME, EPP, Média, Grande)' },
  { name: 'faturamento_estimado', type: 'number', required: false, desc: 'Faturamento estimado mensal em R$' },
  { name: 'lead_source', type: 'string', required: false, desc: 'Origem do lead (ex: Outbound, Inbound, Indicação)' },
  { name: 'canal', type: 'string', required: false, desc: 'Sub-origem (ex: Facebook, Google, LinkedIn, Landing Page)' },
  { name: 'is_inbound', type: 'boolean', required: false, desc: 'Se é lead inbound (default: true)' },
  { name: 'instagram', type: 'string', required: false, desc: '@ ou URL do Instagram' },
  { name: 'linkedin', type: 'string', required: false, desc: 'URL do perfil no LinkedIn' },
  { name: 'website', type: 'string', required: false, desc: 'URL do site da empresa' },
  { name: 'assigned_to', type: 'UUID', required: false, desc: 'ID do SDR responsável pelo lead' },
  { name: 'cadence_id', type: 'UUID', required: false, desc: 'ID da cadência para inscrição automática' },
  { name: 'notes', type: 'string', required: false, desc: 'Observações sobre o lead' },
  { name: 'custom_fields', type: 'object', required: false, desc: 'Campos personalizados por ID ou nome, ex: { "Valor do Lead": 5000 }' },
];

interface ErrorCode {
  code: string;
  meaning: string;
}

// Status codes retornados pelos route handlers de /api/v1/leads e /api/webhooks/inbound-leads.
const ERRORS: ErrorCode[] = [
  { code: '200', meaning: 'OK — requisição idempotente já processada, ou lote aceito sem novos leads criados' },
  { code: '201', meaning: 'Created — lead(s) criado(s) com sucesso' },
  { code: '400', meaning: 'JSON inválido ou payload malformado' },
  { code: '401', meaning: 'API key ausente, inválida ou expirada' },
  { code: '402', meaning: 'Limite de leads do plano atingido' },
  { code: '409', meaning: 'Lead duplicado (retorna existing_lead_id) — apenas REST' },
  { code: '413', meaning: 'Payload excede 1 MB — apenas REST' },
  { code: '422', meaning: 'Erro de validação (retorna details com os campos), nenhum lead no payload, ou mais de 100 leads' },
  { code: '429', meaning: 'Rate limit excedido — veja o header Retry-After' },
  { code: '500', meaning: 'Erro interno do servidor' },
];

const CURL_CREATE = `curl -X POST ${BASE_URL}/api/v1/leads \\
  -H "Authorization: Bearer SUA_CHAVE_API" \\
  -H "Content-Type: application/json" \\
  -d '{
    "first_name": "Carlos",
    "email": "carlos@empresa.com",
    "telefone": "+5511999999999",
    "empresa": "XPTO Ltda"
  }'`;

const RESPONSE_CREATE = `{
  "success": true,
  "data": {
    "lead_id": "550e8400-e29b-41d4-a716-446655440000"
  }
}`;

const CURL_BATCH = `curl -X POST ${BASE_URL}/api/webhooks/inbound-leads \\
  -H "Authorization: Bearer SUA_CHAVE_API" \\
  -H "Content-Type: application/json" \\
  -H "X-Idempotency-Key: 1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed" \\
  -d '{
    "on_duplicate": "skip",
    "leads": [
      { "first_name": "João", "email": "joao@empresa.com", "telefone": "+5511987654321", "empresa": "ABC Corp" },
      { "name": "Maria Souza", "email": "maria@beta.com", "phone": "+5511955554444", "company": "Beta SA" }
    ]
  }'`;

const RESPONSE_BATCH = `{
  "success": true,
  "data": {
    "received": 2,
    "created": 2,
    "duplicates": 0,
    "updated": 0,
    "errors": 0,
    "results": [
      { "index": 0, "status": "created", "lead_id": "550e8400-..." },
      { "index": 1, "status": "created", "lead_id": "660f9511-..." }
    ]
  }
}`;

const CURL_HEALTH = `curl ${BASE_URL}/api/health`;

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-background px-2 py-1 text-xs font-medium text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
      aria-label="Copiar"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copiado' : 'Copiar'}
    </button>
  );
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  return (
    <div className="relative">
      <div className="absolute right-2 top-2 z-10 flex items-center gap-2">
        {language ? (
          <span className="rounded bg-[var(--border)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            {language}
          </span>
        ) : null}
        <CopyButton value={code} />
      </div>
      <pre className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--muted)] p-4 pt-10 text-xs leading-relaxed">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  );
}

function MethodBadge({ method }: { method: 'POST' | 'GET' }) {
  const color =
    method === 'POST'
      ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
      : 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300';
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-bold ${color}`}>{method}</span>
  );
}

function Endpoint({ method, path }: { method: 'POST' | 'GET'; path: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <MethodBadge method={method} />
        <code className="truncate font-mono text-sm">{path}</code>
      </div>
      <CopyButton value={`${BASE_URL}${path}`} />
    </div>
  );
}

export function ApiDocsContent() {
  const [active, setActive] = useState<string>('introducao');

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActive(entry.target.id);
          }
        }
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: 0 },
    );

    for (const item of NAV) {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-6 py-10 lg:grid-cols-[220px_1fr]">
      {/* Sidebar */}
      <aside className="hidden lg:block">
        <nav className="sticky top-20 space-y-1">
          <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Referência da API
          </p>
          {NAV.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={`block rounded-md px-3 py-1.5 text-sm transition-colors ${
                active === item.id
                  ? 'bg-[var(--muted)] font-medium text-[var(--foreground)]'
                  : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)]/60'
              }`}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className="min-w-0 space-y-14">
        {/* Introdução */}
        <section id="introducao" className="scroll-mt-24">
          <h1 className="text-3xl font-bold tracking-tight">API de Leads</h1>
          <p className="mt-3 max-w-2xl text-[var(--muted-foreground)]">
            Envie leads diretamente para a sua organização no Enriquece AI a partir de qualquer
            sistema — landing pages, RD Station, Zapier, Make, formulários próprios ou seu backend.
            A API é REST, recebe e responde em JSON, e usa autenticação por chave.
          </p>

          <div className="mt-6 space-y-2">
            <p className="text-sm font-medium text-[var(--muted-foreground)]">URL base</p>
            <CodeBlock code={BASE_URL} />
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <Endpoint method="POST" path="/api/v1/leads" />
            <Endpoint method="POST" path="/api/webhooks/inbound-leads" />
          </div>
        </section>

        {/* Autenticação */}
        <section id="autenticacao" className="scroll-mt-24">
          <h2 className="text-2xl font-bold tracking-tight">Autenticação</h2>
          <p className="mt-3 max-w-2xl text-[var(--muted-foreground)]">
            Toda requisição precisa de uma <strong>chave de API</strong> (formato{' '}
            <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-sm">enr_k_...</code>). Gere e
            gerencie suas chaves dentro da plataforma, em{' '}
            <strong>Configurações → Integrações → API</strong>. A chave é exibida apenas uma vez na
            criação — guarde em local seguro. Cada chave pertence a uma organização e pode ser
            revogada a qualquer momento.
          </p>

          <p className="mt-5 text-sm font-medium">Envie a chave no header Authorization:</p>
          <div className="mt-2">
            <CodeBlock code={`Authorization: Bearer SUA_CHAVE_API`} />
          </div>

          <p className="mt-5 text-sm text-[var(--muted-foreground)]">
            Alternativamente, a chave pode ser enviada como query param{' '}
            <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-sm">?token=SUA_CHAVE_API</code>{' '}
            — útil para webhooks de plataformas que não permitem headers customizados. Prefira o
            header sempre que possível.
          </p>
        </section>

        {/* Limites de uso */}
        <section id="limites" className="scroll-mt-24">
          <h2 className="text-2xl font-bold tracking-tight">Limites de uso</h2>
          <ul className="mt-3 max-w-2xl list-disc space-y-2 pl-5 text-[var(--muted-foreground)]">
            <li>
              <strong>Rate limit:</strong> 100 requisições por minuto, por organização. Ao exceder,
              a API responde <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-sm">429</code>{' '}
              com o header{' '}
              <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-sm">Retry-After</code>{' '}
              (segundos até liberar).
            </li>
            <li>
              <strong>Tamanho do corpo:</strong> máximo de 1 MB por requisição (REST).
            </li>
            <li>
              <strong>Lote:</strong> máximo de 100 leads por requisição no endpoint de webhook.
            </li>
            <li>
              <strong>Plano:</strong> a criação respeita o limite de leads do seu plano. Ao atingi-lo,
              a API responde{' '}
              <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-sm">402</code>.
            </li>
          </ul>
        </section>

        {/* Criar lead (REST) */}
        <section id="criar-lead" className="scroll-mt-24">
          <h2 className="text-2xl font-bold tracking-tight">Criar lead (REST)</h2>
          <div className="mt-3">
            <Endpoint method="POST" path="/api/v1/leads" />
          </div>
          <p className="mt-4 max-w-2xl text-[var(--muted-foreground)]">
            Cria um único lead. Envie um objeto JSON com os campos do lead (veja{' '}
            <a href="#campos" className="text-[var(--primary)] underline">
              Campos do lead
            </a>
            ). Para garantir que retentativas não dupliquem o lead, envie um header opcional{' '}
            <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-sm">X-Idempotency-Key</code>{' '}
            (qualquer string única, ex: um UUID): requisições repetidas com a mesma chave retornam{' '}
            <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-sm">200</code> sem recriar.
          </p>

          <p className="mt-6 text-sm font-medium">Requisição</p>
          <div className="mt-2">
            <CodeBlock code={CURL_CREATE} language="bash" />
          </div>

          <p className="mt-6 text-sm font-medium">Resposta — 201 Created</p>
          <div className="mt-2">
            <CodeBlock code={RESPONSE_CREATE} language="json" />
          </div>

          <p className="mt-4 text-sm text-[var(--muted-foreground)]">
            Se o lead já existir (mesmo e-mail ou CNPJ), a resposta é{' '}
            <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-sm">409</code> com{' '}
            <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-sm">existing_lead_id</code>.
            Erros de validação retornam{' '}
            <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-sm">422</code> com a lista{' '}
            <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-sm">details</code> apontando
            os campos inválidos.
          </p>
        </section>

        {/* Enviar em lote (Webhook) */}
        <section id="enviar-lote" className="scroll-mt-24">
          <h2 className="text-2xl font-bold tracking-tight">Enviar em lote (Webhook)</h2>
          <div className="mt-3">
            <Endpoint method="POST" path="/api/webhooks/inbound-leads" />
          </div>
          <p className="mt-4 max-w-2xl text-[var(--muted-foreground)]">
            Recebe vários leads de uma vez (até 100) e é tolerante a diferentes formatos de payload —
            ideal para integrar plataformas externas sem transformar os dados. Aceita:
          </p>
          <ul className="mt-3 max-w-2xl list-disc space-y-1 pl-5 text-sm text-[var(--muted-foreground)]">
            <li><code className="rounded bg-[var(--muted)] px-1 py-0.5">{`{ "leads": [...] }`}</code> — estilo RD Station</li>
            <li><code className="rounded bg-[var(--muted)] px-1 py-0.5">{`{ "data": [...] }`}</code> — algumas plataformas</li>
            <li><code className="rounded bg-[var(--muted)] px-1 py-0.5">{`[ {...}, {...} ]`}</code> — array direto</li>
            <li><code className="rounded bg-[var(--muted)] px-1 py-0.5">{`{ "first_name": "...", "email": "..." }`}</code> — objeto único</li>
          </ul>

          <p className="mt-5 text-sm font-medium">Mapeamento automático de campos</p>
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted-foreground)]">
            Nomes de campos comuns de outras ferramentas são convertidos automaticamente para o schema
            do Enriquece AI:
          </p>
          <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--muted)]/50 text-left">
                  <th className="p-2 font-semibold">Recebido</th>
                  <th className="p-2 font-semibold">Convertido para</th>
                </tr>
              </thead>
              <tbody className="font-mono text-xs">
                <tr className="border-b border-[var(--border)]"><td className="p-2">name, full_name, nome, nome_completo</td><td className="p-2">first_name + last_name</td></tr>
                <tr className="border-b border-[var(--border)]"><td className="p-2">phone, personal_phone, mobile, celular, whatsapp</td><td className="p-2">telefone</td></tr>
                <tr className="border-b border-[var(--border)]"><td className="p-2">company, company_name, organization, empresa_nome</td><td className="p-2">empresa</td></tr>
                <tr><td className="p-2">title, position, cargo</td><td className="p-2">job_title</td></tr>
              </tbody>
            </table>
          </div>

          <p className="mt-5 max-w-2xl text-sm text-[var(--muted-foreground)]">
            Use{' '}
            <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-sm">on_duplicate</code> para
            controlar duplicados:{' '}
            <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-sm">{'"skip"'}</code>{' '}
            (padrão) ignora ou{' '}
            <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-sm">{'"update"'}</code>{' '}
            atualiza o
            lead existente.
          </p>

          <p className="mt-5 max-w-2xl text-[var(--muted-foreground)]">
            <strong>Retentativas seguras.</strong> Plataformas como RD Station, Zapier e Make
            reenviam o mesmo lote quando a rede falha. Envie um header opcional{' '}
            <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-sm">X-Idempotency-Key</code>{' '}
            (qualquer string única por lote, ex: um UUID): se a mesma chave chegar de novo, a API
            responde{' '}
            <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-sm">200</code> sem
            reprocessar o lote, evitando leads duplicados.
          </p>

          <p className="mt-6 text-sm font-medium">Requisição</p>
          <div className="mt-2">
            <CodeBlock code={CURL_BATCH} language="bash" />
          </div>

          <p className="mt-6 text-sm font-medium">Resposta — 201 Created</p>
          <div className="mt-2">
            <CodeBlock code={RESPONSE_BATCH} language="json" />
          </div>
          <p className="mt-4 text-sm text-[var(--muted-foreground)]">
            O lote é sempre processado por inteiro: cada item recebe um{' '}
            <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-sm">status</code> em{' '}
            <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-sm">results</code> (
            <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-sm">created</code>,{' '}
            <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-sm">duplicate</code>,{' '}
            <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-sm">updated</code> ou{' '}
            <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-sm">error</code>). Quando nenhum
            lead novo é criado, o status HTTP é{' '}
            <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-sm">200</code>.
          </p>
        </section>

        {/* Health check */}
        <section id="health" className="scroll-mt-24">
          <h2 className="text-2xl font-bold tracking-tight">Health check</h2>
          <div className="mt-3">
            <Endpoint method="GET" path="/api/health" />
          </div>
          <p className="mt-4 max-w-2xl text-[var(--muted-foreground)]">
            Endpoint público de liveness, sem autenticação. Útil para monitoração. Responde{' '}
            <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-sm">200</code> quando o serviço
            está no ar.
          </p>
          <div className="mt-4">
            <CodeBlock code={CURL_HEALTH} language="bash" />
          </div>
        </section>

        {/* Campos do lead */}
        <section id="campos" className="scroll-mt-24">
          <h2 className="text-2xl font-bold tracking-tight">Campos do lead</h2>
          <p className="mt-3 max-w-2xl text-[var(--muted-foreground)]">
            Campos aceitos no objeto de lead. Apenas{' '}
            <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-sm">first_name</code>,{' '}
            <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-sm">email</code>,{' '}
            <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-sm">telefone</code> e{' '}
            <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-sm">empresa</code> são
            obrigatórios.
          </p>
          <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--muted)]/50 text-left">
                  <th className="p-2 font-semibold">Campo</th>
                  <th className="p-2 font-semibold">Tipo</th>
                  <th className="p-2 font-semibold">Obrigatório</th>
                  <th className="p-2 font-semibold">Descrição</th>
                </tr>
              </thead>
              <tbody>
                {FIELDS.map((f) => (
                  <tr key={f.name} className="border-b border-[var(--border)] last:border-0">
                    <td className="p-2 font-mono text-xs">{f.name}</td>
                    <td className="p-2 font-mono text-xs text-[var(--muted-foreground)]">{f.type}</td>
                    <td className="p-2 text-xs">
                      {f.required ? (
                        <span className="font-semibold text-[var(--primary)]">Sim</span>
                      ) : (
                        <span className="text-[var(--muted-foreground)]">Não</span>
                      )}
                    </td>
                    <td className="p-2 text-xs">{f.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Códigos de erro */}
        <section id="erros" className="scroll-mt-24">
          <h2 className="text-2xl font-bold tracking-tight">Códigos de erro</h2>
          <p className="mt-3 max-w-2xl text-[var(--muted-foreground)]">
            Respostas de erro seguem o formato{' '}
            <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-sm">{`{ "success": false, "error": "..." }`}</code>
            . Erros de validação incluem{' '}
            <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-sm">details</code>.
          </p>
          <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--muted)]/50 text-left">
                  <th className="p-2 font-semibold">Status</th>
                  <th className="p-2 font-semibold">Significado</th>
                </tr>
              </thead>
              <tbody>
                {ERRORS.map((e) => (
                  <tr key={e.code} className="border-b border-[var(--border)] last:border-0">
                    <td className="p-2 font-mono text-xs font-semibold">{e.code}</td>
                    <td className="p-2 text-xs">{e.meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-8 text-sm text-[var(--muted-foreground)]">
            Precisa de ajuda com a integração? Gere sua chave em{' '}
            <strong>Configurações → Integrações → API</strong> dentro da plataforma.
          </p>
        </section>
      </main>
    </div>
  );
}
