# NC7 Studio3D — Architecture Guideline

> เอกสารนี้เป็น **guideline** สำหรับนักพัฒนา/AI assistant ที่เข้ามาทำงานต่อ
> อธิบายว่า data ไหลผ่านระบบอย่างไร และแต่ละขั้นตอนคำนวณอะไร
> Source of truth ทางคณิตศาสตร์อยู่ที่ `docs/CONCEPT.md` + `docs/DevFoamLogic.md`

---

## 1. หลักการพื้นฐาน

**ทุกการคำนวณเป็น mathematical function ล้วน** — ดู `CONCEPT.md` §7

```
STL (input)
  → [Model]     จัดท่าโมเดล      → geometry ตั้งต้น
  → [Toolpath]  หาเส้นตัด        → cutJob (profiles)
  → [G-code]    แปลงเป็นคำสั่ง   → .nc file
  → [Simulate]  ตรวจสอบ          → ภาพเคลื่อนไหว
```

**ไม่มี AI, ไม่มี network, deterministic ทุกขั้น** — input เดิม ได้ output เดิมเสมอ

---

## 2. หน้า (Pages) และหน้าที่

| # | Route | หน้า | อินพุต | เอาต์พุต |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `/model` | Model | ไฟล์ `.stl` | `geometry` (จัดท่าแล้ว) |
| 2 | `/toolpath` | Toolpath | `geometry` + `stock` | `cutJob` (profiles + wire paths) |
| 3 | `/gcode` | G-code | `cutJob` + `settings` | ไฟล์ `.nc` |
| 4 | `/simulate` | Simulate | `cutJob` | ภาพเคลื่อนไหว (ไม่ผลิตข้อมูลใหม่) |

**จุดสำคัญ:** หน้า **Toolpath** กับหน้า **G-code** แยกกันคนละงาน

* **Toolpath** = เรขาคณิต — "ลวดต้องวิ่งเป็นเส้นอะไร" (หน่วย mm)
* **G-code** = การแปล — "เขียนเป็นคำสั่ง G93 F... อย่างไร" (หน่วย mm + inverse-time)

เก็บสถานะร่วมกันใน `src/context/AppState.jsx`

---

## 3. Data ที่ไหลระหว่างหน้า

```
┌─────────────┐
│  geometry   │  THREE.BufferGeometry — โมเดลที่จัดท่าแล้ว
└──────┬──────┘
       │
       │  + stock { w, t, h, lo, bo, kerf, topOffset, boAuto, boMargin }
       │  + rotationN (จำนวนรอบตัด 3–64)
       ▼
┌─────────────┐
│   cutJob    │  { rotationN, cutCount, halfSpan, cuts[] }
└──────┬──────┘   cuts[i] = { index, thetaDeg, profile, wirePath }
       │
       │  + gcodeSettings { feedRate, indexFeed, spindle }
       ▼
┌─────────────┐
│  .nc file   │  ข้อความ G-code
└─────────────┘
```

---

## 4. ขั้นตอนที่ 1 — Model (`/model`)

**หน้าที่:** นำ STL เข้ามาและจัดท่าให้พร้อมตัด

### 4.1 จัดกลาง + วางบนพื้น (ครั้งเดียวตอนโหลด)

`prepareRawGeometry()` — `src/context/AppState.jsx`

```js
// จัดกลางที่ origin (center of mass)
geo.translate(-centroid.x, -centroid.y, -centroid.z)
// วางบนพื้น Y=0
geo.translate(0, -geo.boundingBox.min.y, 0)
```

**ทำไมต้องวางบนพื้น:** เพราะ Y=0 คือระนาบฐานก้อนโฟม (CONCEPT §2)
ถ้าจัดกลางอย่างเดียว โมเดลจะจมครึ่ง → gizmo ไปติดพื้น

### 4.2 Pivot: OBJ_Gizmo

```
Scene
 └── OBJ_Gizmo   (position = center of mass, ตัวหมุน/ย้าย)
      ├── mesh   (position = −com → โมเดลอยู่ที่ world origin)
      └── Trans_Gizmo (TransformControls, ลูกศรที่เห็น)
```

