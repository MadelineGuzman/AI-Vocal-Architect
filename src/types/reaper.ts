export interface ReaperSnapshot {
  version: 1;
  sessionId: string;
  sequence: number;
  revision?: number;
  updatedAt: number;
  project: { sessionId: string; name: string; saved: boolean };
  tracks: Array<{ id: string; name: string; number: number; isMaster: boolean }>;
}
export interface ReaperState {
  status: 'waiting' | 'connected' | 'disconnected' | 'error';
  snapshot: ReaperSnapshot | null;
  message: string;
  levels?: LevelReport | null;
  levelsError?: string;
  levelsNotice?: {message: string; updatedAt: number; requestId?: string};
}

// Response to POST /api/reaper/analyze. The server generates the requestId and
// writes a single bounded request file; REAPER echoes the id back in its report.
export interface AnalyzeRequestResponse {
  requestId: string;
}

// Producer-directed EQ write-back (draw-to-EQ Gate 2). A drawn bell band and the
// outcome the bridge echoes back after adding the ReaEQ.
export interface EqBand { f: number; g: number; q: number }
export interface ApplyEqResponse { requestId: string }
export interface EqResult {
  requestId: string;
  status: 'applied' | 'error';
  message: string;
  trackName: string;
  bandCount: number;
  updatedAt: number;
}

export interface LevelMetrics {
  samplePeakDbfs?: number; rmsDbfs?: number; crestDb?: number; activeVariationDb?: number;
  activeWindows: number; samplesAtFullScale: number; sampleCount: number; silent: boolean;
  // Downsampled peak-over-time envelope in dBFS (for the loudness waveform).
  envelope?: number[];
  // Log-spaced relative tone curve (for the frequency view / overlap).
  spectrum?: { f: number; db: number }[];
}
export interface LevelReport {
  version: 1; id: string; status: 'running' | 'ready' | 'error'; message: string; updatedAt: number;
  requestId?: string;
  projectId: string; projectRevision: number; trackId: string; trackName: string; takeId: string; takeName: string;
  signal: 'take-pre-fx'; sampleRate: number; channels: number; startSeconds: number; endSeconds: number;
  progress: number; metrics?: LevelMetrics;
}
