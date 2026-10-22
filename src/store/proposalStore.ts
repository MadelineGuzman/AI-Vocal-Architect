import { create } from 'zustand';
import { addProposal, removeProposal, sanitizeProposals, type Proposal } from '../lib/proposals';

// The collaborator's proposed actions, waiting for the producer to approve.
// Persisted to localStorage so a proposal made now survives a refresh and can be
// approved later — the "async" in executable async intent. Local-only for now;
// a shared/remote store is the next layer.
const KEY = 'cadenzai.proposals.v1';

function load(): Proposal[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitizeProposals(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function persist(list: Proposal[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage unavailable; keep in memory */ }
}

function newId(): string {
  try { return crypto.randomUUID(); } catch { return 'p-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8); }
}

interface ProposalState {
  proposals: Proposal[];
  propose: (p: Omit<Proposal, 'id' | 'createdAt'>) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

export const useProposalStore = create<ProposalState>((set, get) => ({
  proposals: load(),
  propose: (p) => {
    const next = addProposal(get().proposals, { ...p, id: newId(), createdAt: Date.now() });
    persist(next);
    set({ proposals: next });
  },
  dismiss: (id) => {
    const next = removeProposal(get().proposals, id);
    persist(next);
    set({ proposals: next });
  },
  clear: () => { persist([]); set({ proposals: [] }); },
}));
