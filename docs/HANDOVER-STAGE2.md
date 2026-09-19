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

### 10.1 Polish pass (2026-09-19, uncommitted)

Three changes applied in the working tree — **not yet committed**:

1. **Plain 3D removed from the Toolpath toggle.** `ToolpathPage.jsx` now offers
   `[2D] [Combined]` only; the `'3d'` state value is gone. `Viewer3D` itself is
   untouched and is still used in full by the Model page.
2. **Red MP plane hidden in Combined.** `mpPlane.visible = !combinedView` — the
   mesh stays in the scene with its transform intact, and material must be
   attached for `visible` to reach the render list, so overlay placement on the
   MP coordinate space is unaffected.
3. **Camera unlocked in Combined.** The `lockCamera` prop is removed. `viewMode`
   Combined still snaps once to the **back** preset on entry (camera at `−Z`
   looking along `+Z`), but orbit/zoom/pan stay live and the ViewCube is shown.
   The overlay foreshortens at oblique angles — accepted.

**Verified in-browser (Combined, θ = 0°):** toggle shows `2D`/`Combined` only;
`mpVisible false` / MP group still parented to the scene; overlay present with 6
children; `controls.enabled true`, damping on, left+right = ROTATE; camera
`(0, 310.75, −1553.75)` on entry = rear; a synthetic right-drag moved the camera
to an oblique pose, confirming orbit. Round-trip 2D → Combined re-snaps to rear
and restores the overlay. Model page unchanged (Move/Rotate/Reset/Settle/Center,
rotation panel, ViewCube visible). Screenshots:
`.inspect/combined-clean-default.png`, `.inspect/combined-clean-orbited.png`.

Push anything further only on explicit instruction. Do NOT merge to `main`.



