import { describe, expect, it } from 'vitest';

import { cumulativeDays, groupStepsByDay, relativeDelaysForDays } from './timeline-days';

const steps = (...delays: number[]) => delays.map((delay_days, i) => ({ id: `s${i + 1}`, delay_days }));

describe('cumulativeDays', () => {
  it('soma os atrasos relativos a partir do Dia 1', () => {
    expect(cumulativeDays(steps(0, 2, 0, 5))).toEqual([1, 3, 3, 8]);
  });

  it('primeiro passo com atraso começa depois do Dia 1', () => {
    expect(cumulativeDays(steps(1, 0, 3))).toEqual([2, 2, 5]);
  });

  it('ignora atraso negativo', () => {
    expect(cumulativeDays(steps(0, -2, 1))).toEqual([1, 1, 2]);
  });
});

describe('groupStepsByDay', () => {
  it('agrupa passos consecutivos do mesmo dia sem mudar a ordem', () => {
    // Cadência gravada com atraso relativo (v3 do BDR): não pode virar "3 dias".
    const groups = groupStepsByDay(steps(0, 2, 0, 5, 2, 0, 2));
    expect(groups.map((g) => g.day)).toEqual([1, 3, 8, 10, 12]);
    expect(groups.flatMap((g) => g.steps.map((s) => s.id))).toEqual(['s1', 's2', 's3', 's4', 's5', 's6', 's7']);
    expect(groups[1]!.steps.map((s) => s.id)).toEqual(['s2', 's3']);
  });

  it('cadência v3 do BDR (78aa84ca): 16 passos nos dias 0…37 desde a inscrição, na ordem de step_order', () => {
    const v3 = steps(0, 2, 0, 5, 2, 0, 2, 3, 2, 0, 5, 2, 5, 0, 7, 2);
    const groups = groupStepsByDay(v3);
    // "Dia N" da tela = dias desde a inscrição + 1
    expect(groups.map((g) => g.day - 1)).toEqual([0, 2, 7, 9, 11, 14, 16, 21, 23, 28, 35, 37]);
    expect(groups.flatMap((g) => g.steps.map((s) => s.id))).toEqual(v3.map((s) => s.id));
  });

  it('lista vazia não tem dias', () => {
    expect(groupStepsByDay([])).toEqual([]);
  });
});

describe('relativeDelaysForDays', () => {
  it('Dia 1, Dia 3, Dia 5 grava 0, 2, 2 (o motor executa nos dias 1, 3 e 5)', () => {
    expect(
      relativeDelaysForDays([
        { day: 1, stepCount: 1 },
        { day: 3, stepCount: 1 },
        { day: 5, stepCount: 1 },
      ]),
    ).toEqual([[0], [2], [2]]);
  });

  it('só o primeiro passo do dia leva o salto; os outros do mesmo dia gravam 0', () => {
    expect(
      relativeDelaysForDays([
        { day: 1, stepCount: 2 },
        { day: 2, stepCount: 3 },
      ]),
    ).toEqual([[0, 0], [1, 0, 0]]);
  });

  it('cadência que começa depois do Dia 1 grava o atraso no primeiro passo', () => {
    expect(relativeDelaysForDays([{ day: 2, stepCount: 1 }])).toEqual([[1]]);
  });

  it('dia vazio no meio não conta como passo anterior', () => {
    expect(
      relativeDelaysForDays([
        { day: 1, stepCount: 1 },
        { day: 4, stepCount: 0 },
        { day: 6, stepCount: 1 },
      ]),
    ).toEqual([[0], [], [5]]);
  });

  it('ida e volta: abrir e salvar sem mexer grava os mesmos atrasos', () => {
    const original = steps(0, 2, 0, 5, 2, 0, 2, 3, 2, 0, 5, 2, 5, 0, 7, 2);
    const groups = groupStepsByDay(original);
    const saved = relativeDelaysForDays(groups.map((g) => ({ day: g.day, stepCount: g.steps.length }))).flat();
    expect(saved).toEqual(original.map((s) => s.delay_days));
  });

  it('ida e volta também preserva primeiro passo com atraso', () => {
    const original = steps(1, 0, 3, 0, 4, 0);
    const groups = groupStepsByDay(original);
    const saved = relativeDelaysForDays(groups.map((g) => ({ day: g.day, stepCount: g.steps.length }))).flat();
    expect(saved).toEqual([1, 0, 3, 0, 4, 0]);
  });
});
