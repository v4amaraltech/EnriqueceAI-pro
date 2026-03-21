import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Termos de Uso — Enriquece AI',
};

export default function TermsPage() {
  return (
    <article className="max-w-none space-y-4 text-sm leading-relaxed [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-medium [&_h3]:mt-4 [&_h3]:mb-1 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1 [&_a]:underline">
      <h1>Termos de Uso</h1>
      <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        Ultima atualizacao: 21 de marco de 2026
      </p>

      <p>
        Bem-vindo ao <strong>Enriquece AI</strong>. Ao acessar ou utilizar nossa Plataforma, voce concorda
        com os termos e condicoes descritos abaixo. Leia-os atentamente.
      </p>

      <h2>1. Definicoes</h2>
      <ul>
        <li>
          <strong>Plataforma</strong>: o software Enriquece AI, acessivel via web em
          app.enriqueceai.com.br
        </li>
        <li>
          <strong>Usuario</strong>: pessoa fisica que acessa e utiliza a Plataforma
        </li>
        <li>
          <strong>Organizacao</strong>: empresa ou entidade juridica que contrata os servicos
        </li>
        <li>
          <strong>Assinatura</strong>: plano contratado (Starter, Pro ou Enterprise)
        </li>
        <li>
          <strong>SDR</strong>: Sales Development Representative — membro da equipe de vendas
        </li>
      </ul>

      <h2>2. Aceitacao dos Termos</h2>
      <p>
        Ao criar uma conta, voce declara ter lido, entendido e concordado com estes Termos de Uso e com
        nossa{' '}
        <a href="/privacy" className="underline">
          Politica de Privacidade
        </a>
        . Se voce nao concordar, nao utilize a Plataforma.
      </p>

      <h2>3. Descricao do Servico</h2>
      <p>O Enriquece AI e uma plataforma de Sales Engagement que oferece:</p>
      <ul>
        <li>Gestao de leads B2B (importacao, enriquecimento, qualificacao)</li>
        <li>Cadencias de outreach multicanal (email e WhatsApp)</li>
        <li>Geracao de mensagens personalizadas com inteligencia artificial</li>
        <li>Fila de atividades para SDRs</li>
        <li>Integracoes com CRMs (HubSpot, Pipedrive, RD Station)</li>
        <li>Relatorios e analiticos de desempenho</li>
      </ul>

      <h2>4. Contas e Acesso</h2>
      <h3>4.1 Cadastro</h3>
      <p>
        Para utilizar a Plataforma, voce deve criar uma conta com informacoes verdadeiras e manter seus
        dados atualizados. Voce e responsavel pela seguranca de sua senha e por todas as atividades
        realizadas em sua conta.
      </p>

      <h3>4.2 Papeis</h3>
      <p>A Plataforma possui dois papeis:</p>
      <ul>
        <li>
          <strong>Manager</strong>: administrador com acesso completo, incluindo configuracoes, billing e
          gestao de equipe
        </li>
        <li>
          <strong>SDR</strong>: membro da equipe com acesso as funcionalidades operacionais
        </li>
      </ul>

      <h3>4.3 Convites</h3>
      <p>
        Managers podem convidar novos membros para a Organizacao. Convites expiram em 7 dias e podem ser
        reenviados.
      </p>

      <h2>5. Planos e Pagamentos</h2>
      <h3>5.1 Trial</h3>
      <p>
        Novas organizacoes recebem um periodo de teste gratuito de 14 dias com acesso completo ao plano
        selecionado. Ao final do trial, e necessario efetuar o pagamento para continuar utilizando a
        Plataforma.
      </p>

      <h3>5.2 Assinaturas</h3>
      <p>
        As assinaturas sao mensais, com cobranca recorrente processada pela Stripe. Os valores e limites de
        cada plano estao disponiveis na pagina de precos.
      </p>

      <h3>5.3 Cancelamento</h3>
      <p>
        Voce pode cancelar sua assinatura a qualquer momento atraves do portal de billing. O acesso
        permanece ativo ate o final do periodo ja pago. Nao ha reembolso proporcional.
      </p>

      <h3>5.4 Limites</h3>
      <p>
        Cada plano possui limites de uso (leads, geracoes de IA, creditos de WhatsApp). Ao atingir o limite,
        a funcionalidade correspondente sera temporariamente restrita ate o proximo ciclo ou upgrade de
        plano.
      </p>

      <h2>6. Uso Aceitavel</h2>
      <p>Voce concorda em utilizar a Plataforma de forma etica e legal. E proibido:</p>
      <ul>
        <li>Enviar spam ou mensagens nao solicitadas em massa</li>
        <li>Utilizar dados de leads sem base legal adequada</li>
        <li>Violar a legislacao anti-spam (Lei n. 12.965/2014 — Marco Civil da Internet)</li>
        <li>Falsificar identidade ou se passar por terceiros</li>
        <li>Tentar acessar dados de outras organizacoes</li>
        <li>Realizar engenharia reversa ou explorar vulnerabilidades da Plataforma</li>
        <li>Utilizar a Plataforma para fins ilegais ou que violem direitos de terceiros</li>
      </ul>
      <p>
        O descumprimento destas regras pode resultar em suspensao ou cancelamento imediato da conta, sem
        direito a reembolso.
      </p>

      <h2>7. Propriedade Intelectual</h2>
      <p>
        Todo o conteudo da Plataforma (software, design, marca, textos) e de propriedade exclusiva da
        Enriquece AI. Os dados inseridos pelo Usuario permanecem de propriedade da Organizacao.
      </p>

      <h2>8. Inteligencia Artificial</h2>
      <p>
        A Plataforma utiliza modelos de IA (Claude/Anthropic) para geracao de mensagens. O conteudo gerado e
        sugerido como rascunho — o Usuario e integralmente responsavel pela revisao e envio final de
        qualquer mensagem.
      </p>
      <p>
        Nao garantimos que o conteudo gerado por IA sera adequado, preciso ou livre de erros. O Usuario deve
        sempre revisar o conteudo antes do envio.
      </p>

      <h2>9. Integracoes com Terceiros</h2>
      <p>
        A Plataforma permite integracao com servicos de terceiros (Gmail, CRMs, WhatsApp). Ao conectar uma
        integracao, voce autoriza o acesso aos dados necessarios conforme descrito na autorizacao OAuth. Nao
        somos responsaveis por interrupcoes, alteracoes de API ou politicas de terceiros.
      </p>

      <h2>10. Disponibilidade</h2>
      <p>
        Nos empenhamos em manter a Plataforma disponivel 24/7, mas nao garantimos disponibilidade
        ininterrupta. Manutencoes programadas serao comunicadas com antecedencia quando possivel.
      </p>

      <h2>11. Limitacao de Responsabilidade</h2>
      <p>
        A Enriquece AI nao se responsabiliza por danos indiretos, incidentais ou consequenciais decorrentes
        do uso da Plataforma, incluindo perda de dados, perda de receita ou interrupcao de negocios.
      </p>
      <p>
        Nossa responsabilidade total esta limitada ao valor pago pelo Usuario nos 12 meses anteriores ao
        evento que deu origem a reclamacao.
      </p>

      <h2>12. Rescisao</h2>
      <p>
        Podemos suspender ou encerrar sua conta caso haja violacao destes Termos, inadimplencia superior a
        30 dias, ou uso abusivo da Plataforma. Em caso de rescisao, seus dados serao mantidos por 90 dias e
        entao excluidos.
      </p>

      <h2>13. Alteracoes nos Termos</h2>
      <p>
        Reservamos o direito de alterar estes Termos a qualquer momento. Alteracoes significativas serao
        comunicadas com 30 dias de antecedencia. O uso continuado da Plataforma apos as alteracoes
        constitui aceitacao dos novos termos.
      </p>

      <h2>14. Legislacao Aplicavel</h2>
      <p>
        Estes Termos sao regidos pelas leis da Republica Federativa do Brasil. Eventuais disputas serao
        resolvidas no foro da comarca da sede da Enriquece AI.
      </p>

      <h2>15. Contato</h2>
      <p>Em caso de duvidas sobre estes Termos de Uso:</p>
      <ul>
        <li>
          Email: <strong>contato@enriqueceai.com.br</strong>
        </li>
        <li>
          Empresa: <strong>Enriquece AI Tecnologia LTDA</strong>
        </li>
      </ul>
    </article>
  );
}
