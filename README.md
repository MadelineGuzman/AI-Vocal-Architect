# Cadenzai

Cadenzai is an audio production workspace combining the Google AI Studio React rebuild with the earlier project's history and Hum to Spark integration.

## One source of truth

- Repository: https://github.com/MadelineGuzman/AI-Vocal-Architect
- Working folder: `Cadenzai`
- Current development branch: `feature/google-ai-studio-overhaul`
- Current application: `src/`, root `index.html`, and `server.ts`.
- The Google-overhaul repository is a superseded import source, not a second development destination.

`main` is still the older GitHub Pages publication branch. Do not merge the rebuild into it as routine folder cleanup: Pages publishes that branch automatically, and production hosting for the new server has not been reconciled.

## Local development

The repository has a Bun lockfile. With Bun installed, use `bun install --frozen-lockfile` for a fresh dependency installation. Existing installed dependencies can also run the scripts through npm.

```sh
npm run dev
npm run typecheck
npm test
npm run build
```

The Express development server listens on port 3000. Gemini chat requires `GEMINI_API_KEY` in the server process environment. `.env.example` lists the variable; the current server does not automatically load a `.env` file. Never place this key in frontend variables or source code. Without the key, the workspace runs but chat returns a configuration error.

For the built server, set `NODE_ENV=production` in the process environment before `npm start`. Production release remains pending; see the limitations below.

## Preserved earlier work

- `public/app/`, `public/index.html`, and `public/styles.css`: earlier modular application, preserved for feature migration and regression checks.
- `worker.js` and `wrangler.toml`: restored earlier Cloudflare owner authentication and static deployment configuration. This serves the earlier `public/` app, not the new Express API.
- `archive/legacy-prototype/`: standalone prototype recovered from the separate AI Vocal Architect folder.
- `legacy_index.html`, `legacy_server.js`, and `public/legacy_index.html`: snapshots already present in the AI Studio import.
- `assets/visuals/`: recovered artwork. The white logo lives in `src/assets/branding/`.
- `chains/`, `examples/`, and older `docs/`: retained product knowledge; historical descriptions do not establish current feature parity.

Start with [the rebuild comparison](docs/rebuild-comparison.md) and [the preservation manifest](docs/consolidation-manifest.json).

## Known gaps before release

The React rebuild is the development baseline, not yet a feature-complete replacement. Project persistence, old-data migration, vocal-chain generation/export, and Spark-to-project promotion still need to be brought forward. Some imported findings are demo data. Settings and Share are placeholders.

Owner authentication is restored for the Cloudflare Worker only. The Express server does not implement that owner login boundary, and its static build includes files copied from `public/`; it must not be treated as a secured production deployment. Hosting, API access controls, environment loading, and exclusion/protection of private assets need an explicit release pass.

Browser-local projects and recordings, provider secrets, and hosting settings are not backed up by Git. The two application versions use different localStorage metadata keys, even though their Spark audio database name/store match; no automatic migration has been implemented.
