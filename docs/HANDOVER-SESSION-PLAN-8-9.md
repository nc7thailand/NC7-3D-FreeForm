# NC7 3D Freeform — Session Handover (Plan Items 8–9)

**Date:** 2026-10-09  
**Audience:** New Cursor / Cloud Agent session  
**Repo:** `github.com/nc7thailand/NC7-3D-FreeForm` (local: `NC7Studio3D`)  
**Active branch:** `feature/memory-optimization`  
**Current save point (rollback here):** tag `savepoint/view-resolution-hud-2026-10-09` → commit `6595606`

**Previous save point:** `savepoint/pre-webview2-plan-2026-10-08` → `e527446` (before Hi/Lo viewport work)

---

## 1. Executive summary

Browser-side memory and UX work on **`feature/memory-optimization`** is in good shape: tiered import + auto-simplify, toolpath RAM fixes (shared slice geometry, worker), WebGL context recovery, WebView2 host POC, **user-chosen 3D viewport Hi/Lo** (toolpath compute always hi-res), viewport stats HUD, dark modals.

**Next strategic work (Jamie / PL audit roadmap):**

| # | Item | Status |
|---|------|--------|
| **8** | Native C++ CAM backend + WebView2 IPC | POC shell exists; **no native toolpath service yet** |
| **9** | WASM port of silhouette hot loop (optional if JS worker still bottleneck) | **Not started** |

**Recommendation:** Start with **#8** (IPC + native service skeleton that returns the same `cutJob` shape as `camWorker.js`). Do **#9** only after profiling proves the worker silhouette loop is still the limit.

---

## 2. Product / policy constraints

- **Desktop target:** Microsoft **Edge WebView2** (not Chrome-first).
- **Toolpath math:** Always uses **full hi-res** mesh in memory/worker; **Hi/Lo** affects **3D viewport display shell only** (`displayProxy` / cached proxy in `meshProxy.js`).
- **Import:** STL + 3MF; tiered gates (10 MB warn, 20 MB hard max); auto-simplify to 50k tris on load when needed.
- **Git:** PL Bank may require **explicit approval before push** — confirm with user if unsure.
- **Parked work:** Model-editing branch stashed separately; **do not merge** unless requested.

---

## 3. What was completed (this arc)

### Memory & pipeline (commits `7b78ccd` … `05172d9`)

- Single shared position buffer per toolpath job (no per-angle geometry clones).
- `camWorker.js` — full toolpath + G-code compile off main thread.
- Display proxy for dense meshes (optional via user Hi/Lo).
- Benchmark harness: `npm run benchmark`, `npm run benchmark:ab`, `scripts/compare-benchmarks.mjs`.

### WebView2 & stability (`5a0052b`)

- `host/webview2/NC7WebViewHost/` — WinForms WebView2, `NC7_WEBVIEW_HEAP_MB` → `--js-flags=--max-old-space-size=N`.
- `scripts/webview2-heap-test.ps1`, `scripts/launch-edge-heap-test.sh`.
- `webglcontextlost` / `restored` on Viewer3D, SimulateViewer, GCodePreviewModal.
- `window.__NC7_TELEMETRY__` — import + toolpath events.

### Viewport UX (`6595606`)

- ViewCube removed → **home** button (`HomeViewButton.jsx`).
- **3D resolution modal** + **Hi/Lo** HUD + **?** to reopen modal.
- **Cached** display proxy (`userData.nc7DisplayProxyGeo`); **single-mesh** swap via `viewportDisplayShell.js` (no dual models on toggle).
- **ViewportDisplayHud** — center-top tris / heap / swap ms / “1 mesh”.
- **Dark theme** for `CenteredModalOverlay` (all centered modals).

---

## 4. Architecture snapshot (compute)

```
Main thread:  import, simplify (load), live silhouette preview (debounced), Three.js views
Web Worker:   camWorker — computeToolpath (N × silhouette raster + overlay), compileGcode
WASM:         none
Native C++:   none (plan 8)
```

