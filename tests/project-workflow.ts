/**
 * Deterministic coverage of the React persistence workflow.
 *
 * The store accepts an injected ProjectStorage and analyze() function, so the
 * full import -> sections -> findings -> save -> reopen -> switch flow is
 * exercised here against an in-memory storage and a fake analyzer. This covers
 * the acceptance criteria that do not require a real browser; microphone
 * capture, IndexedDB commit, and playback are verified manually in-app.
 *
 * Run with: tsx tests/project-workflow.ts
 */
import assert from 'node:assert/strict';

// ---- Browser shims (must exist before the store module loads) ----
const storage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
  setItem: (k: string, v: string) => { storage.set(k, String(v)); },
  removeItem: (k: string) => { storage.delete(k); },
};
if (!(globalThis as any).URL.createObjectURL) (globalThis as any).URL.createObjectURL = () => 'blob:mock';
if (!(globalThis as any).URL.revokeObjectURL) (globalThis as any).URL.revokeObjectURL = () => {};

const { createProjectStore } = await import('../src/store/projectStore.ts');
const { readLegacyProjects } = await import('../src/services/ProjectRepository.ts');
type SavedProject = import('../src/services/ProjectRepository.ts').SavedProject;
type ProjectStorage = import('../src/services/ProjectRepository.ts').ProjectStorage;
import type { AssetMetadata, SongSection } from '../src/types';

