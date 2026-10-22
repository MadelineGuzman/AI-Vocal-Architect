import { useMemo, useState } from 'react';
import { Sparkles, Copy, Check } from 'lucide-react';
import { generateChain, chainToText, CHAIN_ORDER, PRESET_OPTIONS, PLUGIN_MAP } from '../lib/vocalChain';

// Vocal Architect: type a vibe/style → a full DAW-aware vocal chain (EQ, comp,
// de-ess, saturation, delay, reverb) with settings and the "why" + "listen for".
// Ported from the earlier app. Settings are starting points, not final mixes.
const DAWS = Object.keys(PLUGIN_MAP);

export function VocalChain() {
  const [style, setStyle] = useState('');
  const [intensity, setIntensity] = useState(5);
  const [daw, setDaw] = useState('REAPER');
  const [copied, setCopied] = useState(false);

  const chain = useMemo(() => (style.trim() ? generateChain({ style, daw, intensity }) : null), [style, daw, intensity]);

  const copy = () => {
    if (!chain) return;
    try { void navigator.clipboard.writeText(chainToText(chain)); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { /* clipboard unavailable */ }
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
            <button onClick={copy} className="flex items-center gap-1 rounded border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200">
              {copied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy chain</>}
            </button>
          </div>
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
