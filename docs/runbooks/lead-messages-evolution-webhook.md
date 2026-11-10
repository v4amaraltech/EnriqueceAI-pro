# Webhook de mensagens da Evolution (ainda não configurar)

Esta rota só grava conversa quando a flag `lead_messages_capture` está ligada para a org. Não mexe no webhook de conexão que já aponta para a Edge Function `evolution-webhook`.

Quando for a hora de ligar, na instância da Evolution:

- URL: `https://<domínio do app>/api/webhooks/evolution/messages`
- Método: POST
- Header: `X-EVOLUTION-SECRET` com o mesmo valor da variável `EVOLUTION_MESSAGES_WEBHOOK_SECRET`
- Evento: `MESSAGES_UPSERT` (também aceito como `messages.upsert`)
- Não enviar neste URL: conexão, QR code, grupo ou status. Grupo (`@g.us`) e status (`broadcast`) são ignorados.

Variável de ambiente do app, ainda sem valor em produção:

- `EVOLUTION_MESSAGES_WEBHOOK_SECRET`

Sem a variável a rota responde 503 e não grava nada. Sem o header certo responde 401. A mesma mensagem, reenviada, não duplica: a chave é `(org_id, provider, provider_message_id)`.
