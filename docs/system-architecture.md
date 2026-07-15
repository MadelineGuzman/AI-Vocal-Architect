# System Architecture

Cadenzai is a modular, project-based production workspace. It remains build-free and framework-free, using isolated ordered browser modules and a centralized CSS design system.

## Core Layers

### Interface Layer

- Deployment shell in `public/index.html`
- Centralized tokens and reusable component classes in `public/styles.css`
- Dashboard, project creation, stage workspace, Guided/Advanced disclosure, recording analysis, Vocal Architect, review, and Core boundary rendered from `public/app/app.js`

### Decision Layer

- Preset, intensity, DAW, plugin mapping, and export formatting in `public/app/recommendation-engine.js`
- Local measurement engine and versioned reports in `public/app/audio-analysis.js`
- Corrective decisions reference measurement finding IDs; creative decisions remain labeled separately

### Export and Recall Layer

- Text export for quick session notes
- JSON export containing project context, analysis provenance, chain, and order
- Versioned project/session persistence through local storage
- Review history and project readiness state

### Preview Layer

- Web Audio API sample loading
- DRY/WET transport preview
- Monitoring-oriented preview path for fast comparison

## Deployment Notes

- `public/` is the authoritative deployable application source.
- Root `index.html` is a development entry point that loads the same modules from `public/`.
- `worker.js` is the Cloudflare Worker entry point and serves the static assets from `public/` through the `ASSETS` binding.
- Proprietary analysis and production policies must remain server-side when those capabilities are introduced; browser-delivered JavaScript is public and inspectable.

## Planned Evolution

The next system boundary is a recording-analysis service that produces evidence-based findings without owning presentation. The app will consume those findings, connect them to chain decisions, and preserve the analysis version used for every recommendation. See `recording-analysis-spec.md` for the initial contract.
