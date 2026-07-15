# Cadenzai Implementation Architecture

## Project Architecture

```text
public/
├── index.html                      deployment shell
├── styles.css                      design tokens and reusable component styles
├── assets/
│   └── logo-mark.svg               approved Syzygy mark
└── app/
    ├── app.js                      router, reusable view components, interactions, preview
    ├── state.js                    project model, persistence, store
    ├── recommendation-engine.js    presets, DAW mappings, chain generation, exports
    └── audio-analysis.js           local DSP measurements and finding contract
```

The app uses isolated browser modules exposed through a small `window.Cadenzai*` namespace and needs no package installation or build step. Ordered deferred scripts allow the root page to work when opened directly through `file://`, while Cloudflare serves the same files from `public/`.

## Component Hierarchy

```text
AppShell
├── SidebarNav
├── TopBar
│   └── GuidedAdvancedToggle
└── RouteView
    ├── Dashboard
    │   ├── ContinueProject
    │   ├── ProjectCard
    │   └── AttentionItem
    ├── CreateProject
    │   ├── StepRail
    │   └── ProjectForm
    ├── ProjectWorkspace
    │   ├── StageNavigation
    │   └── StageView
    │       ├── ProjectOverview
    │       ├── CreativeIntent
    │       ├── LyricsWorkspace
    │       ├── RecordingAnalysis
    │       ├── VocalArchitect
    │       │   ├── SignalFlow
    │       │   ├── EqCurve
    │       │   ├── ChainStep
    │       │   └── PreviewAndExport
    │       ├── ProjectReview
    │       └── FutureModuleBoundary
    └── OwnerAuthenticationBoundary
```

Rendering currently uses small pure view functions rather than a framework component runtime. Shared visual primitives are centralized as CSS classes and tokens.

## State Model

The top-level store contains a schema version, user preferences, and projects. Each project owns:

- metadata: title, artist, genre, DAW, stage, readiness, timestamps
- creative intent: central idea, perspective, response, voice, mood, conflict, destination, protected moments, accessibility
- lyrics: ordered sections and contextual feedback
- assets: typed project asset references without persisting raw file bytes
- preferences: Guided/Advanced mode, intensity, plugin inventory, optional style override
- generated chain: profile, parameters, ordered step definitions, decisions, analysis linkage
- recording analysis: source metadata, measurements, findings, limitations, analyzer provenance
- review history: readiness transitions
- session state: active stage, expanded chain step, chain order, lyric-feedback decisions

Raw audio remains in memory for the current browser session. It is intentionally not serialized into local storage.

## Future Extension Points

- Arrangement can add beat metadata, section boundaries, and energy events under the project.
- Vocal Blueprint can consume intent, lyrics, and arrangement without modifying those sources.
- Validation can attach before/after analysis pairs to a generated-chain version.
- Mastering and Release can add delivery targets and readiness gates.
- Owner-only capabilities use a server-authorized boundary under `/internal/`. Internal policies and proprietary reasoning must never ship as browser-visible configuration.
- A future API can replace local storage behind the store interface without rewriting view components or engines.

## Known Limitations

- Project persistence is local to one browser and has no authentication or cloud synchronization.
- Raw audio is cached only for the current page session.
- The preview represents generated EQ and broadband dynamics, not de-essing, saturation, pitch correction, delay, or reverb.
- Spectral findings are coarse candidates and deliberately use lower confidence.
- Lyrics feedback in the sample project is curated demonstration data; no model endpoint is connected.
- The Learn, Plugin Library, and Settings navigation destinations are reserved but not yet implemented.
- Arrangement, Vocal Blueprint, Validation, Mastering, and Release do not claim functionality before their engines exist.

## Recommended Next Milestones

1. Add deterministic audio fixtures and tolerance-based analysis regression tests.
2. Add editable lyric section content and model-backed feedback with evidence contracts.
3. Implement cloud project persistence, authentication, and explicit audio-retention controls.
4. Build beat analysis and arrangement timelines.
5. Implement processed-vocal validation with loudness-matched comparison.
6. Add private orchestration only after a server-side policy store and audit trail exist.

See [Owner Authentication](owner-authentication.md) for the deployment configuration required to access the private owner portal.
