import type { AssetMetadata, ChatMessage, Finding, SongSection } from '../types';

export interface SavedProject {
  schemaVersion: 1;
  id: string;
  revision: number;
  title: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
  audio: Blob | null;
  audioFileName: string | null;
  assetMetadata: AssetMetadata | null;
  duration: number;
  sections: SongSection[];
  findings: Finding[];
  chatHistory: ChatMessage[];
  legacySource?: { key: string; project: Record<string, unknown> };
}

export type ProjectSummary = Pick<SavedProject, 'id' | 'title' | 'updatedAt'> & { hasAudio: boolean };
export const summarizeProject = (project: SavedProject): ProjectSummary => ({
  id: project.id, title: project.title, updatedAt: project.updatedAt, hasAudio: Boolean(project.audio),
});

export interface ProjectStorage {
  list(): Promise<ProjectSummary[]>;
  get(id: string): Promise<SavedProject | undefined>;
  getActiveId(): Promise<string | undefined>;
  setActiveId(id: string): Promise<void>;
  save(project: SavedProject): Promise<number>;
  importLegacy(bundle: LegacyBundle): Promise<number>;
}

interface LegacyBundle {
  projects: SavedProject[];
  originals: Record<string, string>;
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string' ? value : '';

// Explicit, repeatable migration. Never write to or remove the source keys.
export function readLegacyProjects(storage: Pick<Storage, 'getItem'>): LegacyBundle {
  const originals: Record<string, string> = {};
  const projects = new Map<string, SavedProject>();
  for (const key of ['syzygy_cadenzai_state_v1', 'syzygy_opus_state_v1']) {
    const raw = storage.getItem(key);
    if (!raw) continue;
    const source: unknown = JSON.parse(raw);
    if (!record(source) || source.version !== 1 || !Array.isArray(source.projects)) {
      throw new Error('Earlier project data could not be read. The original data has not been changed.');
    }
    originals[key] = raw; // Includes ideas, settings and fields not yet supported by the new workspace.
    for (const item of source.projects) {
      if (!record(item) || typeof item.id !== 'string' || !record(item.metadata)) {
        throw new Error('An earlier project is incomplete. No earlier data has been changed.');
      }
      const id = `legacy-project:${item.id}`;
      if (projects.has(id)) continue; // Prefer the newer Cadenzai key over the Opus fallback.
      const metadata = item.metadata;
      const noteParts: string[] = [];
      for (const field of ['artist', 'genre', 'daw']) {
        if (text(metadata[field])) noteParts.push(`${field}: ${text(metadata[field])}`);
      }
      if (record(item.intent)) {
        for (const [field, value] of Object.entries(item.intent)) {
          if (text(value)) noteParts.push(`${field}: ${text(value)}`);
        }
      }
      if (Array.isArray(item.lyrics)) {
        for (const lyric of item.lyrics) {
          if (record(lyric) && text(lyric.text)) noteParts.push(`${text(lyric.type) || 'Lyrics'}\n${text(lyric.text)}`);
        }
      }
      projects.set(id, {
        schemaVersion: 1, id, revision: 0, title: text(metadata.title) || 'Earlier project',
        notes: noteParts.join('\n\n'), createdAt: Date.parse(text(metadata.createdAt)) || Date.now(),
        updatedAt: Date.now(), audio: null, audioFileName: null, assetMetadata: null, duration: 0,
        sections: [], findings: [], chatHistory: [], legacySource: { key, project: item },
      });
    }
  }
  return { projects: [...projects.values()], originals };
}

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  if (!globalThis.indexedDB) { reject(new Error('This browser cannot store projects.')); return; }
  const request = indexedDB.open('cadenzai-projects', 1);
  let blocked = false;
  request.onupgradeneeded = () => {
    request.result.createObjectStore('projects', { keyPath: 'id' });
    request.result.createObjectStore('session');
  };
  request.onblocked = () => { blocked = true; reject(new Error('Close other Cadenzai tabs, then try again.')); };
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const database = request.result;
    database.onversionchange = () => database.close();
    if (blocked) database.close();
    else resolve(database);
  };
});

