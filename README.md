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

## Project persistence and legacy migration

The React workspace now saves and restores full projects.

- **Storage.** Projects are stored in a dedicated IndexedDB database, `cadenzai-projects` (object stores `projects` and `session`). This is separate from Hum to Spark, which keeps its own database `cadenzai` (store `spark-audio`); Hum to Spark data is left untouched.
- **What is saved.** Title, notes, the recording itself (audio Blob), asset metadata, artist-defined sections, findings and their triage decisions, and chat history.
- **Saving.** Edits autosave (debounced) and there is an explicit Save/Retry button. The status bar shows Saving / Saved / Unsaved / Save failed, and success is only reported after the IndexedDB transaction commits.
- **Reopening.** The last active project is restored on load. Measured findings are recomputed from the restored audio rather than trusted blindly; if saved section times no longer fit the recording the project is reported as invalid rather than silently changed.
- **Multiple projects.** A project picker (the Projects button) lists saved projects, shows whether each still has its recording, and switches between them. The current project is always saved before another is opened or a new one is started.
- **Conflict safety.** Each save carries a revision. If another browser tab saved in the meantime, the save is refused with a clear message instead of overwriting the other tab's work.

### Importing earlier projects

"Import earlier projects" (in the project picker) brings forward work saved by the earlier Cadenzai app.

**Supported:**

- Reads project metadata from the earlier keys `syzygy_cadenzai_state_v1` and the older `syzygy_opus_state_v1` fallback.
- Creates a new saved project per earlier project (id namespaced as `legacy-project:<id>`), folding artist, genre, DAW, creative intent, and lyrics into the project notes.
- Preserves the complete original record (including fields the new workspace does not use yet) under the project's `legacySource`.
- Is repeatable: re-running it does not duplicate or overwrite already-imported or edited projects, and it never writes to or deletes the original `localStorage` keys. A raw snapshot of each source key is also kept in the projects database.

**Not supported (by design, for now):**

- **Audio is not migrated.** The earlier app did not store project audio in a portable form, so imported projects open without a recording and explicitly ask you to attach one before analysis. Attaching a recording keeps the recovered notes and original data.
- No automatic migration of Spark/idea metadata beyond what is folded into notes.
- No cross-browser or cross-device sync. All project data is local to one browser origin and is **not** a Git-backed or cloud backup.
- Vocal Architect chain generation/export and Spark-to-project promotion are still not ported into the React workspace. Settings and Share remain placeholders.

## Preserved earlier work

- `public/app/`, `public/index.html`, and `public/styles.css`: earlier modular application, preserved for feature migration and regression checks.
- `worker.js` and `wrangler.toml`: restored earlier Cloudflare owner authentication and static deployment configuration. This serves the earlier `public/` app, not the new Express API.
- `archive/legacy-prototype/`: standalone prototype recovered from the separate AI Vocal Architect folder.
- `legacy_index.html`, `legacy_server.js`, and `public/legacy_index.html`: snapshots already present in the AI Studio import.
- `assets/visuals/`: recovered artwork. The white logo lives in `src/assets/branding/`.
- `chains/`, `examples/`, and older `docs/`: retained product knowledge; historical descriptions do not establish current feature parity.

Start with [the rebuild comparison](docs/rebuild-comparison.md) and [the preservation manifest](docs/consolidation-manifest.json).

## Known gaps before release

The React rebuild is the development baseline, not yet a feature-complete replacement. Project persistence and explicit legacy import are now implemented (see [Project persistence and legacy migration](#project-persistence-and-legacy-migration)). Still pending: vocal-chain generation/export and Spark-to-project promotion in the React workspace. Findings shown on import are now measured DSP only (the canned demo-findings service was removed); a finding's `provenance` still distinguishes `real-dsp` from any future `ai-model` source. Settings and Share are placeholders.

Owner authentication is restored for the Cloudflare Worker only. The Express server does not implement that owner login boundary, and its static build includes files copied from `public/`; it must not be treated as a secured production deployment. Hosting, API access controls, environment loading, and exclusion/protection of private assets need an explicit release pass.

Browser-local projects and recordings, provider secrets, and hosting settings are not backed up by Git. The two application versions use different localStorage metadata keys, even though their Spark audio database name/store match. Migration is explicit and opt-in via "Import earlier projects" (metadata only; audio is reattached by the user) — it never runs automatically and never modifies the original keys.
