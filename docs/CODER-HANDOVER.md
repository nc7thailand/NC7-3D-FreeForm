# CODER-HANDOVER.md

**For:** Incoming Coder (Cursor IDE)
**From:** Outgoing Coder (Qwen Code) audit + PL decisions
**Date:** 2026-09-20
**Repo:** github.com/nc7thailand/NC7-3D-FreeForm
**Branch:** `main` (HEAD `23fb15f`)
**Deployed:** Cloud Run via Cloudflare Worker reverse proxy — `3dfreeform.nc7foamart.com`

---

## 0. ROLE & PROTOCOL

You are the **Coder**. You implement. PL reviews every output.

**Hard rules:**
- **Standby for PL orders.** Do not self-initiate work. Do not propose direction.
- **Commit directly to `main`** — but ONLY on PL's explicit order. Never commit/push on your own.
  - Direct-to-`main` is safe ONLY because §6 SHA check gates every change. If SHA breaks, STOP and report to PL — do not commit.
- **Reply in English. Brief. Bullets.** No restating the task, no padding.
- **Do not touch pipeline files** without PL approval — see §5 classification.
- **Verify before reporting done** — see §6.
- PL is the runtime verifier. You verify by code inspection + build + SHA. Never claim runtime success.

---

## 1. PROJECT

NC7 3dFreeFoam — 3D hot wire foam cutter CAM.
Reverse-engineering DevFoam 3D 2.0 (DevCad, ~2011).

**Stack:** React + Vite SPA, Three.js (3D), Canvas 2D (2D preview + Sim), d3-contour (silhouette), no backend — 100% client-side math.

**Sister project:** NC7 PathFinder (2D CAM). Design flows between projects.

---

## 2. NON-NEGOTIABLES (locked)

- No sort-by-height
- No clamp-to-block  ⚠️ *(see §10.1 — contradiction under review)*
- No frame
- No Chaikin smoothing
- One closed silhouette loop per rotation angle, exactly as `d3-contour` emits it
- 2D view = source of truth (drives G-code pipeline)
- 3D view = visualization only (never drives pipeline)
- **G-code SHA must remain `dae3c7351f9cb04b4e71e4b19dcd5796ede93919fed670c5b0b74f1a365e2490`** unless PL explicitly says "we are changing the G-code pipeline"

---

## 3. GOLDEN REFERENCE & FEED MODE

**Primary Golden SHA:** `dae3c7351f9cb04b4e71e4b19dcd5796ede93919fed670c5b0b74f1a365e2490`
→ This is the **highest authority** for validating current G-code output.

**`StackedCut2_CutLeft-Right.nc.txt`** (DevFoam output)
→ **Structural reference only.** Do NOT compare numeric values against it in the current loop. It uses G93; we do not.

**Feed mode decision (locked):**
- **Use G1/G94 (feed per minute) exclusively.**
- **G93 is OUT.** Not for this project. Reserved for a future 4-axis airplane-wing project.
- If `gcode.js` still hardcodes or comments G93 — that is a pending code fix (Issue B), not a state to preserve.

**Sim vs G-code feed — decoupled:**
- `gcodeSettings.feedRate` (700) — G-code export only. Never modified by Sim/WSB/SGP flow.
- `stock.simFeedRate` (500) — simulation timing + time display only.
- Sim changes must never alter G-code output.

---

## 4. PIPELINE (5 stages)

1. **Closed silhouette loop** — one loop per rotation angle, from d3-contour.
2. **Vector boolean split** at rotation axis → left/right halves.
3. **Open the loop** — cut bottom at Cutout Offset Bottom, top at Min Axis Distance.
4. **Safe points** — extend from wire endpoints.
5. **G-code wrap** — G1/G94 throughout.

**Status:**
- Stage 1: **LOCKED and committed.**
- Stages 2–5: **not wired into live UI** (old scaffolding removed).

---

## 5. REPO MAP

Classification legend:
- **[PIPELINE]** — affects G-code SHA / cut geometry. **Never edit without PL approval.**
- **[VIZ]** — visualization / UI only. Safe to read; be careful with pipeline calls.
- **[IO]** — file/session plumbing. No G-code effect, but can break project load/save.
- **[ORPHAN]** — no remaining importer.

