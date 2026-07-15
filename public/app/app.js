(function () {
"use strict";

const { createProject, createStore } = window.CadenzaiState;
const { PRESET_OPTIONS, generateChain, chainToText } = window.CadenzaiRecommendation;
const { analyzeAudioBuffer, decodeAudioFile } = window.CadenzaiAnalysis;

const store = createStore();
const root = document.getElementById("app");
const logoUrl = new URL("../assets/logo-mark.svg", document.currentScript.src).href;
const audioCache = new Map();
let audioContext = null;
let activeSource = null;
let activeMode = null;
let playbackTimer = null;
let playbackStartedAt = 0;
let playbackOffset = 0;
let mobileNavOpen = false;

const stages = [
  ["overview", "00", "Overview", "live"],
  ["intent", "02", "Creative Intent", "live"],
  ["lyrics", "03", "Lyrics", "live"],
  ["arrangement", "04", "Arrangement", "future"],
  ["blueprint", "05", "Vocal Blueprint", "future"],
  ["recording", "06", "Recording", "live"],
  ["chain", "07", "Vocal Chain", "live"],
  ["validation", "08", "Validation", "future"],
  ["review", "09", "Final Review", "live"]
];

const futureModules = {
  arrangement: ["Stage 04", "Arrangement & Beat Relationship", "⌁", "Instrumental analysis and arrangement planning will live here as a song timeline, not fabricated prose.", ["BPM & key", "Section boundaries", "Energy map", "Vocal entry points"]],
  blueprint: ["Stage 05", "Vocal Blueprint", "✦", "This module will turn intent and structure into a per-section performance plan.", ["Per-section intensity", "Register & delivery", "Doubles / harmonies", "Ad-libs & BGVs"]],
  validation: ["Stage 08", "Validation", "⇄", "This module will compare raw and processed vocals across an Analyze → Apply → Re-upload → Validate loop.", ["Noise reduction", "Dynamic control", "Sibilance", "Loudness"]],
  mastering: ["Future module", "Mastering Review", "◈", "Delivery-target loudness, dynamics, translation, and version consistency will connect here.", ["Loudness target", "Peak safety", "Translation", "Version QA"]],
  release: ["Future module", "Release Preparation", "↗", "Metadata, artwork, credits, deliverables, and distribution readiness will connect here.", ["Metadata", "Credits", "Artwork", "Deliverables"]]
};

const certainty = value => `<span class="certainty ${value}">${value}</span>`;
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const routeFor = (id, stage = "overview") => `#/project/${encodeURIComponent(id)}/${stage}`;
const navigate = route => { location.hash = route.startsWith("#") ? route.slice(1) : route; };

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (!parts.length || parts[0] === "dashboard") return { view: "dashboard" };
  if (parts[0] === "new") return { view: "create", step: Number(parts[1] || 0) };
  if (parts[0] === "project") return { view: "project", projectId: decodeURIComponent(parts[1] || ""), stage: parts[2] || "overview" };
  return { view: "dashboard" };
}

function projectById(id) { return store.getState().projects.find(project => project.id === id); }
function derivedStyle(project) { return `${project.metadata.genre}, ${project.intent.mood || "focused"}, ${project.intent.voice || "expressive"}`; }
function currentChain(project) { return project.generatedChain || generateChain({ style: derivedStyle(project), daw: project.metadata.daw, intensity: project.preferences.intensity, analysis: project.analysis }); }

function shell(content, route) {
  const state = store.getState();
  const project = route.projectId ? projectById(route.projectId) : null;
  const mode = project?.preferences.mode || state.preferences.mode;
  const projectCount = state.projects.length;
  const crumb = route.view === "project" ? `${project?.metadata.title || "Project"} · ${stages.find(item => item[0] === route.stage)?.[2] || "Workspace"}` : route.view === "create" ? "New Project" : "Dashboard";
  return `<div class="app-shell">
    <aside class="sidebar ${mobileNavOpen ? "open" : ""}" aria-label="Primary navigation">
      <div class="brand-lockup"><img class="brand-logo" src="${logoUrl}" alt=""><div><div class="brand-name">Cadenzai</div><div class="brand-sub">Vocal Architect · Syzygy</div></div></div>
      <nav class="nav">
        <div class="nav-label">Workspace</div>
        ${navButton("dashboard", "◧", "Dashboard", route.view === "dashboard")}
        ${navButton("projects", "❖", "Projects", route.view === "dashboard", projectCount)}
        ${navButton("current-project", "✦", "Current Project", route.view === "project", "")}
        ${navButton("architect", "⚡", "Vocal Architect", route.view === "project" && route.stage === "chain")}
        <div class="nav-label" style="margin-top:8px">Library</div>
        ${navButton("learn", "✎", "Learn", false)}
        ${navButton("plugins", "▤", "Plugin Library", false)}
        ${navButton("settings", "⚙", "Settings", false)}
      </nav>
    </aside>
    <div class="main-column">
      <header class="topbar">
        <button class="mobile-menu" data-action="mobile-menu" aria-label="Toggle navigation">☰</button>
        <div class="breadcrumb"><span class="breadcrumb-root">${route.view === "project" ? "Project" : "Cadenzai"}</span><span aria-hidden="true">/</span><span class="breadcrumb-current">${escapeHtml(crumb)}</span></div>
        <div class="topbar-spacer"></div>
        <div class="mode"><span class="mode-label">Mode</span><div class="mode-toggle" aria-label="Detail mode"><button data-action="mode" data-mode="guided" class="${mode === "guided" ? "active" : ""}">Guided</button><button data-action="mode" data-mode="advanced" class="${mode === "advanced" ? "active" : ""}">Advanced</button></div></div>
        <div class="avatar" aria-label="${escapeHtml(state.user.displayName)}">${escapeHtml(state.user.initials)}</div>
      </header>
      <main>${content}</main>
    </div>
  </div>`;
}

function navButton(action, icon, label, active, badge = "") {
  return `<button class="nav-button ${active ? "active" : ""}" data-action="${action}"><span class="nav-icon">${icon}</span><span class="nav-text">${label}</span>${badge !== "" ? `<span class="nav-count">${badge}</span>` : ""}</button>`;
}

function dashboard() {
  const state = store.getState();
  const active = state.projects[0];
  return `<div class="page">
    <div class="page-heading"><div><div class="eyebrow">Dashboard</div><h1>Good evening, ${escapeHtml(state.user.displayName)}.</h1><p class="lede">${state.projects.length} projects in motion. One is waiting on you.</p></div><button class="button gold" data-action="new-project">＋ New Project</button></div>
    <section class="card feature-card">
      <div class="feature-content"><div><div class="section-label" style="color:var(--teal)">Continue where you stopped</div><div class="project-title">${escapeHtml(active.metadata.title)}</div><div class="meta">${escapeHtml(active.metadata.artist)} · ${escapeHtml(active.metadata.genre)} · ${escapeHtml(active.metadata.daw)}</div><div class="button-row" style="margin-top:14px"><span class="pill gold">Stage · ${escapeHtml(stageName(active.metadata.currentStage))}</span><span class="pill teal">${escapeHtml(active.metadata.readiness)}</span></div></div><div class="button-row"><button class="button primary" data-action="open-project" data-project="${active.id}" data-stage="${active.metadata.currentStage}">Resume session →</button><button class="button" data-action="open-project" data-project="${active.id}" data-stage="review">View project review</button></div></div>
      <div class="stage-strip">${stages.filter(item => item[0] !== "overview").map(item => `<div class="stage-strip-item ${item[0] === active.metadata.currentStage ? "current" : ""}"><small>${item[1]}</small><span>${item[2].replace("Creative ", "").replace("Vocal ", "")}</span></div>`).join("")}</div>
    </section>
    <div class="dashboard-grid"><section><div class="section-label">Your projects</div><div class="project-list">${state.projects.map(projectCard).join("")}</div></section>
    <section><div class="section-label">Needs your attention</div><div class="card"><button class="attention-item" data-action="open-project" data-project="${active.id}" data-stage="lyrics">${certainty("Creative")}<p>Verse 1 lines 3–4 restate the same idea — one open suggestion can advance the story.</p></button><button class="attention-item" data-action="open-project" data-project="${active.id}" data-stage="chain">${certainty("Technical")}<p>Vocal chain drafted. Confirm the de-ess amount before tracking layered finals.</p></button><button class="attention-item" data-action="open-project" data-project="${active.id}" data-stage="recording">${certainty(active.analysis ? "Measured" : "Confirm")}<p>${active.analysis ? `Recording analysis available · quality ${active.analysis.qualityScore}/100.` : "Add a raw vocal to unlock evidence-based recording analysis."}</p></button></div></section></div>
  </div>`;
}

function projectCard(project) {
  return `<button class="project-card" data-action="open-project" data-project="${project.id}" data-stage="${project.metadata.currentStage}"><span class="project-art">${escapeHtml(project.metadata.title[0])}</span><span class="project-copy"><strong>${escapeHtml(project.metadata.title)}</strong><span class="meta" style="display:block;margin-top:3px">${escapeHtml(project.metadata.artist)} · ${escapeHtml(project.metadata.genre)}</span></span><span style="text-align:right"><span class="pill ${project.metadata.readiness.includes("Ready") ? "teal" : ""}">${escapeHtml(project.metadata.readiness)}</span><small class="meta" style="display:block;margin-top:6px">Stage · ${escapeHtml(stageName(project.metadata.currentStage))}</small></span></button>`;
}

function createPage(step) {
  const safeStep = Math.max(0, Math.min(2, step));
  const steps = ["Basics", "Setup", "Assets"];
  const panels = [
    `<div class="form-grid"><div class="field"><label for="new-title">Song title</label><input id="new-title" name="title" value="Gravity Doesn't Ask" required></div><div class="field"><label for="new-artist">Artist</label><input id="new-artist" name="artist" value="Rara Kallistos" required></div><div class="form-row"><div class="field"><label for="new-genre">Genre / blend</label><input id="new-genre" name="genre" value="Alternative R&B / cinematic pop"></div><div class="field"><label for="new-stage">Current stage</label><select id="new-stage" name="stage"><option value="intent">Creative development</option><option value="lyrics">Lyrics</option><option value="chain">Vocal production</option></select></div></div></div>`,
    `<div class="form-grid"><div class="form-row"><div class="field"><label for="new-daw">DAW</label><select id="new-daw" name="daw">${["FL Studio","Logic Pro","Pro Tools","Ableton","REAPER","Other"].map(value => `<option ${value === "REAPER" ? "selected" : ""}>${value}</option>`).join("")}</select></div><div class="field"><label>Experience level</label><select name="experience"><option>Beginner</option><option selected>Intermediate / Advanced</option></select></div></div><div class="field"><label>Available plugins</label><div class="button-row">${["REAPER stock","TDR Nova","TDR SlickEQ","MJUC jr.","Melda free bundle","Baby Audio"].map(value => `<label class="pill teal"><input type="checkbox" name="plugins" value="${value}" checked> ${value}</label>`).join("")}</div></div></div>`,
    `<div class="form-grid">${[["Lyrics","Song development feedback"],["Beat / instrumental","Arrangement and timeline"],["Vocal demo","Vocal blueprint"],["Raw vocal recording","Recording analysis"],["Reference songs","Style calibration"]].map(([label, unlocks], index) => `<label class="card padded" style="display:flex;gap:12px;align-items:center"><input type="checkbox" name="asset" value="${label}"><span style="flex:1"><strong>${label}</strong><small class="meta" style="display:block">Unlocks ${unlocks}</small></span><span class="pill ${index ? "" : "teal"}">${index ? "Optional" : "Added"}</span></label>`).join("")}</div>`
  ];
  return `<div class="page narrow"><button class="button" data-action="dashboard">← Dashboard</button><div style="margin-top:20px"><div class="eyebrow">New Project</div><h1>Start a production session</h1><p class="lede">You do not need every asset to begin. Add what you have; the workspace shows what each asset unlocks.</p></div><div class="step-rail">${steps.map((label, index) => `<span class="${index === safeStep ? "active" : ""}">${index + 1} · ${label}</span>`).join("")}</div><form id="create-project-form" class="card form-card" data-step="${safeStep}">${panels[safeStep]}<div class="button-row" style="justify-content:flex-end;margin-top:22px"><button type="button" class="button" data-action="create-back" data-step="${safeStep}">${safeStep ? "Back" : "Cancel"}</button><button type="submit" class="button primary">${safeStep < 2 ? "Continue" : "Create project →"}</button></div></form></div>`;
}

function workspace(project, stage) {
  return `<div class="workspace-layout"><nav class="stage-nav card" aria-label="Project stages">${stages.map(([key, number, name, status]) => `<button class="stage-button ${stage === key ? "active" : ""} ${status === "future" ? "future" : ""}" data-action="stage" data-project="${project.id}" data-stage="${key}"><span class="stage-number">${status === "future" ? "○" : number}</span><span class="stage-name">${name}</span></button>`).join("")}</nav><section class="workspace-main">${stageContent(project, stage)}</section></div>`;
}

function stageContent(project, stage) {
  if (stage === "overview") return overviewStage(project);
  if (stage === "intent") return intentStage(project);
  if (stage === "lyrics") return lyricsStage(project);
  if (stage === "recording") return recordingStage(project);
  if (stage === "chain") return chainStage(project);
  if (stage === "review") return reviewStage(project);
  return futureStage(project, stage);
}

function overviewStage(project) {
  return `<div class="eyebrow">Project Workspace</div><h1>${escapeHtml(project.metadata.title)}</h1><p class="lede">${escapeHtml(project.metadata.artist)} · ${escapeHtml(project.metadata.genre)} · ${escapeHtml(project.metadata.daw)}</p><div class="button-row" style="margin-top:14px"><span class="pill gold">${escapeHtml(project.metadata.readiness)}</span><span class="pill">Updated ${new Date(project.metadata.updatedAt).toLocaleDateString()}</span></div><div class="module-grid">${stages.filter(item => item[0] !== "overview").map(([key, number, name, status]) => `<button class="card module-card ${status === "future" ? "future" : ""}" data-action="stage" data-project="${project.id}" data-stage="${key}"><div class="module-card-head"><span class="stage-number">${number}</span><h3>${name}</h3><span class="pill ${status === "live" ? "teal" : ""}">${status === "live" ? "Active" : "Future"}</span></div><div class="meta">${moduleNote(key, project)}</div></button>`).join("")}</div><div class="card padded" style="margin-top:18px;border-color:rgba(205,168,94,.22)"><strong style="color:var(--gold-bright)">Artist-directed by design</strong><p class="lede">Your intent, lyrics, protected moments, performances, and approvals remain the creative source. Cadenzai organizes evidence and recommendations without claiming authorship or silently changing your work.</p></div>`;
}

function moduleNote(key, project) {
  return ({ intent: "Central idea, mood, non-negotiables", lyrics: `${project.lyrics.length} song sections and contextual feedback`, arrangement: "BPM, key, energy map, vocal entries", blueprint: "Per-section performance plan", recording: project.analysis ? `Analyzed · quality ${project.analysis.qualityScore}/100` : "Clipping, noise, dynamics, coarse spectrum", chain: "EQ · compression · saturation · effects", validation: "Raw versus processed comparison", review: "Studio summary and readiness" })[key];
}

function intentStage(project) {
  const fields = [["central","Central idea","Creative"],["perspective","Emotional perspective","Creative"],["response","Intended listener response","Creative"],["voice","Narrative voice","Creative"],["mood","Mood","Creative"],["conflict","Conflict / tension","Creative"],["destination","Emotional destination","Creative"],["nonnegotiables","Non-negotiable moments","Confirm"]];
  const access = project.intent.accessibility;
  return `<div class="eyebrow">Stage 02 · Creative Intent</div><h1>What is this song really trying to say?</h1><p class="lede">This brief becomes the reference every later stage checks against. Nothing here is scored—only remembered.</p><section class="card intent-card"><div class="intent-header"><span>✦</span><strong>Creative Intent Brief</strong><span class="save-state">Auto-saved</span></div>${fields.map(([key,label,tag]) => `<div class="intent-field"><div><label for="intent-${key}">${label}</label><div style="margin-top:6px">${certainty(tag)}</div></div><textarea id="intent-${key}" rows="3" data-input="intent" data-key="${key}" data-project="${project.id}">${escapeHtml(project.intent[key])}</textarea></div>`).join("")}<div class="intent-field"><label for="intent-access">Accessible ↔ Experimental</label><div><input id="intent-access" type="range" min="0" max="100" value="${access}" data-input="accessibility" data-project="${project.id}" style="width:100%"><div class="meta" style="display:flex;justify-content:space-between"><span>Accessible</span><strong>${access < 40 ? "Leaning experimental" : access > 60 ? "Leaning accessible" : "Balanced"}</strong><span>Experimental</span></div></div></div></section><div class="button-row" style="justify-content:flex-end;margin-top:18px"><button class="button primary" data-action="stage" data-project="${project.id}" data-stage="lyrics">Continue to Lyrics →</button></div>`;
}

function lyricsStage(project) {
  return `<div class="eyebrow">Stage 03 · Song Development</div><h1>Lyrics & structure</h1><p class="lede">Feedback cites the exact section it concerns. Accept or ignore anything; Cadenzai never silently rewrites your words.</p><div class="button-row" style="margin-top:10px"><span class="meta">Legend:</span>${["Measured","Inferred","Creative","Confirm"].map(certainty).join("")}</div><div class="lyrics-list">${project.lyrics.map(section => lyricSection(project, section)).join("")}<button class="button" data-action="add-lyric-section" data-project="${project.id}">＋ Add section</button></div>`;
}

function lyricSection(project, section) {
  const decisions = project.session.lyricDecisions;
  return `<article class="card lyrics-section"><header class="lyrics-head"><span class="eyebrow" style="color:var(--gold-bright)">${escapeHtml(section.type)}</span><span class="meta">${escapeHtml(section.name)}</span><span style="flex:1"></span>${section.hook ? `<span class="pill gold">${escapeHtml(section.hook)}</span>` : ""}</header><div class="lyrics-body"><div class="lyrics-text"><label class="sr-only" for="lyrics-${section.id}">${escapeHtml(section.type)} lyrics</label><textarea id="lyrics-${section.id}" class="lyrics-editor" data-input="lyrics" data-project="${project.id}" data-section="${section.id}" placeholder="Write lyrics for this section…">${escapeHtml(section.text)}</textarea></div><div class="feedback-list">${section.feedback.length ? section.feedback.map(item => { const decision = decisions[item.id]; return `<div class="feedback">${certainty(item.certainty)}<p>${escapeHtml(item.text)}</p>${item.certainty === "Confirm" ? `<div class="meta" style="margin-top:8px;color:var(--alert)">Advisory only · protected</div>` : decision ? `<div class="meta" style="margin-top:8px;color:${decision === "accepted" ? "var(--teal)" : "var(--muted)"}">${decision === "accepted" ? "✓ Accepted into notes" : "Ignored"}</div>` : `<div class="button-row" style="margin-top:9px"><button class="button" data-action="lyric-decision" data-project="${project.id}" data-feedback="${item.id}" data-decision="accepted">Accept</button><button class="button" data-action="lyric-decision" data-project="${project.id}" data-feedback="${item.id}" data-decision="ignored">Ignore</button></div>`}</div>`; }).join("") : `<div class="meta">Feedback unlocks when this section contains lyrics.</div>`}</div></div></article>`;
}

function recordingStage(project) {
  return `<div class="eyebrow">Stage 06 · Recording Analysis</div><h1>Inspect the raw vocal</h1><p class="lede">Analysis runs locally on this device. Measured findings are kept separate from creative interpretation and linked to corrective chain decisions.</p><div class="card padded" style="margin-top:22px"><div class="button-row"><label class="button primary" for="recording-file">${project.analysis ? "Analyze another vocal" : "Load raw vocal"}</label><input id="recording-file" class="sr-only" type="file" accept="audio/*" data-project="${project.id}">${project.analysis ? `<span class="meta">${escapeHtml(project.analysis.source.fileName)}</span>` : ""}</div></div>${project.analysis ? analysisPanel(project.analysis, project.generatedChain) : `<div class="future-panel card"><div class="future-icon">◎</div><div class="eyebrow">Local analysis ready</div><h2 style="margin-top:8px">Add a raw vocal recording</h2><p class="lede" style="margin-left:auto;margin-right:auto">This analyzer currently measures levels, dynamics, clipping, silence, noise-floor estimates, and coarse spectral balance. It does not fabricate pitch or room measurements.</p></div>`}`;
}

function analysisPanel(report, chain) {
  const m = report.measurements;
  const linked = chain?.analysisId === report.analysisId ? chain.decisions : [];
  const metrics = [["Peak",`${m.peakDbfs.toFixed(1)} dBFS`],["RMS",`${m.rmsDbfs.toFixed(1)} dBFS`],["Crest",`${m.crestFactorDb.toFixed(1)} dB`],["Clipping",`${m.clippingEvents} events`],["Noise est.",`${m.noiseFloorDbfs.toFixed(1)} dBFS`],["Silence",`${(m.silenceRatio*100).toFixed(0)}%`]];
  return `<section class="card analysis-panel"><div class="analysis-head"><div><div class="eyebrow" style="color:var(--teal)">Recording Analysis</div><div class="meta">${report.analyzerVersion} · local processing</div></div><span class="pill teal">Quality ${report.qualityScore}/100</span></div><div class="metrics">${metrics.map(([label,value]) => `<div class="metric"><small>${label}</small><strong>${value}</strong></div>`).join("")}</div><div class="findings">${report.findings.map(item => { const decision = linked.find(value => value.becauseOf?.includes(item.id)); return `<div class="finding ${item.severity}">${certainty(item.type === "baseline" ? "Measured" : "Measured")} <strong>${item.severity.toUpperCase()}</strong> · ${escapeHtml(item.summary)} <span class="meta">Confidence ${Math.round(item.confidence*100)}%</span>${decision ? `<div class="meta" style="margin-top:5px;color:var(--teal)">Chain response: ${escapeHtml(decision.explanation)}</div>` : ""}</div>`; }).join("")}</div><p class="meta" style="margin:12px 0 0">${report.limitations.length ? `Limitations: ${escapeHtml(report.limitations.join(" "))}` : "Confirm coarse tonal findings by ear in the full arrangement."}</p></section>`;
}

function chainStage(project) {
  const chain = currentChain(project);
  const order = project.session.chainOrder;
  const intensity = project.preferences.intensity;
  const mode = project.preferences.mode;
  return `<div class="page-heading"><div><div class="eyebrow">Stage 07 · Vocal Architect</div><h1>Vocal chain</h1><p class="lede">Built from project intent, style, DAW, and available recording evidence. Reorder steps and expand any stage for reasoning.</p></div><div style="text-align:right"><div class="section-label">Derived style</div><div>${escapeHtml(chain.profile)} · ${escapeHtml(project.metadata.daw)}</div></div></div><div class="preset-row" aria-label="Chain presets">${PRESET_OPTIONS.map(item => `<button class="preset-chip ${chain.profile === item.label ? "active" : ""}" data-action="preset" data-project="${project.id}" data-preset="${escapeHtml(item.label)}">${escapeHtml(item.label)}</button>`).join("")}</div><div class="architect-controls"><div class="card padded"><div style="display:flex;justify-content:space-between"><strong>Processing intensity</strong><span class="pill gold">${intensity} / 10</span></div><input type="range" min="1" max="10" value="${intensity}" data-input="intensity" data-project="${project.id}" style="width:100%;margin-top:12px"><p class="meta" style="margin:8px 0 0">Higher values push compression, EQ movement, saturation, and effects harder.</p></div><div class="readout-grid">${[["Processing",intensity <= 3 ? "Gentle" : intensity <= 7 ? "Balanced" : "Assertive"],["Space",intensity <= 3 ? "Dry" : intensity <= 7 ? "Focused" : "Open"],["Tone",intensity <= 3 ? "Natural" : intensity <= 7 ? "Warm-forward" : "Bright edge"]].map(([label,value]) => `<div class="card readout"><small>${label}</small><strong>${value}</strong></div>`).join("")}</div></div>${eqCurve(chain.eq)}<div class="card signal-flow"><span class="section-label" style="margin:0">Signal</span>${order.map((key,index) => `<span class="signal-node">${chain.steps[key].role}</span>${index < order.length-1 ? `<span class="signal-arrow">→</span>` : ""}`).join("")}</div><div class="chain-list">${order.map((key,index) => chainStep(project, chain.steps[key], key, index, mode)).join("")}</div>${project.analysis ? analysisPanel(project.analysis, chain) : ""}${transport(project, chain)}</div>`;
}

function eqCurve(eq) {
  const width = 760, height = 150, baseline = 78;
  const points = Array.from({length:31}, (_,index) => { const t=index/30; let y=baseline; y += Math.max(0,(eq.hpf-60)/18)*Math.max(0,1-t/.16)*10; y += Math.abs(Math.min(0,eq.moves[0].gain))*Math.max(0,1-Math.abs(t-.32)/.16)*4; y -= Math.max(0,eq.moves[1].gain)*Math.max(0,1-Math.abs(t-.7)/.13)*4.8; y -= Math.max(0,eq.moves[2].gain)*Math.max(0,(t-.78)/.22)*4.8; return [18+(width-36)*t,Math.max(16,Math.min(height-16,y))]; });
  const path = points.map((point,index) => `${index ? "L" : "M"}${point[0].toFixed(1)} ${point[1].toFixed(1)}`).join(" ");
  return `<svg class="eq-curve" viewBox="0 0 ${width} ${height}" role="img" aria-label="Generated EQ response"><line x1="18" y1="${baseline}" x2="${width-18}" y2="${baseline}" stroke="rgba(150,170,220,.16)"/><path d="${path}" fill="none" stroke="#5ad8ff" stroke-width="2.5"/><text x="24" y="22" fill="#8791a6" font-size="10">HPF ${eq.hpf} Hz</text><text x="${width-150}" y="22" fill="#8791a6" font-size="10">Generated response</text></svg>`;
}

function chainStep(project, step, key, index, mode) {
  const open = project.session.expandedChainStep === key;
  return `<article class="card chain-step ${open ? "open" : ""}"><div class="chain-summary" data-action="toggle-step" data-project="${project.id}" data-step="${key}"><span class="chain-index">${index+1}</span><div class="chain-title"><div class="button-row"><h3>${escapeHtml(step.name)}</h3><span class="pill">${step.required ? "Required" : "Optional"}</span>${certainty(step.certainty)}</div><p>${escapeHtml(step.role)} · ${escapeHtml(step.plugin)}</p></div><div class="order-buttons"><button class="icon-button" data-action="move-step" data-project="${project.id}" data-step="${key}" data-direction="-1" aria-label="Move up">▲</button><button class="icon-button" data-action="move-step" data-project="${project.id}" data-step="${key}" data-direction="1" aria-label="Move down">▼</button></div><span>${open ? "▾" : "▸"}</span></div>${open ? `<div class="chain-detail"><div><div class="detail-label">Why it is here</div><p>${escapeHtml(step.why)}</p></div><div><div class="detail-label">Starting settings</div><div class="settings">${step.settings.map(([label,value]) => `<div class="setting"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`).join("")}</div></div>${mode === "advanced" ? `<div class="plugin-grid"><div class="plugin-box"><div class="section-label">Primary plugin</div>${escapeHtml(step.plugin)}</div><div class="plugin-box"><div class="section-label">Free / stock alternative</div><span style="color:var(--teal)">${escapeHtml(step.alternative)}</span></div></div>` : ""}<div class="listen-box"><span>🎧</span><div><div class="detail-label">Listen for</div><p>${escapeHtml(step.listen)}</p></div></div></div>` : ""}</article>`;
}

function transport(project, chain) {
  const cached = audioCache.get(project.id);
  return `<section class="card transport"><div class="button-row"><label class="button" for="chain-audio-file">${cached ? "Change sample" : "Load Sample"}</label><input id="chain-audio-file" class="sr-only" type="file" accept="audio/*" data-project="${project.id}"><button class="button ${activeMode === "dry" ? "primary" : ""}" data-action="play" data-project="${project.id}" data-mode="dry" ${cached ? "" : "disabled"}>▷ DRY</button><button class="button ${activeMode === "wet" ? "primary" : ""}" data-action="play" data-project="${project.id}" data-mode="wet" ${cached ? "" : "disabled"}>▷ WET</button><button class="button" data-action="stop">STOP</button>${cached ? `<span class="meta">${escapeHtml(cached.fileName)} loaded ✓</span>` : ""}<span style="flex:1"></span><button class="button" data-action="copy-chain" data-project="${project.id}">Copy settings</button><button class="button" data-action="download-text" data-project="${project.id}">Export .txt</button><button class="button" data-action="download-json" data-project="${project.id}">Export .json</button><button class="button primary" data-action="stage" data-project="${project.id}" data-stage="review">To Final Review →</button></div><div class="progress" data-action="scrub" data-project="${project.id}"><div id="progress-fill" class="progress-fill"></div></div><div class="transport-note">${certainty("Confirm")} Preview reflects EQ and dynamics only — pitch correction and time-based FX require your DAW.</div></section>`;
}

function reviewStage(project) {
  const cards = [
    ["Creative","Creative intent",[project.intent.central || "Creative intent is not defined yet.",`Arc: ${project.intent.perspective || "needs confirmation"}`]],
    ["Measured","Strongest elements",["Chorus hook is title-bearing and memorable.","“Made a home inside the waiting” is a standout image.",project.analysis ? `Recording quality currently measures ${project.analysis.qualityScore}/100.` : "Recording analysis is still pending."]],
    ["Inferred","Primary concerns",["Verse 1 lines 3–4 restate the same idea.","Pre-chorus and bridge lyrics are not yet written.","De-ess amount needs confirmation on layered finals."]],
    ["Technical","Decisions made",[`Chain built for ${project.metadata.daw}.`,`${currentChain(project).profile} profile at intensity ${project.preferences.intensity}/10.`,"Non-negotiable chorus lines remain protected."]],
    ["Confirm","Open questions",["Track the lead before or after writing the bridge?","Double or harmonize the pre-chorus lift?"]],
    ["Creative","Recommended next actions",["Write pre-chorus and bridge lyrics.","Record the lead against the proposed chain.",project.analysis ? "Validate the processed vocal when Stage 08 activates." : "Run local recording analysis on the raw vocal."]]
  ];
  const readiness = ["Needs Development","Ready to Record","Ready to Mix","Ready for Final Review"];
  return `<div class="eyebrow">Stage 09 · Project Review</div><h1>Studio review</h1><p class="lede">A production summary, not a score. Advance readiness when the work supports it.</p><div class="card padded" style="margin-top:20px;border-color:rgba(205,168,94,.22)"><div class="section-label">Current readiness</div><div class="button-row">${readiness.map(value => `<button class="button ${project.metadata.readiness === value ? "gold" : ""}" data-action="readiness" data-project="${project.id}" data-readiness="${value}">${value}</button>`).join("")}</div></div><div class="review-grid">${cards.map(([tag,title,items]) => `<article class="card review-card"><div class="button-row">${certainty(tag)}<h3 style="margin:0">${title}</h3></div><ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></article>`).join("")}</div>`;
}

function futureStage(project, stage) {
  const item = futureModules[stage] || futureModules.arrangement;
  return `<div class="eyebrow" style="color:var(--muted)">${item[0]} · Future module</div><h1>${item[1]}</h1><p class="lede">${item[3]}</p><div class="card future-panel"><div class="future-icon">${item[2]}</div><div class="eyebrow" style="color:var(--violet)">Integration point</div><h2 style="margin:8px 0">Architecture reserved</h2><p class="lede" style="margin-left:auto;margin-right:auto">The project model and stage router already reserve this module’s context. It will activate without redesigning the workspace.</p><div class="button-row" style="justify-content:center;margin-top:18px">${item[4].map(value => `<span class="pill">${value}</span>`).join("")}</div><p style="color:var(--teal);font-size:12px;margin:20px 0 0">Cadenzai will not fabricate measurements before the required engine exists.</p></div>`;
}

function stageName(key) { return stages.find(item => item[0] === key)?.[2] || "Overview"; }

function render() {
  const route = parseRoute();
  let content;
  if (route.view === "dashboard") content = dashboard();
  else if (route.view === "create") content = createPage(route.step);
  else {
    const project = projectById(route.projectId);
    if (!project) { navigate("#/dashboard"); return; }
    content = workspace(project, route.stage);
  }
  root.innerHTML = shell(content, route);
}

function updateProjectMode(route, mode) {
  if (route.projectId) store.updateProject(route.projectId, project => { project.preferences.mode = mode; });
  else store.update(state => { state.preferences.mode = mode; });
}

function regenerate(projectId, styleOverride) {
  store.updateProject(projectId, project => {
    const style = styleOverride || derivedStyle(project);
    if (styleOverride) project.preferences.styleOverride = styleOverride;
    project.generatedChain = generateChain({ style, daw: project.metadata.daw, intensity: project.preferences.intensity, analysis: project.analysis });
  });
}

root.addEventListener("click", async event => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  const projectId = target.dataset.project;
  if (action === "mobile-menu") { mobileNavOpen = !mobileNavOpen; render(); }
  else if (action === "dashboard" || action === "projects") navigate("#/dashboard");
  else if (action === "new-project") navigate("#/new/0");
  else if (action === "current-project") { const first = store.getState().projects[0]; navigate(routeFor(first.id, first.metadata.currentStage)); }
  else if (action === "architect") { const first = store.getState().projects[0]; navigate(routeFor(first.id, "chain")); }
  else if (["learn","plugins","settings"].includes(action)) alert(`${target.textContent.trim()} is reserved in the approved Cadenzai architecture and will activate in a later milestone.`);
  else if (action === "open-project" || action === "stage") {
    const nextStage = target.dataset.stage || "overview";
    if (projectId && action === "stage") store.updateProject(projectId, project => { project.metadata.currentStage = nextStage; project.session.activeStage = nextStage; });
    navigate(routeFor(projectId, nextStage));
  }
  else if (action === "mode") updateProjectMode(parseRoute(), target.dataset.mode);
  else if (action === "create-back") navigate(Number(target.dataset.step) ? `#/new/${Number(target.dataset.step)-1}` : "#/dashboard");
  else if (action === "lyric-decision") store.updateProject(projectId, project => { project.session.lyricDecisions[target.dataset.feedback] = target.dataset.decision; });
  else if (action === "add-lyric-section") store.updateProject(projectId, project => { project.lyrics.push({ id:`section-${Date.now()}`, type:"New Section", name:"Custom section", text:"", feedback:[] }); });
  else if (action === "toggle-step") store.updateProject(projectId, project => { project.session.expandedChainStep = project.session.expandedChainStep === target.dataset.step ? "" : target.dataset.step; });
  else if (action === "move-step") { event.stopPropagation(); store.updateProject(projectId, project => { const order=project.session.chainOrder; const index=order.indexOf(target.dataset.step); const next=index+Number(target.dataset.direction); if(next<0||next>=order.length)return; [order[index],order[next]]=[order[next],order[index]]; }); }
  else if (action === "preset") regenerate(projectId, target.dataset.preset);
  else if (action === "readiness") store.updateProject(projectId, project => { project.metadata.readiness = target.dataset.readiness; project.reviewHistory.unshift({ readiness:target.dataset.readiness, at:new Date().toISOString() }); });
  else if (action === "copy-chain") await copyChain(projectId);
  else if (action === "download-text") downloadChain(projectId, "text");
  else if (action === "download-json") downloadChain(projectId, "json");
  else if (action === "play") await playAudio(projectId, target.dataset.mode);
  else if (action === "stop") stopAudio();
  else if (action === "scrub") await scrubAudio(projectId, event, target);
});

