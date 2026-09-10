# Save Point — 2026-03-10 (stable toolpath UI + envelope silhouette)

**Tag:** `savepoint-2026-03-10`  
**Status:** Known-good baseline before silhouette / raycasting experiments.

## What works at this point

| Area | State |
| :--- | :--- |
| **Silhouette** | Front-to-rear **envelope bins** (`silhouette.js`) — stable on knight STL |
| **Preview** | Full red outline on middle plane (MP); rear plane hidden |
| **Toolpath cut** | Method 1 left envelope; half-span N/2 cuts (0–180°) |
| **UI** | Combined header + stepper; rotation bar in bottom nav; gear setup overlay |
| **Model move** | Gizmo **Model page only**; Toolpath is view-only |
| **Parameters** | W, T, H, LO, BO, kerf, topOffset, auto BO, **show model bbox** toggle |
| **Session** | IndexedDB autosave (page, stock, model, cut job) |
| **Network** | Vite `allowedHosts` for Tailscale |

## Checkpoints on disk

| File | Role |
| :--- | :--- |
| `src/lib/checkpoints/silhouette-envelope-v2.js` | **This save point** — envelope method (active in main) |
| `src/lib/checkpoints/silhouette-edges-v1.js` | Silhouette-edge attempt — reverted (quality regressed) |

## Restore envelope baseline

```bash
cp src/lib/checkpoints/silhouette-envelope-v2.js src/lib/silhouette.js
```

Or checkout git tag: `git checkout savepoint-2026-03-10`

## DevFoam reference (added after save point)

- `Example/StackedCut.nc` — left+right with safe lift between passes
- `Example/StackedCut2_CutLeft-Right.nc` — left+right continuous
- `docs/DevFoamLogic.md` — DevFoam pipeline + NC7 mapping

## Known limitations (next work)

- Envelope bins cannot represent **concave** pockets at the same height (e.g. under chin).
- Not yet true per-ray depth casting — projection stamps triangle vertices/edges into v-bins.
