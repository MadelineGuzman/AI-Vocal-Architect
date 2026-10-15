import { ReaperLevels } from './ReaperLevels';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Cable, ChevronDown } from 'lucide-react';
import type { ReaperState, AnalyzeRequestResponse } from '../types/reaper';

const initial: ReaperState = { status: 'waiting', snapshot: null, message: 'Checking local connection…' };

// How long to wait for REAPER to acknowledge a request before offering a retry.
const ACK_TIMEOUT_MS = 8000;

export type AnalyzePhase = 'idle' | 'sending' | 'waiting' | 'measuring' | 'complete' | 'rejected' | 'error' | 'timeout';
export interface AnalyzeView {
  phase: AnalyzePhase;
  message: string;
  progress: number;
  canAnalyze: boolean;
  onAnalyze: () => void;
}

export function ReaperConnection() {
  const [state, setState] = useState<ReaperState>(initial);
  const [request, setRequest] = useState<{ id: string; startedAt: number } | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Re-render on a timer so the acknowledgement timeout is evaluated even if the
  // polled state stops changing.
  const [, setClock] = useState(0);
  const requestRef = useRef(request);
  requestRef.current = request;

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    const poll = async () => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      try {
        const response = await fetch('/api/reaper/state', { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Connection request failed');
        const next: ReaperState = await response.json();
        if (!stopped) setState(next);
      } catch {
        if (!stopped) setState(previous => ({ ...previous, status: 'error', message: 'Local server unavailable — selection may be outdated' }));
      } finally {
        clearTimeout(timeout);
        if (!stopped) { setClock(value => value + 1); timer = setTimeout(poll, 500); }
      }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, []);

  const onAnalyze = useCallback(async () => {
    if (sending) return;
    setSending(true);
    setRequestError(null);
    try {
      const response = await fetch('/api/reaper/analyze', { method: 'POST', cache: 'no-store' });
      const body = await response.json().catch(() => ({})) as Partial<AnalyzeRequestResponse> & { error?: string };
      if (response.ok && body.requestId) {
        setRequest({ id: body.requestId, startedAt: Date.now() });
      } else {
        setRequest(null);
        setRequestError(body.error || 'REAPER could not accept the request. Make sure the bridge is running.');
      }
    } catch {
      setRequest(null);
      setRequestError('The local server could not be reached. Is Cadenzai still running?');
    } finally {
      setSending(false);
    }
  }, [sending]);

  const { snapshot, status, message } = state;
  const connected = status === 'connected';
  const label = connected ? 'Connected' : status === 'waiting' ? 'Waiting for REAPER' : status === 'disconnected' ? 'Disconnected' : 'Connection error';

  // Derive the analysis phase from the active request and the polled report.
  let phase: AnalyzePhase = 'idle';
  let phaseMessage = '';
  let progress = 0;
  if (sending) {
    phase = 'sending';
  } else if (!request) {
    if (requestError) { phase = 'error'; phaseMessage = requestError; }
  } else {
    const report = state.levels && state.levels.requestId === request.id ? state.levels : null;
    const notice = state.levelsNotice && state.levelsNotice.requestId === request.id ? state.levelsNotice : null;
    if (notice) { phase = 'rejected'; phaseMessage = notice.message; }
    else if (report) {
      if (report.status === 'running') { phase = 'measuring'; progress = report.progress; }
      else if (report.status === 'ready') { phase = 'complete'; }
      else { phase = 'error'; phaseMessage = report.message; }
    } else if (Date.now() - request.startedAt > ACK_TIMEOUT_MS) {
      phase = 'timeout';
      phaseMessage = 'REAPER did not acknowledge the request. Make sure the Cadenzai bridge is running in REAPER (and no dialog is open), then try again.';
    } else {
      phase = 'waiting';
    }
  }
  const busy = phase === 'sending' || phase === 'waiting' || phase === 'measuring';
  const analyze: AnalyzeView = { phase, message: phaseMessage, progress, canAnalyze: connected && !busy, onAnalyze };

  return (
    <section aria-label="REAPER connection" className="shrink-0 border-b border-zinc-800 bg-zinc-950 px-6 py-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <span className="flex items-center gap-2 font-semibold tracking-wide text-zinc-200"><Cable size={15} /> REAPER</span>
        <span role="status" className={connected ? 'text-cyan-400' : 'text-amber-300'}>{label}</span>
        <span className="text-zinc-500">{message}</span>
        {snapshot && <span className="ml-auto text-zinc-400">{snapshot.project.name}{snapshot.project.saved ? '' : ' · unsaved'}</span>}
      </div>
      {snapshot ? (
        <details className="mt-2 text-xs text-zinc-400">
          <summary className="cursor-pointer py-1 text-zinc-200">
            <ChevronDown size={12} className="inline mr-2" />
            {connected ? '' : 'Last known: '}
            {snapshot.tracks.length === 0 ? 'No track selected' : snapshot.tracks.length === 1 ? snapshot.tracks[0].name || 'Unnamed track' : snapshot.tracks.length + ' tracks selected'}
          </summary>
          <div className="max-h-40 overflow-auto pt-2 space-y-2">
            {snapshot.tracks.map(track => <div key={track.id} className="flex flex-wrap gap-x-4 gap-y-1">
              <span className="text-zinc-300">{track.isMaster ? 'Master' : 'Track ' + track.number}: {track.name || 'Unnamed track'}</span>
              <span className="font-mono break-all">ID: {track.id}</span>
            </div>)}
            <p>Last update: {new Date(snapshot.updatedAt).toLocaleTimeString()}</p>
          </div>
        </details>
      ) : <p className="mt-2 text-xs text-zinc-500">In REAPER, load and run “Cadenzai_Read_Selection.lua” from Actions. No audio is transferred.</p>}
      <ReaperLevels state={state} analyze={analyze} />
    </section>
  );
}
