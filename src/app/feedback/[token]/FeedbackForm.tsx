'use client';

import { useState } from 'react';

interface FeedbackFormProps {
  token: string;
}

const RESULT_OPTIONS = [
  { value: 'meeting_done', label: 'Reunião realizada' },
  { value: 'no_show', label: 'Não compareceu' },
  { value: 'rescheduled', label: 'Remarcou' },
] as const;

export function FeedbackForm({ token }: FeedbackFormProps) {
  const [result, setResult] = useState('');
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!result || !rating) return;

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, result, rating, comment: comment.trim() || null }),
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
        <div className="text-4xl mb-4">&#10003;</div>
        <h2 className="text-xl font-semibold text-gray-800 mb-2">Feedback enviado!</h2>
        <p className="text-gray-600">Obrigado pela sua avaliação.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Result */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-3">
          Como foi a reunião? <span className="text-red-500">*</span>
        </label>
        <div className="space-y-2">
          {RESULT_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                result === option.value
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <input
                type="radio"
                name="result"
                value={option.value}
                checked={result === option.value}
                onChange={() => setResult(option.value)}
                className="text-blue-600"
              />
              <span className="text-sm text-gray-700">{option.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Rating */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-3">
          Qualidade do lead (1-5) <span className="text-red-500">*</span>
        </label>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setRating(star)}
              onMouseEnter={() => setHoverRating(star)}
              onMouseLeave={() => setHoverRating(0)}
              className="text-3xl transition-transform hover:scale-110 focus:outline-none"
            >
              <span style={{ color: star <= (hoverRating || rating) ? '#f59e0b' : '#d1d5db' }}>
                &#9733;
              </span>
            </button>
          ))}
        </div>
        {rating > 0 && (
          <p className="text-xs text-gray-500 mt-1">
            {rating === 1 && 'Muito baixa'}
            {rating === 2 && 'Baixa'}
            {rating === 3 && 'Regular'}
            {rating === 4 && 'Boa'}
            {rating === 5 && 'Excelente'}
          </p>
        )}
      </div>

      {/* Comment */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          Observações <span className="text-gray-400 font-normal">(opcional)</span>
        </label>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Alguma observação sobre a reunião ou o lead..."
          rows={3}
          className="w-full rounded-lg border border-gray-200 px-4 py-3 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</p>
      )}

      <button
        type="submit"
        disabled={submitting || !result || !rating}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition-colors"
      >
        {submitting ? 'Enviando...' : 'Enviar Feedback'}
      </button>
    </form>
  );
}
