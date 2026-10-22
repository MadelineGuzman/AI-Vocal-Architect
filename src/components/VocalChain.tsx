import { useMemo, useRef, useState } from 'react';
import { Sparkles, Copy, Check, Wrench, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { generateChain, chainToText, CHAIN_ORDER, PRESET_OPTIONS, PLUGIN_MAP } from '../lib/vocalChain';

// Vocal Architect: type a vibe/style → a full DAW-aware vocal chain (EQ, comp,
// de-ess, saturation, delay, reverb) with settings and the "why" + "listen for".
// Ported from the earlier app. Settings are starting points, not final mixes.
// When REAPER is connected, "Build in REAPER" lands the EQ (with real values) and
// drops in the effect rack in one undo block; the time-based FX come in at default
// with the target settings shown to dial.
const DAWS = Object.keys(PLUGIN_MAP);

export function VocalChain({ track }: { track: { id: string; name: string } | null }) {
  const [style, setStyle] = useState('');
  const [intensity, setIntensity] = useState(5);
  const [daw, setDaw] = useState('REAPER');
  const [copied, setCopied] = useState(false);
  const [build, setBuild] = useState<{ phase: 'idle' | 'sending' | 'waiting' | 'applied' | 'error'; message: string }>({ phase: 'idle', message: '' });
  const buildIdRef = useRef<string | null>(null);

  const chain = useMemo(() => (style.trim() ? generateChain({ style, daw, intensity }) : null), [style, daw, intensity]);
  const buildBusy = build.phase === 'sending' || build.phase === 'waiting';
  // Build in REAPER only makes sense for the REAPER chain on a selected track.
  const canBuild = Boolean(track) && daw === 'REAPER' && Boolean(chain);

  const copy = () => {
    if (!chain) return;
    try { void navigator.clipboard.writeText(chainToText(chain)); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { /* clipboard unavailable */ }
  };

  const pollChain = (id: string, deadline: number) => {
    if (buildIdRef.current !== id) return;
    fetch('/api/reaper/chain-result', { cache: 'no-store' }).then(r => r.json()).then((d: { result: { requestId: string; status: string; message: string } | null }) => {
      if (buildIdRef.current !== id) return;
      const res = d.result;
      if (res && res.requestId === id) setBuild({ phase: res.status === 'applied' ? 'applied' : 'error', message: res.message });
      else if (Date.now() < deadline) setTimeout(() => pollChain(id, deadline), 500);
      else setBuild({ phase: 'error', message: 'REAPER didn’t confirm the chain. If you recently updated Cadenzai, re-run Cadenzai_Read_Selection.lua (Terminate the old one first), then try again.' });
    }).catch(() => { if (buildIdRef.current === id && Date.now() < deadline) setTimeout(() => pollChain(id, deadline), 500); else setBuild({ phase: 'error', message: 'Could not reach the local server.' }); });
  };

  const onBuild = () => {
    if (!track || !chain || buildBusy) return;
    const bands = chain.eq.moves.map(m => ({ f: Math.round(m.frequency), g: Math.round(m.gain * 10) / 10, q: m.q }));
    setBuild({ phase: 'sending', message: '' });
    fetch('/api/reaper/apply-chain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackId: track.id, hpf: chain.eq.hpf, bands, fx: ['ReaComp', 'ReaDelay', 'ReaVerbate'], profile: chain.profile }) })
      .then(async r => {
        const b = await r.json().catch(() => ({})) as { requestId?: string; error?: string };
        if (r.ok && b.requestId) { buildIdRef.current = b.requestId; setBuild({ phase: 'waiting', message: '' }); pollChain(b.requestId, Date.now() + 9000); }
        else setBuild({ phase: 'error', message: b.error || 'REAPER could not accept the chain.' });
      })
      .catch(() => setBuild({ phase: 'error', message: 'Could not reach the local server.' }));
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs font-semibold text-zinc-200"><Sparkles size={14} className="text-amber-300" /> Vocal chain from a vibe</p>
        <select value={daw} onChange={e => setDaw(e.target.value)} aria-label="DAW" className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300 focus:border-zinc-600 focus:outline-none">
          {DAWS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">Say the vibe and Cadenzai lays out the whole chain for it — tone, dynamics, space — with settings for your DAW. Starting points, not final mixes: trust your ears.</p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={style}
          onChange={e => setStyle(e.target.value)}
          placeholder="chopped and screwed, lo-fi, smooth R&B, aggressive rap…"
          className="min-w-[14rem] flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
        />
        <label className="flex items-center gap-2 text-[11px] text-zinc-500">
          Intensity
          <input type="range" min={1} max={10} value={intensity} onChange={e => setIntensity(Number(e.target.value))} className="h-1 w-24 accent-amber-400" />
          <span className="w-4 text-zinc-300">{intensity}</span>
        </label>
      </div>

      {/* Quick-pick the known styles. */}
      <div className="mt-2 flex flex-wrap gap-1">
        {PRESET_OPTIONS.map(o => (
          <button key={o.key} onClick={() => setStyle(o.label)}
            className="rounded-full border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200">
            {o.label}
          </button>
        ))}
      </div>

      {chain && (
        <div className="mt-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-zinc-400">Matched profile: <span className="font-semibold text-amber-200">{chain.profile}</span> · {daw}</p>
            <div className="flex items-center gap-2">
              {canBuild && <button onClick={onBuild} disabled={buildBusy}
                className="flex items-center gap-1 rounded bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-zinc-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50">
                {buildBusy ? <Loader2 size={12} className="animate-spin" /> : <Wrench size={12} />} Build in REAPER
              </button>}
              <button onClick={copy} className="flex items-center gap-1 rounded border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200">
                {copied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy chain</>}
              </button>
            </div>
          </div>
          {track && daw === 'REAPER' &&
            <p className="mb-2 text-[11px]">
              {buildBusy
                ? <span className="flex items-center gap-1.5 text-cyan-300"><Loader2 size={13} className="animate-spin" /> Building the chain on {track.name} in REAPER…</span>
                : build.phase === 'applied'
                  ? <span className="flex items-center gap-1.5 text-green-400"><CheckCircle2 size={13} /> {build.message} The EQ is dialed in; set the comp / delay / reverb to the targets below. Ctrl+Z in REAPER undoes the whole thing.</span>
                  : build.phase === 'error'
                    ? <span className="flex items-center gap-1.5 text-amber-300"><AlertTriangle size={13} /> {build.message}</span>
                    : <span className="text-zinc-500">“Build in REAPER” lands the <span className="text-zinc-400">EQ with real values</span> + drops in ReaComp, ReaDelay & ReaVerbate in order — one undo block. You dial the time-based FX to the targets below.</span>}
            </p>}
          {!track && daw === 'REAPER' && <p className="mb-2 text-[11px] text-zinc-600">Select one track in REAPER to build this chain onto it.</p>}
          <ol className="space-y-2">
            {CHAIN_ORDER.map((key, i) => {
              const step = chain.steps[key];
              return (
                <li key={key} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <p className="text-xs font-medium text-zinc-200">{i + 1}. {step.name}{!step.required && <span className="text-zinc-600"> · optional</span>}</p>
                    <p className="text-[10px] text-zinc-500">{step.plugin}</p>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                    {step.settings.map(([label, value]) => (
                      <span key={label} className="text-[11px] text-zinc-400"><span className="text-zinc-500">{label}:</span> {value}</span>
                    ))}
                  </div>
                  <p className="mt-1 text-[10px] text-zinc-500">Listen for: {step.listen}</p>
                </li>
              );
            })}
          </ol>
          <p className="mt-2 text-[10px] text-zinc-600">These are preset starting points (never verified by ear) — a place to begin, not a locked mix.</p>
        </div>
      )}
    </div>
  );
}
