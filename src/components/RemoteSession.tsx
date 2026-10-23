import { useState } from 'react';
import { Radio, Copy, Check, LogIn, X, Loader2 } from 'lucide-react';
import { useSessionStore } from '../store/sessionStore';
import { encodeJoinCode, DEFAULT_RELAY_BASE } from '../lib/relayClient';

// Remote collaboration bar (Layer 2). Lets the engineer HOST a session (publishes
// the local REAPER state to the relay and runs the artist's queued commands) and
// lets a collaborator JOIN from their own device with a shared code. The code
// carries the relay URL, session id and token — share it like a meeting link.
export function RemoteSession() {
  const { role, session, busy, error, startHosting, join, leave, clearError } = useSessionStore();
  const [showJoin, setShowJoin] = useState(false);
  const [code, setCode] = useState('');
  const [relayBase, setRelayBase] = useState(DEFAULT_RELAY_BASE);
  const [copied, setCopied] = useState(false);

  const copyCode = () => {
    if (!session) return;
    try { void navigator.clipboard.writeText(encodeJoinCode(session)); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { /* clipboard unavailable */ }
  };

  // --- Hosting: show the shareable join code. ---
  if (role === 'hosting' && session) {
    return (
      <div className="rounded-xl border border-cyan-900/60 bg-cyan-950/20 p-3 text-xs">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="flex items-center gap-2 font-semibold text-cyan-300"><Radio size={14} /> Hosting a session</span>
          <span className="text-zinc-500">Share this code with your collaborator — it works like a meeting link.</span>
          <button onClick={() => void leave()} className="ml-auto flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:border-red-500/60 hover:text-red-300">
            <X size={12} /> End session
          </button>
        </div>
        <div className="mt-2 flex items-stretch gap-2">
          <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-mono text-[11px] text-cyan-200">{encodeJoinCode(session)}</code>
          <button onClick={copyCode} className="flex items-center gap-1 rounded-md border border-zinc-700 px-2.5 text-[11px] font-medium text-zinc-200 hover:border-zinc-500">
            {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-zinc-600">Keep this tab open — it relays what you do in REAPER to your collaborator and runs theirs here. Idle sessions expire after 2 hours.</p>
      </div>
    );
  }

  // --- Joined: a collaborator on their own device. ---
  if (role === 'joined' && session) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-900/60 bg-amber-950/15 p-3 text-xs">
        <span className="flex items-center gap-2 font-semibold text-amber-300"><Radio size={14} /> In a live session</span>
        <span className="text-zinc-500">Connected to the engineer’s REAPER via {new URL(session.relayBase).host}. Your taps and effects go straight to their session.</span>
        <button onClick={() => void leave()} className="ml-auto flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:border-zinc-500">
          <X size={12} /> Leave
        </button>
      </div>
    );
  }

  // --- Local (default): offer to host or join. ---
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex items-center gap-2 font-medium text-zinc-300"><Radio size={14} className="text-cyan-400" /> Collaborate remotely</span>
        <span className="text-zinc-500">Host from the machine running REAPER; your collaborator joins from anywhere.</span>
        <span className="ml-auto flex items-center gap-2">
          <button onClick={() => void startHosting(relayBase)} disabled={busy}
            className="flex items-center gap-1.5 rounded-md bg-cyan-500 px-2.5 py-1 text-[11px] font-semibold text-zinc-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Radio size={12} />} Host a session
          </button>
          <button onClick={() => { setShowJoin(v => !v); clearError(); }}
            className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1 text-[11px] font-medium text-zinc-200 hover:border-zinc-500">
            <LogIn size={12} /> Join
          </button>
        </span>
      </div>

      {showJoin && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={code}
            onChange={e => { setCode(e.target.value); if (error) clearError(); }}
            onKeyDown={e => { if (e.key === 'Enter' && code.trim() && !busy) void join(code); }}
            placeholder="Paste the join code your engineer sent you…"
            className="min-w-[16rem] flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-mono text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
          />
          <button onClick={() => void join(code)} disabled={busy || !code.trim()}
            className="rounded-md bg-amber-500 px-3 py-1.5 text-[11px] font-semibold text-zinc-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? 'Joining…' : 'Join'}
          </button>
        </div>
      )}

      {/* Advanced: point Host at a specific relay (localhost:3100 for dev). */}
      <details className="mt-1.5">
        <summary className="cursor-pointer text-[10px] text-zinc-600 hover:text-zinc-400">Relay: {relayBase}</summary>
        <input
          value={relayBase}
          onChange={e => setRelayBase(e.target.value)}
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-mono text-[11px] text-zinc-300 focus:border-zinc-600 focus:outline-none"
        />
      </details>

      {error && <p className="mt-1.5 text-[11px] text-amber-300">{error}</p>}
    </div>
  );
}
