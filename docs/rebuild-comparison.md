# Cadenzai: earlier app versus Google AI Studio rebuild

Audit and consolidation date: 2026-09-16. This compares committed source, not unexported changes inside the AI Studio editor or a newly verified live deployment.

## Provenance

| Snapshot | Commit | Meaning |
| --- | --- | --- |
| Original repository publication branch | `5512cbf` | GitHub `main` at audit time; older than the full local Cadenzai work |
| Earlier Cadenzai app | `e8932ed` | Includes workspace, release hardening, owner portal and Hum to Spark |
| Google AI Studio import | `42e22da` | React/TypeScript application before Hum to Spark integration |
| Existing combined history | `690b732` | Merge with parents `e8932ed` and `42e22da`; already backed up in both repositories |

The comparison baseline is `e8932ed`, not the older GitHub `main`, so earlier capabilities are not accidentally overlooked. The import replaced some files with older variants while adding the new interface. Its net diff from the earlier app was 40 files, 7,858 insertions and 240 deletions. File counts do not establish feature parity.

Hum to Spark in the React app was added during the later integration. It was not part of the pristine Google import. Existing tracked history is retained; no history rewrite is required to consolidate the folders.

## What changed

| Area | Earlier Cadenzai | Google import / integrated rebuild | Result and next work |
| --- | --- | --- | --- |
| Interface | Vanilla JS project dashboard and guided production stages | React 19, TypeScript, Vite, Tailwind, waveform timeline, section editor and intelligence panel | Use the React interface for ongoing development |
| Project organization | Project creation, metadata, intent, lyrics, stage progression and localStorage state | A single active audio workspace held mostly in Zustand memory | Bring project creation/saving and reload recovery forward |
| Audio analysis | Local recording measurements, versioned reports and measured findings feeding recommendations | Windowed power, artist-defined sections, section energy/activity comparisons and deterministic energy findings | Both contain useful real DSP; neither proves every displayed claim is measured |
| Demo findings | Earlier recommendation/analysis modules use explicit measurement contracts | `AnalysisService` returns fixed vocal-masking and pitch findings on import, marked `mock`; real DSP findings are separate | Replace or isolate mock findings before release; do not describe them as measured |
| AI assistance | Rule-based production recommendations | Express `/api/chat` proxy, server-side Gemini key and structured track/section context | Useful new capability; provider calls and current model availability were not tested |
| Evidence discipline | Corrective-versus-creative chain decisions and report provenance | Prompt distinguishes artist facts, measurements and hypotheses; context lists unavailable measurements | Preserve both approaches; prompt safeguards alone do not validate DSP or provider output |
| Vocal Architect | DAW-aware chain generation, presets, intensity, text/JSON export and dry/wet preview | Earlier code survives under `public/app/`, but these tools are not integrated into the React workspace | Port deliberately instead of deleting the earlier modules |
| Hum to Spark | Capture, melody interpretation, local audio storage, saved ideas and promotion to a project | Absent from the pristine import; integration added a React capture/save/play/delete dialog | Keep current capture and restore promotion/export workflows later |
| Saved data | Metadata under `syzygy_cadenzai_state_v1`, with older `syzygy_opus_state_v1` fallback | Spark metadata under `cadenzai-sparks`; other workspace state is transient | Metadata schemas/keys differ; there is no migration |
| Spark audio | IndexedDB `cadenzai`, store `spark-audio` | Same database/store names in the TypeScript adapter | Same names do not migrate metadata; storage is also scoped to browser origin |
| Owner portal | JWT signature, issuer, audience, time and owner checks; private headers; Worker-first routing | Import/integration reduced the Worker to static passthrough and removed protected routing | Earlier Worker and configuration restored during consolidation; Express is still a separate unresolved boundary |
| Deployment | Static app and Cloudflare owner route | Node/Express + Vite build added alongside the old static deployment configuration | Build succeeds, but hosting paths are not a unified production release |
| Documentation/schema | Project-oriented docs and versioned chain export example | Some docs regressed to the earlier single-file prototype description; chain example lost provenance fields | README and entry-point docs clarified; versioned chain example restored |
| Settings/sharing | Chain copy/export and project review flows | Settings alert is a placeholder; Share has no action | Do not count toolbar icons as implemented capabilities |

## What consolidation preserves and repairs

- One canonical local working folder, `Cadenzai`, using the existing original repository and rebuild development branch.
- All prior commits and both parents of the existing integration merge.
- Three previously untracked visual assets and a byte-preserved standalone prototype. The identical white logo is reused from the existing tracked path. Checksums are in `consolidation-manifest.json`.
- The earlier Cloudflare `worker.js`, `wrangler.toml`, and versioned chain example restored from `e8932ed`.
- Explicit development instructions and automated owner-denial regression coverage.

Restoring Worker-first routing follows [Cloudflare's static-assets routing documentation](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/): authentication must execute before private assets are served. The restoration does not establish that any live deployment has changed or that the Express server is protected.

## Validation and release boundary

The pre-consolidation TypeScript check and production build passed. Melody tests passed. The release smoke test failed because the integration dropped owner authentication. Consolidation restores that code and adds behavioral tests for anonymous/unconfigured/malformed-token denial, method restrictions and public routing. Final results are reported with the consolidation commit.

The existing tests primarily cover the earlier browser modules. They are not end-to-end coverage of the new React application, microphone capture, IndexedDB persistence, valid Cloudflare login, or paid Gemini calls.

GitHub Pages was verified to publish `main` from `/`. Consolidation therefore uses `feature/google-ai-studio-overhaul`; merging into `main` is a release action, not folder maintenance. The duplicate GitHub repository is archived read-only after confirming every published ref is contained in the canonical history. Local development pushes only to `origin` (the original repository). The AI Studio editor connection itself was not changed or inspected; reconnect it to the canonical repository before attempting future exports, and retain any unexported editor work.

Recommended next implementation sequence:

1. Establish one hosting path, protect/remove private static assets from the Express build, and add API access controls before public deployment.
2. Restore project persistence and explicitly migrate old browser metadata without deleting the old storage keys.
3. Bring Vocal Architect and Spark-to-project promotion into the React interface.
4. Replace/isolate demo findings; test actual React audio and saving flows.
5. Review a release diff, then merge to the publication branch when deployment behavior is ready.

## Recovery

Before retiring redundant folders, create a verified local Git bundle under `.local-backups/` in the canonical folder. This is an ignored recovery artifact, not another working repository. Preserve unique files using the manifest and verify the consolidated commit before removing the linked worktree. Historical source remains accessible with `git show <commit>:<path>`.

## Verified consolidation outcome

- Source consolidation commit: `52778b0`, pushed to the original repository's rebuild branch.
- Canonical folder: `Cadenzai`; only one registered live worktree remains.
- `npm run typecheck`, all three `npm test` suites, and `npm run build` passed from that folder after dependency paths were repaired for the move.
- Both recovery Git bundles were verified. They and the original artwork copies are stored locally under `.local-backups/2026-09-16-consolidation/` and are intentionally not pushed.
- The separate `AI Vocal Architect` prototype folder was retired after checksum verification.
- The duplicate GitHub repository is archived; the original repository is the only configured remote.
- The old `Cadenzai-google-overhaul` checkout and its Git registration are gone. Windows may retain its empty directory while the Codex task that started there holds it open. It contains no source and can be removed after closing that task.
- `main`, GitHub Pages configuration, and live hosting were not changed.

No browser-stored projects/recordings, hosted credentials or unexported AI Studio editor changes were migrated by this filesystem consolidation.