-- ============================================================================
-- Flux Sales Engagement — Seed Data for Development
-- ============================================================================
-- Run after initial_schema migration.
-- Creates a dev user + organization, then seeds 20 sample leads.
-- Login: dev@flux.local / dev123456
-- ============================================================================

-- ── Step 1: Create dev user in auth.users ──
-- The handle_new_user trigger will auto-create org + membership.
INSERT INTO auth.users (
  id, instance_id, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, aud, role,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES (
  'a0000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'dev@flux.local',
  crypt('dev123456', gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Dev User"}'::jsonb,
  'authenticated', 'authenticated',
  '', '', '', ''
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (
  id, user_id, provider_id, provider, identity_data,
  last_sign_in_at, created_at, updated_at
) VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'dev@flux.local', 'email',
  '{"sub":"a0000000-0000-0000-0000-000000000001","email":"dev@flux.local"}'::jsonb,
  now(), now(), now()
) ON CONFLICT (provider_id, provider) DO NOTHING;

-- ── Step 2: Insert sample leads for the dev user's organization ──
DO $$
DECLARE
  v_org_id UUID;
  v_user_id UUID;
  v_import_id UUID;
BEGIN
  -- Get first organization (created by handle_new_user trigger)
  SELECT id INTO v_org_id FROM organizations LIMIT 1;
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'No organization found. Create a user first (trigger creates org automatically).';
    RETURN;
  END IF;

  -- Get org owner
  SELECT owner_id INTO v_user_id FROM organizations WHERE id = v_org_id;

  -- Create a sample import record
  INSERT INTO lead_imports (id, org_id, file_name, total_rows, processed_rows, success_count, error_count, status, created_by)
  VALUES (gen_random_uuid(), v_org_id, 'leads-exemplo.csv', 20, 20, 20, 0, 'completed', v_user_id)
  RETURNING id INTO v_import_id;

  -- Insert 20 leads with realistic Brazilian company data
  INSERT INTO leads (org_id, cnpj, status, enrichment_status, razao_social, nome_fantasia, endereco, porte, cnae, situacao_cadastral, email, telefone, faturamento_estimado, created_by, import_id) VALUES
  (v_org_id, '11222333000181', 'new', 'enriched', 'Tech Solutions Ltda', 'TechSol', '{"logradouro":"Av. Paulista","numero":"1000","bairro":"Bela Vista","cidade":"São Paulo","uf":"SP","cep":"01310100"}'::jsonb, 'ME', '6201-5/01', 'Ativa', 'contato@techsol.com.br', '11999001122', 250000.00, v_user_id, v_import_id),

  (v_org_id, '22333444000192', 'new', 'pending', 'Inovacao Digital SA', 'InovaDigital', '{"logradouro":"Rua Augusta","numero":"500","bairro":"Consolação","cidade":"São Paulo","uf":"SP","cep":"01304001"}'::jsonb, 'EPP', '6201-5/01', 'Ativa', 'rh@inovadigital.com.br', '11988112233', 1500000.00, v_user_id, v_import_id),

  (v_org_id, '33444555000103', 'contacted', 'enriched', 'Data Analytics Corp Ltda', 'DataCorp', '{"logradouro":"Av. Brigadeiro Faria Lima","numero":"3477","bairro":"Itaim Bibi","cidade":"São Paulo","uf":"SP","cep":"04538133"}'::jsonb, 'ME', '6311-9/00', 'Ativa', 'vendas@datacorp.com.br', '11977223344', 800000.00, v_user_id, v_import_id),

  (v_org_id, '44555666000114', 'qualified', 'enriched', 'Cloud Services Brasil Ltda', 'CloudBR', '{"logradouro":"Rua Funchal","numero":"411","bairro":"Vila Olímpia","cidade":"São Paulo","uf":"SP","cep":"04551060"}'::jsonb, 'EPP', '6311-9/00', 'Ativa', 'comercial@cloudbr.com.br', '11966334455', 3200000.00, v_user_id, v_import_id),

  (v_org_id, '55666777000125', 'new', 'enrichment_failed', 'Automacao Industrial ME', 'AutoInd', '{"logradouro":"Rod. Anhanguera","numero":"km 25","cidade":"Campinas","uf":"SP","cep":"13065905"}'::jsonb, 'ME', '2812-7/00', 'Ativa', NULL, '19988556677', 450000.00, v_user_id, v_import_id),

  (v_org_id, '66777888000136', 'new', 'enriched', 'Marketing Pro Eireli', 'MktPro', '{"logradouro":"Av. Brasil","numero":"1500","bairro":"Centro","cidade":"Rio de Janeiro","uf":"RJ","cep":"20040020"}'::jsonb, 'ME', '7311-4/00', 'Ativa', 'atendimento@mktpro.com.br', '21977889900', 600000.00, v_user_id, v_import_id),

  (v_org_id, '77888999000147', 'contacted', 'enriched', 'Logistica Express SA', 'LogExpress', '{"logradouro":"Av. das Nações Unidas","numero":"12901","bairro":"Brooklin","cidade":"São Paulo","uf":"SP","cep":"04578000"}'::jsonb, 'Médio', '5211-7/99', 'Ativa', 'operacoes@logexpress.com.br', '11955667788', 12000000.00, v_user_id, v_import_id),

  (v_org_id, '88999000000158', 'new', 'pending', 'Construcoes Modelo Ltda', 'Modelo Eng', '{"logradouro":"SCS Quadra 7","numero":"Bloco A","bairro":"Asa Sul","cidade":"Brasília","uf":"DF","cep":"70307901"}'::jsonb, 'EPP', '4120-4/00', 'Ativa', 'projetos@modeloeng.com.br', '61933445566', 5000000.00, v_user_id, v_import_id),

  (v_org_id, '99000111000169', 'unqualified', 'enriched', 'Restaurante Sabor ME', 'Sabor da Terra', '{"logradouro":"Rua Oscar Freire","numero":"300","bairro":"Jardins","cidade":"São Paulo","uf":"SP","cep":"01426001"}'::jsonb, 'ME', '5611-2/01', 'Ativa', 'reservas@sabordaterra.com.br', '11944556677', 180000.00, v_user_id, v_import_id),

  (v_org_id, '10111222000170', 'new', 'enriched', 'Consultoria Estrategica Ltda', 'ConsultEst', '{"logradouro":"Av. Rio Branco","numero":"1","bairro":"Centro","cidade":"Rio de Janeiro","uf":"RJ","cep":"20090003"}'::jsonb, 'ME', '7020-4/00', 'Ativa', 'parceiros@consultest.com.br', '21922334455', 900000.00, v_user_id, v_import_id),

  (v_org_id, '11222333000262', 'contacted', 'enriched', 'Farmacia Popular Ltda', 'Farma Pop', '{"logradouro":"Rua XV de Novembro","numero":"500","bairro":"Centro","cidade":"Curitiba","uf":"PR","cep":"80020310"}'::jsonb, 'EPP', '4771-7/01', 'Ativa', 'compras@farmapop.com.br', '41911223344', 2800000.00, v_user_id, v_import_id),

  (v_org_id, '12333444000173', 'new', 'pending', 'Agro Tech Solutions Ltda', 'AgroTech', '{"logradouro":"Rod. BR-060","numero":"km 388","cidade":"Goiânia","uf":"GO","cep":"74000000"}'::jsonb, 'Médio', '0161-0/03', 'Ativa', 'contato@agrotech.agr.br', '62900112233', 8500000.00, v_user_id, v_import_id),

  (v_org_id, '13444555000184', 'qualified', 'enriched', 'Educacao Online SA', 'EduOn', '{"logradouro":"Av. Eng. Luiz Carlos Berrini","numero":"1376","bairro":"Cidade Monções","cidade":"São Paulo","uf":"SP","cep":"04571000"}'::jsonb, 'EPP', '8550-1/01', 'Ativa', 'comercial@eduon.com.br', '11933445566', 4200000.00, v_user_id, v_import_id),

  (v_org_id, '14555666000195', 'new', 'enriched', 'Seguranca Total Ltda', 'SecTotal', '{"logradouro":"Rua Vergueiro","numero":"3185","bairro":"Vila Mariana","cidade":"São Paulo","uf":"SP","cep":"04101300"}'::jsonb, 'ME', '8011-1/01', 'Ativa', 'propostas@sectotal.com.br', '11922556677', 350000.00, v_user_id, v_import_id),

  (v_org_id, '15666777000106', 'archived', 'enriched', 'Textil Nordeste ME', 'TexNord', '{"logradouro":"Av. Santos Dumont","numero":"1500","bairro":"Aldeota","cidade":"Fortaleza","uf":"CE","cep":"60150161"}'::jsonb, 'ME', '1412-6/01', 'Baixada', NULL, '85911667788', 120000.00, v_user_id, v_import_id),

  (v_org_id, '16777888000117', 'new', 'not_found', 'Mineracao Sul Ltda', 'MinSul', '{"logradouro":"Av. Afonso Pena","numero":"1901","bairro":"Funcionários","cidade":"Belo Horizonte","uf":"MG","cep":"30130004"}'::jsonb, 'Médio', '0710-3/01', 'Ativa', 'diretoria@minsul.com.br', '31900778899', 15000000.00, v_user_id, v_import_id),

  (v_org_id, '17888999000128', 'contacted', 'enriched', 'Energia Renovavel SA', 'EnerRenov', '{"logradouro":"Rua da Quitanda","numero":"86","bairro":"Centro","cidade":"Rio de Janeiro","uf":"RJ","cep":"20040020"}'::jsonb, 'Médio', '3511-5/01', 'Ativa', 'sustentabilidade@enerrenov.com.br', '21988990011', 22000000.00, v_user_id, v_import_id),

  (v_org_id, '18999000000139', 'new', 'pending', 'Pet Care Servicos Ltda', 'PetCare', '{"logradouro":"Rua Voluntários da Pátria","numero":"190","bairro":"Botafogo","cidade":"Rio de Janeiro","uf":"RJ","cep":"22270000"}'::jsonb, 'ME', '9609-2/08', 'Ativa', 'atendimento@petcare.vet.br', '21977001122', 280000.00, v_user_id, v_import_id),

  (v_org_id, '19000111000140', 'qualified', 'enriched', 'Financeira Capital Ltda', 'FinCap', '{"logradouro":"Av. Juscelino Kubitschek","numero":"1830","bairro":"Vila Nova Conceição","cidade":"São Paulo","uf":"SP","cep":"04543900"}'::jsonb, 'EPP', '6492-1/00', 'Ativa', 'negocios@fincap.com.br', '11966778899', 7800000.00, v_user_id, v_import_id),

  (v_org_id, '20111222000151', 'new', 'enriched', 'Saude Integral SA', 'SaudeInt', '{"logradouro":"Rua Padre Chagas","numero":"79","bairro":"Moinhos de Vento","cidade":"Porto Alegre","uf":"RS","cep":"90570080"}'::jsonb, 'Médio', '8610-1/01', 'Ativa', 'administracao@saudeint.com.br', '51955889900', 18000000.00, v_user_id, v_import_id);

  RAISE NOTICE 'Seed complete: 20 leads created for org %', v_org_id;
END $$;
