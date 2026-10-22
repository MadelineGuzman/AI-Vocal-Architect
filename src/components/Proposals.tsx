import { useState } from 'react';
import { Inbox, CheckCircle2, X, Loader2, AlertTriangle } from 'lucide-react';
import { useProposalStore } from '../store/proposalStore';
import { timeAgo, type Proposal } from '../lib/proposals';

// The producer's approval queue: proposed changes from a collaborator, waiting
// for a yes. Approving runs the proposal's already-built command in REAPER
// (undoable). Nothing happens on its own — this is the producer-directed gate,
// now across time. Local proof-of-concept; remote sharing is the next layer.
export function Proposals({ connected }: { connected: boolean }) {
  const proposals = useProposalStore(s => s.proposals);
  const dismiss = useProposalStore(s => s.dismiss);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; msg: string } | null>(null);

  if (proposals.length === 0) return null;

  const approve = async (p: Proposal) => {
    if (!connected) { setError({ id: p.id, msg: 'Connect REAPER to approve this.' }); return; }
    setBusy(p.id);
    setError(null);
    try {
      const r = await fetch(p.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p.body) });
      if (r.ok) {
        dismiss(p.id);
      } else {
        const b = await r.json().catch(() => ({})) as { error?: string };
        setError({ id: p.id, msg: b.error || 'REAPER couldn’t accept it.' });
      }
    } catch {
      setError({ id: p.id, msg: 'Could not reach the local server.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
      <p className="flex items-center gap-2 text-xs font-semibold text-amber-200"><Inbox size={14} /> Pending from your collaborator ({proposals.length})</p>
      <p className="mt-1 text-[11px] text-zinc-500">Proposed changes waiting on you. Nothing happens until you approve — then it runs in REAPER, undoable with Ctrl+Z.</p>
      <ul className="mt-3 space-y-2">
        {proposals.map(p => (
          <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-zinc-200">{p.label}</p>
              {p.detail && <p className="mt-0.5 text-[10px] leading-snug text-zinc-500">{p.detail}</p>}
              <p className="mt-0.5 text-[10px] text-zinc-600">{p.from} · {timeAgo(p.createdAt)}</p>
            </div>
            {error?.id === p.id && <span className="flex items-center gap-1 text-[11px] text-amber-300"><AlertTriangle size={12} /> {error.msg}</span>}
            <div className="flex items-center gap-1.5">
              <button onClick={() => approve(p)} disabled={busy === p.id}
                className="flex items-center gap-1 rounded bg-green-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50">
                {busy === p.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Approve
              </button>
              <button onClick={() => dismiss(p.id)} title="Dismiss this proposal" aria-label="Dismiss"
                className="flex h-7 w-7 items-center justify-center rounded border border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300">
                <X size={13} />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