### `src/lib/`

| File | Purpose | Class |
|---|---|---|
| `toolpath.js` | Cutting-plane math, `buildSectionProfile` (G-code site 1), `buildFullSilhouettePreview` (display) | **[PIPELINE]** |
| `silhouette.js` | Occupancy-raster shadow trace; `extractLeftSilhouette` (G-code) + `extractFullSilhouette` (display) | **[PIPELINE]** |
| `gridContour.js` | `traceGridBoundary` — Moore-neighbour tracer, preserves concavities. **Shared by G-code path (`silhouette.js`) AND viewer path (`shadowProjection.js`).** | **[PIPELINE]** — shared, do not assume viewer-only |
| `wirePath.js` | Kerf, BO clamp, dedupe; `wirePathFromProfile` builds emitted polyline. ⚠️ see §10.1 | **[PIPELINE]** |
| `gcode.js` | G-code post-processor; `generateGcode`, feed/format, retract, Z index. ⚠️ see §10.2 | **[PIPELINE]** |
| `cutJob.js` | `buildCutJob` — per-cut orchestration, cut modes, angle list, N clamping | **[PIPELINE]** |
| `stl.js` | STL load + `orientGeometryUp` Z-up→Y-up auto-detect | **[PIPELINE]** |
| `settle.js` | Drop model to Y=0 floor | **[PIPELINE]** |
| `slicer.js` | Mesh/plane intersection; only used by checkpoints/PoC | **[ORPHAN]** |
| `shadowProjection.js` | Collimated-light shadow outline; Viewer3D overlay only. Shares `traceGridBoundary` from `gridContour.js` with the G-code path. | **[VIZ]** — but touches shared tracer |
| `cutOverlay.js` | Shared 2D/Combined overlay data | **[VIZ]** |
| `simStack.js` | 3D world-space wire paths for Simulate page | **[VIZ]** |
| `simSettings.js` | Sim feed rate/unit localStorage (`nc7-3dfreefoam-sim-settings`) | **[VIZ]** |
| `simplify.js` | Mesh decimation for display | **[VIZ]** |
| `resize.js` | Geometry scaling, inch↔mm constants | **[VIZ]** |
| `sample.js` | Demo model generators | **[ORPHAN]** |
| `exampleStl.js` | `?url` import of bundled knight STL | **[IO]** |
| `export.js` | Binary STL download | **[IO]** |
| `project.js` | Project pack/unpack (fflate zip) | **[IO]** |
| `session.js` | IndexedDB autosave | **[IO]** |

`src/lib/checkpoints/` — frozen snapshots of superseded approaches (`silhouette-edges-v1`, `silhouette-envelope-v2`, `shadow-raycast-v1`). Not on any live import path. Historical reference only; **do not wire back in.**

### `src/components/`

| File | Purpose | Class |
|---|---|---|
| `SilhouettePreviewPanel.jsx` (36 KB) | 2D preview canvas, pan/zoom, WSB host, sim loop | **[VIZ]** |
| `Viewer3D.jsx` (49 KB) | 3D viewport, solids, grid, shadow, Combined mode | **[VIZ]** |
| `WireSimulatorBar.jsx` | WSB overlay (`.wsb-` classes) | **[VIZ]** |
| `SimulationGcodePanel.jsx` | SGP modal — sim feed rate + unit | **[VIZ]** |
| `SimulateViewer.jsx` | Older 3D sim viewer (simStack) | **[VIZ]** |
| `PathPreviewCanvas.jsx` | Legacy path-preview canvas | **[VIZ]** |
| `ToolpathSetupOverlay.jsx` | Blocking setup modal, draft/apply | **[VIZ]** |
| `ToolpathParametersForm.jsx` | Param inputs | **[VIZ]** |
| `ViewCube.jsx` | View orientation cube | **[VIZ]** |
| `PageNav.jsx` | Next/Back + dim logic | **[VIZ]** |
| `Stepper.jsx` | Numeric stepper | **[VIZ]** |
| `AppLayout.jsx` | Shell/layout | **[VIZ]** |
| `ProjectPanel.jsx` | Save/load UI | **[IO]** |
| `RouteGuards.jsx` | Route protection / gating | **[VIZ]** |
| `LoadingOverlay.jsx` | Spinner | **[VIZ]** |
| `WIPBanner.jsx` | WIP banner | **[VIZ]** |

