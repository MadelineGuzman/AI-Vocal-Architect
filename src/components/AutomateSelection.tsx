import { useRef, useState } from 'react';
import { TrendingUp, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { planAutomation } from '../lib/describeAutomation';

// Time-selection automation: drag a time selection in REAPER, say "swell" or
// "fade," and Cadenzai writes a volume envelope over exactly that range — only
// on your click, undoable in REAPER. Read-only until you click Write.
export function AutomateSelection({ track }: { track: { id: string; name: string } | null }) {
  const [desc, setDesc] = useState('');
  const [apply, setApply] = useState<{ phase: 'idle' | 'sending' | 'waiting' | 'applied' | 'error'; message: string }>({ phase: 'idle', message: '' });
  const applyIdRef = useRef<string | null>(null);
  const plan = planAutomation(desc);
  const busy = apply.phase === 'sending' || apply.phase === 'waiting';

  const clearApply = () => { applyIdRef.current = null; setApply({ phase: 'idle', message: '' }); };

  const pollAuto = (id: string, deadline: number) => {
    if (applyIdRef.current !== id) return;
    fetch('/api/reaper/automation-result', { cache: 'no-store' }).then(r => r.json()).then((d: { result: { requestId: string; status: string; message: string } | null }) => {
      if (applyIdRef.current !== id) return;
      const res = d.result;
      if (res && res.requestId === id) setApply({ phase: res.status === 'applied' ? 'applied' : 'error', message: res.message });
      else if (Date.now() < deadline) setTimeout(() => pollAuto(id, deadline), 500);
      else setApply({ phase: 'error', message: 'REAPER didn’t confirm the automation. If you recently updated Cadenzai, re-run Cadenzai_Read_Selection.lua (Terminate the old one first), then try again.' });
    }).catch(() => { if (applyIdRef.current === id && Date.now() < deadline) setTimeout(() => pollAuto(id, deadline), 500); else setApply({ phase: 'error', message: 'Could not reach the local server.' }); });
  };

  const onApply = () => {
    if (!track || !plan || busy) return;
    setApply({ phase: 'sending', message: '' });
    fetch('/api/reaper/apply-automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackId: track.id, auto: plan.kind }) })
      .then(async r => {
        const b = await r.json().catch(() => ({})) as { requestId?: string; error?: string };
        if (r.ok && b.requestId) { applyIdRef.current = b.requestId; setApply({ phase: 'waiting', message: '' }); pollAuto(b.requestId, Date.now() + 9000); }
        else setApply({ phase: 'error', message: b.error || 'REAPER could not accept the automation.' });
      })
      .catch(() => setApply({ phase: 'error', message: 'Could not reach the local server.' }));
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <p className="flex items-center gap-2 text-xs font-medium text-zinc-300"><TrendingUp size={14} className="text-amber-300" /> Automate over your time selection</p>
      {!track
        ? <p className="mt-2 text-[11px] text-zinc-500">Select exactly one track in REAPER to automate it.</p>
        : <>
            <p className="mt-1 text-[11px] text-zinc-500">In REAPER, <span className="text-zinc-300">drag a time selection</span> over the part you want on <span className="text-zinc-300">{track.name}</span>, then say what it should do (e.g. “swell”, “fade out”). This changes only this part, not the whole track.</p>
            <input
              value={desc}
              onChange={e => { setDesc(e.target.value); if (apply.phase !== 'idle') clearApply(); }}
              onKeyDown={e => { if (e.key === 'Enter' && plan && !busy) onApply(); }}
              placeholder="swell into the end…"
              className="mt-2 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
            {desc.trim() && (plan
              ? <div className="mt-2 text-[11px] leading-relaxed">
                  <p><span className="font-medium text-zinc-200">{plan.title}:</span> <span className="text-zinc-400">{plan.what}</span></p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <button onClick={onApply} disabled={busy}
                      className="rounded bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-zinc-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50">
                      Write it in REAPER
                    </button>
                    {busy
                      ? <span className="flex items-center gap-1.5 text-cyan-300"><Loader2 size={13} className="animate-spin" /> Writing it in REAPER…</span>
                      : apply.phase === 'applied'
                        ? <span className="flex items-center gap-1.5 text-green-400"><CheckCircle2 size={13} /> {apply.message} It’s on {track.name}’s volume automation — tweak the curve, or Ctrl+Z in REAPER to undo.</span>
                        : apply.phase === 'error'
                          ? <span className="flex items-center gap-1.5 text-amber-300"><AlertTriangle size={13} /> {apply.message}</span>
                          : <span className="text-zinc-500">Writes volume automation over your selection, only when you click — undoable in REAPER.</span>}
                  </div>
                </div>
              : <p className="mt-2 text-[11px] text-zinc-500">So far I can <span className="text-zinc-300">swell</span> (build up) or <span className="text-zinc-300">fade out</span> over your selection. Try “swell” or “fade out”. (More moves coming.)</p>)}
          </>}
    </div>
  );
}
