(function () {
"use strict";

const STORAGE_KEY = "syzygy_cadenzai_state_v1";

const now = () => new Date().toISOString();
let fallbackId = 0;
const makeId = prefix => globalThis.crypto?.randomUUID ? `${prefix}-${globalThis.crypto.randomUUID()}` : `${prefix}-${Date.now()}-${fallbackId++}`;

function createProject(input = {}) {
  const id = input.id || makeId("project");
  return {
    id,
    metadata: {
      title: input.title || "Untitled Song",
      artist: input.artist || "Independent Artist",
      genre: input.genre || "Modern vocal production",
      daw: input.daw || "REAPER",
      currentStage: input.currentStage || "intent",
      readiness: input.readiness || "Needs Development",
      createdAt: input.createdAt || now(),
      updatedAt: now()
    },
    intent: {
      central: input.intent?.central || "",
      perspective: input.intent?.perspective || "",
      response: input.intent?.response || "",
      voice: input.intent?.voice || "",
      mood: input.intent?.mood || "",
      conflict: input.intent?.conflict || "",
      destination: input.intent?.destination || "",
      nonnegotiables: input.intent?.nonnegotiables || "",
      accessibility: input.intent?.accessibility ?? 50
    },
    lyrics: input.lyrics || [],
    assets: input.assets || [],
    preferences: {
      mode: input.preferences?.mode || "guided",
      intensity: input.preferences?.intensity ?? 5,
      plugins: input.preferences?.plugins || []
    },
    generatedChain: input.generatedChain || null,
    analysis: input.analysis || null,
    reviewHistory: input.reviewHistory || [],
    session: {
      activeStage: input.session?.activeStage || input.currentStage || "overview",
      expandedChainStep: input.session?.expandedChainStep || "eq",
      chainOrder: input.session?.chainOrder || ["cleanup", "eq", "compression", "deesser", "saturation", "delay", "reverb"],
      lyricDecisions: input.session?.lyricDecisions || {}
    }
  };
}

// A Spark is a captured idea. It is a self-contained, portable record (safe to
// export as a file and sync to Drive/iCloud later) built from the melody
// analyzer's read. Raw audio lives in IndexedDB, referenced by audioRef.
function createSpark(input = {}) {
  const analysis = input.analysis || {};
  const createdAt = input.createdAt || now();
  const id = input.id || makeId("spark");
  return {
    schemaVersion: analysis.schemaVersion || "0.1.0",
    analyzerVersion: analysis.analyzerVersion || "unknown",
    id,
    createdAt,
    title: input.title || `Untitled idea · ${new Date(createdAt).toLocaleDateString()}`,
    note: input.note || "",
    durationSeconds: analysis.durationSeconds ?? 0,
    capture: { kind: input.kind || "hum", sampleRateHz: input.sampleRateHz || null },
    musical: analysis.musical || { key: { value: null, confidence: 0 }, tempo: { value: null, confidence: 0 }, noteSequence: [] },
    read: analysis.read || { inference: "inconclusive", confidence: 0, evidence: [], limitations: [] },
    audioRef: input.audioRef || null,
    promotedProjectId: input.promotedProjectId || null
  };
}

const sampleProject = createProject({
  id: "gravity-doesnt-ask",
  title: "Gravity Doesn't Ask",
  artist: "Rara Kallistos",
  genre: "Alternative R&B / cinematic pop",
  daw: "REAPER",
  currentStage: "chain",
  readiness: "Ready to Record",
  preferences: {
    mode: "guided",
    intensity: 5,
    plugins: ["REAPER stock", "TDR Nova", "TDR SlickEQ", "MJUC jr.", "Melda free bundle", "Baby Audio"]
  },
  intent: {
    central: "Realizing a relationship has slowly pulled you away from yourself.",
    perspective: "First person — reflective, then confrontational, then released.",
    response: "Recognition and catharsis; the feeling of naming something you tolerated too long.",
    voice: "Intimate and unguarded, never performative.",
    mood: "Gravity, quiet tension, eventual release.",
    conflict: "Devotion versus self-erasure.",
    destination: "Release, not heartbreak.",
    nonnegotiables: "Chorus: “I kept calling it devotion / While it turned me into someone I'm not.”",
    accessibility: 60
  },
  lyrics: [
    {
      id: "verse-1", type: "Verse 1", name: "Restrained, intimate",
      text: "I learned to breathe around the weight\nMade a home inside the waiting\nEvery promise changed its shape\nEvery silence kept me staying",
      feedback: [
        { id: "v1-image", certainty: "Creative", text: "“Made a home inside the waiting” is the strongest image here — it makes the passivity physical. Consider building the verse around it." },
        { id: "v1-repeat", certainty: "Inferred", text: "Lines 3–4 both land on staying and waiting. Letting line 4 name a consequence would advance the story instead of restating the stasis." }
      ]
    },
    { id: "pre-chorus", type: "Pre-Chorus", name: "Lift into the hook", text: "", feedback: [] },
    {
      id: "chorus", type: "Chorus", name: "Wide, forceful", hook: "Strong hook",
      text: "Gravity doesn't ask before it pulls\nDoesn't care how far you've come\nI kept calling it devotion\nWhile it turned me into someone I'm not",
      feedback: [
        { id: "chorus-core", certainty: "Creative", text: "Title-bearing and memorable. The devotion → “someone I'm not” turn is the emotional core of the song." },
        { id: "chorus-protected", certainty: "Confirm", text: "These lines are marked non-negotiable. Feedback remains advisory and never rewrites them automatically." }
      ]
    },
    { id: "bridge", type: "Bridge", name: "Turn toward release", text: "", feedback: [] }
  ]
});

const seedState = () => ({
  version: 1,
  user: { displayName: "Rara", initials: "R" },
  preferences: { mode: "guided" },
  ideas: [],
  projects: [
    sampleProject,
    createProject({ id: "paper-satellites", title: "Paper Satellites", artist: "Neon Liturgy", genre: "Cinematic pop", readiness: "Needs Development", currentStage: "lyrics" }),
    createProject({ id: "low-orbit", title: "Low Orbit", artist: "SABLE", genre: "Drill / dark trap", readiness: "Ready to Mix", currentStage: "chain" })
  ]
});

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem("syzygy_opus_state_v1");
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1 && Array.isArray(parsed.projects)) {
      if (!Array.isArray(parsed.ideas)) parsed.ideas = [];
      return parsed;
    }
  } catch (error) {
    console.warn("Unable to restore Cadenzai state", error);
  }
  return seedState();
}

