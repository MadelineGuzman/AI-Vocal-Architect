import { useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { ProjectBar } from './components/ProjectBar';
import { ProjectPicker } from './components/ProjectPicker';
import { Workspace } from './components/workspace/Workspace';
import { ImportAudioDialog } from './components/ImportAudioDialog';
import { HumToSparkDialog } from './components/HumToSparkDialog';
import { useProjectStore } from './store/projectStore';
import { Loader2 } from 'lucide-react';

function App() {
  const initialize = useProjectStore(state => state.initialize);
  const isReady = useProjectStore(state => state.isReady);

  // StrictMode double-invokes effects; the store guards initialize() so this runs once.
  useEffect(() => { void initialize(); }, [initialize]);

  if (!isReady) {
    return (
      <div className="h-screen w-full bg-zinc-950 text-zinc-400 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={28} className="animate-spin text-zinc-500" />
          <p className="text-xs font-mono uppercase tracking-[0.2em]">Loading workspace…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full bg-zinc-950 text-zinc-200 font-sans flex flex-col overflow-hidden selection:bg-zinc-800">
      <TopBar />
      <ProjectBar />
      <Workspace />
      <ImportAudioDialog />
      <HumToSparkDialog />
      <ProjectPicker />
    </div>
  );
}

export default App;
