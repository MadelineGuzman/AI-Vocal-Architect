import { create } from 'zustand';

// Capability mode. Engineer sees the full technical dashboard; Artist sees a
// focused view of the direct actions a collaborator can drive without knowing
// the DAW — transport, record, scrap-a-take, plain-language effects and vibe
// chains. "Control stays with the engineer" means the engineer holds the deep
// technical layer, NOT that they approve the artist's moves: in a live session
// the artist acts directly. Persisted locally so the chosen mode sticks.
export type Mode = 'engineer' | 'artist';

const KEY = 'cadenzai.mode.v1';

function load(): Mode {
  try { return localStorage.getItem(KEY) === 'artist' ? 'artist' : 'engineer'; } catch { return 'engineer'; }
}

interface ModeState {
  mode: Mode;
  setMode: (mode: Mode) => void;
}

export const useModeStore = create<ModeState>((set) => ({
  mode: load(),
  setMode: (mode) => { try { localStorage.setItem(KEY, mode); } catch { /* storage unavailable */ } set({ mode }); },
}));
