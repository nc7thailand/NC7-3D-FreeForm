# HANDOVER — STAGE 2

## 1. Stage 1 Status — COMPLETE

- Silhouette pipeline locked (d3-contour, High=600 bins default)
- 2D preview panel with mode toggle (Left→Right / Left only)
- 3D view with MP (red, 40% opacity, fixed in XY plane), dashed bbox, rotating stock+model, fixed red wire
- Mobile 2D/3D toggle (< 768px)
- Deployed to Cloudflare Pages: 3dfreeform.nc7foamart.com
- Last commit: 00f8c19

## 2. Stage 2 Plan — Vector Boolean Split

- The previous Stage 2-4 implementation was removed during the Stage 1-only refocus. It exists only as uncommitted scaffolding in scripts/gen-stage3-4-5.mjs. Treat Stage 2 as a fresh implementation on top of the locked Stage 1 pipeline. Reference gen-stage3-4-5.mjs for the original logic, but expect to rebuild cleanly.
- Goal: split silhouette at rotation axis into left/right halves
- Verify against DevFoam's left/right behavior
- Left only mode: one half per rotation (16 cuts)
- Left→Right mode: pair left@θ + right@θ+180 → 8 cuts

## 3. Known Issues (fix in this order)

### Issue A — Safe Points (HIGH PRIORITY, visible bug)

- File: src/lib/wirePath.js :: addSafePoints
- Current: places bottom safe at blockSectionHalfWidth (block corner — wrong)
- Correct: extend straight from wire endpoints
  - Top:    { u: wire[0].u,         v: wire[0].v + topOffset }
  - Bottom: { u: wire[last].u,      v: wire[last].v - bottomOffset }
- Verify: regenerate stage3-4-wire.svg, top/bottom safe should be straight vertical lines from wire ends.

### Issue B — G-code Header (mode error)

- File: src/lib/gcode.js
- Problems: missing G94 before M3, duplicate G93
- Reference header order (from DevFoam StackedCut2):

```
G90 G21
S1000
G17
G90
G94
M3
G1 X... Y... Z... F700
G93
<contour moves>
```

### Issue C — Coordinate System (SVG mirror)

- SVG Y-down vs CNC Y-up
- Canonical: CNC Y-up throughout internal pipeline
- SVG: apply mirror at display layer only (transform="translate(0, H) scale(1, -1)")
- G-code: unchanged (already CNC Y-up)

### Issue D — F Values (defer)

- Our range: ~F70–F145
- DevFoam range: ~F6–F10000 (span ~1600x)
- Feedrate algorithm differs — investigate later, not blocking

## 4. Non-Negotiables

- No sort-by-height
- No clamp-to-block
- No frame
- No Chaikin smoothing
- One closed silhouette loop per rotation angle, exactly as d3-contour emits it

## 5. Key Files

- src/lib/silhouetteWire.js — Stages 2-4
- src/lib/wirePath.js — has safe-point bug (Issue A)
- src/lib/gcode.js — header fix needed (Issue B)
- src/lib/gridContour.js — d3-contour tracer
- src/lib/silhouette.js — silhouette extraction
- src/lib/toolpath.js — pipeline orchestration
- docs/HANDOVER-STAGE1.md — previous handover

## 6. Golden Reference

- StackedCut2_CutLeft-Right.nc.txt (real DevFoam output)
- Preview.stl (knight test model)
- Default accuracy: High (600 bins)

## 7. Next Session Start

Start with Issue A (Safe Points) — highest-priority visible bug.
Test by regenerating scripts/stage3-4-wire.svg and visually confirming top/bottom safe points extend straight up/down from wire endpoints.

## 8. 2D Polish Status (as of 2026-09-17)

### 8.1 What's been polished in the 2D preview

- **Reference axes**: red dashed vertical line at u = 0 (rotation axis),
  blue dashed horizontal line at v = BO (bottom cutout offset).
- **Cut path**: solid blue polyline, per cut mode (Left→Right / Left only).
- **Foam block outline**: dashed grey rectangle, dynamic projected width
  `W·|cos θ| + T·|sin θ|`, centred on u = 0, spanning v ∈ [0, stock.h].
- **Direction markers**: green (start) + red (end) squares outside the foam
  block at v = BO; colours swap by rotation parity (odd → green left / red
  right; even → red left / green right).
- **Link lines**: horizontal solid lines at v = BO joining each marker to the
  corresponding blue cut-path endpoint (green = start side, red = end side).
