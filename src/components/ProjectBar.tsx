import React, { useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { FolderOpen, StickyNote, Paperclip, Save, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';

export const ProjectBar: React.FC = () => {
  const {
    projectId, title, setTitle, notes, setNotes,
    saveStatus, storageError, isDirty, isBusy, audioBlob,
    saveProject, setProjectsOpen, setIsImportModalOpen,
  } = useProjectStore();

  const [notesOpen, setNotesOpen] = useState(false);
  const attaching = Boolean(projectId && !audioBlob);

  const status = (() => {
    if (saveStatus === 'saving') return { icon: <Loader2 size={13} className="animate-spin" />, text: 'Saving…', tone: 'text-zinc-400' };
    if (saveStatus === 'error') return { icon: <AlertTriangle size={13} />, text: 'Save failed', tone: 'text-red-400' };
    if (saveStatus === 'saved' && !isDirty) return { icon: <CheckCircle2 size={13} />, text: 'Saved', tone: 'text-green-400' };
    if (isDirty) return { icon: <Save size={13} />, text: 'Unsaved changes', tone: 'text-amber-400' };
    return { icon: null, text: '', tone: 'text-zinc-500' };
  })();

  return (
    <div className="border-b border-zinc-800 bg-zinc-950/60 shrink-0 relative z-40">
      <div className="h-12 flex items-center gap-4 px-6">
        <button
          onClick={() => setProjectsOpen(true)}
          className="flex items-center gap-2 text-xs font-medium text-zinc-300 hover:text-white bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-md px-3 py-1.5 transition-colors shrink-0"
          title="Open a saved project"
        >
          <FolderOpen size={14} /> Projects
        </button>

        {projectId ? (
          <>
            <input
              aria-label="Project title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Untitled project"
              className="min-w-0 flex-1 max-w-md bg-transparent text-sm font-semibold text-zinc-100 placeholder:text-zinc-600 border-b border-transparent focus:border-zinc-700 outline-none py-1"
            />

            <button
              onClick={() => setNotesOpen(o => !o)}
              className={clsx(
                'flex items-center gap-2 text-xs rounded-md px-3 py-1.5 border transition-colors shrink-0',
                notesOpen ? 'bg-zinc-800 border-zinc-700 text-zinc-200' : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
              )}
              title="Project notes"
            >
              <StickyNote size={14} /> Notes
            </button>

            {attaching && (
              <button
                onClick={() => setIsImportModalOpen(true)}
                className="flex items-center gap-2 text-xs rounded-md px-3 py-1.5 border border-amber-800/60 bg-amber-900/20 text-amber-300 hover:bg-amber-900/40 transition-colors shrink-0"
                title="This recovered project has no audio. Attach a recording to analyze it."
              >
                <Paperclip size={14} /> Attach recording
              </button>
            )}

            <div className="ml-auto flex items-center gap-3 shrink-0">
              {status.text && (
                <span className={clsx('flex items-center gap-1.5 text-xs font-medium', status.tone)}>
                  {status.icon} {status.text}
                </span>
              )}
              <button
                onClick={() => { void saveProject(); }}
                disabled={isBusy || saveStatus === 'saving' || (!isDirty && saveStatus !== 'error')}
                className="flex items-center gap-1.5 text-xs font-medium rounded-md px-3 py-1.5 bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-40 disabled:hover:bg-cyan-600 transition-colors"
              >
                <Save size={13} /> {saveStatus === 'error' ? 'Retry' : 'Save'}
              </button>
            </div>
          </>
        ) : (
          <span className="text-xs text-zinc-500">No project loaded — import audio or open a saved project.</span>
        )}
      </div>

      {projectId && saveStatus === 'error' && storageError && (
        <div role="alert" className="px-6 pb-2 -mt-1 text-xs text-red-300">{storageError}</div>
      )}

      {projectId && notesOpen && (
        <div className="px-6 pb-3">
          <textarea
            aria-label="Project notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes, intent, lyrics, references — anything you want to keep with this project."
            rows={4}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-700 resize-y"
          />
        </div>
      )}
    </div>
  );
};
