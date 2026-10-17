import { Activity, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { ReaperState, LevelMetrics } from '../types/reaper';
import type { AnalyzeView } from './ReaperConnection';

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

function LoudnessStrip({ envelope, startSeconds, endSeconds }: { envelope: number[]; startSeconds: number; endSeconds: number }) {
  const span = Math.max(0, endSeconds - startSeconds);
  const n = envelope.length;
  return (
    <div>
      <div className="flex h-16 w-full overflow-hidden rounded-lg border border-zinc-800" role="img" aria-label="Loudness over time, coloured from blue (quiet) to red (near clipping)">
        {envelope.map((db, i) => {
          const t = startSeconds + ((i + 0.5) / n) * span;
          return <div key={i} className="h-full flex-1" style={{ backgroundColor: loudnessColor(db) }} title={`${t.toFixed(1)}s · ${db.toFixed(1)} dBFS`} />;
        })}
      </div>
      <div className="relative mt-1 h-3 text-[10px] text-zinc-500">
        <span className="absolute left-0">{startSeconds.toFixed(1)}s</span>
        <span className="absolute right-0">{endSeconds.toFixed(1)}s</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-zinc-500">
        {([['#3b82f6', 'quiet'], ['#84cc16', 'healthy'], ['#f59e0b', 'hot'], ['#ef4444', 'near clip']] as const).map(([c, label]) =>
          <span key={label} className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} /> {label}</span>)}
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">Each slice is a moment of the take, coloured by its loudest peak — red is near clipping, blue is quiet. Hover a slice for its time and level.</p>
    </div>
  );
}

function Results({ report, metrics, current }: { report: NonNullable<ReaperState['levels']>; metrics: LevelMetrics; current: boolean }) {
  return (
    <div className="mt-3 max-h-80 overflow-y-auto space-y-4">
      <p className="text-zinc-300">{report.trackName} / {report.takeName || 'Unnamed take'} · {report.startSeconds.toFixed(2)}–{report.endSeconds.toFixed(2)} s · {report.channels === 1 ? 'Mono' : 'Stereo'}</p>
      {!current && <p className="text-amber-300">Historical result. The connection, project, track selection, or project revision no longer matches. Rerun for a current measurement.</p>}

      {metrics.silent ? (
        <p className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-zinc-300">Silence — there was no measurable level in this selection.</p>
      ) : <>
        {/* at-a-glance verdict */}
        {metrics.samplesAtFullScale > 0
          ? <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300"><AlertTriangle size={16} /> {metrics.samplesAtFullScale} sample{metrics.samplesAtFullScale === 1 ? '' : 's'} reached 0 dBFS — check this part for overload.</div>
          : <div className="flex items-center gap-2 rounded-lg border border-green-500/25 bg-green-500/10 px-3 py-2.5 text-sm text-green-300"><CheckCircle2 size={16} /> No samples reached 0 dBFS — you have headroom.</div>}

        {metrics.envelope && metrics.envelope.length > 1
          ? <LoudnessStrip envelope={metrics.envelope} startSeconds={report.startSeconds} endSeconds={report.endSeconds} />
          : <LevelMeter peak={metrics.samplePeakDbfs!} rms={metrics.rmsDbfs!} />}

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

export function ReaperLevels({ state, analyze }: { state: ReaperState; analyze: AnalyzeView }) {
  const report = state.levels;
  const sameProject = report && state.snapshot?.project.sessionId === report.projectId;
  const sameTrack = report && state.snapshot?.tracks.length === 1 && state.snapshot.tracks[0].id === report.trackId;
  const current = Boolean(state.status === 'connected' && sameProject && sameTrack && state.snapshot?.revision === report?.projectRevision);
  const metrics = report?.metrics;
  return <details className="mt-3 border-t border-zinc-800 pt-2 text-xs text-zinc-400" open={Boolean(report || state.levelsNotice || analyze.phase !== 'idle')}>
    <summary className="cursor-pointer py-1 font-medium text-zinc-200">Recording level check{report ? ' · ' + (current ? report.status : 'previous snapshot') : ''}</summary>

    <div className="mt-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
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

    {state.levelsNotice && <section role="status" className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-5">
      <p className="text-xs font-medium uppercase tracking-widest text-cyan-300">Recording level check</p>
      <h3 className="mt-2 text-lg font-semibold text-zinc-100">One step before we can measure</h3>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-300">{state.levelsNotice.message}</p>
      <p className="mt-3 text-xs text-zinc-500">Your audio is unchanged. Check attempted {new Date(state.levelsNotice.updatedAt).toLocaleString()}.</p>
    </section>}
    {state.levelsError && <p role="alert" className="mt-2 text-amber-300">{state.levelsError}</p>}
    {report && (report.status === 'running'
      ? <div className="mt-3" role="status">Measuring… {Math.round(report.progress * 100)}%</div>
      : report.status === 'error'
        ? <p role="alert" className="mt-3 text-amber-300">{report.message}</p>
        : metrics && <Results report={report} metrics={metrics} current={current} />)}
  </details>;
}
