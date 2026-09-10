# DevFoam Logic — Reference for NC7 Studio3D

Reverse-engineered reference from **DevFoam 3** official documentation, cncfoam.com wiki, and two sample G-code files shipped in this repo.

**Example G-code (same knight STL job):**

| File | Mode |
| :--- | :--- |
| `Example/StackedCut.nc` | Left + Right with **safe lift** between passes |
| `Example/StackedCut2_CutLeft-Right.nc` | Left + Right **continuous** (single wire step) |

NC7 v1 implements **Method 1** (left cut only). DevFoam samples above are **Method 2** (left + right per rotation). See §7 for mapping.

---

## 1. Core idea — Visual hull / shape from silhouette

DevFoam does **not** use arbitrary 3D raycasting or mesh boolean in the G-code exporter. The pipeline is:

1. Import STL (triangular mesh).
2. For each rotation angle θ, compute a **projected section** = contour of the **shadow** of the part on a vertical plane, using **collimated (parallel) light** along the view direction.
3. Turn that 2D section into a **cutting profile** (left and/or right side of the wire path).
4. Stack all θ steps → rotary hot-wire job → G-code.

Official wording (DevFoam help):

> *"A projected section is the contour of the shadow of the part on a plane, created by a Collimated light (rays are parallel)."*

This is the **visual hull** (shape-from-silhouette): cut away everything outside every silhouette as the foam rotates.

**Implication for NC7:** improve silhouette quality by better **orthographic shadow sampling** + **Profile accuracy**, not by jumping to unrelated algorithms unless needed.

---

## 2. UI layers (2D preview)

From DevFoam *Cut Stl Part* dialog:

| Visual | Meaning |
| :--- | :--- |
| **Grey dotted curve** | Full projected section at current θ |
| **Red bold curve** | **Cutting profile** (wire path) for current θ |
| **Blue dotted line** | Rotation axis |
| **Green lines** | Paths to safe points |
| **Light pink zones** | Cutout offset regions |
| **Light yellow zones** | Min axis distance bands |

3D preview: transparent cyan plane = projection plane; rotates with θ slider.

**NC7 mapping:**

| DevFoam | NC7 |
| :--- | :--- |
| Grey full section | Red silhouette on middle plane (MP) |
| Red cut profile | Left wire path (Method 1) / future right path (v2) |

---

## 3. Silhouette extraction (DevFoam)

### Method

- **Orthographic projection** (parallel rays) through the mesh onto the cutting plane.
- **Profile accuracy** slider: higher accuracy → denser polyline → longer compute.
- Sample knight job: **~126 points (left)** + **~134 points (right)** per cut at θ=0° in our reference files.

### What DevFoam does *not* do (documented limits)

- Cannot cut **internal holes** in a silhouette — *"If internal holes are created in the Path, they will be ignored."*
- Cannot render **concavities along the wire length** well — choose rotation axis carefully.
- Avoid **up/down reversals** within a single cut when possible (quality).

### Alternative DevFoam modes (not in our samples)

| Mode | Use |
| :--- | :--- |
| **Cut Stl Part** | Rotary axis — our reference G-code |
| **Cut Sliced Stl Part** | XY slices, no rotary; can cut internal XY concavities |
| **TwistRot Part** | Analytic shapes, faster/more accurate |

---

## 4. Cut methods — Left vs Left+Right

### Method 2 — Left + Right (both sample `.nc` files)

Per rotation θ, DevFoam can cut **both sides** of the full projected section in one indexed step:

```
Pass A (LEFT):  X ≤ 0 , wire travels one direction in Y
Pass B (RIGHT): X ≥ 0 , wire travels return direction in Y (mirror envelope)
```

Observed in `Example/StackedCut2_CutLeft-Right.nc` at Z=0°:

1. Lead-in from far left: `G1 X-390 … Y30`
2. **Left profile:** X negative, Y ≈ 45 → 629 (~126 segments)
3. Cross center: `X-0.14 Y629` → `X+2 Y629` (**wire stays in foam**)
4. **Right profile:** X positive, Y ≈ 629 → 45 (~134 segments, mirrored)
5. Exit low: `Y30`
6. Retract far right: `G1 X+389`
7. Index: `G1 Z22.5 F160`

### Safe lift between left and right (`StackedCut.nc`)

Same geometry as Left-Right, but **between** left end and right start DevFoam inserts:

```gcode
G1 Y729.3834 F7.0000   ; lift wire above block
G1 Y629.3834 F7.0000   ; return to cut-plane height
```

Then right pass begins at `X+2`.

| File | Between left → right |
| :--- | :--- |
| `StackedCut2_CutLeft-Right.nc` | **Continuous** — no Y729 lift (DevFoam *"Cut Left/Right in single step"*) |
| `StackedCut.nc` | **Safe lift** — Y729 then Y629 before right pass |

The two files differ by **only these 8 lift pairs** (one per cut); all other moves match.

### Method 1 — Left only (NC7 v1)

