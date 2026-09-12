# NC7 Studio3D — Development Log

> **Chronicle** ของโปรเจกต์ — เกิดอะไร เมื่อไหร่ และ **ทำไม**
> เรียงจากใหม่ → เก่า · ใช้ `git log` เป็นหลักฐานเมื่อต้องการรายละเอียด
>
> เอกสารนี้บันทึก **การตัดสินใจ** และ **เหตุผล** — ส่วนรายละเอียดโค้ดอยู่ใน commit message
> สถานะปัจจุบันดูที่ `docs/HANDOVER-CURRENT.md`

---

## 2026-09-12 — ล็อกขอบเขตแอป + กติกาการคำนวณ

**Commit:** `e8f2314` · **Tag:** `savepoint-2026-09-12-center-turntable`

### สิ่งที่ทำ

**1. โมเดลยืนบนพื้นทันทีที่โหลด**
`prepareRawGeometry()` เดิมจัดกลางที่ origin อย่างเดียว → โมเดลจมครึ่งใต้พื้น (Y=0)
ทำให้ pivot ของ gizmo ไปติดพื้นแทนที่จะอยู่กลางโมเดล
เพิ่ม `translate(0, -min.y, 0)` → โมเดลยืนบนพื้นตั้งแต่โหลด

**2. Gizmo ตาม center of mass สด — ลบบั๊ก "gizmo เกาะพื้น"**
`resetMeshTransform()` เดิมบังคับ `gizmo.position = (0,0,0)` แต่ OBJ_Gizmo ถูกสร้าง
ที่ `center of mass` ไม่ใช่ origin → โมเดลถูกดันเพี้ยน
และเคย cache ค่าไว้ใน `gizmoRest` ซึ่งกลายเป็น stale เมื่อ geometry ถูก mutate
(settle/bake) → แก้เป็นคำนวณสดผ่าน `placePivotAtGeometryCentre()`

**3. ปุ่ม Center — ย้ายโมเดลเข้า turntable**
`gizmo.position.x = 0`, `.z = 0` → center of mass มาอยู่ที่ world X0/Z0
**Y คงเดิม, rotation คงเดิม** ตามที่ตกลง (align model เป็นฟีเจอร์แยก)

### การตัดสินใจสำคัญ

**🔒 ล็อกขอบเขตแอป — CAM เท่านั้น ไม่ใช่ machine controller**

Bank ตรวจ roadmap แล้วสั่งตัดทิ้งทั้งหมด:

| ตัดออก | เพราะ |
| :--- | :--- |
| Serial/USB ต่อเครื่อง | แอปนี้สร้าง G-code ให้ดาวน์โหลดไปโหลดเอง |
| STL Slicing หลายชั้น | ไม่ใช่ 3D-printer — ใช้ **ray casting** ฉายเงา |
| Grid Cut / Tapered / Wedges | เครื่อง NC7 เป็น 2-axis + 1 rotary ทำไม่ได้ |

**🔒 ล็อกกติกาการคำนวณ — pure math เท่านั้น**

Bank: *"All process must be mathematic function. No AI api injected."*
→ ห้าม AI API / model inference / network ใน `src/` ที่ส่งมอบ
→ ต้อง deterministic, reproducible, explainable
→ AI ใช้ได้เฉพาะ**ตอนพัฒนา** (ช่วยเขียนสูตรคณิตศาสตร์)

### เอกสารที่เกิดจาก session นี้

* `docs/ARCHITECTURE.md` — **ใหม่** guideline pipeline (Model → Toolpath → G-code → Simulate)
* `docs/CONCEPT.md` §6–8 — ล็อกขอบเขต + กติกาคำนวณ + roadmap ใหม่
* `docs/LOG.md` — **ใหม่** ไฟล์นี้
* `docs/HANDOVER-CURRENT.md` — **ใหม่** snapshot สถานะปัจจุบัน

### งานค้างที่ตั้งใจทิ้งไว้

* G-code golden compare vs `Example/StackedCut.nc`
* Toolpath optimization (ลด air-cut) — ทำ step by step easy → hard
* Session restore กับโมเดลที่หมุนไว้
* Method 2 (Left + Right) — v2

---

## 2026-09-11 — แก้ Settle (โมเดลร่วงไม่หยุด)

**Commit:** `362f77e` · **Tag:** `savepoint-2026-09-11-settle-fix`

### อาการ

กด Settle แล้วโมเดล**ร่วงลงเรื่อยๆ ไม่หยุด** — เกิดกับทุกกรณี ไม่ว่าจะ rotate มาก่อนหรือไม่

### Root cause

`OBJ_Gizmo` ถูกสร้างที่ `center of mass` พร้อม mesh offset `−com`
แต่ `resetMeshTransform()` บังคับ `position = (0,0,0)` → ไม่ตรงกับ offset
ทุกครั้งที่กด Settle: apply matrix (มี com อยู่ข้างใน) แล้ว reset กลับผิดที่
→ **ดันลงซ้ำ com ทุกครั้ง**

### สิ่งที่แก้

