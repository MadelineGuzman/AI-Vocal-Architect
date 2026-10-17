import React from 'react';
import { useProjectStore } from '../../store/projectStore';
import { AudioTimeline } from './AudioTimeline';
import { IntelligenceHub } from './IntelligenceHub';
import { Upload } from 'lucide-react';

export const Workspace: React.FC = () => {
  const { audioUrl, isAnalyzing, setIsImportModalOpen } = useProjectStore();

  if (!audioUrl) {
    // Compact, unobtrusive entry point. The REAPER panel above is the live path;
    // this is the standalone path — drop a file in to analyze it without REAPER.
    return (
      <div className="flex-1 overflow-y-auto bg-zinc-950">
        <div className="mx-auto max-w-md px-6 py-6">
          <button
            onClick={() => setIsImportModalOpen(true)}
            className="group flex w-full items-center gap-4 rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-4 text-left transition-all hover:border-zinc-700 hover:bg-zinc-900/70"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-700/50 bg-zinc-800/60 transition-transform group-hover:scale-105">
              <Upload size={20} className="text-zinc-300" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-zinc-100">Import a song to analyze</h3>
              <p className="mt-0.5 text-xs text-zinc-400">Analyze a file directly in Cadenzai — no REAPER needed. Or use the REAPER panel above for a live read.</p>
            </div>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Main Canvas */}
      <div className="flex-1 flex flex-col relative bg-zinc-950">

        <div className="absolute inset-0 z-0 opacity-20 pointer-events-none">
           <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[300px] bg-zinc-800 rounded-full blur-[120px]" />
        </div>

        <div className="flex-1 flex flex-col justify-center max-w-6xl mx-auto w-full relative z-10">
           {isAnalyzing && (
             <div className="absolute inset-0 z-50 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm rounded-3xl">
               <div className="flex flex-col items-center gap-6">
                 <div className="relative w-12 h-12">
                   <div className="absolute inset-0 border-2 border-zinc-800 rounded-full"></div>
                   <div className="absolute inset-0 border-2 border-transparent border-t-zinc-300 rounded-full animate-spin"></div>
                 </div>
                 <p className="text-zinc-300 font-mono text-xs uppercase tracking-[0.2em] animate-pulse">Architect Analyzing...</p>
               </div>
             </div>
           )}
           <AudioTimeline />
        </div>
      </div>

      {/* Intelligence Hub */}
      <IntelligenceHub />
    </div>
  );
};