No component writes SHA-affecting values except by calling `lib` pipeline. **`SilhouettePreviewPanel.jsx` and `Viewer3D.jsx` are the two files most likely to hold state that feeds the pipeline indirectly — treat their pipeline calls as read-only.**

### `src/context/`

| File | Purpose | Class |
|---|---|---|
| `AppState.jsx` (26 KB) | Global state: `stock`, `gcodeSettings`, `simSettings`, `simActive`/`simPlaying`, cut mode, persistence | **[PIPELINE-ADJACENT]** — owns the inputs. Never edit without PL approval. |

### `src/pages/`

| File | Purpose | Class |
|---|---|---|
| `ModelPage.jsx` | Load/settle/orient model (calls `stl.js`/`settle.js`) | **[VIZ]** |
| `ToolpathPage.jsx` | 2D/Combined toggle, setup panel, `buildCutJob` | **[VIZ]** (triggers pipeline) |
| `SimulatePage.jsx` | 3D sim playback | **[VIZ]** |
| `GcodePage.jsx` | G-code display + download (calls `generateGcode`) | **[VIZ]** |

### `scripts/` — runnable tools

| File | Purpose |
|---|---|
| `dump-gcode.mjs` | **The G-code identity harness.** SHA this. |
| `golden-compare.mjs` | Silhouette vs DevFoam metrics |
| `verify-stage5.mjs`, `wire-production.mjs` | Stage-5 verification |
| `gen-*.mjs` | SVG/NC generators for staged verification |
| `diag-*.mjs`, `poc-*.mjs`, `verify-silhouette.mjs` | Scratch / proof-of-concept |
| `capture-model-page.mjs` | Page capture |
| `*.svg`, `*.png`, `*.csv`, `*.nc` | Generated artifacts, committed |

`scripts/gen-stage3-4-5.mjs` is the **only surviving reference implementation of old Stage 2–4 logic.** Not imported by anything.

---

## 6. VERIFICATION — before reporting "done"

```bash
# 1. G-code identity — the single most important check
node scripts/dump-gcode.mjs | shasum -a 256
# MUST equal dae3c7351f9cb04b4e71e4b19dcd5796ede93919fed670c5b0b74f1a365e2490

# 2. Build gate (necessary, NOT sufficient)
npm run build          # exit code must be 0

# 3. Diff review
git diff / git status

# 4. Dev-server hygiene
lsof -i :5173 | grep LISTEN          # before starting — reuse if present
lsof -i :5173-5179 | grep LISTEN     # before declaring session closed
pkill -f "NC7Studio3D.*vite"         # cleanup, never leave background processes
```

---

## 7. DANGEROUS / FORBIDDEN COMMANDS

- **`pkill node` / `killall node` / `kill $(pgrep node)`** — kills unrelated processes. Kill by PID or process group.
- **Deleting or overwriting `src/lib/checkpoints/`** — sole surviving copies of superseded algorithms.
- **`rm -rf dist/` + assume rebuild matches** — `dist/` may contain files the Vite build does not regenerate (e.g. `_redirects` from Cloudflare Pages era).
- **Any `git` write operation** (commit, push, merge, rebase, reset --hard, branch delete) — **PL reviews every output. Commit only on PL's explicit order.**
- **`docker` commands** — PL handles deployment.
- **`cat ~/.qwen/settings.json`** — dumps live API keys into transcript. Two keys exposed 2026-09-12, still awaiting rotation. Read only `mcpServers` subtree if needed.
- **Editing `package.json` dependencies** without instruction — `three`, `d3-contour`, `fflate`, `react-router-dom` are load-bearing.

---

## 8. KNOWN TRAPS (you will hit these)

