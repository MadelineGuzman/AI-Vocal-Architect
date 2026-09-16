# System Architecture

> Historical prototype description retained for provenance. The current development architecture is React/Vite plus Express, described in [the project README](../README.md) and [the rebuild comparison](rebuild-comparison.md). This page does not define the current entry point or release configuration.

AI Vocal Architect is organized as a lightweight production tool with a single-page application front end and export-oriented support features.

## Core Layers

### Interface Layer

- Single-file web application in `index.html`
- Preset controls, DAW selector, intensity controls, and preview tools
- Visual output for EQ response, signal flow, and parameter blocks

### Decision Layer

- Preset-driven vocal chain logic
- Style-to-profile mapping
- Intensity scaling across EQ, compression, and FX settings
- DAW-aware plugin translation for practical implementation

### Export and Recall Layer

- Text export for quick session notes
- JSON export for structured data reuse
- Saved chain history through local storage
- Share and recall concepts for repeatable workflows

### Preview Layer

- Web Audio API sample loading
- DRY/WET transport preview
- Monitoring-oriented preview path for fast comparison

## Deployment Notes

- Static app served from `index.html`
- `public/index.html` retained for deployment compatibility
- `worker.js` reserved for auxiliary edge/runtime support where needed