- **Zoom/pan controls**: `+` / `−` / Reset buttons, wheel zoom, drag pan,
  pinch (0.5x–10x). Stock-anchored viewport (u = 0 fixed at canvas centre).
- **Blocking setup panel**: Toolpath Setup modal auto-opens on page entry and
  gear click; draft-only params; Apply/Reset/✕/Escape; cut method row.

Commits this session: `bafa5b5`, `e149409`, `f2f6e2c` (latest).

### 8.2 Known Watch List (still open — deferred)

- Red line might not be perfectly canvas-center (Project Leader re-verifying
  with zoom reset).
- 2D vs 3D orientation mismatch (deferred; 2D = source of truth, 3D is
  visualisation only — do NOT change pipeline to satisfy 3D).
- Safe Points fix (Issue A) — deferred.
- G-code header G94 (Issue B) — deferred.
- Coordinate system mirror (Issue C) — deferred.
- F values comparison (Issue D) — deferred.

### 8.3 Next session priority

Either:
- Continue 2D polish (per Project Leader direction), OR
- Move to Stage 2 wiring (Safe Points + pipeline), starting with Issue A.

### 8.4 Session token note

Previous session reached ~14.4M input tokens — starting a fresh session to
reduce context bloat. Read this handover plus `docs/HANDOVER-STAGE1.md` first.

## 8.5 Latest Polish (as of 2026-09-18)

- Apex logic verified: apex = highest u=0 crossing on the left-only
  path. Path extends until it crosses u=0 if no crossing exists.
  Path stops at apex.
- Foam block now centered on the model's 3D bbox center (frozen from
  Model page). Direction markers shift with block edges.
- Debug markers (rhombus + apex) removed after verification.
- Left Only mode complete. Left → Right mode unchanged.
- Latest commit: `63a40f8`
- Session token reached 21.8M — opening fresh session next time.

## 9. Working Protocol (Recommendations)

Guidelines to keep sessions efficient — defaults, not constraints:

1. **Language:** Prefer English for reports (cheaper tokens, faster).
2. **Brevity:** Prefer concise reports. Skip restating tasks. Use
   bullet points. Deep diagnosis is fine when warranted.
3. **Screenshots:** Default to Project Leader capturing on his
   phone and forwarding to the advisor. Use Chrome MCP screenshots
   only when explicitly requested or when visual confirmation is
   essential.
4. **Scope:** Complete tasks as specified. Flag genuine blockers
   or inconsistencies. Do not propose architectural changes
   unprompted.
5. **Waiting:** After completing a task, wait for the next
   instruction.

Project Leader may override any guideline at any time.

### 9.1 Dev Server Protocol

Before starting a dev server:

```
lsof -i :5173 | grep LISTEN
```

- If a server is already running on 5173: **REUSE it**
- Do **NOT** start a second one

When done:

```
pkill -f "NC7Studio3D.*vite"
```

(or kill by PID)

- Never leave background processes across sessions.
- If the port is occupied → kill the old one, do **NOT** auto-increment
  (Vite's "Port 5173 is in use, trying another one..." fallback is the
  failure mode this rule exists to prevent — it silently stacks servers on
  5174, 5175, … and the Project Leader ends up verifying a stale build.)

Verify no servers remain before reporting "session ready to close":

```
lsof -i :5173-5179 | grep LISTEN
```

## 10. Combined View Feature (2026-09-18, branch `experiment/combined-view`)

A third toolpath view mode. **Branch-based experiment — NOT merged to `main`.**

- **Branch:** `experiment/combined-view` (created from `main` @ `2fd4026`).
- **Committed:** `d733153` — "feat(toolpath): Combined view — 2D cut drawing
  on the fixed wire plane" (pushed to origin).
- **What it does:** adds a `[2D] [Combined]` toggle (desktop + mobile,
  **Combined default**). Combined shows the 3D viewport with the 2D cut drawing
  (silhouette loop, cut path, direction markers, link lines) as translucent 3D
  geometry on the **fixed** middle plane. 2D mode is unchanged.
- **Overlay placement:** raw MP-local mapping — `u → world X`, `v → world Y`,
  `z = 0`. The MP mesh stays unrotated; the silhouette shape changes with θ
  while the plane does not. `unprojectFromSection` is deliberately NOT used.