// ---- Fake persistence layer with the same revision semantics as ProjectRepository ----
function createFakeRepo() {
  const projects = new Map<string, SavedProject>();
  let activeId: string | undefined;
  let failSaveOnce = false;
  let gate: Promise<void> | null = null;
  let openGate: (() => void) | null = null;
  const repo: ProjectStorage = {
    async list() {
      return [...projects.values()]
        .map(p => ({ id: p.id, title: p.title, updatedAt: p.updatedAt, hasAudio: Boolean(p.audio) }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async get(id) { return projects.get(id); },
    async getActiveId() { return activeId; },
    async setActiveId(id) { activeId = id; },
    async save(project) {
      if (failSaveOnce) { failSaveOnce = false; throw new Error('Storage quota exceeded.'); }
      if (gate) await gate;
      const existing = projects.get(project.id);
      const currentRev = existing ? existing.revision : 0;
      if (currentRev !== project.revision) {
        throw new Error('This project changed in another tab. Copy any unsaved notes before reopening the latest version.');
      }
      const nextRevision = project.revision + 1;
      projects.set(project.id, { ...project, revision: nextRevision });
      activeId = project.id;
      return nextRevision;
    },
    async importLegacy(bundle) {
      let count = 0;
      for (const p of bundle.projects) if (!projects.has(p.id)) { projects.set(p.id, { ...p, revision: 1 }); count += 1; }
      return count;
    },
  };
  return {
    repo, projects,
    failSaveOnce: () => { failSaveOnce = true; },
    arm: () => { gate = new Promise<void>(res => { openGate = res; }); },
    release: () => { openGate?.(); gate = null; openGate = null; },
    setActive: (id: string) => { activeId = id; },
  };
}

const POWERS = [...Array(12).fill(0.1), ...Array(12).fill(0.001)]; // loud first half, quiet second
const fakeAnalyze = async () => ({ duration: 12, powers: [...POWERS] });
const meta: AssetMetadata = { assetType: 'Full Mix / Premix', content: '', userLabel: '' };
const audioFile = () => new File([new Uint8Array(2048)], 'take.wav', { type: 'audio/wav' });
const twoSections = (): SongSection[] => [
  { id: 's1', name: 'Verse', color: '#1d4ed8', timeRange: { start: 0, end: 6 }, provenance: 'artist' },
  { id: 's2', name: 'Chorus', color: '#be185d', timeRange: { start: 6, end: 12 }, provenance: 'artist' },
];
const flush = () => new Promise(r => setTimeout(r, 0));

async function run() {
  // 1. Import produces measured findings and NO canned mock findings.
  {
    const fake = createFakeRepo();
    const store = createProjectStore(fake.repo, fakeAnalyze);
    await store.getState().initialize();
    await store.getState().importAudio(audioFile(), meta);
    for (const s of twoSections()) assert.equal(store.getState().addSection(s), true);
    const findings = store.getState().findings;
    assert.ok(findings.length > 0, 'sections should yield measured energy findings');
    assert.ok(findings.every(f => f.provenance === 'real-dsp'), 'no canned mock/pitch findings on import');
    assert.ok(findings.some(f => f.id === 'dsp-energy-s1-s2'), 'energy transition finding present');
    assert.equal(store.getState().projectId !== null, true, 'import created a project');
  }

  // 2. Save title/notes/sections/decisions/audio, then reopen in a fresh store (refresh) restores them.
  {
    const fake = createFakeRepo();
    let store = createProjectStore(fake.repo, fakeAnalyze);
    await store.getState().initialize();
    await store.getState().importAudio(audioFile(), meta);
    store.getState().setTitle('Gravity');
    store.getState().setNotes('Chorus should lift.');
    for (const s of twoSections()) store.getState().addSection(s);
    const fId = store.getState().findings[0].id;
    store.getState().updateFindingStatus(fId, 'accepted');
    assert.equal(await store.getState().saveProject(), true, 'save should succeed');
    assert.equal(store.getState().saveStatus, 'saved');
    const savedId = store.getState().projectId!;

    // Simulate a browser refresh: new store instance, same persistence layer.
    store = createProjectStore(fake.repo, fakeAnalyze);
    await store.getState().initialize();
    const s = store.getState();
    assert.equal(s.projectId, savedId, 'last active project reopened');
    assert.equal(s.title, 'Gravity');
    assert.equal(s.notes, 'Chorus should lift.');
    assert.equal(s.sections.length, 2, 'sections restored');
    assert.ok(s.audioBlob instanceof Blob, 'recording restored');
    assert.ok(s.findings.length > 0, 'findings recomputed from restored audio');
    assert.equal(s.findings.find(f => f.id === fId)?.userStatus, 'accepted', 'finding decision restored');
  }

  // 3. Two projects, switch between them without contamination.
  {
    const fake = createFakeRepo();
    const store = createProjectStore(fake.repo, fakeAnalyze);
    await store.getState().initialize();
    await store.getState().importAudio(audioFile(), meta);
    store.getState().setTitle('Song A');
    store.getState().addSection({ id: 'a1', name: 'Verse', color: '#1', timeRange: { start: 0, end: 5 }, provenance: 'artist' });
    await store.getState().saveProject();
    const idA = store.getState().projectId!;

    await store.getState().newProject();
    assert.equal(store.getState().projectId, null, 'newProject clears the workspace');
    await store.getState().importAudio(audioFile(), meta);
    store.getState().setTitle('Song B');
    store.getState().addSection({ id: 'b1', name: 'Bridge', color: '#2', timeRange: { start: 1, end: 7 }, provenance: 'artist' });
    await store.getState().saveProject();
    const idB = store.getState().projectId!;
    assert.notEqual(idA, idB, 'second project has its own id');

    assert.equal(await store.getState().openProject(idA), true);
    assert.equal(store.getState().title, 'Song A');
    assert.deepEqual(store.getState().sections.map(x => x.id), ['a1']);
    assert.equal(await store.getState().openProject(idB), true);
    assert.equal(store.getState().title, 'Song B');
    assert.deepEqual(store.getState().sections.map(x => x.id), ['b1']);
  }

  // 4. Invalid audio import leaves the previous project intact.
  {
    const fake = createFakeRepo();
    let failImport = false;
    const analyze = async () => {
      if (failImport) throw new Error('This audio file could not be decoded.');
      return { duration: 12, powers: [...POWERS] };
    };
    const store = createProjectStore(fake.repo, analyze);
    await store.getState().initialize();
    await store.getState().importAudio(audioFile(), meta);
    store.getState().setTitle('Keeper');
    await store.getState().saveProject();
    const keptId = store.getState().projectId;

    failImport = true;
    await assert.rejects(() => store.getState().importAudio(audioFile(), meta), /decoded/);
    assert.equal(store.getState().projectId, keptId, 'previous project remains active after a failed import');
    assert.equal(store.getState().title, 'Keeper', 'previous project title is unchanged');
    assert.ok(store.getState().audioBlob instanceof Blob, 'previous recording remains loaded');
  }

  // 5. Invalid section ranges are rejected clearly and change nothing.
  {
    const fake = createFakeRepo();
    const store = createProjectStore(fake.repo, fakeAnalyze);
    await store.getState().initialize();
    await store.getState().importAudio(audioFile(), meta);
    assert.equal(store.getState().addSection({ id: 'x', name: 'Verse', color: '#1', timeRange: { start: 8, end: 4 }, provenance: 'artist' }), false, 'end before start rejected');
    assert.equal(store.getState().addSection({ id: 'y', name: 'Verse', color: '#1', timeRange: { start: 0, end: 99 }, provenance: 'artist' }), false, 'end beyond duration rejected');
    assert.ok(store.getState().sectionError, 'a section error message is surfaced');
    assert.equal(store.getState().sections.length, 0, 'no invalid section was added');
  }

  // 6. Storage failure never reports "Saved".
  {
    const fake = createFakeRepo();
    const store = createProjectStore(fake.repo, fakeAnalyze);
    await store.getState().initialize();
    await store.getState().importAudio(audioFile(), meta); // first save happens here
    fake.failSaveOnce();
    store.getState().setTitle('Will fail');
    const ok = await store.getState().saveProject();
    assert.equal(ok, false, 'save returns false on storage failure');
    assert.equal(store.getState().saveStatus, 'error');
    assert.notEqual(store.getState().saveStatus, 'saved');
    assert.ok(store.getState().storageError, 'a storage error is surfaced');
  }

  // 7. Edits made during an in-progress save are not lost.
  {
    const fake = createFakeRepo();
    const store = createProjectStore(fake.repo, fakeAnalyze);
    await store.getState().initialize();
    await store.getState().importAudio(audioFile(), meta);
    const id = store.getState().projectId!;
    store.getState().setTitle('First');
    fake.arm();                       // make the next save block until released
    const saving = store.getState().saveProject();
    await flush();
    store.getState().setTitle('Second'); // edit while the save is in flight
    fake.release();
    await saving;
    await flush();
    await store.getState().saveProject(); // drain any trailing dirty state
    assert.equal(fake.projects.get(id)!.title, 'Second', 'the later edit is persisted, not lost');
    assert.equal(store.getState().isDirty, false, 'no unsaved changes remain');
  }

  // 8. A conflicting save from another tab does not silently overwrite.
  {
    const fake = createFakeRepo();
    const store = createProjectStore(fake.repo, fakeAnalyze);
    await store.getState().initialize();
    await store.getState().importAudio(audioFile(), meta);
    store.getState().setTitle('Mine');
    await store.getState().saveProject();
    const id = store.getState().projectId!;
    // Another tab writes a newer revision underneath us.
    const external = fake.projects.get(id)!;
    fake.projects.set(id, { ...external, revision: external.revision + 5, title: 'Other tab' });
    store.getState().setTitle('Mine edited');
    const ok = await store.getState().saveProject();
    assert.equal(ok, false, 'conflicting save is refused');
    assert.match(store.getState().storageError || '', /another tab/i);
    assert.equal(fake.projects.get(id)!.title, 'Other tab', 'the other tab\'s data was not overwritten');
  }

  // 9. Legacy import: pure reader maps metadata and never mutates the source.
  {
    const legacy = {
      version: 1,
      projects: [{
        id: 'p1',
        metadata: { title: 'Old Song', artist: 'SABLE', genre: 'drill', createdAt: '2026-01-01T00:00:00.000Z' },
        intent: { central: 'about leaving' },
        lyrics: [{ type: 'Verse 1', text: 'first line' }],
        unsupportedFutureField: { keep: true },
      }],
    };
    const raw = JSON.stringify(legacy);
    const src = new Map<string, string>([['syzygy_cadenzai_state_v1', raw]]);
    const bundle = readLegacyProjects({ getItem: k => src.get(k) ?? null });
    assert.equal(bundle.projects.length, 1);
    const p = bundle.projects[0];
    assert.equal(p.id, 'legacy-project:p1');
    assert.equal(p.title, 'Old Song');
    assert.ok(p.notes.includes('artist: SABLE'), 'artist folded into notes');
    assert.ok(p.notes.includes('about leaving'), 'intent folded into notes');
    assert.ok(p.notes.includes('first line'), 'lyrics folded into notes');
    assert.equal(p.audio, null, 'legacy projects have no audio and must request reattachment');
    assert.deepEqual((p.legacySource!.project as any).unsupportedFutureField, { keep: true }, 'unsupported original data preserved');
    assert.equal(src.get('syzygy_cadenzai_state_v1'), raw, 'source key left byte-for-byte unchanged');
    assert.ok(bundle.originals['syzygy_cadenzai_state_v1'], 'original snapshot retained');
  }

  // 10. Legacy import through the store is repeatable without duplicates; recovered projects need audio.
  {
    const fake = createFakeRepo();
    const store = createProjectStore(fake.repo, fakeAnalyze);
    await store.getState().initialize();
    storage.set('syzygy_cadenzai_state_v1', JSON.stringify({
      version: 1,
      projects: [{ id: 'p1', metadata: { title: 'Recovered' }, intent: {}, lyrics: [] }],
    }));
    const first = await store.getState().importEarlierProjects();
    const second = await store.getState().importEarlierProjects();
    assert.equal(first, 1, 'one project imported the first time');
    assert.equal(second, 0, 'repeat import adds no duplicates');
    const summary = store.getState().projects.find(p => p.id === 'legacy-project:p1');
    assert.ok(summary, 'recovered project appears in the picker');
    assert.equal(summary!.hasAudio, false, 'recovered project has no audio and must request a recording');

    assert.equal(await store.getState().openProject('legacy-project:p1'), true);
    assert.equal(store.getState().audioBlob, null, 'opened recovered project has no recording yet');
    assert.equal(store.getState().projectId, 'legacy-project:p1', 'recovered project becomes active for reattachment');
  }

  console.log('Cadenzai project workflow checks passed');
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
