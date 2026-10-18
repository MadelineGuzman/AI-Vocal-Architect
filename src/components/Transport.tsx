import { useRef, useState } from 'react';
import { SkipBack, Play, Pause, Square, Circle, Repeat, Trash2 } from 'lucide-react';

// Transport control: drive REAPER's playback and recording from Cadenzai, plus
// a reversible "delete last take". Each button fires one allow-listed action
// (fire-and-forget, like the cursor move). Built so a collaborator can run the
// session (loop / record / play / stop / scrap a take) without touching the DAW.
type Action = 'to-start' | 'play' | 'pause' | 'stop' | 'record' | 'toggle-loop' | 'delete-take';

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
  const [armed, setArmed] = useState(false); // two-tap confirm for delete last take
  const [deleted, setDeleted] = useState(false);
  const disarmTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const send = (action: Action) => {
    if (!connected) return;
    setFlash(action);
    setError(false);
    window.setTimeout(() => setFlash(f => (f === action ? null : f)), 250);
    fetch('/api/reaper/transport', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
      .then(r => { if (!r.ok) setError(true); })
      .catch(() => setError(true));
  };

  const onDelete = () => {
    if (!connected) return;
    if (!armed) { // first tap arms; auto-disarm after 3s
      setArmed(true);
      clearTimeout(disarmTimer.current);
      disarmTimer.current = setTimeout(() => setArmed(false), 3000);
      return;
    }
    clearTimeout(disarmTimer.current);
    setArmed(false);
    send('delete-take');
    setDeleted(true);
    window.setTimeout(() => setDeleted(false), 2500);
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
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
      {/* Set apart from the play/record cluster, with a two-tap confirm. */}
      <span className="h-5 w-px bg-zinc-800" aria-hidden />
      <button
        onClick={onDelete}
        disabled={!connected}
        title="Removes your last recording (REAPER undo) — Redo in REAPER brings it back."
        className={`flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${armed ? 'border-red-500 bg-red-500/20 text-red-200' : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-red-500/50 hover:text-red-300'}`}
      >
        <Trash2 size={13} /> {armed ? 'Tap again to confirm' : 'Delete last take'}
      </button>
      {!connected
        ? <span className="text-[11px] text-zinc-600">Connect REAPER to drive the transport.</span>
        : error
          ? <span className="text-[11px] text-amber-300">Couldn’t reach REAPER — if you just updated Cadenzai, re-run the bridge.</span>
          : deleted
            ? <span className="text-[11px] text-green-400">Scrapped the last take — Redo in REAPER if you want it back.</span>
            : <span className="text-[11px] text-zinc-600">Loop a section, record, play, stop — and scrap a take if it’s no good.</span>}
    </div>
  );
}
