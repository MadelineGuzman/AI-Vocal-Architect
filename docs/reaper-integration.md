# REAPER selection bridge — first milestone

Cadenzai retains its React interface and saved projects. REAPER owns recording, editing, mixing, routing and playback. This bridge observes selection only: no audio transfer, no project edits, no transport control, and no model calls.

## Setup (Windows)

1. Start Cadenzai from the canonical repository with npm run dev.
2. Open http://127.0.0.1:3000 in a browser on this computer.
3. In REAPER, open Actions > Show action list. Choose ReaScript > Load (wording may vary by version), and select reaper/Cadenzai_Read_Selection.lua from this repository.
4. Run that action. The REAPER panel appears above the existing Cadenzai workspace, even without imported audio. Select a track; expand its details to see the GUID.
5. Stop by running the action again and choosing Terminate. The panel expires within approximately four seconds of the last heartbeat. Start the action again to reconnect.

Use one bridge action in one REAPER instance at a time. Automatic startup is intentionally not configured. Loading the action registers a script in REAPER settings; it does not edit the song. No SWS, ReaPack, LuaSocket, or other extension is required to run the bridge in REAPER. The initial script is Windows-only.

## Data and safety

Lua writes a bounded JSON snapshot to LOCALAPPDATA/Cadenzai/reaper-bridge/state.json. The local server reads only that fixed file; the browser cannot request arbitrary paths. It contains project display name, saved/unsaved status, temporary project identity, selected track names/GUIDs/numbers, and heartbeat metadata. No project path or audio is included. The file is outside the repository and public assets. It remains on disk after stopping and may be deleted when the bridge is stopped.

Selection is checked every 250 ms. Changes and one-second heartbeats are published; React polls every 500 ms without overlapping requests. Partially written JSON retains the last valid snapshot only until its original heartbeat expires. Invalid or oversized data is rejected. Old data is visibly stale. These timings are targets subject to scheduling delays, including REAPER modal dialogs.

The Express server now binds to IPv4 loopback and rejects unexpected Host/Origin headers and cross-site browser requests. Local applications under the same user are trusted; this is not a defense against malicious software on the computer. The endpoint has no command channel. REAPER metadata is not inserted into AI prompts or saved Cadenzai projects. Existing production deployment/authentication work remains separate.

Track GUIDs survive renaming/reordering; track numbers are display labels. Project identities are session-scoped and reset when the bridge restarts or a project is closed. Unsaved tabs can be distinguished without writing to projects. Multiple selections, the master track and empty selections are represented explicitly. More than 512 selected tracks stops the script with an explanatory message.

## Verification

npm run test:reaper checks bounded parsing, stale data, recovery, schema validation, cross-origin/host rejection and a real local HTTP route. When Lua is installed on the development machine, it also executes the actual bridge against a strict read-only API double, including Unicode/escaping, renaming, reordering, master selection, project changes and heartbeats. A standalone Lua runtime is needed only for this developer test, not normal REAPER use.

Before calling live integration verified, use a disposable REAPER project: select and rename tracks, reorder them, select multiple/no/master tracks, switch saved and unsaved tabs, stop/restart the script and server, and observe the panel. Confirm playback continues and observation creates no project dirty state or undo entries. Also check Cadenzai audio import/save/reopen. Automated doubles do not establish real REAPER behavior or timing.

## Next phases

Choose and label the analysis signal point (source, pre-FX, post-FX or routed output) before adding audio analysis. Session routing and effects make those different signals. Production controls require a separate, explicitly approved write path with review and undo; they must never be added to this observation endpoint implicitly.

## References and licensing

- https://www.reaper.fm/sdk/reascript/reascript.php
- https://www.reaper.fm/sdk/reascript/reascripthelp.html

The bridge is original project code using documented APIs. No third-party bridge code, new package dependencies, or REAPER binaries are bundled. REAPER remains separately installed/licensed.

## Verification recorded October 11, 2026

React typecheck, explicit server/test typecheck, full regression suite (including actual Lua under API doubles), production build and diff whitespace checks passed. The running local endpoint returned waiting and the real browser displayed the branded REAPER panel without imported audio. REAPER 7.82 was located and opened; loading the action through desktop automation could not be verified. Live selected-track synchronization, playback/undo behavior and restart timing remain pending manual verification. No audio was transferred or edited, and no Git push or deployment was performed.


## Recording level check (October 12, 2026)

The optional analysis action reads audio locally inside REAPER. Only measurements are sent to Cadenzai; no samples, gain changes, effects changes, or transport commands are transferred.

1. If the selection action is already running, run it again and choose Terminate, then run it once more. This loads the updated connector needed by analysis.
2. Load `reaper/Cadenzai_Analyze_Levels.lua` using REAPER's Actions list. Keep the adjacent `lib` folder in place.
3. Select exactly one audio item and its track. Drag a time selection over the portion to measure (up to 120 seconds).
4. Run the analysis action. Expand **Recording level check** in Cadenzai to see progress and results.
5. Rerun after edits or when choosing another recording or range. Reports identify the measured take, project-time range and timestamp. They are snapshots, not live meters. A disconnected bridge or mismatched project, track or revision marks the result historical.

