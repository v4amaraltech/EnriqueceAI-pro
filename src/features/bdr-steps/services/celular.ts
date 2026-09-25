/**
 * BDR IA — telefone para a Ana ligar.
 *
 * Piloto de 22-24/09/2026: metade das ligações perdidas foi para fixo de sede
 * ou PABX, e 25 leads importados do Apollo entraram sem telefone (crédito de
 * celular do Apollo esgotado). Duas regras:
 *   1. o celular brasileiro sempre vem primeiro na lista de telefones — o
 *      telefone principal do lead é o primeiro número do contato
 *      (trigger sync_primary_contact_to_lead);
 *   2. lead sem celular não sai da cadência de cara: pede a revelação ao
 *      Apollo e espera até N dias úteis; se o celular não chegar, liga no
 *      fixo (a triagem de recepção está no prompt da Ana) ou, sem nenhum
 *      número, encerra.
 */

export interface TelefoneLead { tipo?: string | null; numero?: string | null }

/** Só dígitos, com DDI 55 quando o número veio sem ele (10 ou 11 dígitos). */
export function digitosBR(n: unknown): string {
  let d = String(n ?? '').replace(/\D/g, '');
  if (d.length === 14 && d.startsWith('5555')) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d;
}

export function ehCelularBR(n: unknown): boolean {
  return /^55\d{2}9\d{8}$/.test(digitosBR(n));
}

export function ehFixoBR(n: unknown): boolean {
  return /^55\d{2}[2-5]\d{7}$/.test(digitosBR(n));
}

/** E.164 (+55…) de um número brasileiro válido, ou null. */
export function e164BR(n: unknown): string | null {
  const d = digitosBR(n);
  return ehCelularBR(d) || ehFixoBR(d) ? '+' + d : null;
}

/**
 * Reordena a lista com o 1º celular brasileiro na frente (marcado como
 * celular). O resto mantém a ordem. Não inventa nem remove números.
 */
export function ordenarCelularPrimeiro<T extends TelefoneLead>(phones: T[] | null | undefined): T[] {
  const lista = [...(phones ?? [])].filter((p) => p && String(p.numero ?? '').trim() !== '');
  const i = lista.findIndex((p) => ehCelularBR(p.numero));
  if (i < 0) return lista;
  const [cel] = lista.splice(i, 1);
  return [{ ...cel!, tipo: 'celular' } as T, ...lista];
}

/** Telefone principal certo: o 1º celular BR se houver; senão o atual; senão o 1º da lista. */
export function telefonePrincipal(atual: string | null | undefined, phones: TelefoneLead[] | null | undefined): string | null {
  const cel = (phones ?? []).find((p) => ehCelularBR(p.numero));
  if (cel && !ehCelularBR(atual)) return String(cel.numero);
  if (atual && String(atual).trim()) return atual;
  const primeiro = (phones ?? []).find((p) => String(p.numero ?? '').trim() !== '');
  return primeiro ? String(primeiro.numero) : null;
}

const DIA_MS = 86_400_000;
const OFFSET_SP_MS = -3 * 3_600_000;

/** Dias úteis (seg-sex) completos entre a e b, contados no fuso de São Paulo. */
export function diasUteisEntre(a: Date, b: Date): number {
  if (b <= a) return 0;
  const inicio = new Date(Math.floor((a.getTime() + OFFSET_SP_MS) / DIA_MS) * DIA_MS);
  const fim = new Date(Math.floor((b.getTime() + OFFSET_SP_MS) / DIA_MS) * DIA_MS);
  let n = 0;
  for (let d = new Date(inicio.getTime() + DIA_MS); d <= fim; d = new Date(d.getTime() + DIA_MS)) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

/** Próximo dia útil (seg-sex) às 09:00 de São Paulo, depois de `agora`. */
export function proximoDiaUtil9hSP(agora: Date): Date {
  let dia = Math.floor((agora.getTime() + OFFSET_SP_MS) / DIA_MS) * DIA_MS + DIA_MS;
  while ([0, 6].includes(new Date(dia).getUTCDay())) dia += DIA_MS;
  return new Date(dia + 9 * 3_600_000 - OFFSET_SP_MS);
}

export type AcaoCelular = 'ligar' | 'ligar_fixo' | 'aguardar' | 'encerrar';

export interface DecisaoCelular {
  acao: AcaoCelular;
  telefone: string | null;
  pedirRevelacao: boolean;
  motivo: string;
}

/**
 * @param numeros   todos os números conhecidos do lead (principal + contato + lead.phones)
 * @param esperas   datas dos pedidos de revelação já feitos para este lead (espera de celular)
 */
export function decidirCelular({ numeros, esperas, agora, esperaMaxDiasUteis = 3, intervaloPedidoHoras = 20 }: {
  numeros: Array<string | null | undefined>;
  esperas: Date[];
  agora: Date;
  esperaMaxDiasUteis?: number;
  intervaloPedidoHoras?: number;
}): DecisaoCelular {
  const cel = numeros.find((n) => ehCelularBR(n));
  if (cel) return { acao: 'ligar', telefone: '+' + digitosBR(cel), pedirRevelacao: false, motivo: 'celular' };

  const ordenadas = [...esperas].sort((x, y) => x.getTime() - y.getTime());
  const primeira = ordenadas[0];
  const ultima = ordenadas[ordenadas.length - 1];
  const fixo = numeros.map((n) => e164BR(n)).find((n) => n && ehFixoBR(n)) ?? null;

  if (primeira && diasUteisEntre(primeira, agora) >= esperaMaxDiasUteis) {
    return fixo
      ? { acao: 'ligar_fixo', telefone: fixo, pedirRevelacao: false, motivo: `sem celular após ${esperaMaxDiasUteis} dias úteis — liga no fixo` }
      : { acao: 'encerrar', telefone: null, pedirRevelacao: false, motivo: `sem telefone após ${esperaMaxDiasUteis} dias úteis de espera` };
  }
  const pedir = !ultima || agora.getTime() - ultima.getTime() >= intervaloPedidoHoras * 3_600_000;
  return { acao: 'aguardar', telefone: null, pedirRevelacao: pedir, motivo: fixo ? 'só fixo — aguardando celular' : 'sem telefone — aguardando celular' };
}