- **Shared data:** `src/lib/cutOverlay.js` (new, pure math) now supplies the
  contour / cut path / markers / links for BOTH the 2D panel and the 3D
  overlay — removed ~285 lines of duplicated logic from
  `SilhouettePreviewPanel.jsx`.
- **G-code verified byte-identical** to `main` (SHA-256 `dae3c735…`, both cut
  modes) via `scripts/dump-gcode.mjs`. Rendering only — silhouette extraction,
  wire path, toolpath and G-code generation are untouched.
- **`npm run build` clean.**

### 10.1 Polish pass (2026-09-19, committed)

**Source commit: `7249901`** — "feat(toolpath): Combined view + polish + bug
fixes" (branch `experiment/combined-view`, pushed to origin). This section and
§10.2 describe the changes in that commit; it also covers §10.2's bug fixes.

Changes to the Combined overlay and the setup panel:

1. **Plain 3D removed from the Toolpath toggle.** `ToolpathPage.jsx` now offers
   `[2D] [Combined]` only; the `'3d'` state value is gone. `Viewer3D` itself is
   unchanged and is still used in full by the Model page.
2. **Red MP plane hidden in Combined.** `mpPlane.visible = !combinedView` — the
   mesh stays in the scene with its transform intact, so overlay placement on
   the MP coordinate space is unaffected.
3. **Red wire (vertical axis cylinder) hidden in Combined.**
   `rotaryAxisLine.visible = !combinedView`, same hide-not-delete rule.
4. **Camera unlocked in Combined.** The `lockCamera` prop is removed. Combined
   snaps once to the **front** preset on entry (camera at `+Z` looking along
   `−Z`, previously `back`), then orbit/zoom/pan stay live and the ViewCube is
   shown. The overlay foreshortens at oblique angles — accepted.
5. **Overlay styling.** Overlay contour is **white dashed** (was black, for
   contrast on the dark 3D background); overlay cut path stays blue; overlay
   link lines and markers keep the green/red 2D colour code. Terminology
   adopted: *overlay contour / overlay cut path / overlay link lines / overlay
   markers*.
6. **`stock.overlayThickness` (1–10, default 3).** Numeric input in the Toolpath
   Setup panel; scales the overlay cut path, link lines and markers. The overlay
   contour is deliberately exempt (unscaled thin dash). Lives in `stock`, so it
   inherits the existing project/session persistence; the G-code pipeline reads
   only its known fields and ignores it. Part of the draft/apply flow.
7. **Setup panel.** Cut method is now a `<select>` (`Left only` / `Left → Right`)
   replacing the two buttons; panel height is `80vh` with `overflow-y: auto`,
   vertically centred.

### 10.2 Bug fixes (2026-09-19)

**Source commit: `7249901`** (same commit as §10.1).

1. **Overlay thickness had no effect, and looked "exploded" on mobile.**
   Root cause: `THREE.LineBasicMaterial` cannot render thick lines under core
   WebGL — `gl.lineWidth` is clamped to 1 on most desktop drivers, and partial
   wide-line emulation on some mobile drivers produced perpendicular stubs.
   Markers grew (they are meshes) while lines did not.
   **Fix:** the solid overlay lines now use `Line2` + `LineGeometry` +
   `LineMaterial` from `three/examples/jsm/lines/`, which draws each segment as
   a screen-space quad. `material.resolution` is set at construction and kept in
   sync by a `ResizeObserver` on the mount plus the window resize handler — a
   stale resolution is what warps the strokes on mobile. The dashed overlay
   contour stays on `THREE.Line` (Line2 has no dash support, and the contour is
   unscaled).
2. **`overlayThickness` reverted to 3 after refresh.** Root cause: both restore
   paths called `setStock(data.stock)`, **replacing** wholesale. A session saved
   before the field existed has no such key, so it was dropped on load — and
   because the setup panel's dirty check is `Object.keys(stock)`, the missing
   key also made its edits invisible to Apply, which then silently discarded
   them. **Fix:** `setStock({ ...DEFAULT_STOCK, ...data.stock })` at both sites
   (`AppState.jsx` session restore and project open), matching the existing
   `gcodeSettings` merge pattern.
3. **`CUT_MODE_LEFT_ONLY` ReferenceError at startup.** The constant already
   existed (`src/lib/cutJob.js:11`, value `'left-only'`); the defect was a
   missing import in `AppState.jsx` after the default cut mode was flipped.
   Note: `npm run build` did **not** catch this — Rollup does not resolve
   undefined identifiers inside function bodies, so a clean build was not
   evidence here.