root.addEventListener("input", event => {
  const type = event.target.dataset.input;
  const projectId = event.target.dataset.project;
  if (!type || !projectId) return;
  if (type === "intensity") { store.updateProject(projectId, project => { project.preferences.intensity = Number(event.target.value); project.generatedChain = generateChain({ style:project.preferences.styleOverride || derivedStyle(project), daw:project.metadata.daw, intensity:project.preferences.intensity, analysis:project.analysis }); }); }
});

root.addEventListener("change", async event => {
  const inputType = event.target.dataset.input;
  const inputProjectId = event.target.dataset.project;
  if (inputType === "intent" && inputProjectId) { store.updateProject(inputProjectId, project => { project.intent[event.target.dataset.key] = event.target.value; }); return; }
  if (inputType === "accessibility" && inputProjectId) { store.updateProject(inputProjectId, project => { project.intent.accessibility = Number(event.target.value); }); return; }
  if (inputType === "lyrics" && inputProjectId) { store.updateProject(inputProjectId, project => { const section=project.lyrics.find(item => item.id === event.target.dataset.section); if(section)section.text=event.target.value; }); return; }
  if (event.target.type !== "file" || !inputProjectId) return;
  const file = event.target.files?.[0];
  if (!file) return;
  const projectId = inputProjectId;
  try {
    event.target.disabled = true;
    const decoded = await decodeAudioFile(file, audioContext);
    audioContext = decoded.context;
    const report = analyzeAudioBuffer(decoded.buffer, file.name);
    audioCache.set(projectId, { ...decoded, fileName:file.name });
    store.updateProject(projectId, project => {
      project.analysis = report;
      project.generatedChain = generateChain({ style:derivedStyle(project), daw:project.metadata.daw, intensity:project.preferences.intensity, analysis:report });
      if (!project.assets.some(asset => asset.type === "raw-vocal")) project.assets.push({ type:"raw-vocal", name:file.name, addedAt:new Date().toISOString() });
    });
  } catch (error) {
    alert(`Unable to analyze this audio file: ${error.message || error}`);
    event.target.disabled = false;
  }
});

