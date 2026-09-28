# Design: Approach 4 — Multi-Mesh Toolpath & Object Placement

**Status:** LOCKED (Bank, 2026-03-28)  
**Branch:** `NC7-free-form-test`  
**Scope:** Long-running track — Model split, Object Placement, 3MF project format, multi-mesh silhouette toolpath.

---

## Summary

NC7 Studio3D will **not** merge artwork and helper meshes in 3D before toolpath. Instead, the existing **shadow-grid silhouette** pipeline will **stamp each mesh** (artwork + helpers) into a shared occupancy grid per cut angle θ, then extract the left/full profile once. This matches DevFoam/3D Builder cutting results while avoiding browser RAM spikes from 3D CSG/concat merge.

Object Placement is a **new page** before Toolpath, focused on a **single selected object**, with rotate/center/settle and simple primitive helpers (base/bridge) for models without flat faces.

Primary project format moves to **`.3mf`** (multi-object scene + NC7 metadata). STL upload converts to 3MF objects in memory.

---

## Locked decisions

| ID | Decision |
|----|----------|
| D1 | **Approach 4** — multi-mesh silhouette union; **no 3D merge** for toolpath |
| D2 | **3MF primary** project container; STL import → 3MF object in scene |
| D3 | **Plane cut** is the key split tool (not axis-only slices) |
| D4 | After split: **maintain world positions**; **random basic colors** per part (not black) |
| D5 | Toolpath **one part at a time** (single `cutJob` + `toolpathObjectId`) |
| D6 | **Object Placement page** before Toolpath; single selected object |
| D7 | Helpers: simple shapes (box plate, box bar, cylinder) as base/bridge |
| D8 | Placement **non-destructive** — store recipe in 3MF, not merged mesh |
| D9 | **Undo/Redo** in early phases |
| D10 | **Multi-object browser** last in roadmap |
| D11 | **No emboss/logo** |
| D12 | 3D merge reserved for **fallback** (golden-test failure) and **STL export only** |

---

## App flow

```
/model          Import · plane split · simplify · objects browser (late)
    ↓
/placement      One selected object · rotate/center/settle · add helpers
    ↓
/toolpath       Multi-mesh silhouette compute · G-code (unchanged posting if profile matches)
```

---

## Approach 4 — Toolpath (technical)

### Current behavior

- `buildSectionProfile(geometry, θ, …)` clones one `BufferGeometry`, runs `extractLeftSilhouette` via shadow grid.

### Target behavior

```javascript
buildSectionProfileFromParts(
  [
    { geometry, worldMatrix, includeInCut: true, role: 'artwork' },
    { geometry, worldMatrix, includeInCut: true, role: 'helper-base' },
  ],
  thetaDeg,
  planePoint,
  opts,
)
```

### Algorithm (per θ)

1. Compute combined scene bounds for grid sizing (all `includeInCut` parts).
2. Allocate one occupancy grid (same as today’s `projectFrontToRearShadow`).
3. For each part: apply `worldMatrix`, stamp triangles into the **same** grid.
4. Trace contour / left envelope **once** from the combined grid.
5. Dispose per-part slice clones; **never** allocate a merged 3D mesh.

### Also update

- `buildFullSilhouettePreview` — same multi-part stamping for Combined view.
- `modelBBoxBottomY` / `cutBoV` — combined bbox of cut-included parts.
- `cutJob` metadata — `sourceObjectId`, placement revision (not only `sourceGeometryUuid`).
- CAM worker path — pass part list instead of single geometry where applicable.

### Verification

- Compare profiles and G-code against DevFoam golden for: artwork alone, artwork + base plate, artwork + bridge.
- If mismatch beyond tolerance, document case and use merge-in-worker fallback for that case only.

### RAM rules

- Hold artwork + small helpers only; no merged mesh in `workingRef`.
- Do not store merged geometry in `.3mf` or IndexedDB session.
- `geometry.dispose()` when switching toolpath target part.

---

## Object Placement page

### Focus

- One **selected object** from scene (split part or whole model).
- Other parts hidden or ghosted (TBD in UI pass).

