import { afterEach, describe, expect, it } from 'vitest';

import type { LiveAmdView } from './live-amd-session';
import {
  getLiveAmdView,
  publishLiveAmdView,
  resetLiveAmdViewStore,
  subscribeLiveAmdView,
} from './live-amd-view-store';

const view = (over: Partial<LiveAmdView> = {}): LiveAmdView => ({
  prediction: 'human',
  phrase: null,
  confidence: 0.9,
  latencyMs: 10,
  transcript: 'alô',
  nextActivity: 'schedule_meeting',
  nextActivityReason: 'Aceitou.',
  ...over,
});

afterEach(() => resetLiveAmdViewStore());

describe('live-amd-view-store', () => {
  it('guarda e devolve a visão da ligação atual', () => {
    const v = view();
    publishLiveAmdView('call-1', v);
    expect(getLiveAmdView('call-1')).toEqual(v);
    expect(getLiveAmdView('call-2')).toBeNull();
  });

  it('avisa os inscritos e cancela a inscrição', () => {
    const seen: string[] = [];
    const off = subscribeLiveAmdView((id) => seen.push(id));
    publishLiveAmdView('call-1', view());
    off();
    publishLiveAmdView('call-1', view({ nextActivity: 'schedule_callback' }));
    expect(seen).toEqual(['call-1']);
    expect(getLiveAmdView('call-1')?.nextActivity).toBe('schedule_callback');
  });
});
