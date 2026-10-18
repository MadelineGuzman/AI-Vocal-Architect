import { useState, useRef, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Activity, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { ReaperState, LevelMetrics } from '../types/reaper';
import type { AnalyzeView, SpectrumEntry } from './ReaperConnection';

const format = (value: number | undefined, unit: string) => value === undefined ? '—' : value.toFixed(1) + ' ' + unit;

// Plain-language account of what the current REAPER selection means for analysis.
function selectionHint(state: ReaperState): string {
  if (state.status !== 'connected') return 'Connect the REAPER bridge to analyze a selection.';
  const tracks = state.snapshot?.tracks ?? [];
  if (tracks.length === 0) return 'In REAPER, select one audio item and its track, then click Analyze. The whole item is measured unless you drag a time selection over part of it.';
  if (tracks.length > 1) return 'Select exactly one track in REAPER to analyze.';
  if (tracks[0].isMaster) return 'Select a recording track in REAPER, not the master.';
  return `Ready to measure “${tracks[0].name || 'Unnamed track'}”. Select one audio item on it — the whole item is measured unless you drag a time selection over part of it.`;
}

function StatusLine({ analyze }: { analyze: AnalyzeView }) {
  const { phase, message, progress } = analyze;
  if (phase === 'idle') return null;
  const base = 'mt-3 flex items-center gap-2 text-xs';
  if (phase === 'sending' || phase === 'waiting') {
    return <p className={base + ' text-cyan-300'} role="status"><Loader2 size={14} className="animate-spin" /> {phase === 'sending' ? 'Sending request to REAPER…' : 'Request sent — waiting for REAPER to acknowledge…'}</p>;
  }
  if (phase === 'measuring') {
    return <div className="mt-3" role="status">
      <p className="flex items-center gap-2 text-xs text-cyan-300"><Loader2 size={14} className="animate-spin" /> Measuring in REAPER… {Math.round(progress * 100)}%</p>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800"><div className="h-full rounded-full bg-cyan-400 transition-all" style={{ width: Math.round(progress * 100) + '%' }} /></div>
    </div>;
  }
  if (phase === 'complete') return <p className={base + ' text-green-400'} role="status"><CheckCircle2 size={14} /> Analysis complete.</p>;
  // rejected / error / timeout
  return <p className={base + ' text-amber-300'} role="alert"><AlertTriangle size={14} /> {message}</p>;
}

// --- Level meter: shows average level (filled) and the loudest peak (marker) on
// a -42..0 dBFS scale, with 0 (clip) and the -6 reference marked. Honest guide,
// not a verdict: colour only hints at how much headroom is left.
const METER_MIN_DB = -42;
const meterPct = (db: number) => Math.max(0, Math.min(100, ((db - METER_MIN_DB) / (0 - METER_MIN_DB)) * 100));
const peakZone = (db: number): 'hot' | 'warm' | 'good' => db >= -1 ? 'hot' : db >= -6 ? 'warm' : 'good';
const ZONE_COLOR: Record<'hot' | 'warm' | 'good', string> = { hot: '#f87171', warm: '#fbbf24', good: '#2dd4bf' };
const ZONE_LABEL: Record<'hot' | 'warm' | 'good', string> = { hot: 'very little headroom', warm: 'getting hot', good: 'comfortable headroom' };

function LevelMeter({ peak, rms }: { peak: number; rms: number }) {
  const zone = peakZone(peak);
  return (
    <div>
      <div className="relative h-8 w-full overflow-hidden rounded-md bg-zinc-800" role="img" aria-label={`Peak ${peak.toFixed(1)} dBFS, average ${rms.toFixed(1)} dBFS, on a -42 to 0 dBFS scale`}>
        {/* hot zone shading near 0 dBFS */}
        <div className="absolute inset-y-0 right-0" style={{ width: (100 - meterPct(-6)) + '%', background: 'linear-gradient(to right, transparent, rgba(248,113,113,0.22))' }} />
        {/* average level fill */}
        <div className="absolute inset-y-0 left-0 bg-cyan-500/30" style={{ width: meterPct(rms) + '%' }} />
        {/* -6 dBFS reference tick */}
        <div className="absolute inset-y-0 w-px bg-zinc-500/80" style={{ left: meterPct(-6) + '%' }} />
        {/* peak marker */}
        <div className="absolute inset-y-0 w-[3px] rounded" style={{ left: `calc(${meterPct(peak)}% - 1.5px)`, background: ZONE_COLOR[zone] }} />
      </div>
      <div className="relative mt-1 h-3 text-[10px] text-zinc-500">
        <span className="absolute left-0">−42</span>
        <span className="absolute -translate-x-1/2" style={{ left: meterPct(-6) + '%' }}>−6 ref</span>
        <span className="absolute right-0 font-medium text-red-400">0 · clip</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px]">
        <span className="flex items-center gap-1.5" style={{ color: ZONE_COLOR[zone] }}><span className="inline-block h-2.5 w-[3px] rounded" style={{ background: ZONE_COLOR[zone] }} /> Peak {peak.toFixed(1)} dBFS · {ZONE_LABEL[zone]}</span>
        <span className="flex items-center gap-1.5 text-cyan-300"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-cyan-500/40" /> Average {rms.toFixed(1)} dBFS</span>
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">The filled bar is your average level; the line is your loudest peak. Closer to 0 means less headroom — −6 is your personal reference, not a target.</p>
    </div>
  );
}

