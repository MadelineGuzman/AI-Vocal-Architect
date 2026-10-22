// Executable async intent (collaboration frontier, Layer 1): a queue of proposed
// actions a collaborator makes, waiting for the producer's approval. Each
// proposal carries the SAME structured command Cadenzai already sends to the
// bridge — approving it just runs that command. No AI, no networking: this is
// pure, testable queue logic; persistence and the store live elsewhere.

export interface Proposal {
  id: string;
  // Human-readable summary, e.g. "Add slappy echo to Chorus Vox".
  label: string;
  // Optional extra detail (the knob targets, a note).
  detail?: string;
  // Who proposed it (just a label until real identities/remote exist).
  from: string;
  trackName: string;
  // The already-built command to run on approval.
  endpoint: string;
  body: unknown;
  createdAt: number;
}

export const MAX_PROPOSALS = 50;

// Newest first, capped. A pure reducer so it can be tested without a browser.
export function addProposal(list: Proposal[], proposal: Proposal): Proposal[] {
  return [proposal, ...list].slice(0, MAX_PROPOSALS);
}

export function removeProposal(list: Proposal[], id: string): Proposal[] {
  return list.filter(p => p.id !== id);
}

// Accept only well-formed proposals when loading from storage, so corrupt or
// tampered localStorage can never feed junk into an approval that hits REAPER.
export function sanitizeProposals(raw: unknown): Proposal[] {
  if (!Array.isArray(raw)) return [];
  const out: Proposal[] = [];
  for (const p of raw) {
    if (p && typeof p === 'object' &&
        typeof (p as Proposal).id === 'string' &&
        typeof (p as Proposal).label === 'string' &&
        typeof (p as Proposal).from === 'string' &&
        typeof (p as Proposal).trackName === 'string' &&
        typeof (p as Proposal).endpoint === 'string' && (p as Proposal).endpoint.startsWith('/api/reaper/') &&
        typeof (p as Proposal).createdAt === 'number') {
      const q = p as Proposal;
      out.push({ id: q.id, label: q.label, detail: typeof q.detail === 'string' ? q.detail : undefined, from: q.from, trackName: q.trackName, endpoint: q.endpoint, body: q.body, createdAt: q.createdAt });
    }
    if (out.length >= MAX_PROPOSALS) break;
  }
  return out;
}

// Human-friendly "when", for the approval list.
export function timeAgo(then: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
