# Cadenzai repository

- Canonical repository: `MadelineGuzman/AI-Vocal-Architect` (`origin`).
- Canonical local folder: `Cadenzai`.
- Continue current development on `feature/google-ai-studio-overhaul` until a release is ready. GitHub Pages publishes `main`; changing it can publish the app.
- Read `README.md` and `docs/rebuild-comparison.md` before changing application boundaries. React `src/` and `server.ts` are the current development baseline. `public/app/` and `archive/` preserve earlier work; do not mistake their feature set for React feature parity.
- Keep original history and recovered source assets. Use `docs/consolidation-manifest.json` for provenance.
- Run `npm run typecheck`, `npm test`, and `npm run build` for code changes where applicable. Existing browser-module tests do not cover the full React app.
- Keep provider keys server-side and ignored. Do not describe mock analysis as measured audio evidence.
- Local browser data and deployment credentials are not Git backups. Do not overwrite old storage keys without an explicit migration.
