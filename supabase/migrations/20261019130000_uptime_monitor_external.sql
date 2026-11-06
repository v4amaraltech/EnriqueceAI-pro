-- Monitor de disponibilidade EXTERNO ao host do Coolify (19/10/2026).
--
-- Em 19/10/2026 a Contabo reiniciou o host físico (patch de kernel) e o site ficou ~30 min
-- fora (Cloudflare 523) sem ninguém ser avisado: os alertas de "robô parado"
-- (health-check-workers → Sentry + sino) rodam DENTRO do app, no mesmo host — ficam mudos
-- quando o host inteiro cai.
--
-- Este monitor roda no Supabase cloud (pg_cron, fora do host): a cada 2 min faz GET em
-- `/api/version` com a extensão `http` (síncrona — ao contrário do pg_net, dá status e
-- latência na hora e não sofre os ~13% de "DNS time: 5000 ms" vistos na fila do pg_net).
-- Se a 1ª tentativa falha, espera `retry_delay_seconds` e tenta de novo na mesma rodada.
-- Após `failure_threshold` rodadas seguidas falhando (padrão 2 → ~4 min) avisa a equipe;
-- enquanto segue fora, lembra a cada `remind_every`; quando volta, manda "normalizou".
--
-- Canais (nenhum depende do app estar no ar):
--   * E-mail via Resend (`net`/`http` direto para api.resend.com). A chave fica no Vault
--     com o nome `resend_api_key` — NÃO está nesta migration. Sem a chave, o e-mail é
--     pulado e o motivo fica gravado em `uptime_checks.alert_detail`.
--     Destinatários: `uptime_monitors.alert_emails`; se nulo, os gestores ativos da
--     `notify_org_id` (e-mail em auth.users).
--   * Sino do app (tabela `notifications`, mesmo canal do health-check) para os gestores
--     da `notify_org_id` — aparece quando o app voltar, útil para o "normalizou".
--
-- Tabelas são globais de plataforma (como `app_flags`): sem `org_id`; `notify_org_id`
-- diz quem é avisado. Leitura só para gestores dessa org; escrita só service_role/postgres.
--
-- Teste manual: ver docs/stories/uptime-monitor-external.story.md.

BEGIN;

-- =============================================================================
-- Tabelas
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.uptime_monitors (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL UNIQUE,
  url                   TEXT NOT NULL,
  enabled               BOOLEAN NOT NULL DEFAULT true,
  -- rodadas seguidas falhando antes de avisar (2 rodadas × 2 min ≈ 4 min)
  failure_threshold     INTEGER NOT NULL DEFAULT 2 CHECK (failure_threshold >= 1),
  timeout_ms            INTEGER NOT NULL DEFAULT 10000 CHECK (timeout_ms BETWEEN 1000 AND 60000),
  retry_delay_seconds   INTEGER NOT NULL DEFAULT 10 CHECK (retry_delay_seconds BETWEEN 0 AND 30),
  -- além do HTTP 200, o corpo precisa casar (NULL = só o status). Protege contra
  -- página de erro/cached que responda 200.
  expect_body_like      TEXT DEFAULT '%"status":"ok"%',
  -- org cujos gestores recebem sino + e-mail (fallback quando alert_emails é nulo)
  notify_org_id         UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  alert_emails          TEXT[],
  remind_every          INTERVAL NOT NULL DEFAULT interval '60 minutes',
  -- estado
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,
  is_down               BOOLEAN NOT NULL DEFAULT false,
  down_since            TIMESTAMPTZ,
  last_checked_at       TIMESTAMPTZ,
  last_ok_at            TIMESTAMPTZ,
  last_status_code      INTEGER,
  last_error            TEXT,
  last_alert_at         TIMESTAMPTZ,
  last_alert_kind       TEXT CHECK (last_alert_kind IN ('down', 'reminder', 'recovered')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.uptime_monitors IS
  'Monitor de disponibilidade externo (pg_cron uptime-monitor, a cada 2 min). Global de plataforma.';

DROP TRIGGER IF EXISTS set_updated_at ON public.uptime_monitors;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.uptime_monitors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE IF NOT EXISTS public.uptime_checks (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  monitor_id    UUID NOT NULL REFERENCES public.uptime_monitors(id) ON DELETE CASCADE,
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ok            BOOLEAN NOT NULL,
  status_code   INTEGER,
  latency_ms    INTEGER,
  attempts      INTEGER NOT NULL DEFAULT 1,
  error         TEXT,
  -- preenchido na rodada que disparou um aviso
  alert_kind    TEXT CHECK (alert_kind IN ('down', 'reminder', 'recovered')),
  alert_detail  JSONB
);

COMMENT ON TABLE public.uptime_checks IS
  'Histórico das rodadas do monitor de disponibilidade (retenção 30 dias, podado pelo próprio cron).';

CREATE INDEX IF NOT EXISTS idx_uptime_checks_monitor_checked_at
  ON public.uptime_checks (monitor_id, checked_at DESC);

-- =============================================================================
-- RLS + privilégios (tabela nova nasce legível por anon via default privileges)
-- =============================================================================

ALTER TABLE public.uptime_monitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uptime_checks   ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.uptime_monitors FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.uptime_checks   FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.uptime_monitors TO authenticated;
GRANT SELECT ON public.uptime_checks   TO authenticated;
GRANT ALL ON public.uptime_monitors TO service_role;
GRANT ALL ON public.uptime_checks   TO service_role;

DROP POLICY IF EXISTS uptime_monitors_manager_select ON public.uptime_monitors;
CREATE POLICY uptime_monitors_manager_select ON public.uptime_monitors
  FOR SELECT TO authenticated
  USING ((SELECT public.is_manager()) AND notify_org_id = (SELECT public.user_org_id()));

DROP POLICY IF EXISTS uptime_checks_manager_select ON public.uptime_checks;
CREATE POLICY uptime_checks_manager_select ON public.uptime_checks
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_manager())
    AND EXISTS (
      SELECT 1 FROM public.uptime_monitors m
      WHERE m.id = uptime_checks.monitor_id
        AND m.notify_org_id = (SELECT public.user_org_id())
    )
  );

