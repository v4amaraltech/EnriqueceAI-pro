import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { type JevInput, type JevResponse, mapJevResponse } from './jev.client';
import {
  NEEDS_REVIEW_REASONS,
  detectSuspiciousAudio,
  evaluateNeedsReview,
  hasDurationWarning,
  hasMailboxPrompt,
  isIncoherentOutcomeNextStep,
  isTrustedNotConnected,
  stripIcpAnswers,
} from './review';

const fixturesPath = join(dirname(fileURLToPath(import.meta.url)), 'review.audit.fixtures.json');

interface AuditFixture {
  call_prefix: string;
  duration_seconds: number;
  speakers_count: number;
  transcript_error: string | null;
  transcript: string;
  jev_response: JevResponse;
  old_needs_review: boolean;
  expected_needs_review: boolean;
  expected_reasons: string[];
}

const auditFixtures = JSON.parse(readFileSync(fixturesPath, 'utf8')) as AuditFixture[];

const baseInput = (over: Partial<JevInput> = {}): JevInput => ({
  transcript: 'Pode me ligar amanhã.',
  utterances: [{ speaker: 'A', text: 'Pode me ligar amanhã.', start: 0, end: 1 }],
  durationSeconds: 60,
  callType: 'outbound',
  ...over,
});

describe('detectSuspiciousAudio', () => {
  it('marca caixa postal seguida de conversa longa e 2 speakers', () => {
    const text =
      'Deixe a sua mensagem na caixa postal. ' +
      'Você vai pegar quantos nhoques? Um sozinho, né? Pegar dois. Um para casa e outro para a família. '.repeat(3);
    expect(hasMailboxPrompt(text)).toBe(true);
    expect(detectSuspiciousAudio({ text, speakersCount: 2 })).toBe(
      NEEDS_REVIEW_REASONS.suspiciousAudioVoicemailUnrelated,
    );
  });

  it('não marca correio de voz puro de 1 speaker', () => {
    const text =
      'Sua chamada foi encaminhada para o correio de voz, pois a pessoa que você está tentando contatar não está disponível. Grave a sua mensagem após o sinal. Você pode desligar quando terminar a gravação.';
    expect(detectSuspiciousAudio({ text, speakersCount: 1 })).toBeNull();
  });

  it('não marca URA de porteiro + recado curto, mesmo com prompt de mensagem', () => {
    const text =
      'Olá, se você disser seu nome e o motivo da chamada, poderei ver se esta pessoa está disponível. Mateus, urgente. Permaneça na linha. Esta pessoa não está disponível. Se desejar, deixe outra mensagem após o sinal.';
    expect(detectSuspiciousAudio({ text, speakersCount: 2 })).toBeNull();
  });

  it('não marca URA seguida de conversa real (sem caixa postal)', () => {
    const text =
      'Olá, se você disser seu nome e o motivo da ligação, poderei ver se esta pessoa está disponível. Mateus, urgente. Permaneça na linha. Alô, Adriano, aqui é o Matheus da V4, você se lembra de mim? ' +
      'Lá no começo do ano a gente quase fechou uma parceria. '.repeat(8);
    expect(hasMailboxPrompt(text)).toBe(false);
    expect(detectSuspiciousAudio({ text, speakersCount: 3 })).toBeNull();
  });

  it('marca anomalia de speakers', () => {
    expect(detectSuspiciousAudio({ text: 'Alô?', speakersCount: 0 })).toBe(
      NEEDS_REVIEW_REASONS.suspiciousAudioSpeakerAnomaly,
    );
    expect(detectSuspiciousAudio({ text: 'Alô?', speakersCount: 5 })).toBe(
      NEEDS_REVIEW_REASONS.suspiciousAudioSpeakerAnomaly,
    );
    expect(detectSuspiciousAudio({ text: 'Alô?', speakersCount: 2 })).toBeNull();
  });
});

