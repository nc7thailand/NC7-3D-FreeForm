# Silhouette checkpoints

| File | Date | Description |
| :--- | :--- | :--- |
| `silhouette-envelope-v2.js` | 2026-03-10 | **Current save point.** Per-v min/max envelope — stable on mobile knight STL. Active in `silhouette.js`. |
| `silhouette-edges-v1.js` | 2026-03-10 | View-dependent silhouette edges + vertex weld. Reverted — quality regressed (open loops / wrong loop). |

Full project save point: `docs/SAVEPOINT-2026-03-10.md` · git tag `savepoint-2026-03-10`

## Restore

```bash
cp src/lib/checkpoints/silhouette-envelope-v2.js src/lib/silhouette.js
```

To retry edges: copy `silhouette-edges-v1.js` into `silhouette.js` and wire `extractFullSilhouette` to prefer edge extraction.
