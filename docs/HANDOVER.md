# NC7 Studio3D CAM — Handover Document

**Date:** 2026-08-12 (Phase 1 complete)
**Author:** P Bank (NC7) with AI Agent (Gemma)
**Next environment:** Google Antigravity (Vibe Coding / Agent)

---

## 1. Project Summary

NC7 Studio3D is a web-based **CAM software** for the NC7 **hot wire foam cutter CNC machine** (2-axis X/Y + optional rotary Z-axis). It will eventually be packaged as a desktop app with **Electron**.

The immediate Phase 1 goal: **load, resize, settle (auto-orient), and simplify `.stl` files**, with an MS-3D-Builder-style 3D viewport.

Source of Truth (concept): **`docs/CONCEPT.md`**

---

## 2. Current Status (Phase 1 DONE)

Core features implemented and committed:
- **Load STL** — binary + ASCII via Three.js `STLLoader` → `src/lib/stl.js`
- **Resize** — scale to target dimensions in **mm or inch**, fit-to-bounds → `src/lib/resize.js`
- **Settle (auto-orient)** — aligns largest flat face to bottom plane (Y=0) → `src/lib/settle.js`
- **Simplify** — grid-based vertex clustering decimation → `src/lib/simplify.js`
- **Export** — binary STL download → `src/lib/export.js`
- **3D Viewport** — OrbitControls + TransformControls (MS 3D Builder style) → `src/components/Viewer3D.jsx`

---

## 3. Tech Stack

| Layer | Tech |
|---|---|
| Build tool | **Vite** 5 |
| Framework | **React** 18 (JSX) |
| 3D | **Three.js** (OrbitControls, TransformControls, STLLoader) |
| Language | JavaScript (ESM, `"type": "module"`) |
| Packaging | **Electron** *(planned, not yet added)* |

Node version used: `v24.18.0` / npm `11`.

---

## 4. Project Structure

```
NC7Studio3D/
├── index.html
├── vite.config.js          # server.host: true (LAN/Tailscale access)
├── package.json
└── docs/
│   ├── CONCEPT.md          # ← Source of Truth (concept V2)
│   └── HANDOVER.md         # ← this file
└── src/
    ├── main.jsx            # React entry
    ├── App.jsx             # Main UI + all state/actions
    ├── index.css           # Styles
    ├── components/
    │   └── Viewer3D.jsx    # 3D viewport + mouse interaction
    └── lib/
        ├── stl.js          # STL load + bounding box helpers
        ├── resize.js       # mm/inch scaling (fit-to-bounds)
        ├── settle.js       # auto-orient to bottom plane
        ├── simplify.js     # grid-based decimation
        └── export.js       # binary STL export
```

---

## 5. Mouse Interaction (MS 3D Builder style)

| Action | Behavior |
|---|---|
| Left-click on model | Select + show TransformControls gizmo |
| Left-click + drag on model | Move (translate) the model |
| Left-click on empty space | Deselect |
| Right-click + drag | **Rotate camera viewpoint** |
| Mouse wheel | Zoom |
| Toolbar Move / Rotate | Toggle gizmo mode |
| Keyboard `W` / `E` | Switch Move / Rotate mode (when not typing in a field) |

Implemented in `src/components/Viewer3D.jsx`.

---

## 6. How to Run

```bash
cd ~/NC7Studio3D
npm install
npx vite          # or: npm run dev
```

- Dev server auto-opens at `http://localhost:5173`
- `vite.config.js` sets `server.host: true`, so it's reachable from **LAN / Tailscale** at `http://<tailscale-ip>:5173`
- Production build: `npm run build` → outputs to `dist/`

---

## 7. Git History

```
4e2e5b3 Config: bind Vite to all network interfaces (host: true)   ← latest
7840ce6 Viewport: right-click rotate viewpoint
f6ed5a9 Phase 1: MS 3D Builder-style mouse interaction
ccce109 Phase 1: STL load, resize, settle & simplify scaffold
dc0e080 Add NC7 Studio3D CAM Concept V2 (source of truth)
15b01f3 Initial commit
```

---

## 8. Known Limitations / Next Steps for Phase 2

### Known Issues (polish before Phase 2):
1. **Export does NOT include gizmo transforms** — Move/Rotate via TransformControls is a visual/positional change to the mesh node, but `export.js` writes raw geometry vertices directly. If user moves/rotates via gizmo, the exported STL **won't reflect** that transform.
2. **Simplify quality** — current grid-based decimation is simple/fast but can downgrade shape fidelity. Consider `meshoptimizer` or quadric error metrics for better results.
3. The unused helper `fitCameraToObject` exists at bottom of `Viewer3D.jsx`.
4. `.continue/` directory contains an AI agent config (from a previous session) — safe to keep or remove.

### Phase 2 target (from CONCEPT.md):
- Generate **CNC tool path** from the `.stl` geometry
- Cross-section plane syncing between 3D viewport and 2D toolpath preview
- Dynamic Block Boundary (BB) rotation and dynamic Bottom Safe Point (LB) calculations:
  - `Block_Bottom_Extent(θ) = |(W/2)·sin(θ)| + |(T/2)·cos(θ)| + LO`
  - `LB(θ) = Block_Bottom_Extent(θ) + BO`
- G-code output for the NC7 machine (X, Y, rotary Z; 1 mm = 1°)

---

## 9. Recommended First Tasks in Antigravity

1. Decide whether gizmo transforms should be "baked" into exported STL (likely yes for Phase 2 toolpath correctness).
2. Refactor so the working mesh ≠ visual mesh, OR apply mesh world matrix before export.
3. Build the **2D toolpath preview canvas** (Section 2) synced to the 3D cutting plane.
4. Implement STL slicing / cross-section extraction for the toolpath.

---

## 10. Notes for AI Agent onboarding

- **Read `docs/CONCEPT.md` first** — it is the authoritative spec in Thai.
- Project language is JavaScript (ESM). Keep imports consistent (`three/examples/jsm/...`).
- Three.js classes used: `STLLoader`, `OrbitControls`, `TransformControls`, `MeshStandardMaterial`, `GridHelper`, `BufferGeometry`.
- All core geometry math lives in `src/lib/` as pure, testable functions.