describe('evaluateNeedsReview', () => {
  it('não usa interest nem noul quando not_connected tem confiança suficiente', () => {
    const d = evaluateNeedsReview({
      outcome: 'not_connected',
      nextStep: 'not_connected',
      outcomeConf: 0.78,
      nextConf: 0.85,
      interestConf: 0.24,
      hasObjections: false,
      noul: 0.07,
    });
    expect(d.needsReview).toBe(false);
    expect(d.reasons).toEqual([]);
    expect(d.confidence).toBe(0.78);
    expect(isTrustedNotConnected('not_connected', 0.78)).toBe(true);
  });

  it('força revisão em pares incoerentes mesmo com confiança alta', () => {
    expect(isIncoherentOutcomeNextStep('not_interested', 'callback')).toBe(true);
    expect(isIncoherentOutcomeNextStep('not_interested', 'meeting')).toBe(true);
    expect(isIncoherentOutcomeNextStep('not_connected', 'meeting')).toBe(true);
    expect(isIncoherentOutcomeNextStep('not_connected', 'callback')).toBe(false);
    const d = evaluateNeedsReview({
      outcome: 'not_interested',
      nextStep: 'callback',
      outcomeConf: 0.95,
      nextConf: 0.9,
      interestConf: 0.9,
      hasObjections: true,
      noul: 0.84,
      objectionTypeConf: 1,
    });
    expect(d.needsReview).toBe(true);
    expect(d.reasons).toEqual([NEEDS_REVIEW_REASONS.incoherentOutcomeNextStep]);
  });

  it('força revisão em duration_warning', () => {
    expect(hasDurationWarning('duration_warning: call=66s audio=85.2s')).toBe(true);
    expect(hasDurationWarning('duration_mismatch: call=66s audio=20s')).toBe(false);
    const d = evaluateNeedsReview({
      outcome: 'callback',
      nextStep: 'callback',
      outcomeConf: 0.9,
      nextConf: 0.85,
      interestConf: 0.8,
      hasObjections: false,
      noul: 0.1,
      durationWarning: true,
    });
    expect(d.needsReview).toBe(true);
    expect(d.reasons).toEqual([NEEDS_REVIEW_REASONS.durationWarning]);
  });
});

describe('stripIcpAnswers e not_connected no mapJevResponse', () => {
  it('remove ICP/BANT do resumo e das answers persistidas', () => {
    const q = mapJevResponse(
      {
        model: 'jev-1.14.0',
        answers: {
          outcome: { type: 'choice', choice: 'not_connected', confidence: 1 },
          interest: { type: 'score', score: 0.6, confidence: 0.4 },
          has_objections: { type: 'noul', noul: 0.08 },
          objection_type: { type: 'choice', choice: 'none', confidence: 0.9 },
          next_step_suggestion: { type: 'choice', choice: 'not_connected', confidence: 0.89 },
          bant_timeline: { type: 'choice', choice: 'yes', confidence: 0.85 },
          decision_maker: { type: 'choice', choice: 'no', confidence: 0.37 },
        },
      },
      baseInput({ transcript: 'Grave a sua mensagem após o sinal.', speakersCount: 1 }),
    );
    expect(q.needsReview).toBe(false);
    expect(q.summary).not.toContain('ICP');
    expect(q.summary).not.toContain('BANT');
    expect(q.summary).not.toContain('prazo');
    const persisted = q.answers as { answers?: Record<string, unknown> };
    expect(persisted.answers?.bant_timeline).toBeUndefined();
    expect(persisted.answers?.decision_maker).toBeUndefined();
    expect(stripIcpAnswers({ bant_timeline: 1, outcome: 2 })).toEqual({ outcome: 2 });
  });
});

describe('auditoria 11/11/2026 (n=11)', () => {
  it('tem os 11 casos', () => {
    expect(auditFixtures.map((f) => f.call_prefix)).toEqual([
      'd9017b4e',
      'fc790ab7',
      '8944be80',
      'b32ce707',
      '4a7b820a',
      'c434ac49',
      '44d730bb',
      '536acfe2',
      '9123b95e',
      '57c5bb55',
      'b971b09a',
    ]);
  });

  it.each(auditFixtures)(
    '$call_prefix: needs_review=$expected_needs_review reasons=$expected_reasons',
    (fix) => {
      const q = mapJevResponse(fix.jev_response, {
        transcript: fix.transcript,
        utterances: [],
        durationSeconds: fix.duration_seconds,
        callType: 'outbound',
        durationWarning: hasDurationWarning(fix.transcript_error),
        speakersCount: fix.speakers_count,
      });
      expect(q.needsReview).toBe(fix.expected_needs_review);
      expect(q.needsReviewReasons).toEqual(fix.expected_reasons);
      expect(q.outcome).toBe(fix.jev_response.answers?.outcome && 'choice' in (fix.jev_response.answers.outcome as object)
        ? (fix.jev_response.answers.outcome as { choice: string }).choice
        : q.outcome);
    },
  );
});
