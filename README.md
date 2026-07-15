# Cadenzai

Cadenzai is a project-based music production workspace from Syzygy Entertainment. Vocal Architect is its vocal-engineering module, combining creative intent, DAW context, style, processing intensity, and local recording evidence into practical vocal-chain blueprints.

The project is built around a practical studio question: how do you turn a creative description such as "aggressive rap lead" or "warm intimate R&B vocal" into a structured signal chain quickly, consistently, and in a way that still leaves room for taste?

## Overview

The application now follows a persistent production workflow: Dashboard → Project → Creative Intent → Lyrics → Recording Analysis → Vocal Architect → Project Review. Arrangement, Vocal Blueprint, Validation, Mastering, and Release have explicit architectural extension points without fabricated functionality.

Rather than acting as a one-click mixer, the system is designed as a production assistant. It provides a strong technical starting point that engineers can adjust inside their own session workflow.

## System Goals

- Improve efficiency by reducing time spent building common vocal chains from scratch
- Increase consistency across sessions, artists, and delivery formats
- Support creative augmentation by translating descriptive language into usable mix decisions
- Encourage systemized engineering habits without flattening artistic variation

## Feature Breakdown

### Vocal Chain Design

- Generates structured vocal processing chains from style input
- Builds parameter suggestions for EQ, compression, de-essing, saturation, delay, and reverb
- Adapts chain behavior based on user-selected intensity

### Preset System

- Includes predefined vocal profiles for multiple production styles
- Uses style-aware defaults for tonal balance, dynamics control, and ambience
- Supports rapid A/B exploration through alternate vibe adjustments

### DAW-Aware Output

- Formats recommendations around common DAW-native workflows
- Maps settings to practical plugin choices rather than abstract concepts alone
- Supports exportable settings for reuse and documentation

### Preview and Monitoring Concepts

- Demonstrates dry vs. wet comparison logic for vocal previewing
- Surfaces chain state visually through EQ response and signal-flow displays
- Exposes parameter-level debug and export data for validation
- Analyzes loaded audio locally for levels, dynamics, clipping, silence, and coarse spectral balance
- Connects supported recording findings to corrective chain decisions with confidence and analyzer provenance

### Automation and Systemization Concepts

- Encodes repeatable vocal processing logic into reusable chain structures
- Encourages standardized session setup for leads, doubles, and supporting vocals
- Creates a framework for future expansion into preset recall, chain history, and assistant-driven routing

## Technologies Used

### Audio Production

- DAWs such as FL Studio, Logic Pro, Pro Tools, Ableton, and REAPER
- Native and stock plugin workflows including EQ, compression, reverb, delay, pitch, and saturation tools
- Studio-style vocal chain concepts based on real mix-engineering practice

### Application Layer

- Modular vanilla HTML, CSS, and JavaScript with ordered browser modules that also work from `file://`
- Web Audio API for local preview and signal-chain demonstration
- Local storage for projects, preferences, creative intent, lyrics decisions, chain state, analysis reports, and review history

### AI and Decision Support

- Natural-language interpretation for vocal style intent
- Rule-based preset mapping and chain scaling logic
- AI-assisted workflow concepts for production planning and parameter recommendation

## Example Workflow

1. Create or resume a song project.
2. Define the creative intent and protected moments.
3. Develop lyrics and record feedback decisions.
4. Load a raw vocal for local evidence-based analysis when available.
5. Open Vocal Architect to review, reorder, and refine the generated chain.
6. Switch between Guided and Advanced detail without changing the underlying recommendation.
7. Preview supported EQ and dynamics, then export text or JSON.
8. Review project readiness and next actions.

## Production Use Case

AI Vocal Architect is best positioned as a pre-mix decision tool. It helps engineers move from rough creative direction to a technically grounded vocal chain quickly, making it useful for:

- vocal template creation
- fast client turnaround sessions
- preset prototyping
- educational demonstrations of vocal processing logic
- documenting repeatable chain decisions across projects

## Future Improvements

- Session-specific chain variation for lead, double, ad-lib, and background vocals
- Deeper DAW integration and plugin parameter translation
- Smarter preview rendering that reflects pitch and time-based effects more accurately
- Better chain auditioning with multiband and serial/parallel processing models
- Expanded AI interpretation for genre hybrids and artist-reference prompts
- Preset versioning, shareable chain snapshots, and collaborative export workflows

## Product Direction

The next product milestone is an evidence-based recording workflow: `Analyze → Recommend → Process → Validate`. The [Recording Analysis Specification](docs/recording-analysis-spec.md) defines the first measurable analysis contract.

See [Implementation Architecture](docs/implementation-architecture.md) for the component hierarchy, state model, extension points, limitations, and recommended milestones.

## Status

This project is an active exploration of AI-assisted vocal production design. It is intended to demonstrate how engineering systems, interactive tooling, and AI-guided decision support can work together inside a modern audio workflow.