This first version accepts mono/stereo audio at 8–192 kHz, normal playback rate and pitch, and no stretch markers or reversed/section sources. Actual repeated loops are excluded. The time selection is intersected with the selected item. Unsupported inputs produce an explanation without editing the project.

The signal is the selected take's audio accessor before effects, not the track mix, fader output or master. Sample peak is the highest absolute channel sample. RMS averages squared samples across channels without cancelling opposite polarity. Peak above average is crest factor. Active variation is the 90th minus 10th percentile of complete 400 ms RMS windows above -60 dBFS; fewer than two active windows produces no estimate. Silence has no finite decibel value. These are not LUFS or true-peak measurements. A -6 dBFS sample peak is a personal headroom reference, not a required loudness target.

Measurements are written to `LOCALAPPDATA/Cadenzai/reaper-bridge/levels.json`, capped at 16 KiB by the server. Reports remain on disk until replaced; timestamps and identity stay visible. Cancelled, changed or stalled analyses are reported as errors. The accessor is released after completion or cancellation.

### Verification status

The user confirmed live track switching and stopping the selection bridge in REAPER. This supersedes the earlier pending status for those two checks only. Real audio level analysis still needs a live REAPER check.

The full regression suite, typecheck and production build passed for the level feature. `npm run test:levels` requires standalone Lua on the developer PATH and checks known sine-wave levels, stereo polarity, silence, full-scale counts, variation, time offsets, cancellation, errors and accessor cleanup using the actual Lua scripts against strict API doubles. It also checks server validation and bounded file reads. REAPER itself supplies Lua for normal use; users do not need a separate Lua installation.

## Analyze from Cadenzai — request flow (October 14, 2026)

The recording level check can now be started from Cadenzai with a visible **Analyze selected section** button. You no longer run a second REAPER script for routine checks; the continuous selection bridge performs the same read-only analysis when Cadenzai asks.

### One connector, one setup step

1. Load and run `reaper/Cadenzai_Read_Selection.lua` from REAPER's Actions list, as before. Keep the adjacent `lib` folder in place.
2. **Restart the bridge after updating it.** If an older bridge is already running, run the action again, choose Terminate, then run it once more so the request-handling code loads. The bridge must be restarted after any script change.
3. `reaper/Cadenzai_Analyze_Levels.lua` still exists for manual, standalone use, but it is optional — the button is the normal path.

### How it works and what stays safe

- You pick a recording and time range in REAPER, then click **Analyze selected section** in Cadenzai. The UI progresses through *REAPER connected → Request sent → Measuring → Complete*, and reports the recording name, measured range and completion time. Disconnected, rejected, no-selection, timeout and reconnect states each explain the next action.
- The browser-to-REAPER channel is a single bounded file, `request.json`, in the same `reaper-bridge` folder. It carries only `version`, the fixed command `kind:"analyze-selection"`, a server-generated `requestId`, and `requestedAt`. It never contains file paths, Lua, shell commands, or project edits. The bridge extracts only the id and acts solely on whatever is selected in REAPER at that moment, echoing the id back in `levels.json`.
- Selection is captured when the bridge receives the request. The report shows exactly what REAPER measured (track, take, project-time range, sample rate, channels); if the current selection or project revision no longer matches, the result is clearly labelled historical.
- Only one analysis runs at a time. Duplicate or concurrent requests are refused by the UI (the button is disabled while pending), by the server (409 while a request is pending or an analysis is running, or while REAPER is not connected), and by the bridge (it ignores a new request while busy and will not replay a stale one after a restart). The server keeps the loopback-only, Host/Origin and bounded-file protections; the only new server effect is writing that one request file.
- This remains observation only. There is no gain, audio, effects, routing, transport or project change, and no automatic target is applied; the −6 dBFS preference stays a contextual reference.

### Verification recorded October 14, 2026

Automated checks passed: React typecheck, the full `npm test` suite, and the production build. New automated coverage, clearly distinct from a live REAPER test:

- `tests/reaper-bridge-analyze.lua` drives the real `Cadenzai_Read_Selection.lua` against a strict read-only + audio API double with a request present, proving it consumes the request, runs the read-only measurement, echoes the `requestId`, keeps publishing the live selection, and releases the accessor once.
- `tests/reaper-request.ts` exercises the `POST /api/reaper/analyze` request channel over a real local HTTP boundary: request-file round trip and validation, the connected/in-progress/pending 409 guards, stale-request expiry, and cross-origin rejection.
- `tests/reaper-levels.ts` continues to validate the analysis engine and the manual action through the shared `reaper/lib/analyze.lua` module.

The full browser lifecycle was verified against the running local server with a simulated bridge (an isolated `LOCALAPPDATA` sandbox, so the user's live REAPER files were never touched): connected selection shown, request written by the button click, measuring progress, completed metrics with the honest-measurement caveats, and the no-selection rejection surfaced with REAPER's reason. **A live end-to-end run with the updated bridge loaded in REAPER (real audio, real request → measure → complete) still needs a manual check on the user's machine.** No audio was transferred or edited, and no Git push or deployment was performed.