root.addEventListener("submit", event => {
  if (event.target.id !== "create-project-form") return;
  event.preventDefault();
  const step = Number(event.target.dataset.step);
  const draft = JSON.parse(sessionStorage.getItem("cadenzai_project_draft") || "{}");
  const data = new FormData(event.target);
  if (step === 0) Object.assign(draft, { title:data.get("title"), artist:data.get("artist"), genre:data.get("genre"), currentStage:data.get("stage") });
  if (step === 1) Object.assign(draft, { daw:data.get("daw"), preferences:{ mode:"guided", intensity:5, plugins:data.getAll("plugins") } });
  if (step === 2) draft.assets = data.getAll("asset").map(type => ({ type, addedAt:new Date().toISOString() }));
  sessionStorage.setItem("cadenzai_project_draft", JSON.stringify(draft));
  if (step < 2) navigate(`#/new/${step+1}`);
  else { const project=createProject(draft); store.addProject(project); sessionStorage.removeItem("cadenzai_project_draft"); navigate(routeFor(project.id, project.metadata.currentStage)); }
});

async function copyChain(projectId) {
  const project = projectById(projectId);
  const text = chainToText(currentChain(project), project.session.chainOrder);
  try { await navigator.clipboard.writeText(text); } catch { alert("Clipboard access was unavailable. Use the text export instead."); }
}