* `Viewer3D` — จำ rest pose ของ gizmo แล้วคืนค่าให้ถูก *(ภายหลังเปลี่ยนเป็นคำนวณสดใน 09-12)*
* `AppState` — ลำดับ settle: apply pose ครั้งเดียว → คืน rest pose
* `AppState` — เลิกดึง stale world matrix ใน `recomputeToolpath` (แก้ silhouette สลับ 0/88 pts)
* ปลดปล่อย WebGL context ตอน unmount (`forceContextLoss()`) — เดิม context leak 3 ตัว
* ลบ `nc7OriginalCentroid` ที่ไม่มีใครใช้

### การตัดสินใจ

**กติกา Settle (LOCKED) — Bank ยืนยัน**
* Settle = ดึง **Y เท่านั้น** จนก้น bounding box แตะ Y=0
* **X/Z ที่ Move ไว้คงเดิม** — align model เป็นฟีเจอร์แยก (ทำภายหลัง)
* ใช้ **bounding box** (ผิวโมเดลจริง = future option)
* Floor = Y=0 = ระนาบเดียวกับ GridHelper

---

## 2026-09-10 — Toolpath: shadow silhouette + floor settle

**Commit:** `5716103` · **Tag:** `savepoint-2026-03-10-session2`

* เพิ่ม shadow silhouette (ฉายเงา), ปรับ profile accuracy, wire path preview
* floor settle ในเส้นทาง toolpath
* เพิ่มไฟล์ตัวอย่าง DevFoam + เอกสารอ้างอิง `docs/DevFoamLogic.md` (`e3fbf25`)

---

## 2026-03 → 2026-09-10 — Save point แรกของ Toolpath

**Commit:** `4c42396` · **Tag:** `savepoint-2026-03-10`

* Toolpath UI เริ่มนิ่ง + envelope silhouette
* ⚠️ หมายเหตุ: tag ใช้ชื่อ `2026-03-10` แต่ commit จริงเกิด 2026-09-10 (ชื่อ tag อ้างวันในปฏิทินทำงานเก่า)

---

## 2026-08-27 — เตรียมย้ายไป Google Antigravity

**Commits:** `e47ce1a`, `4e2e5b3`

* เขียน `docs/HANDOVER.md` สำหรับ migration
* ตั้ง Vite `host: true` ให้เข้าถึงผ่าน LAN/Tailscale ได้
* ⚠️ HANDOVER ฉบับนี้ระบุงานที่**ภายหลังถูกตัดออก** (Serial/USB, slicing, Grid/Tapered/Wedge)
  → เก็บไว้เป็นเอกสารประวัติศาสตร์ ดูขอบเขตปัจจุบันที่ `CONCEPT.md` §6

---

## 2026-08-12 — Phase 1 complete

**Commits:** `7840ce6`, `f6ed5a9`, `ccce109`

* Scaffold: โหลด STL, resize, settle, simplify
* Mouse interaction แบบ MS 3D Builder (ลากซ้าย = ย้ายวัตถุ, ขวา = หมุนกล้อง)
* เป็นจุดที่เอกสาร `HANDOVER.md` ระบุว่า "Phase 1 complete"

---

## 2026-08-10 — Concept V2 (Source of Truth)

**Commit:** `dc0e080`

* `docs/CONCEPT.md` — เอกสารข้อกำหนดฉบับสมบูรณ์ (ภาษาไทย)
* ล็อก: Method 1 (ตัดซ้ายเท่านั้น), G93 inverse time, top safe = H + topOffset
* สูตร Block_Bottom_Extent(θ) และ LB(θ)

---

## 2026-08-09 — เริ่มโปรเจกต์

**Commit:** `15b01f3` — Initial commit

---

## บันทึกการตัดสินใจที่ยังมีผลอยู่

รวมกติกาที่ล็อกแล้วทั้งหมดไว้ที่เดียว เพื่อไม่ต้องค้นย้อนหลัง

| เรื่อง | ข้อสรุป | ล็อกเมื่อ |
| :--- | :--- | :--- |
| **ขอบเขตแอป** | CAM เท่านั้น — ไม่มี machine control, ไม่มี Serial/USB, ไม่มี Grid/Tapered/Wedge | 2026-09-12 |
| **การคำนวณ** | pure math เท่านั้น — ห้าม AI API / network ใน `src/` | 2026-09-12 |
| **Cut mode** | Method 1 — ตัดซ้ายเท่านั้น (Method 2 = v2) | 2026-08-10 |
| **Feed** | G93 inverse time | 2026-08-10 |
| **Top safe** | Y = H + topOffset | 2026-08-10 |
| **Settle** | ดึง Y เท่านั้น, X/Z คงเดิม, ใช้ bounding box | 2026-09-11 |
| **Floor** | Y=0 = ระนาบเดียวกับ GridHelper = ฐานก้อนโฟม | 2026-09-11 |
| **Rotary axis** | จุดต่ำสุดอยู่ที่ world X0, Y0 | 2026-09-11 |
| **Center** | ย้าย com → X0/Z0, Y + rotation คงเดิม | 2026-09-12 |
