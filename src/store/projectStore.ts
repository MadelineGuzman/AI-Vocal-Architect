import { create } from 'zustand';
import type { Finding, SongSection, ChatMessage, AssetMetadata, Spark } from '../types';
import { DSPAnalyzer } from '../services/DSPAnalyzer';
import { ProjectRepository, readLegacyProjects, summarizeProject } from '../services/ProjectRepository';
import type { ProjectStorage, SavedProject, ProjectSummary } from '../services/ProjectRepository';

export const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

interface ProjectState {
  projectId: string | null;
  title: string;
  notes: string;
  createdAt: number;
  storageRevision: number;
  legacySource: SavedProject['legacySource'];
  projects: ProjectSummary[];
  isReady: boolean;
  isBusy: boolean;
  isDirty: boolean;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  storageError: string | null;
  sectionError: string | null;
  isProjectsOpen: boolean;
  audioBlob: Blob | null;
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
  initialize: () => Promise<void>;
  saveProject: () => Promise<boolean>;
  openProject: (id: string) => Promise<boolean>;
  newProject: () => Promise<boolean>;
  importAudio: (file: File, metadata: AssetMetadata, attach?: boolean) => Promise<void>;
  importEarlierProjects: () => Promise<number>;
  refreshProjects: () => Promise<void>;
  setProjectsOpen: (open: boolean) => void;
  setTitle: (title: string) => void;
  setNotes: (notes: string) => void;
  setIsImportModalOpen: (open: boolean) => void;
  setIsHumModalOpen: (open: boolean) => void;
  addSpark: (spark: Spark) => void;
  removeSpark: (id: string) => void;
  setDuration: (duration: number) => void;
  setCurrentTime: (time: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setSelectedFinding: (id: string | null) => void;
  updateFindingStatus: (id: string, status: Finding['userStatus']) => void;
  addChatMessage: (message: ChatMessage) => void;
  clearChatHistory: () => void;
  setAbortController: (controller: AbortController | null) => void;
  addSection: (section: SongSection) => boolean;
  updateSection: (id: string, updates: Partial<SongSection>) => boolean;
  removeSection: (id: string) => void;
}

function initialSparks(): Spark[] {
  try {
    const value = JSON.parse(localStorage.getItem('cadenzai-sparks') || '[]');
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

function measuredFindings(powers: number[], sections: SongSection[], previous: Finding[]): Finding[] {
  return DSPAnalyzer.generateEnergyFindings(powers, sections).map(finding => {
    const existing = previous.find(item => item.id === finding.id && item.evidence === finding.evidence);
    return existing ? { ...finding, userStatus: existing.userStatus } : finding;
  });
}

export function createProjectStore(repository: ProjectStorage = ProjectRepository,
  analyze: (audio: Blob) => Promise<{ duration: number; powers: number[] }> = DSPAnalyzer.analyzeBlob) {
  let revision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<boolean> | null = null;
  let initialization: Promise<void> | null = null;

  const store = create<ProjectState>((set, get) => {
    const dirty = () => {
      revision += 1;
      set({ isDirty: true, saveStatus: 'idle' });
      clearTimeout(timer);
      timer = setTimeout(() => { void get().saveProject(); }, 400);
    };
    const snapshot = (): SavedProject => {
      const state = get();
      return {
        schemaVersion: 1, id: state.projectId!, revision: state.storageRevision,
        title: state.title.trim() || 'Untitled project', notes: state.notes, createdAt: state.createdAt,
        updatedAt: Date.now(), audio: state.audioBlob, audioFileName: state.audioFileName,
        assetMetadata: state.assetMetadata, duration: state.duration, sections: state.sections,
        findings: state.findings, chatHistory: state.chatHistory, legacySource: state.legacySource,
      };
    };
    const applyProject = async (project: SavedProject) => {
      const analysis = project.audio ? await analyze(project.audio) : { duration: 0, powers: [] };
      const invalidRange = project.sections.some(section => section.timeRange.start < 0 ||
        section.timeRange.start >= (section.timeRange.end ?? analysis.duration) ||
        (section.timeRange.end ?? analysis.duration) > analysis.duration);
      if (invalidRange) throw new Error('Saved section times do not match the recording. The saved project has not been changed.');
      const url = project.audio ? URL.createObjectURL(project.audio) : null;
      const oldUrl = get().audioUrl;
      get().abortController?.abort();
      revision = 0;
      set({
        projectId: project.id, title: project.title, notes: project.notes, createdAt: project.createdAt,
        storageRevision: project.revision, legacySource: project.legacySource,
        audioBlob: project.audio, audioUrl: url, audioFileName: project.audioFileName,
        assetMetadata: project.assetMetadata, duration: analysis.duration, windowedPowers: analysis.powers,
        sections: project.sections, findings: measuredFindings(analysis.powers, project.sections, project.findings),
        chatHistory: project.chatHistory, selectedFindingId: null, currentTime: 0, isPlaying: false,
        abortController: null, isDirty: false, saveStatus: 'saved', storageError: null, sectionError: null,
      });
      if (oldUrl) URL.revokeObjectURL(oldUrl);
    };
    const validSection = (section: SongSection) => {
      const { start, end = get().duration } = section.timeRange;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > get().duration || end <= start) {
        set({ sectionError: 'Section times must be within the recording, with the end after the start.' });
        return false;
      }
      set({ sectionError: null }); return true;
    };
    const editSections = (sections: SongSection[]) => {
      const ordered = [...sections].sort((a, b) => a.timeRange.start - b.timeRange.start);
      const findings = measuredFindings(get().windowedPowers, ordered, get().findings);
      set({ sections: ordered, findings, selectedFindingId: findings.some(f => f.id === get().selectedFindingId) ? get().selectedFindingId : null });
      dirty();
    };

    return {
      projectId: null, title: '', notes: '', createdAt: 0, storageRevision: 0, legacySource: undefined,
      projects: [], isReady: false, isBusy: false, isDirty: false, saveStatus: 'idle',
      storageError: null, sectionError: null, isProjectsOpen: false, audioBlob: null,
      audioUrl: null, audioFileName: null, assetMetadata: null, duration: 0, currentTime: 0,
      isPlaying: false, sections: [], findings: [], selectedFindingId: null, windowedPowers: [],
      chatHistory: [], abortController: null, isImportModalOpen: false, isAnalyzing: false,
      isHumModalOpen: false, sparks: initialSparks(),

      initialize: () => {
        if (!initialization) initialization = (async () => {
          set({ isBusy: true });
          try {
            await get().refreshProjects();
            const id = await repository.getActiveId();
            if (id) {
              const project = await repository.get(id);
              if (!project) throw new Error('The last project could not be found. Choose another project or import audio.');
              await applyProject(project);
            }
          } catch (error) {
            set({ storageError: error instanceof Error ? error.message : 'Saved projects could not be opened.', saveStatus: 'error' });
          } finally { set({ isReady: true, isBusy: false }); }
        })();
        return initialization;
      },
      refreshProjects: async () => set({ projects: await repository.list() }),
      saveProject: async () => {
        clearTimeout(timer);
        if (inFlight) {
          if (!await inFlight) return false;
          return get().saveProject();
        }
        if (!get().projectId || !get().isDirty) return true;
        const project = snapshot();
        const capturedRevision = revision;
        set({ saveStatus: 'saving' });
        inFlight = repository.save(project).then(storageRevision => {
          if (get().projectId === project.id) {
            set({ storageRevision, isDirty: revision !== capturedRevision,
              saveStatus: revision === capturedRevision ? 'saved' : 'idle', storageError: null,
              projects: [summarizeProject(project), ...get().projects.filter(item => item.id !== project.id)],
            });
          }
          return true;
        }).catch(error => {
          set({ saveStatus: 'error', storageError: error instanceof Error ? error.message : 'Project could not be saved. Keep this tab open and try Save again.' });
          return false;
        }).finally(() => { inFlight = null; });
        const success = await inFlight;
        return success && get().isDirty ? get().saveProject() : success;
      },
      openProject: async id => {
        if (get().isBusy) return false;
        set({ isBusy: true });
        try {
          if (!await get().saveProject()) return false;
          const project = await repository.get(id);
          if (!project) throw new Error('That saved project could not be found.');
          // A failed read/decode leaves the current workspace intact.
          await applyProject(project);
          await repository.setActiveId(id);
          set({ isProjectsOpen: false });
          return true;
        } catch (error) {
          set({ storageError: error instanceof Error ? error.message : 'Project could not be opened.' });
          return false;
        } finally { set({ isBusy: false }); }
      },
      newProject: async () => {
        if (get().isBusy) return false;
        // Save the current project before clearing so no work is lost.
        if (!await get().saveProject()) return false;
        const previousUrl = get().audioUrl;
        get().abortController?.abort();
        revision = 0;
        set({
          projectId: null, title: '', notes: '', createdAt: 0, storageRevision: 0, legacySource: undefined,
          audioBlob: null, audioUrl: null, audioFileName: null, assetMetadata: null, duration: 0,
          windowedPowers: [], sections: [], findings: [], chatHistory: [], selectedFindingId: null,
          currentTime: 0, isPlaying: false, abortController: null, isDirty: false, saveStatus: 'idle',
          storageError: null, sectionError: null, isProjectsOpen: false,
        });
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        return true;
      },
      importAudio: async (file, metadata, attach = false) => {
        if (get().isBusy) throw new Error('Wait for the current project to finish opening.');
        if (!file.size || file.size > MAX_AUDIO_BYTES) throw new Error('Choose a non-empty audio file up to 100 MB.');
        set({ isBusy: true, isAnalyzing: true });
        try {
          if (!await get().saveProject()) throw new Error('Save the current project successfully before importing another recording.');
          const analysis = await analyze(file);
          if (!Number.isFinite(analysis.duration) || analysis.duration <= 0) throw new Error('This recording has no playable audio.');
          if (attach && (!get().projectId || get().audioBlob)) throw new Error('Audio can only be attached to a project with no recording.');
          const previousUrl = get().audioUrl;
          get().abortController?.abort();
          set({
            ...(attach ? {} : { projectId: `project-${crypto.randomUUID()}`, title: file.name.replace(/\.[^.]+$/, ''),
              notes: '', createdAt: Date.now(), storageRevision: 0, legacySource: undefined }),
            audioBlob: file, audioUrl: URL.createObjectURL(file), audioFileName: file.name,
            assetMetadata: metadata, duration: analysis.duration, windowedPowers: analysis.powers,
            sections: [], findings: [], chatHistory: [], selectedFindingId: null,
            currentTime: 0, isPlaying: false, abortController: null, sectionError: null,
          });
          if (previousUrl) URL.revokeObjectURL(previousUrl);
          dirty();
          // Keep a usable unsaved workspace on quota/storage failure; show the error prominently.
          await get().saveProject();
        } finally { set({ isBusy: false, isAnalyzing: false }); }
      },
      importEarlierProjects: async () => {
        if (get().isBusy) throw new Error('Wait for the current operation to finish.');
        set({ isBusy: true });
        try {
          const count = await repository.importLegacy(readLegacyProjects(localStorage));
          await get().refreshProjects();
          return count;
        } finally { set({ isBusy: false }); }
      },
      setProjectsOpen: isProjectsOpen => set({ isProjectsOpen }),
      setTitle: title => { set({ title }); dirty(); },
      setNotes: notes => { set({ notes }); dirty(); },
      setIsImportModalOpen: isImportModalOpen => set({ isImportModalOpen }),
      setIsHumModalOpen: isHumModalOpen => set({ isHumModalOpen }),
      addSpark: spark => {
        const sparks = [spark, ...get().sparks];
        localStorage.setItem('cadenzai-sparks', JSON.stringify(sparks)); set({ sparks });
      },
      removeSpark: id => {
        const sparks = get().sparks.filter(spark => spark.id !== id);
        localStorage.setItem('cadenzai-sparks', JSON.stringify(sparks)); set({ sparks });
      },
      setDuration: duration => set({ duration }),
      setCurrentTime: currentTime => set({ currentTime }),
      setIsPlaying: isPlaying => set({ isPlaying }),
      setSelectedFinding: selectedFindingId => set({ selectedFindingId }),
      updateFindingStatus: (id, userStatus) => {
        set({ findings: get().findings.map(finding => finding.id === id ? { ...finding, userStatus } : finding) }); dirty();
      },
      addChatMessage: message => { set({ chatHistory: [...get().chatHistory, message] }); dirty(); },
      clearChatHistory: () => { set({ chatHistory: [] }); dirty(); },
      setAbortController: abortController => set({ abortController }),
      addSection: section => { if (!validSection(section)) return false; editSections([...get().sections, section]); return true; },
      updateSection: (id, updates) => {
        const existing = get().sections.find(section => section.id === id);
        if (!existing) return false;
        const section = { ...existing, ...updates };
        if (!validSection(section)) return false;
        editSections(get().sections.map(item => item.id === id ? section : item)); return true;
      },
      removeSection: id => { set({ sectionError: null }); editSections(get().sections.filter(section => section.id !== id)); },
    };
  });
  return store;
}

export const useProjectStore = createProjectStore();