DevFoam default cut side for rotary STL is often described as following the **right side** of the projected section in their UI convention; NC7 locks **left only** (`X ≤ 0`) for Method 1.

NC7 sequence per rotation (from `CONCEPT.md`):

1. Lead-in → left profile (top → bottom)
2. Top safe `Y = H + topOffset`
3. Retract X out of silhouette
4. Index `G1 Z+={360/N}`

No right pass, no cross through X=0.

---

## 5. Rotation / indexing

From reference G-code (both files):

| Parameter | Value |
| :--- | :--- |
| N (user setting) | 16 |
| Index step | **22.5°** = 360/16 |
| Cuts in file | **8** (0°, 22.5°, …, 157.5°) — **half-span 0–180°** |
| Index command | `G1 Z{angle} F160` |
| Z scale | **1 mm G-code = 1°** (same as NC7) |

DevFoam also supports:

- **Customize Rotations** — non-uniform angles, optimize to reduce green (uncut) regions
- **Even N** — enables left+right single-step option

NC7: `effectiveCutCount(N) = N/2` for half-span — matches DevFoam sample behaviour.

---

## 6. G-code format (from samples)

### Header

```gcode
G90 G21
S1000
G21
G17
G90
G94
M3
G1 X-277.4521 Y30.0000 Z0.0000 F700.0000   ; first move still G94 mm/min
G93                                         ; switch to inverse time
```

### Feed

- **G93 inverse time** for profile moves: `F = 1 / time`, short segments → large F (~1794, ~1988), long segments → small F (~3.5).
- First approach move uses **G94 F700** before `G93`.
- Rotary index: **F160** on Z moves.

NC7 uses G93 from the start (no G94 lead-in) — minor difference.

### Axes

| Axis | Role |
| :--- | :--- |
| **X** | Wire horizontal (left negative, right positive) |
| **Y** | Wire vertical; Y=0 at block base in NC7; DevFoam samples use Y≈30 lead-in, profile up to Y≈629 |
| **Z** | Rotary table (degrees) |

### Safe heights (observed)

| Y value | Likely meaning (reference job) |
| :--- | :--- |
| ~30 | Low lead-in / approach below profile |
| ~629 | Top of cut / `H + topOffset` (≈609+20) |
| ~729 | Extra clearance lift (+100 mm above top safe) before cross-pass or retract |

### Footer

```gcode
M5
G30
```

---

## 7. NC7 vs DevFoam — feature map

| Topic | DevFoam | NC7 v1 (save point 2026-03-10) |
| :--- | :--- | :--- |
| Silhouette | Collimated shadow, Profile accuracy | Front-to-rear envelope bins (`silhouette.js`) |
| Preview full section | Grey dotted | Red loop on MP |
| Cut export | Left+Right (samples) or configurable | **Method 1 left only** |
| Left+Right continuous | `StackedCut2_CutLeft-Right.nc` | v2 only |
| Safe between L/R | `StackedCut.nc` (Y729) | N/A |
| Top safe after cut | Y729 optional; Y629 = H+offset | `Y = H + topOffset` |
| G93 | Yes (after first G94 move) | Yes |
| Half-span N/2 | Yes (8 of 16) | Yes |
| Kerf / LO / BO | Yes | Yes (`stock` params) |
| Internal holes | Ignored | Ignored (left envelope) |
| Green uncut preview | Customize Rotations UI | Not yet |

---

## 8. Recommended NC7 alignment (future work)

Priority order to match DevFoam quality without copying Method 2 prematurely:

1. **Shadow contour** with configurable Profile accuracy (replace coarse envelope for preview).
2. Keep **Method 1** export as left-only wire path.
3. Optional **G94 first move** then G93 to match controller expectations.
4. Document **Y729-style** extra lift if controllers need it before X retract.
5. **v2:** Method 2 left+right continuous path using `StackedCut2_CutLeft-Right.nc` as G-code golden reference.

---

## 9. References

### In this repo

- `Example/StackedCut.nc`
- `Example/StackedCut2_CutLeft-Right.nc`
- `Example/KnightChessNoHair.stl` (same model family as samples)
- `docs/CONCEPT.md` — NC7 source of truth
- `src/lib/checkpoints/silhouette-envelope-v2.js` — current NC7 silhouette baseline

### External (DevFoam 3 help)

- [Cut Stl Part](https://www.devcad.com/help_devfoam3/AUG.80.061.htm) — projection, 2D preview colours, parameters
- [Customize Rotations](https://www.devcad.com/help_devfoam3/AUG.80.078.htm) — green uncut regions, optimize angles
- [Cut by Rotating Table](https://www.devcad.com/help_devfoam3/AUG.80.065.htm) — Left/Right single step, G-code export
- [G-code settings](https://www.devcad.com/help_devfoam3/AUG.80.066.htm) — G93, axis names, feed
- [cncfoam.com — STL cutting](https://cncfoam.com/wiki.php/cutting-3d-models-stl-obj) — visual hull explanation

---

*Document version: 2026-03-10 — derived from user-supplied StackedCut.nc samples and DevFoam 3 public documentation.*
