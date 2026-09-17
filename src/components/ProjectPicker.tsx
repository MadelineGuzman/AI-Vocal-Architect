import React, { useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { X, FolderOpen, Plus, Music, FileWarning, DownloadCloud, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';

export const ProjectPicker: React.FC = () => {
  const {
    isProjectsOpen, setProjectsOpen, projects, projectId,
    openProject, newProject, importEarlierProjects, setIsImportModalOpen, isBusy,
  } = useProjectStore();

  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isProjectsOpen) return null;

  const handleOpen = async (id: string) => {
    setError(null);
    const ok = await openProject(id);
    if (!ok) setError(useProjectStore.getState().storageError || 'That project could not be opened.');
  };

  const handleNew = async () => {
    setError(null);
    if (await newProject()) setIsImportModalOpen(true);
    else setError(useProjectStore.getState().storageError || 'Save the current project before starting a new one.');
  };

  const handleImportEarlier = async () => {
    setError(null);
    setImportResult(null);
    setImporting(true);
    try {
      const count = await importEarlierProjects();
      setImportResult(count > 0
        ? `Imported ${count} earlier project${count === 1 ? '' : 's'}. Original browser data was left unchanged.`
        : 'No new earlier projects were found. Anything already imported was left as-is.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Earlier projects could not be imported.');
    } finally {
      setImporting(false);
    }
  };

  const formatWhen = (ms: number) => {
    try { return new Date(ms).toLocaleString(); } catch { return ''; }
  };

  return (
    <div className="fixed inset-0 z-[105] flex items-center justify-center bg-black/80 backdrop-blur-sm p-6">
      <div role="dialog" aria-modal="true" aria-label="Projects" className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-full">
        <div className="flex items-center justify-between p-5 border-b border-zinc-800 bg-zinc-950/50">
          <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
            <FolderOpen size={18} className="text-cyan-500" /> Projects
          </h2>
          <button onClick={() => setProjectsOpen(false)} disabled={isBusy} className="text-zinc-500 hover:text-zinc-300 disabled:opacity-50 p-1">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 border-b border-zinc-800 flex flex-wrap gap-3">
          <button
            onClick={handleNew}
            disabled={isBusy}
            className="flex items-center gap-2 text-sm font-medium rounded-lg px-4 py-2.5 bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-50 transition-colors"
          >
            <Plus size={15} /> New project
          </button>
          <button
            onClick={handleImportEarlier}
            disabled={isBusy || importing}
            className="flex items-center gap-2 text-sm font-medium rounded-lg px-4 py-2.5 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-50 transition-colors"
            title="Import projects saved by the earlier Cadenzai app. Your original data is never changed."
          >
            {importing ? <Loader2 size={15} className="animate-spin" /> : <DownloadCloud size={15} />} Import earlier projects
          </button>
        </div>

        {(importResult || error) && (
          <div className="px-5 pt-4">
            {importResult && <p className="text-xs text-zinc-400">{importResult}</p>}
            {error && <p role="alert" className="text-xs text-red-300 mt-1">{error}</p>}
          </div>
        )}

        <div className="p-5 overflow-y-auto flex-1 custom-scrollbar">
          {projects.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-8">No saved projects yet. Import audio to create your first one.</p>
          ) : (
            <ul className="space-y-2">
              {projects.map(project => {
                const isCurrent = project.id === projectId;
                return (
                  <li key={project.id}>
                    <div className={clsx(
                      'w-full flex items-center gap-3 rounded-xl border p-3 text-left',
                      isCurrent ? 'bg-zinc-800/60 border-zinc-700' : 'bg-zinc-950/40 border-zinc-800'
                    )}>
                      <div className={clsx('shrink-0 rounded-lg p-2', project.hasAudio ? 'bg-cyan-900/30 text-cyan-400' : 'bg-amber-900/20 text-amber-400')}>
                        {project.hasAudio ? <Music size={16} /> : <FileWarning size={16} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-zinc-200 truncate">{project.title}</p>
                        <p className="text-[11px] text-zinc-500">
                          {formatWhen(project.updatedAt)} · {project.hasAudio ? 'Has recording' : 'Needs a recording'}
                        </p>
                      </div>
                      {isCurrent ? (
                        <span className="text-[10px] uppercase tracking-widest font-bold text-zinc-500 px-2">Current</span>
                      ) : (
                        <button
                          onClick={() => handleOpen(project.id)}
                          disabled={isBusy}
                          className="text-xs font-medium rounded-md px-3 py-1.5 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-50 transition-colors shrink-0"
                        >
                          Open
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