**Heaviest JS path:** `src/lib/silhouette.js` — triangle raster + `d3-contour` per cut angle (worker for full job).

**Key files:**

| Area | Path |
|------|------|
| Worker entry | `src/workers/camWorker.js`, `src/lib/camWorkerClient.js` |
| Toolpath pipeline | `src/lib/camPipeline.js`, `src/lib/cutJob.js`, `src/lib/toolpath.js` |
| Geometry IPC | `src/lib/geometryTransfer.js` |
| Display shell | `src/lib/meshProxy.js`, `src/lib/viewportDisplayShell.js` |
| Hi/Lo preference | `src/lib/toolpathViewResolution.js`, `src/hooks/useToolpathViewResolution.js` |
| App orchestration | `src/context/AppState.jsx` |
| WebView2 host | `host/webview2/README.md` |

---

## 5. Plan item 8 — Native CAM + WebView2 IPC (spec)

**Goal:** Move batch toolpath (and optionally G-code) out of V8 into a **native Windows process/DLL**, UI stays React in WebView2.

**Suggested shape:**

1. WebView2 host posts JSON message: `{ action: "computeToolpath", geometry buffers, rotationN, stock, cutMode }`.
2. Native service runs same logical pipeline (or shared C++ lib); streams progress events.
3. Response: serialized **`cutJob`** (same schema worker returns today).
4. Frontend: extend `camWorkerClient.js` with backend switch: `worker` | `native` | `main` (feature-detect `window.chrome.webview`).

**Existing hooks:**

- `host/webview2/NC7WebViewHost/MainForm.cs` — already sets heap flags; add `WebMessageReceived` bridge.
- Heap testing: `NC7_WEBVIEW_HEAP_MB=4096|8192`.

**Dev note:** WebView2 is **Windows-only**; Mac dev can implement host + IPC protocol and test worker fallback; validate on Windows machine.

---

## 6. Plan item 9 — WASM silhouette (spec)

**Goal:** Port inner loop of per-angle rasterization if profiling shows worker JS is still too slow/RAM-heavy.

**Prerequisites:**

- COOP/COEP **not** required if using transferable buffers in/out (no SharedArrayBuffer).
- Consider **meshoptimizer (WASM)** for import simplify first if decimation remains a pain (lower priority after proxy cache).

**Do not** full-rewrite CAM in WASM before **#8** spike proves need.

---

## 7. Verification commands

```bash
cd NC7Studio3D   # or your clone path
git checkout feature/memory-optimization
git rev-parse --short HEAD   # expect 6595606 or later

npm run verify
npm run build
npm run benchmark:ab   # clean tree; compares savepoint vs HEAD by default
```

**Manual QA (Toolpath):**

1. Import model → 3D → resolution modal → Hi / Lo.
2. Toggle Hi/Lo — HUD shows **instant** swap, **proxy cached**, **1 mesh**.
3. **?** reopens modal; dark readable panel.
4. Compute toolpath — unchanged precision vs 2D silhouettes.

---

## 8. Rollback

```bash
git checkout feature/memory-optimization
git reset --hard savepoint/view-resolution-hud-2026-10-09
# only if PL approves:
# git push --force-with-lease origin feature/memory-optimization
```

---

## 9. Out of scope for plan 8–9 unless asked

- Merging model-editing / gizmo branch.
- Pushing without PL approval.
- Full Electron (WebView2 is the chosen shell).
- Mesh boolean / Stage 2 vector split (still planned, not in prod).

---

## 10. Related docs

- `docs/CONCEPT.md`, `docs/ARCHITECTURE.md` — product truth
- `host/webview2/README.md` — WebView2 heap flags
- `docs/HANDOVER.md` — older Phase 1 doc (historical)

**End of handover — start new session with the prompt below.**
