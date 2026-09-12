# NC7 Studio3D — Handover (Current)

**อัปเดต:** 2026-09-12 · **HEAD:** `e8f2314` · **Branch:** `main` (sync กับ `origin/main`)
**Repo:** https://github.com/nc7thailand/NC7-3D-FreeForm

> เอกสารนี้คือ snapshot สถานะ**ปัจจุบัน** สำหรับคนที่เข้ามาทำงานต่อ
> ประวัติ/เหตุผลของการตัดสินใจดูที่ `docs/LOG.md`
> ข้อกำหนดฉบับสมบูรณ์ดูที่ `docs/CONCEPT.md`
> โครงสร้าง pipeline ดูที่ `docs/ARCHITECTURE.md`

---

## 1. อ่านอะไรก่อน

| ลำดับ | ไฟล์ | ทำไม |
| :--- | :--- | :--- |
| 1 | `UCP.md` | โปรโตคอลสื่อสารกับ Bank (ต้องทำตาม) |
| 2 | `docs/CONCEPT.md` | Source of truth — สูตร, ขอบเขต, กติกา |
| 3 | `docs/ARCHITECTURE.md` | Pipeline และหน้าที่ของแต่ละหน้า |
| 4 | `docs/LOG.md` | ประวัติการตัดสินใจ |
| 5 | ไฟล์นี้ | สถานะปัจจุบัน + งานค้าง |

**เอกสารประวัติศาสตร์ (อย่าใช้เป็นข้อกำหนด):** `docs/HANDOVER.md` (2026-08-12),
`docs/HANDOVER-2026-03-10.md`, `docs/SAVEPOINT-2026-03-10.md`

---

## 2. กติกาที่ห้ามละเมิด

### 2.1 การสื่อสาร (จาก `UCP.md` v2.0)

* `!chat` / `/Chat` → **Chat Mode** — ห้ามแก้โค้ด ✍️ แก้ Markdown docs ได้
* `!run` / `/Run` → **Run Mode** — ทำงานเต็มที่ + **3-attempt rule**
* ค่าเริ่มต้น = Run Mode · โหมดเป็น sticky
* **ตอบ Bank เป็นภาษาไทย** — คิด/เขียนโค้ดเป็นอังกฤษ
* **3 attempts max ต่อปัญหา** → ถ้าไม่สำเร็จ หยุดและรายงาน

### 2.2 Hardware Rules (NON-NEGOTIABLE)

| # | Rule |
| :--- | :--- |
| R1 | **ห้าม** restart/stop/kill Qwen daemon (คุณอาศัยอยู่ในนั้น) |
| R2 | **ห้าม** `brew upgrade/reinstall` — จะลบ Web Shell patch |
| R3 | **ห้าม** แก้ `/opt/homebrew/Cellar/qwen-code/` |
| R4 | **ห้าม** พิมพ์/แสดง `.server-token` |
| R5 | **ห้าม** แก้ `com.qwenlm.qwen-serve.plist` |
| R6 | **ห้าม** bind `0.0.0.0` — ใช้ Tailscale IP เท่านั้น |

### 2.3 กติกาการคำนวณ (จาก `CONCEPT.md` §7)

**ทุกอย่างใน `src/` ต้องเป็น mathematical function ล้วน**

* ❌ ห้าม AI API / model inference ในตัวแอปที่ส่งมอบ
* ❌ ห้ามพึ่ง network — ต้องทำงานได้ตอนไม่มีเน็ต
* ✅ Deterministic — input เดิม ได้ output เดิม
* ✅ Reproducible — เปิดโปรเจกต์เก่า ได้ toolpath เดิม
* ✅ Explainable — ช่างอธิบายได้ว่าค่ามาจากสูตรไหน

### 2.4 ขอบเขตแอป (จาก `CONCEPT.md` §6)

**CAM software เท่านั้น — ไม่ใช่ machine controller**

