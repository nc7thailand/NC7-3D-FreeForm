# Example assets

Reference files for development and comparison with DevFoam.

| File | Description |
| :--- | :--- |
| `KnightChessNoHair.stl` | Default demo model (loaded on first visit) |
| `StackedCut.nc` | DevFoam G-code — **left + right** with **safe Y lift** between passes |
| `StackedCut2_CutLeft-Right.nc` | DevFoam G-code — **left + right continuous** (no lift between passes) |

Both `.nc` files use the same knight job: **N=16**, **8 half-span cuts** (0°–157.5°), **G93** feed.

See **`docs/DevFoamLogic.md`** for full DevFoam pipeline documentation and NC7 mapping.
