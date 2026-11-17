import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { callNoteKey, writeCallNote } from '../utils/call-note-draft';

import { useMotorLeadActions } from './use-motor-lead-actions';

const toastMessage = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { message: toastMessage, success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('./CallMeetingDialogs', () => ({
  CallMeetingWeekDialog: ({ open, onChoose }: { open: boolean; onChoose: (c: unknown) => void }) =>
    open ? (
      <button
        type="button"
        data-testid="week-dialog"
        onClick={() => onChoose({ start: new Date('2026-11-18T13:00:00Z'), closer: { id: 'c1' } })}
      />
    ) : null,
  CallMeetingConfirmDialog: ({ onScheduled }: { onScheduled: () => void }) => (
    <button type="button" data-testid="confirm-dialog" onClick={onScheduled} />
  ),
}));
vi.mock('./MotorCallbackDialog', () => ({
  MotorCallbackDialog: ({
    open,
    scheduleCallback,
    initialNotes,
  }: {
    open: boolean;
    scheduleCallback?: (i: { scheduledAt: Date }) => Promise<unknown>;
    initialNotes?: string;
  }) =>
    open ? (
      <button
        type="button"
        data-testid="callback-dialog"
        data-notes={initialNotes}
        data-has-fn={String(Boolean(scheduleCallback))}
        onClick={() => void scheduleCallback?.({ scheduledAt: new Date('2026-11-18T13:00:00Z') })}
      />
    ) : null,
}));
vi.mock('@/features/leads/components/MarkLeadLostDialog', () => ({
  MarkLeadLostDialog: ({ open, onSuccess }: { open: boolean; onSuccess: () => void }) =>
    open ? <button type="button" data-testid="lost-dialog" onClick={onSuccess} /> : null,
}));

type Input = Parameters<typeof useMotorLeadActions>[0];

function Harness(props: Input) {
  const a = useMotorLeadActions(props);
  return (
    <div>
      <button type="button" data-testid="schedule" onClick={a.schedule} />
      <button type="button" data-testid="callback" onClick={a.callback} />
      <button type="button" data-testid="disqualify" onClick={a.disqualify} />
      <span data-testid="busy">{String(a.callbackBusy)}</span>
      {a.dialogs}
    </div>
  );
}

const base: Input = { leadId: 'lead-1', leadName: 'Acme', leadEmail: null, simulated: false };

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('useMotorLeadActions', () => {
  it('agendar com sucesso => onLeadActed("scheduled")', () => {
    const onLeadActed = vi.fn();
    render(<Harness {...base} onLeadActed={onLeadActed} />);
    fireEvent.click(screen.getByTestId('schedule'));
    fireEvent.click(screen.getByTestId('week-dialog'));
    expect(onLeadActed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('confirm-dialog'));
    expect(onLeadActed).toHaveBeenCalledWith('scheduled');
  });

  it('desqualificar (motivo confirmado) => onLeadActed("lost")', () => {
    const onLeadActed = vi.fn();
    render(<Harness {...base} onLeadActed={onLeadActed} />);
    fireEvent.click(screen.getByTestId('disqualify'));
    fireEvent.click(screen.getByTestId('lost-dialog'));
    expect(onLeadActed).toHaveBeenCalledWith('lost');
    expect(screen.queryByTestId('lost-dialog')).toBeNull();
  });

  it('Ligar depois abre o diálogo com scheduleCallback e a anotação do painel; marca "gravando"', async () => {
    writeCallNote(callNoteKey('motor', 'lead-1'), 'pediu proposta');
    let resolve!: (v: { ok: true }) => void;
    const scheduleCallback = vi.fn(() => new Promise<{ ok: true }>((r) => (resolve = r)));
    render(<Harness {...base} scheduleCallback={scheduleCallback} attemptsToday={2} />);
    fireEvent.click(screen.getByTestId('callback'));
    const dialog = screen.getByTestId('callback-dialog');
    expect(dialog.getAttribute('data-has-fn')).toBe('true');
    expect(dialog.getAttribute('data-notes')).toBe('pediu proposta');
    fireEvent.click(dialog);
    expect(scheduleCallback).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('busy').textContent).toBe('true');
    await act(async () => resolve({ ok: true }));
    expect(screen.getByTestId('busy').textContent).toBe('false');
  });

  it('simulado: Agendar e Desqualificar só avisam, sem diálogo nem concluir', () => {
    const onLeadActed = vi.fn();
    render(<Harness {...base} simulated onLeadActed={onLeadActed} />);
    fireEvent.click(screen.getByTestId('schedule'));
    fireEvent.click(screen.getByTestId('disqualify'));
    expect(toastMessage).toHaveBeenCalledTimes(2);
    expect(toastMessage).toHaveBeenCalledWith('Simulado: nada é registrado.');
    expect(screen.queryByTestId('week-dialog')).toBeNull();
    expect(screen.queryByTestId('lost-dialog')).toBeNull();
    expect(onLeadActed).not.toHaveBeenCalled();
  });

  it('fixture (previewOnly): Agendar abre a agenda de exemplo; Desqualificar só avisa', () => {
    render(<Harness {...base} simulated previewOnly />);
    fireEvent.click(screen.getByTestId('schedule'));
    expect(screen.getByTestId('week-dialog')).toBeTruthy();
    fireEvent.click(screen.getByTestId('disqualify'));
    expect(toastMessage).toHaveBeenCalledWith('Fixture de teste: nada é registrado.');
    expect(screen.queryByTestId('lost-dialog')).toBeNull();
  });

  it('sem scheduleCallback (fixture) o diálogo abre sem função', () => {
    render(<Harness {...base} simulated previewOnly />);
    fireEvent.click(screen.getByTestId('callback'));
    expect(screen.getByTestId('callback-dialog').getAttribute('data-has-fn')).toBe('false');
  });
});
