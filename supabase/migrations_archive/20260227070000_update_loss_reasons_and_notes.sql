BEGIN;

-- 1. Add loss_notes column to cadence_enrollments
ALTER TABLE cadence_enrollments
  ADD COLUMN IF NOT EXISTS loss_notes TEXT;

-- 2. Replace system loss reasons with new defaults for all orgs
-- Delete old system reasons
DELETE FROM loss_reasons WHERE is_system = true;

-- Insert new system reasons for each existing org
INSERT INTO loss_reasons (org_id, name, is_system, sort_order)
SELECT o.id, r.name, true, r.sort_order
FROM organizations o
CROSS JOIN (VALUES
  ('Adolescente/Criança', 1),
  ('Blocklist', 2),
  ('Cliente', 3),
  ('Cliente oculto', 4),
  ('Contatos inválidos', 5),
  ('Deixou de responder', 6),
  ('Duplicado', 7),
  ('Engano/Não Lembra', 8),
  ('Ex-cliente (detrator)', 9),
  ('Não ICP', 10),
  ('Nunca respondeu', 11),
  ('Pessoa Física', 12),
  ('Sem autoridade', 13),
  ('Sem budget', 14),
  ('Sem interesse', 15),
  ('Sem necessidade', 16),
  ('Sem timing', 17),
  ('Serviço fora de escopo', 18),
  ('SPAM', 19)
) AS r(name, sort_order);

COMMIT;
