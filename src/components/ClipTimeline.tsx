import { useState } from 'react';
import { MousePointerClick } from 'lucide-react';

// Tap-to-point clip timeline: a clean, schematic view of the focused track's
// clips (not a pixel mirror of REAPER). Tapping a clip highlights it locally and
// selects it in REAPER so the engineer sees exactly which one — killing the
// "not that clip, THIS one" friction. Read/navigation only.
interface Clip { id: string; start: number; len: number; name: string; color: string }

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

export function ClipTimeline({ clips, connected }: { clips?: Clip[]; connected: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [tapped, setTapped] = useState<string | null>(null);
  const [nudgeMsg, setNudgeMsg] = useState<string | null>(null);

  const nudge = (deltaSeconds: number) => {
    if (!selected) return;
    fetch('/api/reaper/nudge-item', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: selected, deltaSeconds }) }).catch(() => { /* bridge no-op on failure */ });
    const ms = Math.round(deltaSeconds * 1000);
    setNudgeMsg(`Nudged ${ms < 0 ? '◄' : '►'} ${Math.abs(ms)} ms`);
    window.setTimeout(() => setNudgeMsg(null), 1500);
  };

  const list = (clips ?? []).slice().sort((a, b) => a.start - b.start);
  const min = list.length ? Math.min(...list.map(c => c.start)) : 0;
  const max = list.length ? Math.max(...list.map(c => c.start + c.len)) : 1;
  const span = Math.max(0.001, max - min);

  const tap = (c: Clip) => {
    setSelected(c.id);
    setTapped(c.name || 'that clip');
    fetch('/api/reaper/select-item', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: c.id }) }).catch(() => { /* engineer still sees nothing worse than no-op */ });
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <p className="flex items-center gap-2 text-xs font-medium text-zinc-300"><MousePointerClick size={14} className="text-amber-300" /> Your clips</p>
      {!connected
        ? <p className="mt-2 text-[11px] text-zinc-500">Waiting for REAPER…</p>
        : !list.length
          ? <p className="mt-2 text-[11px] text-zinc-500">No clips here yet — ask your engineer to select a track that has audio on it.</p>
          : <>
              <p className="mt-1 text-[11px] text-zinc-500">Tap a clip to light it up on the engineer’s screen — no more “the blue one at 1:32.”</p>
              <div className="relative mt-3 h-16 w-full overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
                {list.map(c => {
                  const left = ((c.start - min) / span) * 100;
                  const width = Math.max(0.8, (c.len / span) * 100);
                  const bg = /^#0{6}$/i.test(c.color) ? '#3f3f46' : c.color;
                  return (
                    <button
                      key={c.id}
                      onClick={() => tap(c)}
                      title={`${c.name || 'Clip'} · ${fmt(c.start)}`}
                      style={{ left: `${left}%`, width: `${width}%`, backgroundColor: bg }}
                      className={`absolute bottom-1 top-1 overflow-hidden rounded text-left transition-all ${selected === c.id ? 'ring-2 ring-white' : 'ring-1 ring-black/30 hover:ring-white/50'}`}
                    >
                      <span className="block truncate bg-black/35 px-1 py-0.5 text-[9px] font-medium text-white">{c.name || '—'}</span>
                    </button>
                  );
                })}
              </div>
              <div className="relative mt-1 h-3 text-[10px] text-zinc-600">
                <span className="absolute left-0">{fmt(min)}</span>
                <span className="absolute right-0">{fmt(max)}</span>
              </div>
              <p className="mt-1 text-[11px]">{tapped
                ? <span className="text-green-400">Pointed at “{tapped}” — it’s highlighted in REAPER.</span>
                : <span className="text-zinc-500">Tap any clip above.</span>}</p>
              {selected && <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="text-zinc-500">Slide it:</span>
                {([['◄ 100', -0.1], ['◄ 10', -0.01], ['10 ►', 0.01], ['100 ►', 0.1]] as [string, number][]).map(([lbl, d]) => (
                  <button key={lbl} onClick={() => nudge(d)} className="rounded border border-zinc-700 px-2 py-0.5 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100">{lbl} ms</button>
                ))}
                {nudgeMsg && <span className="ml-1 text-amber-300">{nudgeMsg} — it moves in REAPER.</span>}
              </div>}
            </>}
    </div>
  );
}