* ❌ ไม่มี Serial/USB, machine control, jog, homing
* ❌ ไม่มี Grid Cut / Tapered Cut / Wedges
* ❌ ไม่ใช่ 3D-printer slicer → ใช้ **ray casting** หา silhouette
* ✅ รองรับ 2-axis (X, Y) + 1 rotary axis (Z) เท่านั้น
* ✅ Output = ไฟล์ `.nc` ให้ผู้ใช้ดาวน์โหลดเอง

---

## 3. สภาพแวดล้อม

| | |
| :--- | :--- |
| Repo root | `/Users/nc7foamart/NC7Studio3D` |
| Dev server | `npm run dev` → http://localhost:5173 |
| เข้าจากเครื่องอื่น | `http://100.64.95.27:5173` (Tailscale) |
| Qwen Web UI | https://nc7s-mac-mini.tail36564e.ts.net:4170 |
| Build | `npm run build` (Vite) |
| Test runner | ⚠️ **ไม่มี** — ยังไม่มี test framework ในโปรเจกต์ |

**Chrome DevTools MCP** ใช้สำหรับ verify ด้วยตา — ⚠️ อาจชนกับ Cursor/Antigravity
ที่ใช้ DevTools port เดียวกัน (ดูหัวข้อ 7)

---

## 4. สถานะโค้ดปัจจุบัน

### 4.1 หน้าที่เสร็จแล้ว

| # | Route | สถานะ |
| :--- | :--- | :--- |
| 1 | `/model` | ✅ โหลด STL, resize, settle, center, move, rotate, simplify, export |
| 2 | `/toolpath` | ✅ ray casting silhouette, wire path (kerf/clamp), preview ต่อมุม θ |
| 3 | `/gcode` | ✅ G93 post-processor, download `.nc` |
| 4 | `/simulate` | ✅ ดู toolpath ด้วยภาพ |

### 4.2 Backbone

```
Model  → geometry (จัดท่า)  → cutJob (profiles + wirePath) → .nc
         AppState.jsx เป็น state กลางของทุกหน้า
```

รายละเอียดดู `docs/ARCHITECTURE.md`

### 4.3 ปุ่มใน toolbar หน้า Model

| ปุ่ม | สูตร | หมายเหตุ |
| :--- | :--- | :--- |
| Move / Rotate | gizmo transform | ต้องกด **Next** เพื่อ bake ลง geometry |
| Reset | โหลด dummy ใหม่ | เคลียร์ session + reset gizmo |
| Settle | `translate(0, −min.y, 0)` | **Y เท่านั้น** — X/Z คงเดิม |
| Center | `gizmo.position.x=0, .z=0` | Y + rotation คงเดิม |

---

## 5. งานค้าง

### 5.1 เรียงตามความสำคัญ

| # | งาน | รายละเอียด |
| :--- | :--- | :--- |
| 1 | **G-code golden compare** | เทียบ output กับ `Example/StackedCut.nc` ยังไม่เคยทำ — เป็นด่านตรวจความถูกต้องที่สำคัญที่สุด |
| 2 | **Session restore** | โมเดลที่หมุนไว้แล้ว restore กลับมา — ต้องตรวจว่าท่าถูกต้อง |
| 3 | **Toolpath optimization** | ลด air-cut distance — ทำ **step by step easy → hard** (Bank สั่งไว้ว่าห้ามรีบ) |
| 4 | **Method 2** | Left + Right full silhouette — **v2 เท่านั้น** |
| 5 | **Align model** | ฟีเจอร์แยกจาก Center (ถ้าต้องการเพิ่ม) |

### 5.2 🔴 MUST DO — ความปลอดภัย

**Rotate API keys 2 ตัว** — `DASHSCOPE_API_KEY` และ `DEEPSEEK_API_KEY`
ถูกพิมพ์ลง transcript เมื่อ 2026-09-12 (อุบัติเหตุจากการ `cat ~/.qwen/settings.json`)
Bank เลื่อนไว้ — **ยังค้างอยู่** ต้อง rotate ที่ console ของผู้ให้บริการ

**ห้าม `cat ~/.qwen/settings.json` อีก** — อ่านเฉพาะ `mcpServers`:
```bash
python3 -c "import json;d=json.load(open('/Users/nc7foamart/.qwen/settings.json'));print(json.dumps(d.get('mcpServers'),indent=2))"
```

