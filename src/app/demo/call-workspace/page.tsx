import { CallWorkspaceFixture } from './fixture-client';

/**
 * Fixture visual. Não autentica, não disca e não grava.
 * `?card=1` mostra o cartão. `?theme=dark` usa o tema escuro.
 * `?view=fila` mostra a lista de atividades.
 */
export default async function CallWorkspaceFixturePage({
  searchParams,
}: {
  searchParams: Promise<{ card?: string; theme?: string; view?: string }>;
}) {
  const params = await searchParams;
  return (
    <CallWorkspaceFixture
      leadCard={params.card === '1'}
      theme={params.theme === 'dark' ? 'dark' : 'light'}
      view={params.view === 'fila' ? 'fila' : 'painel'}
    />
  );
}