**Default cut mode is now `Left only`** (`AppState.jsx`), intentional: the
blocking setup panel forces an explicit mode choice each session, so the default
is a starting suggestion. Left only yields N cuts (16 at N=16) rather than
floor(N/2). **This changes G-code output for fresh sessions** —
`scripts/dump-gcode.mjs` cannot detect it, because it passes the mode
explicitly.

**Verification status.** G-code SHA verified byte-identical to `main`
(`dae3c735…`, both modes) — site 1 / `buildSectionProfile` untouched throughout.
Build clean. The Line2 stack and the merge-on-restore behaviour were verified
programmatically (API surface, resolution set/sync, merge reproducing and
resolving the missing-key defect). **Desktop and mobile visual behaviour — thick
lines at thickness 3 vs 10, persistence across refresh, and absence of mobile
artifacts — is Project-Leader-verified, not machine-verified.**

### 10.3 Open items

- **Stage 2 — vector boolean split** has not been started. Split the closed
  silhouette loop at the rotation axis into left/right halves (a vector boolean
  operation, not a `filter(u ≤ 0)` and not a sort). Reference
  `scripts/gen-stage3-4-5.mjs` for the original logic, but rebuild cleanly on the
  locked Stage 1 pipeline.
- **Issue A — Safe points** (`src/lib/wirePath.js` :: `addSafePoints`): bottom
  safe currently places at `blockSectionHalfWidth` (block corner) instead of
  extending straight from the wire endpoints. Highest-priority visible bug.
- **Issue B — G-code header** (`src/lib/gcode.js`): missing `G94` before `M3`,
  duplicate `G93`.
- **Issue C — Coordinate system mirror** (SVG Y-down vs CNC Y-up): apply the
  mirror at the display layer only; G-code already correct.
- **Issue D — F values:** our range ~F70–145 vs DevFoam ~F6–10000. Feedrate
  algorithm differs; deferred.
- **Display vs G-code orientation.** The display chain was flipped to `−θ`
  (`buildFullSilhouettePreview`, `extractOverlayContour`, `blockCenterU`) so the
  2D/Combined drawing matches the 3D view's rotation direction. Site 1
  (`buildSectionProfile`, which feeds G-code) was deliberately **not** flipped.
  Display and G-code therefore differ in orientation until the G-code direction
  is reconciled against the DevFoam golden — a separate task.
- **`buildFullSilhouettePreview` output is unused by the renderer.** It is
  computed into `silhouettePreview` but nothing draws it; the 2D panel and the
  Combined overlay both derive from `extractOverlayContour`.
- **Orphaned CSS:** `.silhouette-mode-btn` / `.silhouette-mode-btn.is-active`
  in `index.css` have no remaining JSX consumers after the cut-method `<select>`
  swap.

Push anything further only on explicit instruction. Do NOT merge to `main`.

## 11. Sim Module (2026-09-19, commit 324eb5b)

### 11.1 Features

- Sim toggle button (after rotation > button)
- Play button (after Sim) triggers wire marker animation
- White dot with blue+yellow stroke = next rotation's start point
- Wire marker animates along full wire path:
  green marker → oriented cut path → red marker
- Blink effect during cutting (orange glow, ~0.45s cycle)
- Direction follows parity (green → red always)
- Distance-based animation (SIM_SPEED_MM_PER_SEC = 100)
- Trail track accumulates during Play
- Live data label shows N, t, u, v, distance, progress, phase
- Click label → opens track-log overlay with CSV export

### 11.2 Status

- Left Only mode: verified
- Left → Right mode: verified (N=1-4)
- Crash fixed: isFinite guards on marker coords
- Overshoot eliminated: marker anchored at real marker position
- Path: [greenMarker, ...orientedCutPath, redMarker]

### 11.3 Deferred

- K point + turntable rotation concept (draft notes exist)
- Left → Right Combined view polish
- Animation speed tuning (currently slow by design)

## 12. Nav Reorder (2026-09-19)

- Nav order: 1 Model | 2 Toolpath | 3 Simulate | 4 G-code
- URLs unchanged (/model, /toolpath, /gcode, /simulate)
- Next/Back rewired per new order
- Dim logic: both Simulate and G-code dim until toolpath saved

## 13. Next Session — G-code Pipeline

Priority: G01 basic pipeline. Then G93 inverse time (DevFoam-style).