**หลักสำคัญ:** `OBJ_Gizmo.position` **คือ** ตำแหน่ง center of mass ของโมเดล
เพราะ mesh offset ไว้ `−com` พอดี — ห้าม cache ค่านี้ ให้คำนวณสดเสมอ
(`placePivotAtGeometryCentre()`) เพราะ com เปลี่ยนเมื่อ geometry ถูก mutate

### 4.3 ปุ่มใน toolbar

| ปุ่ม | สูตร | ผล |
| :--- | :--- | :--- |
| **Move / Rotate** | gizmo transform | จัดท่าโมเดล |
| **Reset** | โหลด dummy ใหม่ | กลับสถานะตั้งต้น |
| **Settle** | `translate(0, −min.y, 0)` | วางก้น bounding box บน Y=0 (X/Z คงเดิม) |
| **Center** | `gizmo.position.x = 0`, `.z = 0` | center of mass → turntable axis (Y + rotation คงเดิม) |

**ก่อนออกจากหน้านี้:** `bakeModelTransform()` จะฝัง gizmo transform ลง vertex จริง
→ หน้า Toolpath ได้ geometry ที่จัดท่าแล้ว ไม่ต้องใช้ matrix อีก

---

## 5. ขั้นตอนที่ 2 — Toolpath (`/toolpath`)

**หน้าที่:** หาเส้นทางลวด (2D polyline ต่อมุม θ)

### 5.1 ระบบพิกัด

World:
* **X** = แนวนอน (origin = ศูนย์กลาง turntable)
* **Y** = แนวตั้ง (origin = ฐานก้อนโฟม, Y=0)
* **Z** = แกนหมุน (rotary)

Section (2D ที่ใช้คำนวณ):
* **u** = ระยะตามระนาบตัด (บวก = ไปทางขวา)
* **v** = ความสูง (เท่ากับ world Y)

### 5.2 Pipeline การคำนวณ

```
geometry (จัดท่าแล้ว)
   │
   ├─ geometryForToolpathSlicing()      คัดลอก + วางบนพื้น (virtual)
   │
   ├─ cuttingPlane(θ)                   สร้างระนาบตัด ณ มุม θ
   │
   ├─ extractLeftSilhouette()           ★ ray casting ★
   │     ยิงรังสีตามแกน −n ผ่าน mesh
   │     → ฉายเงาลงระนาบตัด → filled region
   │     → หา envelope ซ้าย (u ≤ 0)
   │
   ├─ processWireProfile()              แปลง silhouette → wire path
   │     ├─ orderTopDown()              เรียงบน → ล่าง (CONCEPT §2.4)
   │     ├─ applyKerf()                 u −= kerf/2
   │     └─ clampProfileToStock()       จำกัดในกรอบก้อนโฟม
   │
   └─ → polylines[] ในหน่วย mm
```

**นี่คือ "ray casting" ไม่ใช่ slicing** — ไม่ได้ตัดเป็นชั้นๆ
แต่ฉายเงา (orthographic projection) ลงระนาบเดียว

### 5.3 สูตรสำคัญ (`src/lib/toolpath.js`)

```js
// Block_Bottom_Extent(θ) — CONCEPT §3.2
= |(W/2)·sin θ| + |(T/2)·cos θ| + LO

// LB(θ) — จุดถอยลวดล่างสุด
= Block_Bottom_Extent(θ) + BO

// Top safe Y — CONCEPT §2.3
= H + topOffset

// Auto bottom safe (v1)
= hypot(W, T, H)/2 + margin
```

### 5.4 จำนวนการตัด

`cutAnglesForN(n)` — `src/lib/cutJob.js`

```
step  = 360 / N          (มุมต่อครั้ง, คงที่)
count = floor(N / 2)     (half-span 0–180° เพราะ silhouette เต็มรอบ)
```

