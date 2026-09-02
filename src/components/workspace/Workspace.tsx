import React from 'react';
import { useProjectStore } from '../../store/projectStore';
import { AudioTimeline } from './AudioTimeline';
import { IntelligenceHub } from './IntelligenceHub';
import { Upload } from 'lucide-react';

export const Workspace: React.FC = () => {
  const { audioUrl, isAnalyzing, setIsImportModalOpen } = useProjectStore();

  if (!audioUrl) {
    return (
      <div className="flex-1 flex items-center justify-center bg-zinc-950 relative overflow-hidden">
        
        {/* Ambient background blur */}
        <div className="absolute inset-0 z-0 opacity-30 pointer-events-none">
           <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-900/20 rounded-full blur-[100px]" />
           <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-900/20 rounded-full blur-[100px]" />
        </div>

        <div
          className="relative z-10 flex flex-col items-center gap-6 p-16 border border-zinc-800/50 bg-zinc-900/30 backdrop-blur-md rounded-3xl hover:border-zinc-700 hover:bg-zinc-900/50 transition-all cursor-pointer shadow-2xl group"
          onClick={() => setIsImportModalOpen(true)}
        >
          <div className="w-20 h-20 rounded-2xl bg-zinc-800/50 flex items-center justify-center border border-zinc-700/50 group-hover:scale-105 transition-transform">
            <Upload size={32} className="text-zinc-300" />
          </div>
          <div className="text-center max-w-sm">
            <h3 className="text-xl font-semibold text-zinc-100 mb-2">Import Audio</h3>
            <p className="text-sm text-zinc-400 leading-relaxed">Select a full song, demo, or vocal stem to begin architectural analysis.</p>
          </div>
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