// Loudness over time: each bin coloured by its loudest peak — blue (quiet) to
// red (near clipping) — so the shape of the song is visible at a glance.
function loudnessColor(db: number): string {
  if (db >= -1) return '#ef4444';   // red — at or near clipping
  if (db >= -4) return '#f97316';   // orange
  if (db >= -9) return '#f59e0b';   // amber — getting hot
  if (db >= -18) return '#84cc16';  // lime — healthy
  if (db >= -30) return '#14b8a6';  // teal
  if (db >= -48) return '#3b82f6';  // blue — quiet
  return '#1e3a8a';                 // deep blue — near silence
}

function levelWord(db: number): string {
  if (db >= -1) return 'near clipping';
  if (db >= -4) return 'very hot';
  if (db >= -9) return 'hot';
  if (db >= -18) return 'healthy';
  if (db >= -30) return 'quiet';
  return 'very quiet';
}

function LoudnessWaveform({ envelope, startSeconds, endSeconds }: { envelope: number[]; startSeconds: number; endSeconds: number }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [jumped, setJumped] = useState<boolean | null>(null);
  const n = envelope.length;
  const span = Math.max(0, endSeconds - startSeconds);
  const W = 1000, H = 120, mid = H / 2;
  const barW = W / n;
  const amp = (db: number) => Math.min(1, Math.pow(10, db / 20)); // dBFS -> linear height
  const timeOf = (i: number) => startSeconds + ((i + 0.5) / n) * span;
  const select = (i: number) => {
    const next = i === selected ? null : i;
    setSelected(next);
    setJumped(null);
    if (next === null) return;
    // Navigation only: ask REAPER to move its edit cursor here. No edits.
    fetch('/api/reaper/cursor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ timeSeconds: timeOf(next) }) })
      .then(r => setJumped(r.ok)).catch(() => setJumped(false));
  };
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-28 w-full rounded-lg border border-zinc-800 bg-zinc-950" role="img" aria-label="Loudness waveform: taller and redder where louder, coloured blue (quiet) to red (near clipping)">
        <line x1={0} y1={mid} x2={W} y2={mid} stroke="#3f3f46" strokeWidth={0.5} />
        {envelope.map((db, i) => {
          const h = Math.max(0.6, amp(db) * (mid - 2));
          return <rect key={i} x={i * barW} y={mid - h} width={Math.max(barW, 0.8)} height={h * 2}
            fill={loudnessColor(db)} opacity={selected === null || selected === i ? 1 : 0.5}
            style={{ cursor: 'pointer' }} onClick={() => select(i)}>
            <title>{`${timeOf(i).toFixed(1)}s · ${db.toFixed(1)} dBFS`}</title>
          </rect>;
        })}
        {selected !== null && <line x1={selected * barW + barW / 2} y1={0} x2={selected * barW + barW / 2} y2={H} stroke="#ffffff" strokeWidth={1} opacity={0.75} />}
      </svg>
      <div className="relative mt-1 h-3 text-[10px] text-zinc-500">
        <span className="absolute left-0">{startSeconds.toFixed(1)}s</span>
        <span className="absolute right-0">{endSeconds.toFixed(1)}s</span>
      </div>
      {selected !== null
        ? <p className="mt-2 text-xs"><span className="font-medium text-zinc-200">At {timeOf(selected).toFixed(1)}s</span> · <span style={{ color: loudnessColor(envelope[selected]) }}>{envelope[selected].toFixed(1)} dBFS — {levelWord(envelope[selected])}</span><span className="text-zinc-500">{jumped === true ? ' · moved REAPER’s playhead here — press play in REAPER to hear it.' : jumped === false ? ' · go to this time in REAPER (couldn’t move the playhead — is it connected?).' : ' · go to this time in REAPER to hear it.'}</span></p>
        : <p className="mt-2 text-[11px] text-zinc-500">Your take's loudness shape — taller and redder means louder. Click any spot to read its exact time and level.</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-zinc-500">
        {([['#3b82f6', 'quiet'], ['#84cc16', 'healthy'], ['#f59e0b', 'hot'], ['#ef4444', 'near clip']] as const).map(([c, label]) =>
          <span key={label} className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} /> {label}</span>)}
      </div>
    </div>
  );
}