### Tools

- Rotate, Center, Settle (same concepts as Model viewport, but placement-specific workflow).
- Insert helpers: box (plate), box (bar), cylinder — parametric, mm internal.

### Helpers

- Stored as separate objects linked to parent part (`parentId` / placement group).
- `includeInCut: true` by default (DevFoam-style: cut foam includes base).
- Optional future: `includeInCut: false` for positioning-only helpers.

### Commit to Toolpath

- No 3D merge on commit.
- Navigate to Toolpath with **part id** + helper list; compute uses Approach 4.

---

## Split (Model page)

- **Plane cut** UI: move/rotate plane, Keep top / bottom / both.
- **Keep both** → two objects, **same world positions** as before cut.
- Auto-assign **random color** from fixed palette (no black/dark gray).

---

## Project file — `.3mf` primary

### Geometry (3MF standard)

- Multiple `<object>` meshes + `<build><item transform="…"/>`.
- Units: millimeters (STL/geometry internal; `model.units` = mm).

### NC7 metadata (companion)

Store inside 3MF package as `Metadata/nc7.json` (or namespaced metadata keys):

```json
{
  "format": "nc7studio3d",
  "version": 2,
  "ui": {
    "displayUnit": "mm",
    "selectedObjectId": "…",
    "toolpathObjectId": "…"
  },
  "objects": [
    {
      "id": "part-001",
      "name": "part-a",
      "color": "#3498db",
      "type": "artwork"
    }
  ],
  "placement": {
    "part-001": {
      "transform": { },
      "settled": true,
      "helpers": [
        {
          "id": "base-1",
          "primitive": "box",
          "sizeMm": [200, 8, 150],
          "transform": { },
          "role": "base",
          "includeInCut": true
        }
      ]
    }
  },
  "stock": { },
  "toolpath": {
    "objectId": "part-001",
    "rotationN": 16,
    "cutIndex": 0,
    "cutJob": { }
  },
  "gcode": { }
}
```

### Legacy

- Continue reading `.nc7project` v1 (single `model.stl` + manifest).
- Import converts to single 3MF object in memory.

### Session (IndexedDB)

- Same pack format as file save once 3MF writer exists.

---

## Implementation phases

| Phase | Deliverable | Touches |
|-------|-------------|---------|
| **P0** | This design doc + branch | docs |
| **P1** | Multi-mesh grid stamp + `buildSectionProfileFromParts` + golden tests | `silhouette.js`, `toolpath.js`, worker |
| **P2** | Gizmo + Undo on Model (existing plan) | Model, AppState |
| **P3** | Plane split + position + colors | Model, AppState |
| **P4** | Object Placement page + helpers | new route, components |
| **P5** | 3MF load/save + STL→3MF import | `lib/project` or `lib/3mf` |
| **P6** | Objects browser + toolpath target picker | Model, AppState |
| **P7** | Boolean (optional, if still required) | Model |

**P1 is the critical path for Approach 4.** UI phases can proceed in parallel where possible.

---

## Out of scope (unless Bank expands)

- Emboss / logo
- Toolpath cache per part (mode B)
- G-code algorithm changes beyond profile input
- Foam auto-size, 2D cut canvas
- Rotary axis as length
- Chrome DevTools MCP

---

## Shared components — caution

`Viewer3D` is used on Toolpath (read-only). Changes must not alter Toolpath preview/gizmo/teardown. Prefer Model/Placement-specific props and handlers.

---

## References

- Current project pack: `src/lib/project.js` (`.nc7project` v1)
- Silhouette: `src/lib/silhouette.js`, `src/lib/toolpath.js`
- DevFoam parity: `docs/DevFoamLogic.md`

---

## Changelog

| Date | Change |
|------|--------|
| 2026-03-28 | Initial lock — Approach 4, branch `NC7-free-form-test` |

---

## Success criteria

- Branch `NC7-free-form-test` exists on `origin`
- File `docs/DESIGN-APPROACH4-PLACEMENT.md` present on that branch
- `main` unchanged
- Report commit SHA when done
