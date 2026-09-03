import React, { useEffect, useRef } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { useProjectStore } from '../../store/projectStore';
import { clsx } from 'clsx';
import { SectionEditor } from './SectionEditor';

export const AudioTimeline: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const { audioUrl, setDuration, setCurrentTime, setIsPlaying, sections, findings, selectedFindingId, setSelectedFinding } = useProjectStore();

  useEffect(() => {
    if (!containerRef.current || !audioUrl) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      backend: 'WebAudio',
      waveColor: '#3f3f46',
      progressColor: '#d4d4d8',
      cursorColor: '#f4f4f5',
      barWidth: 2,
      barGap: 2,
      barRadius: 2,
      height: 160,
      normalize: true,
    });

    wavesurferRef.current = ws;

    ws.load(audioUrl).catch((err) => {
      if (err.name !== 'AbortError' && !err.message?.includes('abort')) {
        console.error('WaveSurfer load error:', err);
      }
    });

    ws.on('ready', () => {
      setDuration(ws.getDuration());
    });

    ws.on('timeupdate', () => {
      setCurrentTime(ws.getCurrentTime());
    });

    ws.on('seeking', () => {
      setCurrentTime(ws.getCurrentTime());
    });

    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => setIsPlaying(false));

    return () => {
      ws.destroy();
    };
  }, [audioUrl, setDuration, setCurrentTime, setIsPlaying]);

  useEffect(() => {
    const handleTransport = async (e: Event) => {
      const customEvent = e as CustomEvent;
      try {
        if (!wavesurferRef.current) return;

        if (customEvent.detail === 'play') {
          await wavesurferRef.current.play();
        } else if (customEvent.detail === 'pause') {
          wavesurferRef.current.pause();
        } else if (customEvent.detail === 'toggle') {
          await wavesurferRef.current.playPause();
        } else if (typeof customEvent.detail === 'number') {
          wavesurferRef.current.setTime(customEvent.detail);
        }
      } catch (err) {
        console.error('Transport control error:', err);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && e.target instanceof Element) {
        // Ignore space if typing in input, textarea, button, or contenteditable
        if (e.target.closest('input, textarea, button, select, [contenteditable="true"], [contenteditable=""]')) return;

        e.preventDefault();
        window.dispatchEvent(new CustomEvent('transportControl', { detail: 'toggle' }));
      }
    };

    window.addEventListener('transportControl', handleTransport);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('transportControl', handleTransport);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const duration = useProjectStore(state => state.duration);

  const seekToTime = (time: number) => {
    if (!wavesurferRef.current || duration === 0) return;
    wavesurferRef.current.seekTo(time / duration);
  };

  return (
    <div className="relative w-full px-8 flex flex-col justify-center">
      {/* Sections Overlay */}
      <div className="relative h-6 w-full mb-4 bg-zinc-900 rounded-md overflow-hidden">
        {sections.map(section => (
          <div
            key={section.id}
            className="absolute top-0 bottom-0 text-[10px] font-semibold px-2 py-1 flex items-center overflow-hidden border-r border-black/20 uppercase tracking-widest cursor-pointer hover:brightness-110 transition-all"
            style={{
              left: `${(section.timeRange.start / duration) * 100}%`,
              width: `${((section.timeRange.end || duration) - section.timeRange.start) / duration * 100}%`,
              backgroundColor: section.color,
              color: '#fff'
            }}
            onClick={() => seekToTime(section.timeRange.start)}
          >
            {section.name}
          </div>
        ))}
      </div>

      {/* Markers Overlay */}
      <div className="relative h-6 w-full mb-1">
        {findings.map(finding => {
          const isSelected = selectedFindingId === finding.id;
          const leftPercent = (finding.timeRange.start / duration) * 100;
          return (
            <div
              key={finding.id}
              onClick={() => {
                setSelectedFinding(finding.id);
                seekToTime(finding.timeRange.start);
              }}
              className={clsx(
                "absolute top-0 w-3.5 h-3.5 -ml-[7px] rounded-full cursor-pointer transition-all z-10",
                isSelected ? "bg-white scale-[1.3] shadow-[0_0_12px_rgba(255,255,255,0.6)]" : "bg-zinc-500 hover:bg-zinc-300"
              )}
              style={{ left: `${leftPercent}%` }}
            />
          )
        })}
      </div>

      {/* Wavesurfer Container and Evidence Highlights */}
      <div className="relative w-full rounded-xl overflow-hidden bg-zinc-900/30 border border-zinc-800/50 backdrop-blur-sm z-0">

        {/* Section Colored Backgrounds */}
        {duration > 0 && (
          <div className="absolute inset-0 pointer-events-none z-0 opacity-15">
            {sections.map(section => (
              <div
                key={section.id}
                className="absolute top-0 bottom-0"
                style={{
                  left: `${(section.timeRange.start / duration) * 100}%`,
                  width: `${((section.timeRange.end || duration) - section.timeRange.start) / duration * 100}%`,
                  backgroundColor: section.color
                }}
              />
            ))}
          </div>
        )}

        {/* Finding Decision State Overlay */}
        {duration > 0 && (
          <div className="absolute inset-0 z-0 pointer-events-auto">
            {findings.map(finding => {
              if (finding.userStatus === 'open') return null;

              const startPercent = (finding.timeRange.start / duration) * 100;
              const endPercent = ((finding.timeRange.end || duration) / duration) * 100;
              const width = endPercent - startPercent;

              const getStatusStyles = () => {
                switch (finding.userStatus) {
                  case 'accepted': return "bg-green-500/20 border-l border-r border-green-500/30";
                  case 'investigate': return "bg-blue-500/20 border-l border-r border-blue-500/30";
                  case 'ignored': return "bg-red-500/20 border-l border-r border-red-500/30";
                  default: return "";
                }
              };

              return (
                <div
                  key={`decision-${finding.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedFinding(finding.id);
                    seekToTime(finding.timeRange.start);
                  }}
                  className={clsx(
                    "absolute top-0 bottom-0 cursor-pointer hover:brightness-125 transition-all mix-blend-screen",
                    getStatusStyles()
                  )}
                  style={{ left: `${startPercent}%`, width: `${width}%` }}
                  title={`Status: ${finding.userStatus}\n${finding.observation}`}
                />
              );
            })}
          </div>
        )}

        {/* Evidence Highlights */}
        {selectedFindingId && duration > 0 && findings.find(f => f.id === selectedFindingId) && (
          <div className="absolute inset-0 pointer-events-none z-10 mix-blend-screen">
            {(() => {
              const finding = findings.find(f => f.id === selectedFindingId)!;
              const ranges = [finding.timeRange, ...(finding.relatedTimeRanges || [])];

              return ranges.map((range, idx) => {
                const startPercent = (range.start / duration) * 100;
                const endPercent = ((range.end || duration) / duration) * 100;
                const width = endPercent - startPercent;

                return (
                  <div
                    key={idx}
                    className="absolute top-0 bottom-0 bg-cyan-500/15 border-l-2 border-r-2 border-cyan-400/50"
                    style={{ left: `${startPercent}%`, width: `${width}%` }}
                  />
                );
              });
            })()}
          </div>
        )}

        <div ref={containerRef} className="w-full relative z-0" />
      </div>

      <SectionEditor />
    </div>
  );
};