// Frequency / tone view. Overlays each analyzed track's relative tone curve and
// highlights where two tracks are both loud — the frequencies where they mask.
const SPECTRUM_COLORS = ['#22d3ee', '#f472b6', '#a3e635'];

// A drawn-EQ move: a region where the target curve departs from the current one.
interface EqMove { f0: number; f1: number; fc: number; db: number; bi: number }

function describeMove(m: EqMove): string {
  const verb = m.db < 0 ? 'cut' : 'boost';
  return `${verb} ${Math.abs(m.db).toFixed(1)} dB around ${m.fc >= 1000 ? (Math.round(m.fc / 100) / 10) + ' kHz' : Math.round(m.fc / 5) * 5 + ' Hz'}`;
}

function FrequencyView({ history, onClear }: { history: SpectrumEntry[]; onClear: () => void }) {
  const [pick, setPick] = useState<number | null>(null);
  const [drawOn, setDrawOn] = useState(false);
  const [target, setTarget] = useState<number[] | null>(null);
  const [apply, setApply] = useState<{ phase: 'idle' | 'sending' | 'waiting' | 'applied' | 'error'; message: string }>({ phase: 'idle', message: '' });
  const drawingRef = useRef(false);
  const lastBandRef = useRef<number | null>(null);
  const applyIdRef = useRef<string | null>(null);
  if (!history.length) return null;
  const W = 1000, H = 150, padL = 4, padR = 4, padT = 8, padB = 14;
  const fMin = 25;
  const fMax = Math.max(...history.flatMap(h => h.spectrum.map(p => p.f)), 1000);
  const liveDb = history.flatMap(h => h.spectrum.map(p => p.db)).filter(d => d > -119);
  const maxDb = liveDb.length ? Math.max(...liveDb) : 0;
  const yTop = maxDb + 3, yBot = maxDb - 66;
  const xOf = (f: number) => padL + (Math.log(Math.max(f, fMin)) - Math.log(fMin)) / (Math.log(fMax) - Math.log(fMin)) * (W - padL - padR);
  const yOf = (d: number) => padT + (yTop - Math.max(d, yBot)) / (yTop - yBot) * (H - padT - padB);
  const pathOf = (spec: { f: number; db: number }[]) => spec.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.f).toFixed(1)} ${yOf(p.db).toFixed(1)}`).join(' ');
  const peakOf = (spec: { f: number; db: number }[]) => spec.reduce((best, p) => p.db > best.db ? p : best, spec[0]);
  const atFreq = (spec: { f: number; db: number }[], f: number) => spec.reduce((best, p) => Math.abs(Math.log(p.f / f)) < Math.abs(Math.log(best.f / f)) ? p : best, spec[0]);
  const fmtF = (f: number) => f >= 1000 ? (Math.round(f / 100) / 10) + ' kHz' : Math.round(f / 5) * 5 + ' Hz';

  // Draw-to-EQ targets the primary (most recent) track's tone curve.
  const primary = history[0];
  const spec = primary.spectrum;
  const nearestBand = (f: number) => {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < spec.length; i++) { const d = Math.abs(Math.log(spec[i].f / f)); if (d < bd) { bd = d; bi = i; } }
    return bi;
  };
  const freqFromX = (clientX: number, rect: DOMRect) => {
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const lx = Math.max(0, Math.min(1, (t * W - padL) / (W - padL - padR)));
    return fMin * Math.pow(fMax / fMin, lx);
  };
  const dbFromY = (clientY: number, rect: DOMRect) => {
    const svgY = ((clientY - rect.top) / rect.height) * H;
    const d = yTop - ((svgY - padT) / (H - padT - padB)) * (yTop - yBot);
    return Math.max(yBot, Math.min(yTop, d));
  };

  const clearApply = () => { applyIdRef.current = null; setApply({ phase: 'idle', message: '' }); };
  const startDraw = () => { setPick(null); setTarget(spec.map(p => p.db)); setDrawOn(true); clearApply(); };
  const stopDraw = () => { setDrawOn(false); drawingRef.current = false; lastBandRef.current = null; clearApply(); };
  const resetDraw = () => { setTarget(spec.map(p => p.db)); clearApply(); };

  const applyAt = (e: ReactPointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const b = nearestBand(freqFromX(e.clientX, rect));
    const d = dbFromY(e.clientY, rect);
    setTarget(prev => {
      const next = (prev ?? spec.map(p => p.db)).slice();
      const last = lastBandRef.current;
      if (last === null || last === b) { next[b] = d; }
      else { // fill the bands the pointer skipped so a quick drag draws a continuous line
        const lo = Math.min(last, b), hi = Math.max(last, b);
        const dLo = last < b ? next[last] : d, dHi = last < b ? d : next[last];
        for (let i = lo; i <= hi; i++) next[i] = dLo + (dHi - dLo) * ((i - lo) / (hi - lo));
      }
      return next;
    });
    lastBandRef.current = b;
  };
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => { if (!drawOn) return; drawingRef.current = true; lastBandRef.current = null; if (apply.phase !== 'idle') clearApply(); e.currentTarget.setPointerCapture?.(e.pointerId); applyAt(e); };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => { if (drawOn && drawingRef.current) applyAt(e); };
  const endStroke = () => { drawingRef.current = false; lastBandRef.current = null; };

  // Group the drawn target's departures from the current curve into EQ moves.
  const tgt = drawOn ? (target ?? spec.map(p => p.db)) : null;
  const moves: EqMove[] = [];
  if (tgt) {
    let i = 0;
    while (i < spec.length) {
      const sign = (d: number) => d > 1.5 ? 1 : d < -1.5 ? -1 : 0;
      const s = sign(tgt[i] - spec[i].db);
      if (s === 0) { i++; continue; }
      let j = i, peak = i;
      while (j < spec.length && sign(tgt[j] - spec[j].db) === s) {
        if (Math.abs(tgt[j] - spec[j].db) > Math.abs(tgt[peak] - spec[peak].db)) peak = j;
        j++;
      }
      moves.push({ f0: spec[i].f, f1: spec[j - 1].f, fc: spec[peak].f, db: tgt[peak] - spec[peak].db, bi: peak });
      i = j;
    }
  }
  const topMoves = moves.slice().sort((a, b) => Math.abs(b.db) - Math.abs(a.db)).slice(0, 4);

  // Turn the drawn regions into parametric bell bands: center = region's peak
  // frequency, gain = its peak departure, Q from its width in octaves.
  const buildBands = () => moves.slice().sort((a, b) => Math.abs(b.db) - Math.abs(a.db)).slice(0, 16).map(m => {
    const bw = Math.max(0.17, Math.log2(Math.max(m.f1, m.f0 + 1) / m.f0));
    const twoBw = Math.pow(2, bw);
    const q = Math.min(8, Math.max(0.3, Math.sqrt(twoBw) / (twoBw - 1)));
    return { f: Math.round(m.fc), g: Math.max(-36, Math.min(36, Math.round(m.db * 10) / 10)), q: Math.round(q * 100) / 100 };
  });

  const canApply = Boolean(primary.trackId) && moves.length > 0;
  // Poll the bridge's echoed outcome until it matches this request or times out.
  const pollEq = (id: string, deadline: number) => {
    if (applyIdRef.current !== id) return;
    fetch('/api/reaper/eq-result', { cache: 'no-store' }).then(r => r.json()).then((d: { result: { requestId: string; status: string; message: string } | null }) => {
      if (applyIdRef.current !== id) return;
      const res = d.result;
      if (res && res.requestId === id) {
        setApply({ phase: res.status === 'applied' ? 'applied' : 'error', message: res.message });
      } else if (Date.now() < deadline) {
        setTimeout(() => pollEq(id, deadline), 500);
      } else {
        setApply({ phase: 'error', message: 'REAPER didn’t confirm the EQ. Make sure the Cadenzai bridge is running, then try again.' });
      }
    }).catch(() => { if (applyIdRef.current === id && Date.now() < deadline) setTimeout(() => pollEq(id, deadline), 500); else setApply({ phase: 'error', message: 'Could not reach the local server.' }); });
  };
  const onApply = () => {
    if (!canApply) return;
    setApply({ phase: 'sending', message: '' });
    fetch('/api/reaper/apply-eq', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackId: primary.trackId, bands: buildBands() }) })
      .then(async r => {
        const b = await r.json().catch(() => ({})) as { requestId?: string; error?: string };
        if (r.ok && b.requestId) { applyIdRef.current = b.requestId; setApply({ phase: 'waiting', message: '' }); pollEq(b.requestId, Date.now() + 9000); }
        else setApply({ phase: 'error', message: b.error || 'REAPER could not accept the EQ.' });
      })
      .catch(() => setApply({ phase: 'error', message: 'Could not reach the local server.' }));
  };

  const overlaps: { x0: number; x1: number }[] = [];
  if (history.length >= 2 && !drawOn) {
    const a = history[0].spectrum, b = history[1].spectrum;
    const maxA = Math.max(...a.map(p => p.db)), maxB = Math.max(...b.map(p => p.db));
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (a[i].db > maxA - 15 && b[i].db > maxB - 15 && a[i].db > -100 && b[i].db > -100) {
        const f0 = i > 0 ? Math.sqrt(a[i].f * a[i - 1].f) : fMin;
        const f1 = i < n - 1 ? Math.sqrt(a[i].f * a[i + 1].f) : fMax;
        overlaps.push({ x0: xOf(f0), x1: xOf(f1) });
      }
    }
  }
  const ticks = [50, 100, 200, 500, 1000, 2000, 5000, 10000].filter(f => f >= fMin && f <= fMax);

  const onPick = (e: MouseEvent<SVGSVGElement>) => {
    if (drawOn) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const lx = Math.max(0, Math.min(1, (t * W - padL) / (W - padL - padR)));
    setPick(fMin * Math.pow(fMax / fMin, lx));
  };

  // "Which is louder here, and which should I carve?" readout for the clicked frequency.
  let readout: ReactNode = null;
  if (pick !== null && !drawOn) {
    const rows = history.map((h, idx) => ({ track: h.track, db: atFreq(h.spectrum, pick).db, color: SPECTRUM_COLORS[idx] ?? '#a1a1aa' }))
      .filter(r => r.db > -100).sort((x, y) => y.db - x.db);
    if (rows.length >= 2) {
      readout = <>
        <span className="font-medium text-zinc-200">At {fmtF(pick)}</span> — {rows.map((r, i) => <span key={r.track}><span style={{ color: r.color }}>{r.track} {r.db.toFixed(1)} dB</span>{i < rows.length - 1 ? ', ' : ''}</span>)}.{' '}
        <span className="text-zinc-300">{rows[0].track} is {(rows[0].db - rows[1].db).toFixed(0)} dB louder here.</span>{' '}
        <span className="text-zinc-500">To make room for {rows[1].track}, dip {rows[0].track} around here; if {rows[0].track} should lead, leave it. Your call.</span>
      </>;
    } else if (rows.length === 1) {
      readout = <><span className="font-medium text-zinc-200">At {fmtF(pick)}</span> — <span style={{ color: rows[0].color }}>{rows[0].track} {rows[0].db.toFixed(1)} dB</span>.</>;
    } else {
      readout = <span className="text-zinc-500">At {fmtF(pick)} — nothing significant here.</span>;
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-zinc-300">Frequency / tone{drawOn ? ' · draw the shape you want' : history.length >= 2 ? ' · overlap' : ''}</p>
        <div className="flex items-center gap-2">
          {drawOn
            ? <>
                <button onClick={resetDraw} className="text-[10px] text-zinc-500 hover:text-zinc-300">reset</button>
                <button onClick={stopDraw} className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 hover:border-zinc-600">done</button>
              </>
            : <>
                {history.length >= 2 && <button onClick={onClear} className="text-[10px] text-zinc-500 hover:text-zinc-300">clear</button>}
                <button onClick={startDraw} className="rounded border border-amber-500/40 px-2 py-0.5 text-[10px] font-medium text-amber-300 hover:border-amber-500/70">Draw the tone you want</button>
              </>}
        </div>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-36 w-full rounded-lg border border-zinc-800 bg-zinc-950" style={{ cursor: 'crosshair', touchAction: 'none' }}
          onClick={onPick} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endStroke} onPointerLeave={endStroke}
          role="img" aria-label={drawOn ? 'Draw a target tone curve by dragging. Cadenzai reads off the EQ moves; it changes nothing.' : 'Frequency tone curves; red bands show where two tracks overlap. Click to compare levels.'}>
          {overlaps.map((o, i) => <rect key={i} x={o.x0} y={padT} width={Math.max(0.5, o.x1 - o.x0)} height={H - padT - padB} fill="#ef4444" opacity={0.14} />)}
          {ticks.map(f => <line key={f} x1={xOf(f)} y1={padT} x2={xOf(f)} y2={H - padB} stroke="#27272a" strokeWidth={0.75} />)}
          {history.map((h, idx) => <path key={h.id} d={pathOf(h.spectrum)} fill="none" stroke={SPECTRUM_COLORS[idx] ?? '#a1a1aa'} strokeWidth={idx === 0 ? 2.5 : 1.75} opacity={drawOn && idx !== 0 ? 0.3 : idx === 0 ? 1 : 0.8} />)}
          {/* The drawn target, and a marker over each main move so the change is visible on the curve. */}
          {tgt && <path d={pathOf(spec.map((p, i) => ({ f: p.f, db: tgt[i] })))} fill="none" stroke="#f8fafc" strokeWidth={2} strokeDasharray="5 3" opacity={0.95} />}
          {tgt && topMoves.map(m => {
            const x = xOf(m.fc), color = m.db < 0 ? '#f87171' : '#4ade80';
            return <g key={m.fc}><line x1={x} y1={yOf(spec[m.bi].db)} x2={x} y2={yOf(tgt[m.bi])} stroke={color} strokeWidth={2} /><circle cx={x} cy={yOf(tgt[m.bi])} r={3} fill={color} /></g>;
          })}
          {pick !== null && !drawOn && <line x1={xOf(pick)} y1={padT} x2={xOf(pick)} y2={H - padB} stroke="#ffffff" strokeWidth={1} opacity={0.6} />}
        </svg>
        {/* Direct labels so it is obvious which curve is which, placed over each curve's peak. */}
        {!drawOn && history.map((h, idx) => <span key={h.id} className="pointer-events-none absolute whitespace-nowrap rounded bg-zinc-950/70 px-1 text-[10px] font-semibold" style={{ left: `${xOf(peakOf(h.spectrum).f) / W * 100}%`, top: `${4 + idx * 14}px`, transform: 'translateX(-50%)', color: SPECTRUM_COLORS[idx] ?? '#a1a1aa' }}>{h.track}</span>)}
        {/* dB labels on the drawn moves. */}
        {tgt && topMoves.map(m => <span key={m.fc} className="pointer-events-none absolute whitespace-nowrap rounded bg-zinc-950/80 px-1 text-[10px] font-bold" style={{ left: `${xOf(m.fc) / W * 100}%`, top: `${yOf(tgt[m.bi]) / H * 100}%`, transform: 'translate(-50%, -140%)', color: m.db < 0 ? '#f87171' : '#4ade80' }}>{m.db > 0 ? '+' : '−'}{Math.abs(m.db).toFixed(0)}</span>)}
      </div>
      <div className="relative mt-1 h-3 text-[10px] text-zinc-500">
        {ticks.map(f => <span key={f} className="absolute -translate-x-1/2" style={{ left: (xOf(f) / W * 100) + '%' }}>{f >= 1000 ? (f / 1000) + 'k' : f}</span>)}
      </div>
      {drawOn
        ? <div className="mt-2 text-[11px] leading-relaxed">
            {moves.length
              ? <>
                  <p><span className="font-medium text-zinc-200">EQ to get this shape on {primary.track}:</span> {topMoves.map((m, i) => <span key={m.fc}><span style={{ color: m.db < 0 ? '#f87171' : '#4ade80' }}>{describeMove(m)}</span>{i < topMoves.length - 1 ? '; ' : ''}</span>)}.</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <button onClick={onApply} disabled={!canApply || apply.phase === 'sending' || apply.phase === 'waiting'}
                      className="rounded bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-zinc-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50">
                      Apply in REAPER
                    </button>
                    {apply.phase === 'sending' || apply.phase === 'waiting'
                      ? <span className="flex items-center gap-1.5 text-cyan-300"><Loader2 size={13} className="animate-spin" /> Adding the EQ in REAPER…</span>
                      : apply.phase === 'applied'
                        ? <span className="flex items-center gap-1.5 text-green-400"><CheckCircle2 size={13} /> {apply.message} Hear it on {primary.track}, tweak it, or press Ctrl+Z in REAPER to undo.</span>
                        : apply.phase === 'error'
                          ? <span className="flex items-center gap-1.5 text-amber-300"><AlertTriangle size={13} /> {apply.message}</span>
                          : <span className="text-zinc-500">Builds one “Cadenzai EQ” on this track — only when you click, undoable in REAPER.</span>}
                  </div>
                  {!primary.trackId && <p className="mt-1 text-zinc-500">Re-analyze this track from REAPER to enable one-click apply.</p>}
                </>
              : <p className="text-zinc-500">Drag across the graph to draw the tone you want — pull a region down to thin it, push it up to bring it out. Cadenzai reads off the exact EQ moves, and only writes to REAPER when you click Apply.</p>}
          </div>
        : <p className="mt-2 text-[11px] leading-relaxed">{readout ?? <span className="text-zinc-500">{history.length >= 2 ? 'Red bands are where both tracks are loud — where they mask each other. Click a spot to see which is louder and which to carve.' : 'Your track’s tone. Click any spot to read its level, or draw the tone you want to see the EQ that gets there.'}</span>}</p>}
    </div>
  );
}

function Results({ report, metrics, current, spectra, onClearSpectra }: { report: NonNullable<ReaperState['levels']>; metrics: LevelMetrics; current: boolean; spectra: SpectrumEntry[]; onClearSpectra: () => void }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-sm font-medium text-zinc-200">{report.trackName} / {report.takeName || 'Unnamed take'}</p>
        <p className="text-zinc-500">{report.startSeconds.toFixed(2)}–{report.endSeconds.toFixed(2)} s · {report.channels === 1 ? 'Mono' : 'Stereo'} · {report.sampleRate.toLocaleString()} Hz</p>
      </div>
      {!current && <p className="text-amber-300">Historical result. The connection, project, track selection, or project revision no longer matches. Rerun for a current measurement.</p>}

      {metrics.silent ? (
        <p className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-zinc-300">Silence — there was no measurable level in this selection.</p>
      ) : <>
        {/* at-a-glance verdict */}
        {metrics.samplesAtFullScale > 0
          ? <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300"><AlertTriangle size={16} /> {metrics.samplesAtFullScale} sample{metrics.samplesAtFullScale === 1 ? '' : 's'} reached 0 dBFS — check this part for overload.</div>
          : <div className="flex items-center gap-2 rounded-lg border border-green-500/25 bg-green-500/10 px-3 py-2.5 text-sm text-green-300"><CheckCircle2 size={16} /> No samples reached 0 dBFS — you have headroom.</div>}

        {/* Time (loudness) and tone (frequency) side by side. */}
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <p className="mb-2 text-xs font-medium text-zinc-300">Loudness over time</p>
            {metrics.envelope && metrics.envelope.length > 1
              ? <LoudnessWaveform envelope={metrics.envelope} startSeconds={report.startSeconds} endSeconds={report.endSeconds} />
              : <LevelMeter peak={metrics.samplePeakDbfs!} rms={metrics.rmsDbfs!} />}
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            {spectra.length > 0
              ? <FrequencyView history={spectra} onClear={onClearSpectra} />
              : <div className="flex h-full min-h-[160px] items-center justify-center text-center text-[11px] text-zinc-600">Tone / frequency appears here after analyzing. If it stays empty, reload the bridge in REAPER to enable it.</div>}
          </div>
        </div>

        {/* the numbers, in boxes */}
        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            ['Sample peak', format(metrics.samplePeakDbfs, 'dBFS'), ZONE_COLOR[peakZone(metrics.samplePeakDbfs!)]],
            ['Average RMS', format(metrics.rmsDbfs, 'dBFS'), undefined],
            ['Peak above average', format(metrics.crestDb, 'dB'), undefined],
            ['Active level variation', format(metrics.activeVariationDb, 'dB'), undefined],
          ].map(([label, value, color]) => <div key={label as string} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3"><dt className="text-zinc-400">{label}</dt><dd className="mt-1 text-base font-semibold" style={{ color: (color as string) || '#67e8f9' }}>{value}</dd></div>)}
        </dl>

        {/* fine print, hidden by default */}
        <details className="text-[11px] text-zinc-500">
          <summary className="cursor-pointer select-none py-1 text-xs text-zinc-400 hover:text-zinc-200">What these numbers mean</summary>
          <div className="mt-2 space-y-2 border-l border-zinc-800 pl-3">
            <p>No measured channel samples reaching 0 dBFS does not rule out intersample peaks or earlier clipping.</p>
            <p>RMS is unweighted average energy, not LUFS. “Peak above average” (crest) is how far your loudest peak sits above the average — a rough sense of how punchy vs. squashed it is.</p>
            <p>Active level variation is the 90th–10th percentile spread of complete 400 ms RMS windows above −60 dBFS; fewer than two active windows gives no estimate. This is one take, not the track mix or master output.</p>
            <p>A −6 dBFS peak can be a personal headroom reference, not a loudness requirement. Compare in context before changing gain; expressive level changes may be intentional.</p>
            <p>Measured {new Date(report.updatedAt).toLocaleString()} · {report.sampleRate.toLocaleString()} Hz · sample peak, not true peak.</p>
          </div>
        </details>
      </>}
    </div>
  );
}

export function ReaperLevels({ state, analyze, spectra, onClearSpectra }: { state: ReaperState; analyze: AnalyzeView; spectra: SpectrumEntry[]; onClearSpectra: () => void }) {
  const report = state.levels;
  const sameProject = report && state.snapshot?.project.sessionId === report.projectId;
  const sameTrack = report && state.snapshot?.tracks.length === 1 && state.snapshot.tracks[0].id === report.trackId;
  const current = Boolean(state.status === 'connected' && sameProject && sameTrack && state.snapshot?.revision === report?.projectRevision);
  const metrics = report?.metrics;
  return (
    <div className="space-y-4 text-xs text-zinc-400">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-zinc-200 font-medium">Analyze selected section</p>
            <p className="mt-0.5 text-zinc-500">{selectionHint(state)}</p>
          </div>
          <button
            onClick={analyze.onAnalyze}
            disabled={!analyze.canAnalyze}
            className="flex shrink-0 items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-xs font-medium text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-cyan-600"
          >
            {analyze.phase === 'sending' || analyze.phase === 'waiting' || analyze.phase === 'measuring'
              ? <><Loader2 size={14} className="animate-spin" /> Analyzing…</>
              : <><Activity size={14} /> Analyze selected section</>}
          </button>
        </div>
        <StatusLine analyze={analyze} />
        <p className="mt-3 text-[11px] text-zinc-500">Read-only · measures the selected take before effects · no gain changes · samples stay in REAPER.</p>
      </div>

      {state.levelsNotice && <section role="status" className="rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-5">
        <p className="text-xs font-medium uppercase tracking-widest text-cyan-300">Recording level check</p>
        <h3 className="mt-2 text-lg font-semibold text-zinc-100">One step before we can measure</h3>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-300">{state.levelsNotice.message}</p>
        <p className="mt-3 text-xs text-zinc-500">Your audio is unchanged. Check attempted {new Date(state.levelsNotice.updatedAt).toLocaleString()}.</p>
      </section>}
      {state.levelsError && <p role="alert" className="text-amber-300">{state.levelsError}</p>}
      {report
        ? (report.status === 'running'
            ? <p role="status" className="text-cyan-300">Measuring… {Math.round(report.progress * 100)}%</p>
            : report.status === 'error'
              ? <p role="alert" className="text-amber-300">{report.message}</p>
              : metrics && <Results report={report} metrics={metrics} current={current} spectra={spectra} onClearSpectra={onClearSpectra} />)
        : !state.levelsNotice && <p className="text-zinc-600">Select audio in REAPER and click Analyze — your loudness waveform and tone curve appear here.</p>}
    </div>
  );
}
