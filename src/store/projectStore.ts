import { create } from 'zustand';
import { Finding, SongSection, ChatMessage, AssetMetadata, Spark } from '../types';
import { DSPAnalyzer } from '../services/DSPAnalyzer';

interface ProjectState {
  audioUrl: string | null;
  audioFileName: string | null;
  assetMetadata: AssetMetadata | null;
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  sections: SongSection[];
  findings: Finding[];
  selectedFindingId: string | null;
  windowedPowers: number[];
  chatHistory: ChatMessage[];
  abortController: AbortController | null;
  isImportModalOpen: boolean;
  isAnalyzing: boolean;
  isHumModalOpen: boolean;
  sparks: Spark[];

  // Actions
  setIsImportModalOpen: (isOpen: boolean) => void;
  setIsAnalyzing: (isAnalyzing: boolean) => void;
  setIsHumModalOpen: (isOpen: boolean) => void;
  addSpark: (spark: Spark) => void;
  removeSpark: (id: string) => void;
  setAudio: (url: string, fileName: string, metadata?: AssetMetadata | null) => void;
  setDuration: (duration: number) => void;
  setCurrentTime: (time: number) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setFindings: (findings: Finding[]) => void;
  setSelectedFinding: (id: string | null) => void;
  updateFindingStatus: (id: string, status: Finding['userStatus']) => void;
  addChatMessage: (msg: ChatMessage) => void;
  clearChatHistory: () => void;
  setAbortController: (controller: AbortController | null) => void;

  // Section & Analysis Management
  setWindowedPowers: (powers: number[]) => void;
  addSection: (section: SongSection) => void;
  updateSection: (id: string, updates: Partial<SongSection>) => void;
  removeSection: (id: string) => void;
  refreshDSPFindings: () => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  audioUrl: null,
  audioFileName: null,
  assetMetadata: null,
  duration: 0,
  currentTime: 0,
  isPlaying: false,
  sections: [],
  findings: [],
  selectedFindingId: null,
  windowedPowers: [],
  chatHistory: [],
  abortController: null,
  isImportModalOpen: false,
  isAnalyzing: false,
  isHumModalOpen: false,
  sparks: (() => {
    try { return JSON.parse(localStorage.getItem('cadenzai-sparks') || '[]') as Spark[]; }
    catch { return []; }
  })(),

  setIsImportModalOpen: (isOpen) => set({ isImportModalOpen: isOpen }),
  setIsAnalyzing: (isAnalyzing) => set({ isAnalyzing }),
  setIsHumModalOpen: (isOpen) => set({ isHumModalOpen: isOpen }),
  addSpark: (spark) => set((state) => {
    const sparks = [spark, ...state.sparks];
    localStorage.setItem('cadenzai-sparks', JSON.stringify(sparks));
    return { sparks };
  }),
  removeSpark: (id) => set((state) => {
    const sparks = state.sparks.filter(spark => spark.id !== id);
    localStorage.setItem('cadenzai-sparks', JSON.stringify(sparks));
    return { sparks };
  }),
  setAudio: (url, fileName, metadata = null) => set({ audioUrl: url, audioFileName: fileName, assetMetadata: metadata, sections: [], findings: [], windowedPowers: [], chatHistory: [], selectedFindingId: null, currentTime: 0, isPlaying: false }),
  setDuration: (duration) => set({ duration }),
  setCurrentTime: (currentTime) => set({ currentTime }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setFindings: (findings) => set({ findings }),
  setSelectedFinding: (id) => set({ selectedFindingId: id }),
  updateFindingStatus: (id, status) => set((state) => ({
    findings: state.findings.map(f => f.id === id ? { ...f, userStatus: status } : f)
  })),
  addChatMessage: (msg) => set((state) => ({ chatHistory: [...state.chatHistory, msg] })),
  clearChatHistory: () => set({ chatHistory: [] }),
  setAbortController: (controller) => set({ abortController: controller }),

  setWindowedPowers: (powers) => {
    set({ windowedPowers: powers });
    get().refreshDSPFindings();
  },

  addSection: (section) => {
    set((state) => {
      const sections = [...state.sections, section].sort((a, b) => a.timeRange.start - b.timeRange.start);
      return { sections };
    });
    get().refreshDSPFindings();
  },

  updateSection: (id, updates) => {
    set((state) => {
      const sections = state.sections
        .map(s => s.id === id ? { ...s, ...updates } : s)
        .sort((a, b) => a.timeRange.start - b.timeRange.start);
      return { sections };
    });
    get().refreshDSPFindings();
  },

  removeSection: (id) => {
    set((state) => {
      const sections = state.sections.filter(s => s.id !== id);
      return { sections };
    });
    get().refreshDSPFindings();
  },

  refreshDSPFindings: () => {
    const { windowedPowers, sections, findings } = get();
    if (!windowedPowers.length || sections.length < 2) {
      // Remove real-dsp findings if no powers or not enough sections
      set({ findings: findings.filter(f => f.provenance !== 'real-dsp') });
      return;
    }

    const newFindings = DSPAnalyzer.generateEnergyFindings(windowedPowers, sections);
    const mockAndOthers = findings.filter(f => f.provenance !== 'real-dsp');

    // Preserve userStatus for existing findings that match the deterministic ID
    const preservedNew = newFindings.map(nf => {
      const existing = findings.find(p => p.id === nf.id);
      return existing ? { ...nf, userStatus: existing.userStatus } : nf;
    });

    set({ findings: [...mockAndOthers, ...preservedNew] });
  }
}));
