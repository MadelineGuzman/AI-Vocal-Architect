import { useRef, useState } from 'react';
import { Wand2, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { planEffect } from '../lib/describeEffect';

// Describe-to-effect: say what you want in plain language; Cadenzai figures out
// which REAPER stock plugin that is and, only on your click, adds it to the
// selected track (one undo step, reversible). Read-only until you click Add.
export function DescribeEffect({ track }: { track: { id: string; name: string } | null }) {
  const [desc, setDesc] = useState('');
  const [apply, setApply] = useState<{ phase: 'idle' | 'sending' | 'waiting' | 'applied' | 'error'; message: string }>({ phase: 'idle', message: '' });
  const applyIdRef = useRef<string | null>(null);
  const plan = planEffect(desc, track?.name ?? 'the track');
  const busy = apply.phase === 'sending' || apply.phase === 'waiting';

  const clearApply = () => { applyIdRef.current = null; setApply({ phase: 'idle', message: '' }); };

  // Poll the bridge's echoed outcome until it matches this request or times out.
  const pollFx = (id: string, deadline: number) => {
    if (applyIdRef.current !== id) return;
    fetch('/api/reaper/fx-result', { cache: 'no-store' }).then(r => r.json()).then((d: { result: { requestId: string; status: string; message: string } | null }) => {
      if (applyIdRef.current !== id) return;
      const res = d.result;
      if (res && res.requestId === id) setApply({ phase: res.status === 'applied' ? 'applied' : 'error', message: res.message });
      else if (Date.now() < deadline) setTimeout(() => pollFx(id, deadline), 500);
      else setApply({ phase: 'error', message: 'REAPER didn’t confirm the effect. If you recently updated Cadenzai, re-run Cadenzai_Read_Selection.lua in REAPER (Terminate the old one first), then try again.' });
    }).catch(() => { if (applyIdRef.current === id && Date.now() < deadline) setTimeout(() => pollFx(id, deadline), 500); else setApply({ phase: 'error', message: 'Could not reach the local server.' }); });
  };

  const onApply = () => {
    if (!track || !plan || busy) return;
    setApply({ phase: 'sending', message: '' });
    fetch('/api/reaper/apply-fx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackId: track.id, fx: plan.fx }) })
      .then(async r => {
        const b = await r.json().catch(() => ({})) as { requestId?: string; error?: string };
        if (r.ok && b.requestId) { applyIdRef.current = b.requestId; setApply({ phase: 'waiting', message: '' }); pollFx(b.requestId, Date.now() + 9000); }
        else setApply({ phase: 'error', message: b.error || 'REAPER could not accept the effect.' });
      })
      .catch(() => setApply({ phase: 'error', message: 'Could not reach the local server.' }));
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <p className="flex items-center gap-2 text-xs font-medium text-zinc-300"><Wand2 size={14} className="text-amber-300" /> Describe an effect</p>
      {!track
        ? <p className="mt-2 text-[11px] text-zinc-500">Select exactly one track in REAPER to add an effect to it.</p>
        : <>
            <p className="mt-1 text-[11px] text-zinc-500">For <span className="text-zinc-300">{track.name}</span> — say what you want (e.g. “add an echo”, “give this some reverb”, “glue this together”). Cadenzai reaches for the right REAPER plugin; you approve before anything is added.</p>
            <input
              value={desc}
              onChange={e => { setDesc(e.target.value); if (apply.phase !== 'idle') clearApply(); }}
              onKeyDown={e => { if (e.key === 'Enter' && plan && !busy) onApply(); }}
              placeholder="add an echo to this…"
              className="mt-2 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
            {desc.trim() && (plan
              ? <div className="mt-2 text-[11px] leading-relaxed">
                  <p><span className="font-medium text-zinc-200">{plan.title}:</span> <span className="text-zinc-400">{plan.what}</span></p>
                  <p className="mt-0.5 text-zinc-500">{plan.knobs}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <button onClick={onApply} disabled={busy}
                      className="rounded bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-zinc-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50">
                      Add it in REAPER
                    </button>
                    {busy
                      ? <span className="flex items-center gap-1.5 text-cyan-300"><Loader2 size={13} className="animate-spin" /> Adding it in REAPER…</span>
                      : apply.phase === 'applied'
                        ? <span className="flex items-center gap-1.5 text-green-400"><CheckCircle2 size={13} /> {apply.message} It’s on {track.name} at its default — dial the targets above to get the sound, or Ctrl+Z in REAPER to undo.</span>
                        : apply.phase === 'error'
                          ? <span className="flex items-center gap-1.5 text-amber-300"><AlertTriangle size={13} /> {apply.message}</span>
                          : <span className="text-zinc-500">Adds just this one effect, only when you click — undoable in REAPER.</span>}
                  </div>
                </div>
              : <p className="mt-2 text-[11px] text-zinc-500">So far I can add <span className="text-zinc-300">echo</span>, <span className="text-zinc-300">reverb</span>, or <span className="text-zinc-300">compression</span>. Try “add an echo”. (Exact settings and more effects are coming.)</p>)}
          </>}
    </div>
  );
}
