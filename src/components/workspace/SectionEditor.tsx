import React from 'react';
import { useProjectStore } from '../../store/projectStore';
import { Plus, Trash2 } from 'lucide-react';
import { SongSection } from '../../types';

export const SectionEditor: React.FC = () => {
  const { sections, addSection, updateSection, removeSection, duration, currentTime, sectionError } = useProjectStore();

  const handleAddSection = () => {
    // Leave room so the default section is a valid range even near the end of the track.
    const start = Math.min(currentTime, Math.max(0, duration - 1));
    const end = Math.min(start + 15, duration);
    const newSection: SongSection = {
      id: `sec-${Date.now()}`,
      name: 'Verse',
      timeRange: { start, end },
      color: '#1d4ed8',
      provenance: 'artist'
    };
    addSection(newSection);
  };

  const SECTION_TYPES = [
    { name: 'Intro', color: '#3f3f46' },
    { name: 'Verse', color: '#1d4ed8' },
    { name: 'Pre-Chorus', color: '#7e22ce' },
    { name: 'Chorus', color: '#be185d' },
    { name: 'Bridge', color: '#f59e0b' },
    { name: 'Outro', color: '#14b8a6' },
    { name: 'Custom', color: '#52525b' }
  ];

  return (
    <div className="mt-6 bg-zinc-900/40 rounded-xl p-4 border border-zinc-800/50">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-[13px] font-bold text-zinc-300 uppercase tracking-widest">Song Structure</h3>
          <p className="text-[11px] text-zinc-500 mt-0.5">Artist-defined arrangement</p>
        </div>
        <button
          onClick={handleAddSection}
          className="flex items-center gap-1.5 text-xs bg-cyan-900/30 hover:bg-cyan-900/50 text-cyan-400 border border-cyan-800/50 px-3 py-1.5 rounded-md transition-colors"
        >
          <Plus size={14} /> Add Section
        </button>
      </div>

      {sectionError && (
        <p role="alert" className="text-xs text-red-300 mb-3 -mt-1">{sectionError}</p>
      )}

      <div className="flex gap-3 overflow-x-auto pb-2 min-h-[80px]">
        {sections.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-zinc-600 text-xs italic">
            No sections defined. Add sections to enable structural energy analysis.
          </div>
        ) : (
          sections.map(section => {
            const isPreset = SECTION_TYPES.some(t => t.name === section.name) && section.name !== 'Custom';
            const isCustom = !isPreset;
            return (
            <div key={section.id} className="min-w-[200px] bg-zinc-950/50 border border-zinc-800 rounded-lg p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <select
                  value={isPreset ? section.name : 'Custom'}
                  onChange={(e) => {
                    if (e.target.value === 'Custom') {
                      // Switch to a custom name without discarding a name the artist may re-type.
                      const preset = SECTION_TYPES.find(t => t.name === 'Custom')!;
                      updateSection(section.id, { name: '', color: preset.color });
                    } else {
                      const type = SECTION_TYPES.find(t => t.name === e.target.value);
                      if (type) updateSection(section.id, { name: type.name, color: type.color });
                    }
                  }}
                  className="bg-transparent text-sm font-semibold text-zinc-200 outline-none cursor-pointer"
                  style={{ color: section.color }}
                >
                  {SECTION_TYPES.map(type => (
                    <option key={type.name} value={type.name} className="bg-zinc-900 text-zinc-300">
                      {type.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => removeSection(section.id)}
                  className="text-zinc-500 hover:text-red-400 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {isCustom && (
                <input
                  type="text"
                  value={section.name}
                  onChange={(e) => updateSection(section.id, { name: e.target.value })}
                  placeholder="Section name"
                  className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300"
                />
              )}

              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <div className="flex flex-col">
                  <span className="text-[9px] uppercase tracking-wider text-zinc-600">Start (s)</span>
                  <input
                    type="number"
                    value={Math.round(section.timeRange.start * 10) / 10}
                    onChange={(e) => updateSection(section.id, { timeRange: { ...section.timeRange, start: parseFloat(e.target.value) || 0 }})}
                    className="w-16 bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1 text-zinc-300 font-mono focus:border-cyan-500/50 outline-none"
                    step="0.5"
                  />
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] uppercase tracking-wider text-zinc-600">End (s)</span>
                  <input
                    type="number"
                    value={section.timeRange.end ? Math.round(section.timeRange.end * 10) / 10 : duration}
                    onChange={(e) => updateSection(section.id, { timeRange: { ...section.timeRange, end: parseFloat(e.target.value) || duration }})}
                    className="w-16 bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1 text-zinc-300 font-mono focus:border-cyan-500/50 outline-none"
                    step="0.5"
                  />
                </div>
              </div>
            </div>
            );
          })
        )}
      </div>
    </div>
  );
};