---

## 6. กับดักที่ต้องระวัง

| กับดัก | เรื่อง |
| :--- | :--- |
| **OBJ_Gizmo rest position** | gizmo อยู่ที่ `center of mass` **ไม่ใช่** origin — อย่า `position.set(0,0,0)` |
| **อย่า cache com** | com เปลี่ยนเมื่อ geometry ถูก mutate (settle/bake) — คำนวณสดเสมอ |
| **same-reference bailout** | `setGeometry(workingRef.current)` ส่ง object เดิม → React ไม่ re-render → effect ไม่รัน |
| **effect ordering** | child effect (Viewer3D) รัน**ก่อน** parent effect (AppState) |
| **อย่า apply world matrix ซ้ำ** | เมื่อ bake ไปแล้ว ให้ส่ง `null` ในเส้นทาง toolpath |
| **`resetKey` bump** | ทำให้กล้อง re-frame → เด้ง (ใช้ `refreshMeshPivot()` แทนถ้าทำได้) |
| **`silhouette-edges-v1.js`** | 🚫 **ห้ามเปิดใช้** — พังบนมือถือ (ดู `src/lib/checkpoints/`) |

---

## 7. การ verify

### 7.1 ทำได้เอง

```bash
npm run build      # ตรวจ syntax/import — ผ่านทุกครั้งก่อน commit
```

**Chrome DevTools MCP:** navigate → `evaluate_script` → `take_screenshot` → `list_console_messages`

⚠️ **ข้อจำกัดที่เจอมาแล้ว:**
* `gl.readPixels` นอก rAF ได้ 0 — ต้องอ่านใน `requestAnimationFrame`
* TransformControls **ไม่รับ** synthetic PointerEvent — ต้องให้คนลากเมาส์จริง
* MCP อาจหลุดถ้า Cursor/Antigravity แย่ง DevTools port → restart Qwen แล้วลองใหม่

### 7.2 ต้องให้ Bank ทดสอบด้วยตา

งานที่แตะ**การมองเห็น/การลากเมาส์** — MCP พิสูจน์ไม่ได้ ให้ Bank ทดสอบแล้วรายงานผล
(เช่น Settle, Center, gizmo position)

### 7.3 กติกาการรายงาน

**ห้ามรายงานว่าแก้สำเร็จก่อนพิสูจน์** — build ผ่านไม่ใช่หลักฐานว่าใช้งานได้
ถ้า verify ไม่ได้ ให้บอกตรงๆ พร้อมวิธีทดสอบด้วยมือ แล้วรอให้ Bank ยืนยันก่อน commit

---

## 8. Git workflow

* Commit เมื่อ **แก้ปัญหาจบและผ่านการยืนยันแล้ว** (ไม่ commit งานที่ยังไม่ verify)
* ใส่ **เหตุผล** ใน commit message ไม่ใช่แค่สิ่งที่เปลี่ยน
* Tag savepoint เมื่อจบ session: `savepoint-YYYY-MM-DD-<slug>`
* Push: `git push origin main && git push origin <tag>` (ใช้ SSH)

**Savepoints ที่มี:**
```
savepoint-2026-03-10                (2026-09-10)  toolpath UI + envelope silhouette
savepoint-2026-03-10-session2       (2026-09-10)  shadow silhouette + floor settle
savepoint-2026-09-11-settle-fix     (2026-09-11)  โมเดลไม่ร่วงซ้ำ
savepoint-2026-09-12-center-turntable (2026-09-12) ยืนบนพื้น + gizmo + Center
```

---

## 9. จุดที่ยังไม่แน่ใจ (ต้องตรวจก่อนเชื่อ)

* **G-code ยังไม่เคยเทียบ golden file** — ความถูกต้องของ output ยังไม่พิสูจน์
* **Session restore กับโมเดลที่หมุน** — เคยเห็นอาการโมเดลนอนตะแคง
* **Method 2** ยังไม่เริ่ม — `cross-section` ฝั่งขวายังไม่มีสูตร
