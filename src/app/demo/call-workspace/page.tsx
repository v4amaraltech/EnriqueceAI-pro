import { CallWorkspaceFixture } from './fixture-client';

/**
 * Fixture visual do painel de ligação. Não autentica, não disca, não cria
 * reunião e não grava histórico. `?card=1` mostra o cartão. `?theme=dark` usa o tema escuro.
 */
export default async function CallWorkspaceFixturePage({
  searchParams,
}: {
  searchParams: Promise<{ card?: string; theme?: string }>;
}) {
  const params = await searchParams;
  return (
    <CallWorkspaceFixture
      leadCard={params.card === '1'}
      theme={params.theme === 'dark' ? 'dark' : 'light'}
    />
  );
}
