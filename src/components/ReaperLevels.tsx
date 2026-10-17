import { Activity, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { ReaperState } from '../types/reaper';
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

export function ReaperLevels({ state, analyze }: { state: ReaperState; analyze: AnalyzeView }) {
  const report = state.levels;
  const sameProject = report && state.snapshot?.project.sessionId === report.projectId;
  const sameTrack = report && state.snapshot?.tracks.length === 1 && state.snapshot.tracks[0].id === report.trackId;
  const current = state.status === 'connected' && sameProject && sameTrack && state.snapshot?.revision === report?.projectRevision;
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
      <p className="mt-3 text-zinc-500">Measures the selected item the moment you click — the whole item, or just a time selection if you drag one (up to 15 minutes). Read-only · selected take before effects · no gain changes · samples stay in REAPER. You no longer need to run a second REAPER script.</p>
    </div>

    {state.levelsNotice && <section role="status" className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-5">
      <p className="text-xs font-medium uppercase tracking-widest text-cyan-300">Recording level check</p>
      <h3 className="mt-2 text-lg font-semibold text-zinc-100">One step before we can measure</h3>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-300">{state.levelsNotice.message}</p>
      <p className="mt-3 text-xs text-zinc-500">Your audio is unchanged. Check attempted {new Date(state.levelsNotice.updatedAt).toLocaleString()}.</p>
    </section>}
    {state.levelsError && <p role="alert" className="mt-2 text-amber-300">{state.levelsError}</p>}
    {report && <div className="mt-3 max-h-64 overflow-y-auto space-y-3">
      <p className="text-zinc-300">{report.trackName} / {report.takeName || 'Unnamed take'} · {report.startSeconds.toFixed(2)}–{report.endSeconds.toFixed(2)} s · {report.channels === 1 ? 'Mono' : 'Stereo'}</p>
      {!current && <p className="text-amber-300">Historical result. The connection, project, track selection, or project revision no longer matches. Rerun for a current measurement.</p>}
      {report.status === 'running' ? <div role="status">Measuring… {Math.round(report.progress * 100)}%</div> : report.status === 'error' ? <p role="alert" className="text-amber-300">{report.message}</p> : metrics && <>
        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            ['Sample peak', metrics.silent ? 'Silence (−∞)' : format(metrics.samplePeakDbfs, 'dBFS')],
            ['Average RMS', metrics.silent ? 'Silence (−∞)' : format(metrics.rmsDbfs, 'dBFS')],
            ['Peak above average', format(metrics.crestDb, 'dB')],
            ['Active level variation', format(metrics.activeVariationDb, 'dB')],
          ].map(([label, value]) => <div key={label} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3"><dt>{label}</dt><dd className="mt-1 text-base font-semibold text-cyan-300">{value}</dd></div>)}
        </dl>
        <p>{metrics.samplesAtFullScale > 0 ? metrics.samplesAtFullScale + ' channel samples reached or exceeded 0 dBFS. Inspect the recording for overload; this alone does not prove audible clipping.' : 'No measured channel samples reached 0 dBFS. This does not rule out intersample peaks or earlier clipping.'}</p>
        <p className="text-zinc-500">RMS is unweighted average energy, not LUFS. Variation is the 90th–10th percentile spread of complete 400 ms RMS windows above −60 dBFS; fewer than two active windows gives no estimate. This is one take, not the track mix or master output.</p>
        <p className="text-zinc-400">A −6 dBFS peak can be a personal headroom reference, not a loudness requirement. Compare in context before changing gain; expressive level changes may be intentional.</p>
        <p className="text-zinc-500">Measured {new Date(report.updatedAt).toLocaleString()} · {report.sampleRate.toLocaleString()} Hz · sample peak, not true peak</p>
      </>}
    </div>}
  </details>;
}