function downloadChain(projectId, format) {
  const project = projectById(projectId);
  const chain = currentChain(project);
  const payload = format === "json" ? JSON.stringify({ project:{ id:project.id, metadata:project.metadata, intent:project.intent }, analysis:project.analysis, chain, order:project.session.chainOrder }, null, 2) : chainToText(chain, project.session.chainOrder);
  const blob = new Blob([payload], { type:format === "json" ? "application/json" : "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${project.metadata.title.replace(/[^a-z0-9]+/gi,"_")}_VocalChain.${format === "json" ? "json" : "txt"}`;
  link.click();
  URL.revokeObjectURL(url);
}

function stopAudio() {
  if (playbackTimer) clearInterval(playbackTimer);
  playbackTimer = null;
  if (activeSource) { try { activeSource.stop(); } catch {} activeSource.disconnect(); }
  activeSource = null;
  activeMode = null;
  const fill = document.getElementById("progress-fill");
  if (fill) fill.style.width = "0%";
  render();
}

function buildSource(project, mode) {
  const cached = audioCache.get(project.id);
  const chain = currentChain(project);
  const source = audioContext.createBufferSource();
  source.buffer = cached.buffer;
  source.loop = true;
  source.playbackRate.value = mode === "wet" && chain.profile === "Chopped & Screwed" ? .75 : 1;
  if (mode === "dry") source.connect(audioContext.destination);
  else {
    const hpf=audioContext.createBiquadFilter(); hpf.type="highpass"; hpf.frequency.value=chain.eq.hpf;
    let node=hpf; source.connect(hpf);
    chain.eq.moves.forEach(move => { const filter=audioContext.createBiquadFilter(); filter.type=move.label.includes("Air")||move.label.includes("Roll") ? "highshelf" : "peaking"; filter.frequency.value=move.frequency; filter.Q.value=move.q; filter.gain.value=move.gain; node.connect(filter); node=filter; });
    const compressor=audioContext.createDynamicsCompressor(); compressor.threshold.value=chain.compression.threshold; compressor.ratio.value=chain.compression.ratio; compressor.attack.value=Math.max(.001,chain.compression.attack/1000); compressor.release.value=Math.max(.05,chain.compression.release/1000); node.connect(compressor);
    const gain=audioContext.createGain(); gain.gain.value=Math.pow(10,chain.compression.makeup/20); compressor.connect(gain); gain.connect(audioContext.destination);
  }
  return source;
}

async function playAudio(projectId, mode, offset = 0) {
  const project = projectById(projectId);
  const cached = audioCache.get(projectId);
  if (!cached) return;
  if (mode === "wet" && !project.generatedChain) { alert("Generate a chain first before previewing WET."); return; }
  if (activeSource) { try { activeSource.stop(); } catch {} }
  await audioContext.resume();
  activeSource = buildSource(project, mode);
  activeMode = mode;
  playbackStartedAt = audioContext.currentTime;
  playbackOffset = offset;
  activeSource.start(0, offset);
  if (playbackTimer) clearInterval(playbackTimer);
  playbackTimer = setInterval(() => {
    const fill=document.getElementById("progress-fill");
    if(!fill||!activeSource)return;
    const position=(playbackOffset+(audioContext.currentTime-playbackStartedAt)*activeSource.playbackRate.value)%cached.buffer.duration;
    fill.style.width=`${position/cached.buffer.duration*100}%`;
  }, 60);
  render();
}

async function scrubAudio(projectId, event, track) {
  if (!activeMode) return;
  const cached=audioCache.get(projectId); if(!cached)return;
  const rect=track.getBoundingClientRect();
  const ratio=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));
  await playAudio(projectId,activeMode,ratio*cached.buffer.duration);
}

window.addEventListener("hashchange", () => { mobileNavOpen=false; render(); });
store.subscribe(render);
if (!location.hash) location.hash = "#/dashboard";
render();
})();
