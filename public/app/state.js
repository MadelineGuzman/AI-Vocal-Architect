(function () {
"use strict";

const STORAGE_KEY = "syzygy_cadenzai_state_v1";

const now = () => new Date().toISOString();

function createProject(input = {}) {
  const id = input.id || `project-${Date.now()}`;
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
    if (parsed?.version === 1 && Array.isArray(parsed.projects)) return parsed;
  } catch (error) {
    console.warn("Unable to restore Cadenzai state", error);
  }
  return seedState();
}

function createStore() {
  let state = loadState();
  const listeners = new Set();
  const persist = () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (error) { console.warn("Cadenzai could not persist local project state", error); }
  };
  const notify = () => listeners.forEach(listener => listener(state));

  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    update(mutator) {
      const next = structuredClone(state);
      mutator(next);
      state = next;
      persist();
      notify();
    },
    addProject(project) {
      this.update(next => next.projects.unshift(project));
    },
    updateProject(projectId, mutator) {
      this.update(next => {
        const project = next.projects.find(item => item.id === projectId);
        if (!project) return;
        mutator(project);
        project.metadata.updatedAt = now();
      });
    }
  };
}

window.CadenzaiState = { STORAGE_KEY, createProject, sampleProject, loadState, createStore };
})();
