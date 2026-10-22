import { Mic } from 'lucide-react';
import { Transport } from './Transport';
import { DescribeEffect } from './DescribeEffect';
import { VocalChain } from './VocalChain';

// Artist mode: a focused, DAW-free view a collaborator can drive directly —
// run the transport, record and scrap takes, ask for a sound in plain language,
// pick a vibe. No analysis panels, no approval step; the artist just acts. The
// engineer sets up the session (selects/arms the track) and holds the deep
// technical layer in Engineer mode.
export function ArtistView({ track, connected, transport }: {
  track: { id: string; name: string } | null;
  connected: boolean;
  transport?: { playing: boolean; recording: boolean; looping: boolean };
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-100"><Mic size={20} className="text-amber-300" /> You’re producing with Cadenzai</h2>
        <p className="mt-1 text-sm text-zinc-400">
          {track ? <>Working on <span className="font-medium text-zinc-200">{track.name}</span>. </> : ''}
          Say what you want in plain words — Cadenzai handles the REAPER side. Nothing here is permanent; your engineer can undo anything.
        </p>
        {!connected && <p className="mt-2 text-xs text-amber-300">Waiting for REAPER — ask your engineer to start the Cadenzai bridge.</p>}
        {connected && !track && <p className="mt-2 text-xs text-zinc-500">Ask your engineer to select the track you’re working on.</p>}
      </div>

      {/* Run the session: loop, record, play, stop, scrap a take. (Transport has no card of its own.) */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">Run the take</p>
        <Transport connected={connected} transport={transport} />
      </div>

      {/* Ask for a sound, in plain language. (Self-carded.) */}
      <DescribeEffect track={track} />

      {/* Pick a whole vibe. (Self-carded.) */}
      <VocalChain track={track} />

      <p className="text-center text-[11px] text-zinc-600">Switch to Engineer mode up top for the full technical tools.</p>
    </div>
  );
}
