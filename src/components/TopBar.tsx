import React from 'react';
import { useProjectStore } from '../store/projectStore';
import { Play, Pause, Settings, Share, Upload } from 'lucide-react';
import cadenzaiLogo from '../assets/branding/Cadenzai_Logo_W.png';

export const TopBar: React.FC = () => {
  const { isPlaying, currentTime, duration, audioFileName, setIsImportModalOpen } = useProjectStore();

  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    const ms = Math.floor((time % 1) * 100);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  const togglePlay = () => {
    window.dispatchEvent(new CustomEvent('transportControl', { detail: isPlaying ? 'pause' : 'play' }));
  };

  const handleSettingsClick = () => {
    console.log("Settings is a placeholder.");
    alert("Settings menu is currently a placeholder. Future settings may include: DSP window size adjustment, default arrangement presets, theme toggles, and API model selection.");
  };

  return (
    <div className="h-16 border-b border-zinc-800 bg-zinc-950 flex items-center justify-between px-6 shrink-0 relative z-50 shadow-sm">
      <div className="flex items-center gap-6 min-w-0 flex-1">
        <div className="flex items-center shrink-0 -ml-2">
          <img
            id="cadenzai-header-logo"
            src={cadenzaiLogo}
            alt="Cadenzai"
            className="h-14 w-auto object-contain shrink-0"
            referrerPolicy="no-referrer"
          />
        </div>
        {audioFileName && (
          <div className="text-zinc-500 text-sm border-l border-zinc-800 pl-6 truncate max-w-[250px]">
            {audioFileName}
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-6 flex-1">
        <span className="text-zinc-400 font-mono text-sm tracking-wider w-20 text-right">{formatTime(currentTime)}</span>
        <button
          onClick={togglePlay}
          disabled={!audioFileName}
          className="w-10 h-10 rounded-full bg-zinc-100 text-zinc-900 flex items-center justify-center hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
        >
          {isPlaying ? <Pause size={18} className="fill-current" /> : <Play size={18} className="fill-current ml-1" />}
        </button>
        <span className="text-zinc-600 font-mono text-sm tracking-wider w-20 text-left">{formatTime(duration)}</span>
      </div>

      <div className="flex items-center justify-end gap-4 flex-1 text-zinc-400">
        <button onClick={() => setIsImportModalOpen(true)} className="hover:text-zinc-100 transition-colors p-2 rounded-md hover:bg-zinc-900 cursor-pointer" title="Import Audio"><Upload size={18} /></button>
        <button className="hover:text-zinc-100 transition-colors p-2 rounded-md hover:bg-zinc-900 cursor-pointer" title="Share"><Share size={18} /></button>
        <button onClick={handleSettingsClick} className="hover:text-zinc-100 transition-colors p-2 rounded-md hover:bg-zinc-900 cursor-pointer" title="Settings"><Settings size={18} /></button>
      </div>
    </div>
  );
};