-- =============================================================================
-- Sonda: 1 GET síncrono. Nunca lança — falha vira (ok=false, error=...).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.uptime_probe(p_url TEXT, p_expect_body_like TEXT DEFAULT NULL)
RETURNS TABLE (ok BOOLEAN, status_code INTEGER, latency_ms INTEGER, error TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_t0   TIMESTAMPTZ := clock_timestamp();
  v_url  TEXT;
  v_resp extensions.http_response;
  v_ms   INTEGER;
BEGIN
  -- cache-buster: nunca aceitar resposta guardada (Cloudflare/Next)
  v_url := p_url
        || CASE WHEN position('?' IN p_url) > 0 THEN '&' ELSE '?' END
        || 'probe=' || (extract(epoch FROM clock_timestamp()) * 1000)::bigint;

  BEGIN
    SELECT * INTO v_resp FROM extensions.http((
      'GET'::extensions.http_method,
      v_url,
      ARRAY[
        extensions.http_header('Cache-Control', 'no-cache'),
        extensions.http_header('User-Agent', 'enriqueceai-uptime/1.0')
      ],
      NULL, NULL
    )::extensions.http_request);
  EXCEPTION WHEN OTHERS THEN
    -- timeout, DNS, conexão recusada, TLS...
    v_ms := (extract(epoch FROM (clock_timestamp() - v_t0)) * 1000)::integer;
    RETURN QUERY SELECT false, NULL::integer, v_ms, left(SQLERRM, 500);
    RETURN;
  END;

  v_ms := (extract(epoch FROM (clock_timestamp() - v_t0)) * 1000)::integer;

  IF v_resp.status <> 200 THEN
    RETURN QUERY SELECT false, v_resp.status, v_ms, 'HTTP ' || v_resp.status;
  ELSIF p_expect_body_like IS NOT NULL AND coalesce(v_resp.content, '') NOT LIKE p_expect_body_like THEN
    RETURN QUERY SELECT false, v_resp.status, v_ms,
      'HTTP 200 mas corpo inesperado: ' || left(coalesce(v_resp.content, ''), 120);
  ELSE
    RETURN QUERY SELECT true, v_resp.status, v_ms, NULL::text;
  END IF;
END;
$$;

-- =============================================================================
-- Aviso: e-mail (Resend, chave no Vault) + sino (notifications). Nunca lança.
-- Devolve o que aconteceu em cada canal (vai para uptime_checks.alert_detail).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.uptime_send_alert(
  p_monitor public.uptime_monitors,
  p_kind    TEXT,            -- 'down' | 'reminder' | 'recovered'
  p_error   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_now         TIMESTAMPTZ := clock_timestamp();
  v_since_brt   TEXT := to_char(coalesce(p_monitor.down_since, v_now) AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI');
  v_now_brt     TEXT := to_char(v_now AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI');
  v_down_for    TEXT;
  v_host        TEXT := regexp_replace(p_monitor.url, '^https?://([^/]+).*$', '\1');
  v_subject     TEXT;
  v_title       TEXT;
  v_body        TEXT;
  v_html        TEXT;
  v_emails      TEXT[];
  v_api_key     TEXT;
  v_resp        extensions.http_response;
  v_email       JSONB;
  v_bell        JSONB;
  v_bell_count  INTEGER := 0;
  v_text_error  TEXT := coalesce(p_error, 'sem detalhe');
BEGIN
  v_down_for := CASE
    WHEN p_monitor.down_since IS NULL THEN NULL
    ELSE (extract(epoch FROM (v_now - p_monitor.down_since)) / 60)::integer || ' min'
  END;

  IF p_kind = 'recovered' THEN
    v_subject := '🟢 EnriqueceAI voltou — ' || v_host || ' (ficou fora ' || coalesce(v_down_for, '?') || ')';
    v_title   := 'EnriqueceAI voltou ao ar';
    v_body    := v_host || ' respondeu de novo às ' || v_now_brt || ' (BRT). Ficou fora desde ' || v_since_brt
                 || ' (' || coalesce(v_down_for, '?') || ').';
  ELSIF p_kind = 'reminder' THEN
    v_subject := '🔴 EnriqueceAI AINDA fora do ar — ' || v_host || ' (' || coalesce(v_down_for, '?') || ')';
    v_title   := 'EnriqueceAI continua fora do ar';
    v_body    := v_host || ' segue sem responder desde ' || v_since_brt || ' (BRT), há ' || coalesce(v_down_for, '?')
                 || '. Último erro: ' || v_text_error || '.';
  ELSE
    v_subject := '🔴 EnriqueceAI FORA DO AR — ' || v_host;
    v_title   := 'EnriqueceAI fora do ar';
    v_body    := v_host || ' parou de responder às ' || v_since_brt || ' (BRT): ' || v_text_error
                 || '. Verificado de fora do servidor (' || p_monitor.failure_threshold || ' rodadas seguidas).';
  END IF;

  v_html := '<p>' || v_body || '</p>'
         || '<p><b>URL:</b> ' || p_monitor.url || '</p>'
         || CASE WHEN p_kind = 'recovered' THEN ''
            ELSE '<p><b>Como checar:</b><br>'
              || '1. <code>curl -s ' || p_monitor.url || '</code> (523 = origem fora; 200 = ok)<br>'
              || '2. Painel Coolify: https://painel.v4companyamaral.com<br>'
              || '3. <code>ssh vps-cerebro ''uptime; last -x reboot | head -3; docker ps -a --filter status=exited''</code><br>'
              || '4. Status da Contabo: https://contabo-status.com</p>'
            END
         || '<p style="color:#888;font-size:12px">Monitor externo (Supabase pg_cron <code>uptime-monitor</code>, a cada 2 min). '
         || 'Histórico: tabela <code>uptime_checks</code>.</p>';

  -- ---------------------------------------------------------------- e-mail
  v_emails := p_monitor.alert_emails;
  IF v_emails IS NULL OR cardinality(v_emails) = 0 THEN
    SELECT array_agg(DISTINCT u.email) INTO v_emails
    FROM public.organization_members m
    JOIN auth.users u ON u.id = m.user_id
    WHERE m.org_id = p_monitor.notify_org_id
      AND m.role = 'manager'
      AND m.status = 'active'
      AND u.email IS NOT NULL;
  END IF;

  SELECT decrypted_secret INTO v_api_key
  FROM vault.decrypted_secrets
  WHERE name = 'resend_api_key'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_api_key IS NULL THEN
    v_email := jsonb_build_object('sent', false, 'error', 'segredo resend_api_key não existe no Vault');
  ELSIF v_emails IS NULL OR cardinality(v_emails) = 0 THEN
    v_email := jsonb_build_object('sent', false, 'error', 'nenhum destinatário (alert_emails nulo e org sem gestor com e-mail)');
  ELSE
    BEGIN
      SELECT * INTO v_resp FROM extensions.http((
        'POST'::extensions.http_method,
        'https://api.resend.com/emails',
        ARRAY[extensions.http_header('Authorization', 'Bearer ' || v_api_key)],
        'application/json',
        jsonb_build_object(
          'from', 'EnriqueceAI <noreply@enriqueceai.com.br>',
          'to', to_jsonb(v_emails),
          'subject', v_subject,
          'html', v_html
        )::text
      )::extensions.http_request);
      v_email := jsonb_build_object(
        'sent', v_resp.status BETWEEN 200 AND 299,
        'status', v_resp.status,
        'to_count', cardinality(v_emails),
        'response', left(coalesce(v_resp.content, ''), 200)
      );
    EXCEPTION WHEN OTHERS THEN
      v_email := jsonb_build_object('sent', false, 'to_count', cardinality(v_emails), 'error', left(SQLERRM, 300));
    END;
  END IF;

  -- ---------------------------------------------------------------- sino
  BEGIN
    IF p_monitor.notify_org_id IS NOT NULL THEN
      INSERT INTO public.notifications (org_id, user_id, type, title, body, resource_type, resource_id, metadata)
      SELECT m.org_id, m.user_id, 'integration_error'::public.notification_type, v_title, v_body,
             'uptime', p_monitor.id,
             jsonb_build_object('kind', p_kind, 'monitor', p_monitor.name, 'url', p_monitor.url,
                                'down_since', p_monitor.down_since, 'error', p_error)
      FROM public.organization_members m
      WHERE m.org_id = p_monitor.notify_org_id
        AND m.role = 'manager'
        AND m.status = 'active';
      GET DIAGNOSTICS v_bell_count = ROW_COUNT;
    END IF;
    v_bell := jsonb_build_object('count', v_bell_count);
  EXCEPTION WHEN OTHERS THEN
    v_bell := jsonb_build_object('count', 0, 'error', left(SQLERRM, 300));
  END;

  RETURN jsonb_build_object('kind', p_kind, 'subject', v_subject, 'email', v_email, 'bell', v_bell);
END;
$$;

-- =============================================================================
-- Rodada do cron: sonda (com 1 retentativa), grava, decide e avisa.
-- Devolve um resumo (útil para rodar na mão: SELECT public.uptime_monitor_tick();)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.uptime_monitor_tick()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mon       public.uptime_monitors;
  v_probe     RECORD;
  v_attempts  INTEGER;
  v_now       TIMESTAMPTZ;
  v_alert     TEXT;
  v_detail    JSONB;
  v_check_id  BIGINT;
  v_results   JSONB := '[]'::jsonb;
BEGIN
  -- rodadas não se sobrepõem (uma rodada com retentativas leva até ~35 s)
  IF NOT pg_try_advisory_xact_lock(hashtext('uptime_monitor_tick')) THEN
    RETURN jsonb_build_object('skipped', 'rodada anterior ainda em andamento');
  END IF;

  FOR v_mon IN SELECT * FROM public.uptime_monitors WHERE enabled ORDER BY name LOOP
    -- timeouts valem para a sessão; cada rodada do pg_cron abre uma sessão nova
    PERFORM extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', v_mon.timeout_ms::text);
    PERFORM extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', least(v_mon.timeout_ms, 5000)::text);

    v_attempts := 1;
    SELECT * INTO v_probe FROM public.uptime_probe(v_mon.url, v_mon.expect_body_like);

    IF NOT v_probe.ok AND v_mon.retry_delay_seconds > 0 THEN
      PERFORM pg_sleep(v_mon.retry_delay_seconds);
      v_attempts := 2;
      SELECT * INTO v_probe FROM public.uptime_probe(v_mon.url, v_mon.expect_body_like);
    END IF;

    PERFORM extensions.http_reset_curlopt();

    v_now   := clock_timestamp(); -- não now(): várias rodadas na mesma transação (teste em lote) precisam de horas distintas
    v_alert := NULL;
    v_detail := NULL;

    IF v_probe.ok THEN
      IF v_mon.is_down THEN
        v_alert := 'recovered';
      END IF;
      UPDATE public.uptime_monitors SET
        consecutive_failures = 0,
        last_checked_at = v_now,
        last_ok_at = v_now,
        last_status_code = v_probe.status_code,
        last_error = NULL
      WHERE id = v_mon.id;
    ELSE
      v_mon.consecutive_failures := v_mon.consecutive_failures + 1;
      IF NOT v_mon.is_down AND v_mon.consecutive_failures >= v_mon.failure_threshold THEN
        v_alert := 'down';
        v_mon.is_down := true;
        v_mon.down_since := v_now;
      ELSIF v_mon.is_down AND v_mon.last_alert_at IS NOT NULL
            AND v_now - v_mon.last_alert_at >= v_mon.remind_every THEN
        v_alert := 'reminder';
      END IF;
      UPDATE public.uptime_monitors SET
        consecutive_failures = v_mon.consecutive_failures,
        is_down = v_mon.is_down,
        down_since = v_mon.down_since,
        last_checked_at = v_now,
        last_status_code = v_probe.status_code,
        last_error = v_probe.error
      WHERE id = v_mon.id;
    END IF;

    IF v_alert IS NOT NULL THEN
      -- v_mon carrega down_since atualizado (down) ou o antigo (recovered → duração)
      v_detail := public.uptime_send_alert(v_mon, v_alert, v_probe.error);
      UPDATE public.uptime_monitors SET
        last_alert_at = v_now,
        last_alert_kind = v_alert,
        is_down = (v_alert <> 'recovered'),
        down_since = CASE WHEN v_alert = 'recovered' THEN NULL ELSE down_since END
      WHERE id = v_mon.id;
    END IF;

    INSERT INTO public.uptime_checks (monitor_id, checked_at, ok, status_code, latency_ms, attempts, error, alert_kind, alert_detail)
    VALUES (v_mon.id, v_now, v_probe.ok, v_probe.status_code, v_probe.latency_ms, v_attempts, v_probe.error, v_alert, v_detail)
    RETURNING id INTO v_check_id;

    v_results := v_results || jsonb_build_object(
      'monitor', v_mon.name,
      'ok', v_probe.ok,
      'status', v_probe.status_code,
      'latency_ms', v_probe.latency_ms,
      'attempts', v_attempts,
      'error', v_probe.error,
      'consecutive_failures', CASE WHEN v_probe.ok THEN 0 ELSE v_mon.consecutive_failures END,
      'is_down', CASE WHEN v_alert = 'recovered' THEN false ELSE v_mon.is_down END,
      'alert', v_alert,
      'alert_detail', v_detail,
      'check_id', v_check_id
    );
  END LOOP;

  -- retenção: 30 dias
  DELETE FROM public.uptime_checks WHERE checked_at < now() - interval '30 days';

  RETURN jsonb_build_object('at', now(), 'results', v_results);
END;
$$;

REVOKE ALL ON FUNCTION public.uptime_probe(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.uptime_send_alert(public.uptime_monitors, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.uptime_monitor_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.uptime_monitor_tick() TO service_role;

-- =============================================================================
-- Seed: o app em produção, avisando os gestores da V4 Amaral
-- =============================================================================

INSERT INTO public.uptime_monitors (name, url, notify_org_id)
VALUES (
  'enriqueceai-app',
  'https://app.enriqueceai.com.br/api/version',
  'c2727473-1df8-4faa-9264-a9fc1759fe3b'
)
ON CONFLICT (name) DO NOTHING;

-- =============================================================================
-- Cron: a cada 2 min, sem segredo (chama função do próprio banco)
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'uptime-monitor') THEN
    PERFORM cron.unschedule('uptime-monitor');
  END IF;
  PERFORM cron.schedule('uptime-monitor', '*/2 * * * *', 'SELECT public.uptime_monitor_tick();');
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