function createStore() {
  let state = loadState();
  const listeners = new Set();
  const persist = next => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); return true; }
    catch (error) { console.warn("Cadenzai could not persist local project state", error); return false; }
  };
  const notify = () => listeners.forEach(listener => listener(state));

  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    update(mutator) {
      const next = structuredClone(state);
      mutator(next);
      if (!persist(next)) return false;
      state = next;
      notify();
      return true;
    },
    addProject(project) {
      return this.update(next => next.projects.unshift(project));
    },
    updateProject(projectId, mutator) {
      this.update(next => {
        const project = next.projects.find(item => item.id === projectId);
        if (!project) return;
        mutator(project);
        project.metadata.updatedAt = now();
      });
    },
    addSpark(spark) {
      return this.update(next => { if (!Array.isArray(next.ideas)) next.ideas = []; next.ideas.unshift(spark); });
    },
    removeSpark(sparkId) {
      return this.update(next => { next.ideas = (next.ideas || []).filter(item => item.id !== sparkId); });
    },
    updateSpark(sparkId, mutator) {
      return this.update(next => { const spark = (next.ideas || []).find(item => item.id === sparkId); if (spark) mutator(spark); });
    },
    // Save first, promote later: turn a saved Spark into a project seeded with its title and key.
    promoteSparkToProject(sparkId) {
      let created = null;
      const saved = this.update(next => {
        const spark = (next.ideas || []).find(item => item.id === sparkId);
        if (!spark) return;
        if (spark.promotedProjectId) {
          created = next.projects.find(item => item.id === spark.promotedProjectId) || null;
          if (created) return;
        }
        created = createProject({ title: spark.title, currentStage: "intent" });
        created.assets.push({
          type: "idea-spark",
          name: spark.title,
          sparkId: spark.id,
          addedAt: now(),
          snapshot: structuredClone({
            schemaVersion: spark.schemaVersion,
            analyzerVersion: spark.analyzerVersion,
            durationSeconds: spark.durationSeconds,
            capture: spark.capture,
            musical: spark.musical,
            read: spark.read,
            audioRef: spark.audioRef
          })
        });
        next.projects.unshift(created);
        spark.promotedProjectId = created.id;
      });
      if (!saved) created = null;
      return created;
    }
  };
}

window.CadenzaiState = { STORAGE_KEY, createProject, createSpark, sampleProject, loadState, createStore };
})();
