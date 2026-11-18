# Handoff — Jev não recebe mais ligação de caixa postal (17–18/11/2026)

Pedido do Vini: a operadora marca como atendida (`calls.connected = true`) a ligação que caiu na caixa postal. O Jev recebia essas ligações e gastava as 14 perguntas para responder `not_connected`. A ideia é parar de mandar esses casos para o Jev.

## Regra
- Fica em `src/features/calls/services/transcription-engine/voicemail.ts` (`isVoicemailTranscript`).
- Pega os **primeiros 250 caracteres** de `call_transcripts_v2.text`, em minúsculas, e testa contra `(correio de voz|caixa postal|grave (a )?sua mensagem)`.
- Ficam **fora** de propósito, porque nesses casos o lead costuma atender logo depois:
  - "se você disser seu nome e o motivo da ligação" (triagem de chamadas do iPhone);
  - "não está disponível";
  - "após o sinal";
  - "deixe outra mensagem".
- É usada no `orchestrator.ts`, logo depois da checagem de transcrição vazia e logo antes de `jev.qualify`.
- Quando a regra bate, a `call_qualifications` é gravada no mesmo padrão da transcrição vazia:
  - `status = 'skipped'`, `error = 'voicemail'`;
  - `outcome = 'not_connected'`, `interest = 'none'`;
  - `needs_review = false`, `model = null`, `cost_usd = 0`;
  - `call_id`, `org_id`, `transcript_id` e `provider = 'jev'` vêm da criação da linha.

## Validação (só leitura, em prod)
Rodei a regra nas qualificações que já existem: **121 bateram, todas `completed / not_connected`**. Nenhuma com outro resultado.

## Entregue
- **PR #659** mesclado com squash (`71f46536`) e no ar (`/api/version` = `71f4653`).
- **Testes:**
  - `voicemail.test.ts`: 5 casos que batem e 5 que não batem (inclusive a triagem do iPhone), texto nulo e o limite de 250 caracteres.
  - Novo caso em `engine.test.ts`: o Jev não é chamado e a linha é gravada com os campos acima.
- Sem migration. Sem mudança no prompt nem nas perguntas do Jev. As qualificações antigas não foram mexidas.
- **Limpeza feita:**
  - worktree `EnriqueceAI_Pro-voicemail` removido;
  - branch `fix/jev-skip-voicemail` apagada (local e remota);
  - commit local `7cce7fd9` tirado da `feat/cockpit-motor-automatico-2`.

## Pontos de atenção
- **A trava `reject_call_qualification_mutation` não atrapalha.** Ela só bloqueia UPDATE em linha `completed`. O fluxo atual cria a linha como `processing` e depois faz o UPDATE para o status final, inclusive no caso da transcrição vazia. Por isso o caminho novo também passa.
- **View `call_transcription_engine_daily` sem ajuste.** Ela conta pelo status da transcrição, não filtra `status = 'completed'` da qualificação, e `cost_usd = 0` não altera a soma.
- **CRM auto-update não roda nessas linhas.** O `runCrmAutoUpdate` só olha qualificação `completed`, então essas ligações deixam de entrar no log do shadow. Nada muda no CRM: o modo live só escreve quando o Jev responde `voicemail`, e esses casos vinham como `not_connected`.
- **Formatação:** o `engine.test.ts` já estava fora do Prettier antes desta mudança. Não reformatei.

## Pendente
- Ver a primeira ligação real gravada com `error = 'voicemail'`:
  ```sql
  SELECT call_id, created_at FROM call_qualifications
  WHERE error = 'voicemail' ORDER BY created_at DESC LIMIT 5;
  ```
