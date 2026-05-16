import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Politica de Privacidade — Enriquece AI',
};

export default function PrivacyPage() {
  return (
    <article className="max-w-none space-y-4 text-sm leading-relaxed [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-medium [&_h3]:mt-4 [&_h3]:mb-1 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1 [&_a]:underline">
      <h1>Politica de Privacidade</h1>
      <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        Ultima atualizacao: 16 de maio de 2026
      </p>

      <p>
        A <strong>Enriquece AI</strong> (&quot;nos&quot;, &quot;nosso&quot; ou &quot;Plataforma&quot;) respeita
        a privacidade dos seus usuarios e esta comprometida em proteger os dados pessoais coletados e
        processados por meio de nossa plataforma de Sales Engagement, em conformidade com a Lei Geral de
        Protecao de Dados (LGPD — Lei n. 13.709/2018).
      </p>

      <h2>1. Dados que Coletamos</h2>
      <h3>1.1 Dados de Cadastro</h3>
      <ul>
        <li>Nome completo, email corporativo e senha (criptografada)</li>
        <li>Nome da organizacao e dados do time de vendas</li>
      </ul>

      <h3>1.2 Dados de Uso da Plataforma</h3>
      <ul>
        <li>Leads importados (CNPJ, razao social, email, telefone)</li>
        <li>Historico de interacoes (emails enviados, respostas, reunioes)</li>
        <li>Metricas de cadencias e desempenho de vendas</li>
        <li>Templates de mensagens criados</li>
      </ul>

      <h3>1.3 Dados de Integracoes</h3>
      <ul>
        <li>Tokens OAuth de Gmail, Google Calendar e CRMs (criptografados com AES-256-GCM)</li>
        <li>Dados sincronizados de CRMs conectados (HubSpot, Pipedrive, RD Station, Kommo)</li>
      </ul>

      <h3>1.4 Dados de Pagamento</h3>
      <ul>
        <li>
          Processados exclusivamente pela <strong>Stripe</strong>. Nao armazenamos dados de cartao de
          credito em nossos servidores.
        </li>
      </ul>

      <h2>2. Finalidade do Tratamento</h2>
      <p>Utilizamos seus dados para:</p>
      <ul>
        <li>Prover e manter os servicos da Plataforma</li>
        <li>Executar cadencias de outreach (envio de emails e mensagens)</li>
        <li>Gerar relatorios e analiticos de desempenho</li>
        <li>Personalizar mensagens via inteligencia artificial (Claude/Anthropic)</li>
        <li>Processar pagamentos e gerenciar assinaturas</li>
        <li>Enviar notificacoes operacionais sobre o uso da Plataforma</li>
        <li>Monitorar e prevenir abusos e fraudes</li>
      </ul>

      <h2>3. Base Legal</h2>
      <p>O tratamento de dados e realizado com base em:</p>
      <ul>
        <li>
          <strong>Execucao de contrato</strong> (Art. 7o, V, LGPD) — para prestar os servicos contratados
        </li>
        <li>
          <strong>Consentimento</strong> (Art. 7o, I, LGPD) — para integracoes opcionais e comunicacoes de
          marketing
        </li>
        <li>
          <strong>Interesse legítimo</strong> (Art. 7o, IX, LGPD) — para melhorias na Plataforma e
          prevencao de fraudes
        </li>
      </ul>

      <h2>4. Compartilhamento de Dados</h2>
      <p>Compartilhamos dados apenas com:</p>
      <ul>
        <li>
          <strong>Supabase</strong> — infraestrutura de banco de dados e autenticacao
        </li>
        <li>
          <strong>Stripe</strong> — processamento de pagamentos
        </li>
        <li>
          <strong>Anthropic (Claude)</strong> — geracao de mensagens por IA (dados anonimizados)
        </li>
        <li>
          <strong>Kommo CRM</strong> — sincronizacao de leads, contatos e atividades (apenas quando voce
          conecta sua conta voluntariamente via OAuth)
        </li>
        <li>
          <strong>API4COM</strong> — telefonia VoIP para registro e gravacao de ligacoes (apenas quando voce
          conecta sua conta voluntariamente)
        </li>
        <li>
          <strong>Sentry</strong> — monitoramento de erros (sem dados pessoais)
        </li>
        <li>
          <strong>Vercel</strong> — hospedagem da aplicacao
        </li>
        <li>
          <strong>CRMs terceiros</strong> — apenas quando voce conecta sua conta voluntariamente
        </li>
      </ul>
      <p>Nao vendemos, alugamos ou compartilhamos seus dados com terceiros para fins de marketing.</p>

      <h2>5. Seguranca</h2>
      <p>Adotamos medidas tecnicas e organizacionais para proteger seus dados:</p>
      <ul>
        <li>Criptografia AES-256-GCM para tokens de integracao</li>
        <li>Row Level Security (RLS) no banco de dados — isolamento por organizacao</li>
        <li>HTTPS obrigatorio com headers de seguranca (HSTS, CSP, X-Frame-Options)</li>
        <li>Protecao contra CSRF em todas as requisicoes</li>
        <li>Senhas armazenadas com hash seguro (bcrypt via Supabase Auth)</li>
      </ul>

      <h2>6. Retencao de Dados</h2>
      <p>
        Mantemos seus dados enquanto sua conta estiver ativa. Apos cancelamento da assinatura, os dados sao
        retidos por 90 dias para permitir reativacao, e entao permanentemente excluidos.
      </p>

      <h2>7. Seus Direitos (LGPD)</h2>
      <p>Voce tem direito a:</p>
      <ul>
        <li>Confirmar a existencia de tratamento de dados</li>
        <li>Acessar seus dados pessoais</li>
        <li>Corrigir dados incompletos ou desatualizados</li>
        <li>Solicitar a anonimizacao ou exclusao de dados desnecessarios</li>
        <li>Solicitar a portabilidade dos dados</li>
        <li>Revogar consentimento a qualquer momento</li>
        <li>Solicitar a eliminacao dos dados tratados com consentimento</li>
      </ul>
      <p>
        Para exercer seus direitos, entre em contato pelo email:{' '}
        <strong>privacidade@enriqueceai.com.br</strong>
      </p>

      <h2>8. Cookies</h2>
      <p>
        Utilizamos apenas cookies essenciais para autenticacao e manutencao da sessao. Nao utilizamos
        cookies de rastreamento ou publicidade.
      </p>

      <h2>9. Alteracoes</h2>
      <p>
        Esta politica pode ser atualizada periodicamente. Notificaremos usuarios sobre mudancas
        significativas atraves da Plataforma. A versao vigente estara sempre disponivel nesta pagina.
      </p>

      <h2>10. Contato</h2>
      <p>
        Em caso de duvidas sobre esta Politica de Privacidade ou sobre o tratamento de dados pessoais, entre
        em contato:
      </p>
      <ul>
        <li>
          Email: <strong>privacidade@enriqueceai.com.br</strong>
        </li>
        <li>
          Responsavel pelo tratamento de dados: <strong>Enriquece AI Tecnologia LTDA</strong>
        </li>
      </ul>
    </article>
  );
}
