# Silhouette checkpoints

| File | Description |
| :--- | :--- |
| `silhouette-edges-v1.js` | View-dependent silhouette edges + vertex weld (2026-03-10). Reverted from main — quality regressed on mobile knight STL. |

To retry the edge approach, copy into `src/lib/silhouette.js` and wire `extractFullSilhouette` to call `extractSilhouetteEdgesUV` first.
