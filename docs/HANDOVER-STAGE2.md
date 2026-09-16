# HANDOVER — STAGE 2

## 1. Stage 1 Status — COMPLETE

- Silhouette pipeline locked (d3-contour, High=600 bins default)
- 2D preview panel with mode toggle (Left→Right / Left only)
- 3D view with MP (red, 40% opacity, fixed in XY plane), dashed bbox, rotating stock+model, fixed red wire
- Mobile 2D/3D toggle (< 768px)
- Deployed to Cloudflare Pages: 3dfreeform.nc7foamart.com
- Last commit: 00f8c19

## 2. Stage 2 Plan — Vector Boolean Split

- Current: splitLoopAtAxis exists in src/lib/silhouetteWire.js
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
