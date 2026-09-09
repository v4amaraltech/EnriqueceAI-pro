'use client';

import { useState } from 'react';

interface FeedbackFormProps {
  token: string;
}

const RESULT_OPTIONS = [
  { value: 'meeting_done', label: 'Realizada' },
  { value: 'no_show', label: 'No-show' },
  { value: 'rescheduled', label: 'Remarcada' },
] as const;

const QUALIFICACAO_OPTIONS = [
  { value: 'bateu', label: 'Bateu' },
  { value: 'divergiu', label: 'Divergiu' },
  { value: 'nao_validado', label: 'Não deu pra validar' },
] as const;

// Rótulo exibido → valor gravado. "decisor" saiu daqui — virou pergunta própria
// ("O decisor estava na call?"). O constraint closer_feedback_divergencias_validas
// ainda aceita 'decisor' (dados históricos), mas o form não o oferece mais.
const DIVERGENCIA_OPTIONS = [
  { value: 'verba', label: 'Verba' },
  { value: 'dor', label: 'Dor' },
  { value: 'timing', label: 'Timing' },
  { value: 'dados_cadastrais', label: 'Dados cadastrais' },
] as const;

export function FeedbackForm({ token }: FeedbackFormProps) {
  const [result, setResult] = useState('');
  // Conferência objetiva da qualificação — só quando a reunião foi realizada.
  const [qualificacao, setQualificacao] = useState('');
  // Subconjunto de DIVERGENCIA_OPTIONS — só quando qualificacao === 'divergiu'.
  const [divergencias, setDivergencias] = useState<string[]>([]);
  // Presença do decisor na call — obrigatório quando Realizada. Fonte da métrica
  // "Decisor na Call %" do Sales Hub. null = não respondido.
  const [decisorPresente, setDecisorPresente] = useState<boolean | null>(null);
  // SAO — aceite comercial da oportunidade pelo closer. Obrigatório quando
  // Realizada. ≠ "a qualificação bateu?" (aderência da info do pré-vendas).
  const [oportunidadeQualificada, setOportunidadeQualificada] = useState<boolean | null>(null);
  const [comment, setComment] = useState('');
  // Leitura subjetiva do closer (chance de fechar). Reaproveita a coluna `rating`,
  // sem peso na avaliação do pré-vendas. 0 = não avaliado.
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const isMeetingDone = result === 'meeting_done';
  const isDivergiu = isMeetingDone && qualificacao === 'divergiu';

  function toggleDivergencia(value: string) {
    setDivergencias((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  }

  function handleResultChange(value: string) {
    setResult(value);
    // Sair de "Realizada" limpa qualificação, divergências, decisor e SAO.
    if (value !== 'meeting_done') {
      setQualificacao('');
      setDivergencias([]);
      setDecisorPresente(null);
      setOportunidadeQualificada(null);
    }
    setError('');
  }

  function handleQualificacaoChange(value: string) {
    setQualificacao(value);
    // Ao sair de "Divergiu", zerar o array (constraint só permite itens em 'divergiu').
    if (value !== 'divergiu') setDivergencias([]);
    setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!result) return;
    if (isMeetingDone && !qualificacao) return;
    if (isMeetingDone && decisorPresente === null) return;
    if (isMeetingDone && oportunidadeQualificada === null) return;
    // Replica o constraint closer_feedback_divergencias_obrigatorias no cliente,
    // para erro amigável em vez de 500 do banco.
    if (isDivergiu && divergencias.length === 0) {
      setError('Marque ao menos um item que não conferiu.');
      return;
    }
    // Observações são obrigatórias quando a reunião aconteceu (descrever a call).
    if (isMeetingDone && !comment.trim()) {
      setError('Escreva uma observação sobre a reunião.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          result,
          qualificacao_aderente: isMeetingDone ? qualificacao : null,
          // Só 'divergiu' carrega itens; 'bateu'/'nao_validado' vão nulos.
          divergencias: isDivergiu ? divergencias : null,
          // Presença do decisor — só em Realizada; fonte da métrica do Sales Hub.
          decisor_presente: isMeetingDone ? decisorPresente : null,
          // SAO (aceite da oportunidade) — só em Realizada.
          oportunidade_qualificada: isMeetingDone ? oportunidadeQualificada : null,
          rating: isMeetingDone && rating > 0 ? rating : null,
          comment: comment.trim() || null,
        }),
      });

      if (res.ok) {
        setSubmitted(true);
      } else {
        const data = await res.json();
        setError(data.error ?? 'Erro ao enviar feedback');
      }
    } catch {
      setError('Erro de conexão. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="text-center py-8">
        <div className="text-4xl mb-4 text-primary">&#10003;</div>
        <h2 className="text-xl font-semibold text-[var(--foreground)] mb-2">Feedback enviado</h2>
        <p className="text-[var(--muted-foreground)]">Obrigado pela sua avaliação.</p>
      </div>
    );
  }

  const submitDisabled = submitting || !result || (isMeetingDone && (!qualificacao || decisorPresente === null || oportunidadeQualificada === null || !comment.trim()));

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* 1. Resultado da reunião */}
      <div>
        <label className="block text-sm font-semibold text-[var(--foreground)] mb-3">
          Resultado da reunião <span className="text-primary">*</span>
        </label>
        <div className="grid grid-cols-3 gap-2">
          {RESULT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => handleResultChange(option.value)}
              className={`p-3 rounded-lg border text-sm font-medium transition-colors ${
                result === option.value
                  ? 'border-primary bg-primary/5 text-[var(--foreground)]'
                  : 'border-[var(--border)] text-[var(--foreground)] hover:border-[var(--muted-foreground)]'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* 2. A qualificação bateu com a reunião? — só quando Realizada */}
      {isMeetingDone && (
        <div>
          <label className="block text-sm font-semibold text-[var(--foreground)] mb-1">
            A qualificação bateu com a reunião? <span className="text-primary">*</span>
          </label>
          <p className="text-[var(--muted-foreground)] mb-3" style={{ fontSize: '13px' }}>
            Considere o que o pré-vendas registrou antes da reunião: verba, decisor, dor e timing.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {QUALIFICACAO_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleQualificacaoChange(option.value)}
                className={`p-3 rounded-lg border text-sm font-medium transition-colors ${
                  qualificacao === option.value
                    ? 'border-primary bg-primary/5 text-[var(--foreground)]'
                    : 'border-[var(--border)] text-[var(--foreground)] hover:border-[var(--muted-foreground)]'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 3. O que não conferiu — só quando Divergiu */}
      {isDivergiu && (
        <div className="ml-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 p-4">
          <label className="block text-sm font-semibold text-[var(--foreground)] mb-3">
            O que não conferiu <span className="text-primary">*</span>
          </label>
          <div className="space-y-2">
            {DIVERGENCIA_OPTIONS.map((option) => (
              <label
                key={option.value}
                className="flex items-center gap-3 cursor-pointer text-sm text-[var(--foreground)]"
              >
                <input
                  type="checkbox"
                  checked={divergencias.includes(option.value)}
                  onChange={() => {
                    toggleDivergencia(option.value);
                    setError('');
                  }}
                  className="accent-primary h-4 w-4"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* 4. O decisor estava na call? — só quando Realizada, obrigatório.
          Sinal de presença (≠ da divergência de qualificação). Fonte da métrica
          "Decisor na Call %" do Sales Hub. */}
      {isMeetingDone && (
        <div>
          <label className="block text-sm font-semibold text-[var(--foreground)] mb-3">
            O decisor estava na call? <span className="text-primary">*</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: true, label: 'Sim' },
              { value: false, label: 'Não' },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => { setDecisorPresente(option.value); setError(''); }}
                className={`p-3 rounded-lg border text-sm font-medium transition-colors ${
                  decisorPresente === option.value
                    ? 'border-primary bg-primary/5 text-[var(--foreground)]'
                    : 'border-[var(--border)] text-[var(--foreground)] hover:border-[var(--muted-foreground)]'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 5. Oportunidade Qualificada (SAO) — só quando Realizada, obrigatória.
          Aceite comercial da oportunidade pelo closer. Diferente de "a
          qualificação bateu?": lá se mede se a informação do pré-vendas
          conferiu; aqui, se a oportunidade é de fato uma oportunidade. */}
      {isMeetingDone && (
        <div>
          <label className="block text-sm font-semibold text-[var(--foreground)] mb-1">
            Oportunidade Qualificada (SAO) <span className="text-primary">*</span>
          </label>
          <p className="text-[var(--muted-foreground)] mb-3" style={{ fontSize: '13px' }}>
            Você aceita esta oportunidade como oportunidade de venda?
          </p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: true, label: 'Qualificada' },
              { value: false, label: 'Não qualificada' },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => { setOportunidadeQualificada(option.value); setError(''); }}
                className={`p-3 rounded-lg border text-sm font-medium transition-colors ${
                  oportunidadeQualificada === option.value
                    ? 'border-primary bg-primary/5 text-[var(--foreground)]'
                    : 'border-[var(--border)] text-[var(--foreground)] hover:border-[var(--muted-foreground)]'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 6. Observações — obrigatória quando Realizada (descreve a call);
          opcional em No-show/Remarcada. */}
      <div>
        <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">
          Observações{' '}
          {isMeetingDone
            ? <span className="text-primary">*</span>
            : <span className="text-[var(--muted-foreground)] font-normal">(opcional)</span>}
        </label>
        <textarea
          value={comment}
          onChange={(e) => { setComment(e.target.value); setError(''); }}
          placeholder={isMeetingDone
            ? 'Como foi a call? Ex.: o lead entrou pelo computador ou pelo celular, comportamento, objeções, próximos passos.'
            : 'O que o SDR precisa saber para a próxima'}
          rows={3}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary resize-y"
        />
      </div>

      {/* 7. Chance de fechar — leitura subjetiva, opcional, no rodapé */}
      <div className="border-t border-[var(--border)] pt-6">
        <label className="block text-sm font-semibold text-[var(--foreground)] mb-1">
          Chance de fechar <span className="text-[var(--muted-foreground)] font-normal">(opcional)</span>
        </label>
        <p className="text-[var(--muted-foreground)] mb-3" style={{ fontSize: '12px' }}>
          Leitura sua. Não entra na avaliação do pré-vendas.
        </p>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setRating(star === rating ? 0 : star)}
              onMouseEnter={() => setHoverRating(star)}
              onMouseLeave={() => setHoverRating(0)}
              className="text-3xl transition-transform hover:scale-110 focus:outline-none"
            >
              <span style={{ color: star <= (hoverRating || rating) ? 'var(--primary)' : 'var(--muted-foreground)' }}>
                &#9733;
              </span>
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 p-3 rounded-lg">{error}</p>
      )}

      <button
        type="submit"
        disabled={submitDisabled}
        className="w-full bg-primary hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition-colors"
      >
        {submitting ? 'Enviando...' : 'Enviar feedback'}
      </button>
    </form>
  );
}