**สำคัญ:** M3 หมุน Z ต่อเนื่องอยู่แล้ว จึงตัดแค่ครึ่งรอบ — step ยังเป็น 360/N

---

## 6. ขั้นตอนที่ 3 — G-code (`/gcode`)

**หน้าที่:** แปลง `cutJob` เป็นข้อความ G-code

**ไม่มีเรขาคณิตในขั้นนี้** — ใช้ค่าที่คำนวณไว้แล้วเท่านั้น

### 6.1 รูปแบบ (LOCKED — CONCEPT §2.4)

```
G90 G21        absolute mm
S{S}           spindle
G17 G90
M3             เริ่มหมุน
G93            ★ inverse time feed (ไม่ใช่ G94 mm/min)
  ...
M5             หยุด
G30            จบ
```

### 6.2 ลำดับต่อ 1 cut (`generateGcode()`)

```
1. Lead-in     → X = −extendX(θ), Y = 0
2. Profile     → วิ่งตาม wirePath จากบน → ล่าง
3. Top safe    → Y = H + topOffset   (ดึงลวดขึ้นเหนือก้อน)
4. Retract X   → X = +extendX(θ)
5. Index       → Z += 360/N  (F = indexFeed, G93)
```

### 6.3 Feed rate (G93)

```js
// F = ความเร็ว ÷ ระยะทาง  (inverse time)
F = feedRate / distanceMm
```

เพราะ G93 แปลว่า "ใช้เวลานี้ต่อการเคลื่อนไหว 1 ครั้ง" — ระยะสั้น F สูง ระยะยาว F ต่ำ

---

## 7. ขั้นตอนที่ 4 — Simulate (`/simulate`)

ตรวจสอบ toolpath ด้วยภาพ — **ไม่ผลิตข้อมูลใหม่** ใช้ `cutJob` ที่มีอยู่แล้ว
ดู `src/lib/simStack.js` + `src/components/SimulateViewer.jsx`

---

## 8. ไฟล์สำคัญ

| ไฟล์ | หน้าที่ |
| :--- | :--- |
| `src/context/AppState.jsx` | State กลาง + orchestration ทุกหน้า |
| `src/lib/toolpath.js` | ★ คณิตศาสตร์ toolpath (ระนาบตัด, LB, safe points) |
| `src/lib/silhouette.js` | ★ ray casting + silhouette extraction |
| `src/lib/wirePath.js` | kerf, clamp, เรียงลำดับ, top safe |
| `src/lib/cutJob.js` | มุมตัด, จำนวน cut, สร้าง job |
| `src/lib/gcode.js` | ★ post-processor (G93) |
| `src/lib/settle.js` | settle / bake transform |
| `src/lib/stl.js` | โหลดไฟล์ STL |
| `src/lib/project.js` | save/load `.nc7project` |
| `src/lib/session.js` | restore session อัตโนมัติ |
| `src/components/Viewer3D.jsx` | 3D viewport + OBJ_Gizmo |

---

## 9. กติกาสำหรับคนที่มาแก้ต่อ

1. **ห้ามเพิ่ม AI/network call** ใน `src/` — ดู `CONCEPT.md` §7
2. **แยก geometry ออกจาก formatting** — Toolpath คำนวณ mm, G-code แค่ print
3. **อย่า cache ค่าที่คำนวณได้** — เช่น com ของ geometry ให้คำนวณสด
4. **ค่า default ต้องอยู่ใน `DEFAULT_*`** — อย่า hardcode กระจัดกระจาย
5. **ก่อนแก้ ให้เทียบกับ `Example/StackedCut.nc`** (golden reference จาก DevFoam)

---

## 10. งานค้าง

| งาน | สถานะ |
| :--- | :--- |
| G-code golden compare vs `Example/StackedCut.nc` | ยังไม่ทำ |
| Toolpath optimization (ลด air-cut) | วางแผนไว้ — ทำ step by step |
| Session restore กับโมเดลที่หมุนไว้ | ต้องตรวจสอบ |
| Method 2 (Left + Right full silhouette) | v2 เท่านั้น |
