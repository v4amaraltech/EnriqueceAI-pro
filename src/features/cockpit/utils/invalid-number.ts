/**
 * Número inválido (A-D12, FR-27): erro 422 da API4COM, ou o "Telefone inválido" que o próprio serviço lança antes do POST.
 * LIMITE: o código HTTP vive em `features/calls/**`/`integrations` (proibido editar) e só chega aqui dentro da mensagem de
 * erro; por isso o reconhecimento é por texto (frágil por natureza). O formato real é `API4COM <MÉTODO> <caminho> failed (422)`.
 * Qualquer outro erro continua pausando o motor.
 */
export function isInvalidNumberError(message: string | null | undefined): boolean {
  if (!message) return false;
  return /\bfailed \(422\)/.test(message) || /telefone inv[aá]lido/i.test(message);
}
