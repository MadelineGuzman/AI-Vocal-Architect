import { useState } from 'react';
import { SkipBack, Play, Pause, Square, Circle, Repeat } from 'lucide-react';

// Transport control: drive REAPER's playback and recording from Cadenzai. Each
// button fires one allow-listed transport action (fire-and-forget, like the
// cursor move) — no project edits. Built so a collaborator can run the session
// (loop / record / play / stop) without touching the DAW itself.
type Action = 'to-start' | 'play' | 'pause' | 'stop' | 'record' | 'toggle-loop';

const BUTTONS: { action: Action; label: string; Icon: typeof Play; className?: string }[] = [
  { action: 'to-start', label: 'Back to start of selection', Icon: SkipBack },
  { action: 'play', label: 'Play', Icon: Play },
  { action: 'pause', label: 'Pause', Icon: Pause },
  { action: 'stop', label: 'Stop', Icon: Square },
  { action: 'record', label: 'Record', Icon: Circle, className: 'text-red-400' },
  { action: 'toggle-loop', label: 'Loop the time selection on/off', Icon: Repeat },
];

export function Transport({ connected }: { connected: boolean }) {
  const [flash, setFlash] = useState<Action | null>(null);
  const [error, setError] = useState(false);

  const send = (action: Action) => {
    if (!connected) return;
    setFlash(action);
    setError(false);
    window.setTimeout(() => setFlash(f => (f === action ? null : f)), 250);
    fetch('/api/reaper/transport', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
      .then(r => { if (!r.ok) setError(true); })
      .catch(() => setError(true));
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Transport</span>
      <div className="flex items-center gap-1">
        {BUTTONS.map(({ action, label, Icon, className }) => (
          <button
            key={action}
            onClick={() => send(action)}
            disabled={!connected}
            title={label}
            aria-label={label}
            className={`flex h-8 w-8 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${flash === action ? 'border-amber-500 bg-amber-500/20 text-amber-200' : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600 hover:text-zinc-100'} ${className ?? ''}`}
          >
            <Icon size={15} fill={action === 'record' || action === 'play' || action === 'stop' ? 'currentColor' : 'none'} />
          </button>
        ))}
      </div>
      {!connected
        ? <span className="text-[11px] text-zinc-600">Connect REAPER to drive the transport.</span>
        : error
          ? <span className="text-[11px] text-amber-300">Couldn’t reach REAPER — if you just updated Cadenzai, re-run the bridge.</span>
          : <span className="text-[11px] text-zinc-600">Drives REAPER’s transport — loop a section, record, play, stop.</span>}
    </div>
  );
}
