import { TopBar } from './components/TopBar';
import { Workspace } from './components/workspace/Workspace';
import { ImportAudioDialog } from './components/ImportAudioDialog';
import { HumToSparkDialog } from './components/HumToSparkDialog';

function App() {
  return (
    <div className="h-screen w-full bg-zinc-950 text-zinc-200 font-sans flex flex-col overflow-hidden selection:bg-zinc-800">
      <TopBar />
      <Workspace />
      <ImportAudioDialog />
      <HumToSparkDialog />
    </div>
  );
}

export default App;