- **Build ≠ runtime.** A `ReferenceError` in a component or TDZ error ships behind a green build.
- **State-lift refactor bug.** Moving state to `AppState` leaves stale `setX` references in old component → `ReferenceError` at render. Update every consumer, dependency arrays, inline JSX handlers.
- **TDZ in render body.** A reset guard reading `wireLengthMM` before declaration. Keep such reads inside `useEffect` or order declarations first.
- **Pointer propagation.** 2D panel's pan handler calls `setPointerCapture` and swallows nested controls. Fix: `e.target?.closest?.('.wsb-bar')` skip on wheel/pointerdown/touchstart/dblclick.
- **NaN through `createRadialGradient`.** Non-finite marker coords from corrupt path array. Guard with `isFinite`; `pointAtDistance` returns `null` for poisoned polylines.
- **Wholesale `setState(data.x)` on restore drops newly-added keys.** Always merge: `{ ...DEFAULT_X, ...data.x }`. Otherwise a `Object.keys(obj)` dirty-check silently discards user edits.
- **`THREE.LineBasicMaterial` cannot render thick lines** under core WebGL (`lineWidth` clamps to 1). Use `Line2`/`LineGeometry`/`LineMaterial`; keep `material.resolution` synced via `ResizeObserver`. Line2 has no dash support.
- **Never auto-increment Vite port.** Kill the old server instead. Stacked servers = PL verifies a stale build.
- **Do not sort a closed contour by height.** It converts the loop into a zig-zag comb.

---

## 9. FRAGILE / HIGH-RISK FILES

- **`src/lib/toolpath.js`** — `buildSectionProfile` is G-code site 1. One character change shifts SHA. Carries a load-bearing `-thetaDeg` asymmetry with comments. **Highest risk in repo.**
- **`src/lib/silhouette.js`** — extraction everything downstream inherits. Accuracy bins, dedupe tolerance, envelope fallback all silently change geometry.
- **`src/lib/gcode.js`** — header carries known defects (missing `G94`, duplicate `G93`) that are pending decisions, not oversights. The `cutJob` shape contract is implicit duck-typing with no validation.
- **`src/lib/wirePath.js`** — `processWireProfile` is called on both G-code path and display path. "Just fixing" the clamp changes both. See §10.1.
- **`src/context/AppState.jsx`** — owns every pipeline input plus persistence. Most merge/dirty-check bugs live here.
- **`src/components/SilhouettePreviewPanel.jsx`** and **`Viewer3D.jsx`** — huge, stateful, per-frame loops. Crash-prone refactors.
- **`src/lib/stl.js` / `settle.js`** — silently rescale/reorient. A change here invalidates prior verification and the SHA.

---

## 10. OPEN / UNRESOLVED

### 10.1 `clampProfileToStock` contradiction — 🔴 PL will address

`clampProfileToStock` is **still on the live G-code path** in `wirePath.js`, while §2 lists **"no clamp-to-block"** as a non-negotiable. This is a direct contradiction between documentation and code on the highest-risk file.

**Status: PL has flagged this for review. Do NOT touch `wirePath.js` until PL gives explicit instruction.**

### 10.2 G93 in `gcode.js` — 🟡 pending fix

Header may still reference "G93 inverse time". Decision is locked (§3): **use G1/G94**. If code emits or comments G93 → this is Issue B, pending PL order.

### 10.3 Issue A — safe-point bug

`wirePath.js` has a safe-point bug per handover. **Symptom not yet specified.** PL will define when ready.

### 10.4 `_redirects` in `dist/`

Left over from Cloudflare Pages era. Not regenerated by Vite build. Cloud Run uses Nginx SPA fallback, so this is likely obsolete — but undocumented. Do not assume.

### 10.5 Legacy docs may not match reality

`docs/ARCHITECTURE.md`, `LOG.md`, `CONCEPT.md`, `DevFoamLogic.md`, older `HANDOVER-*.md` may describe states that no longer exist. **This document is the current source of truth.** When in doubt, ask PL.

---

## 11. COMMUNICATION

- Reply in **English**. Bullets. Brief.
- **No restating the task, no unsolicited proposals.**
- When blocked → say so directly. Do not guess.
- When uncertain about pipeline impact → ask PL **before** editing.
- PL's order = green light. Nothing else.

---

**END OF CODER-HANDOVER**