async function transact<T>(stores: string[], mode: IDBTransactionMode,
  run: (transaction: IDBTransaction, result: (value: T) => void, abort: (error: Error) => void) => void): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(stores, mode);
      let value: T;
      let failure: Error | undefined;
      // A successful request is not yet a committed transaction.
      transaction.oncomplete = () => resolve(value);
      transaction.onabort = () => reject(failure || transaction.error || new Error('Project save was interrupted.'));
      transaction.onerror = () => { /* onabort owns failure reporting */ };
      try {
        run(transaction, result => { value = result; }, error => { failure = error; transaction.abort(); });
      } catch (error) {
        failure = error instanceof Error ? error : new Error('Project storage failed.');
        transaction.abort();
      }
    });
  } finally { database.close(); }
}

function validateProject(value: unknown): asserts value is SavedProject {
  if (!record(value) || value.schemaVersion !== 1 || typeof value.id !== 'string' ||
      typeof value.title !== 'string' || typeof value.notes !== 'string' ||
      !Number.isInteger(value.revision) || !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt) ||
      !(value.audio === null || value.audio instanceof Blob) ||
      !Array.isArray(value.sections) || !value.sections.every(section => record(section) &&
        typeof section.id === 'string' && typeof section.name === 'string' && typeof section.color === 'string' &&
        record(section.timeRange) && Number.isFinite(section.timeRange.start) &&
        (section.timeRange.end === undefined || Number.isFinite(section.timeRange.end))) ||
      !Array.isArray(value.findings) || !value.findings.every(finding => record(finding) &&
        typeof finding.id === 'string' && typeof finding.evidence === 'string') ||
      !Array.isArray(value.chatHistory) || !value.chatHistory.every(message => record(message) &&
        typeof message.id === 'string' && typeof message.content === 'string' && ['user', 'assistant'].includes(String(message.role)))) {
    throw new Error('This saved project is incomplete or uses an unsupported format. Its stored data has been left intact.');
  }
}

export const ProjectRepository: ProjectStorage = {
  list: () => transact(['projects'], 'readonly', (transaction, result) => {
    const request = transaction.objectStore('projects').getAll();
    request.onsuccess = () => result((request.result as SavedProject[]).map(summarizeProject).sort((a, b) => b.updatedAt - a.updatedAt));
  }),
  get: id => transact(['projects'], 'readonly', (transaction, result, abort) => {
    const request = transaction.objectStore('projects').get(id);
    request.onsuccess = () => {
      try { if (request.result !== undefined) validateProject(request.result); result(request.result); }
      catch (error) { abort(error as Error); }
    };
  }),
  getActiveId: () => transact(['session'], 'readonly', (transaction, result) => {
    const request = transaction.objectStore('session').get('active-project');
    request.onsuccess = () => result(request.result);
  }),
  setActiveId: id => transact(['session'], 'readwrite', (transaction, result) => {
    transaction.objectStore('session').put(id, 'active-project'); result(undefined);
  }),
  save: project => transact(['projects', 'session'], 'readwrite', (transaction, result, abort) => {
    const projects = transaction.objectStore('projects');
    const existing = projects.get(project.id);
    existing.onsuccess = () => {
      if ((existing.result?.revision ?? 0) !== project.revision) {
        abort(new Error('This project changed in another tab. Keep this tab open and copy any unsaved notes before reopening the latest version.'));
        return;
      }
      const nextRevision = project.revision + 1;
      projects.put({ ...project, revision: nextRevision });
      transaction.objectStore('session').put(project.id, 'active-project');
      result(nextRevision);
    };
  }),
  importLegacy: bundle => transact(['projects', 'session'], 'readwrite', (transaction, result) => {
    let count = 0;
    result(count);
    const projects = transaction.objectStore('projects');
    for (const project of bundle.projects) {
      const request = projects.get(project.id);
      request.onsuccess = () => {
        if (!request.result) { projects.add({ ...project, revision: 1 }); count += 1; result(count); }
      };
    }
    for (const [key, raw] of Object.entries(bundle.originals)) {
      // Keep each distinct migration source snapshot, including unported fields and ideas.
      transaction.objectStore('session').put(raw, `legacy-backup:${key}:${Date.now()}`);
    }
  }),
};
