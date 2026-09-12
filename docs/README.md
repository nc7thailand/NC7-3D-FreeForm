# docs/ — สารบัญเอกสาร

สารบัญเอกสารทั้งหมดของ NC7 Studio3D · อัปเดต 2026-09-12

---

## 🚀 เริ่มจากตรงนี้

| ลำดับ | ไฟล์ | อ่านทำไม |
| :--- | :--- | :--- |
| 1 | [`../UCP.md`](../UCP.md) | **โปรโตคอลสื่อสารกับ Bank** (`!chat` / `!run`, hardware rules) — ต้องทำตาม |
| 2 | [CONCEPT.md](CONCEPT.md) | **Source of truth** — สูตร, ขอบเขตแอป (§6), กติกาคำนวณ (§7) |
| 3 | [ARCHITECTURE.md](ARCHITECTURE.md) | โครงสร้าง pipeline และหน้าที่แต่ละหน้า |
| 4 | [HANDOVER-CURRENT.md](HANDOVER-CURRENT.md) | **สถานะปัจจุบัน** + งานค้าง + กับดักที่ต้องระวัง |
| 5 | [LOG.md](LOG.md) | ประวัติการพัฒนา + เหตุผลของการตัดสินใจ |

---

## 📚 รายละเอียดแต่ละไฟล์

### ข้อกำหนด (Specification)

| ไฟล์ | เนื้อหา |
| :--- | :--- |
| [CONCEPT.md](CONCEPT.md) | Concept V2 — สมบูรณ์สุด: kinematics, Safe Points, G-code output, สูตร Block_Bottom_Extent/LB, ขอบเขตแอป, กติกาการคำนวณ |
| [DevFoamLogic.md](DevFoamLogic.md) | Reverse-engineer Logic ของ DevFoam 3 — อ้างอิงจากเอกสารทางการ + ไฟล์ G-code ตัวอย่าง (`Method 2`) |

### คู่มือพัฒนา (Guideline)

| ไฟล์ | เนื้อหา |
| :--- | :--- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Data flow: `STL → Model → Toolpath → G-code` · ตำแหน่งไฟล์สำคัญ · กติกาสำหรับคนมาแก้ต่อ |
| [HANDOVER-CURRENT.md](HANDOVER-CURRENT.md) | Snapshot สถานะล่าสุด — สภาพแวดล้อม, กติกา, งานค้าง, กับดัก, วิธี verify |

### ประวัติ (History)

| ไฟล์ | เนื้อหา |
| :--- | :--- |
| [LOG.md](LOG.md) | Chronicle เรียงตามเวลา + ตาราง "การตัดสินใจที่ยังมีผลอยู่" |
| [HANDOVER.md](HANDOVER.md) | ⚠️ **ประวัติศาสตร์** (2026-08-12) — มีงานที่ภายหลังถูกตัดออกจากขอบเขต |
| [HANDOVER-2026-03-10.md](HANDOVER-2026-03-10.md) | ⚠️ **ประวัติศาสตร์** (session 2026-03-10) |
| [SAVEPOINT-2026-03-10.md](SAVEPOINT-2026-03-10.md) | ⚠️ **ประวัติศาสตร์** — known-good baseline ก่อนทดลอง silhouette |

> ⚠️ เอกสารประวัติศาสตร์**อย่าใช้เป็นข้อกำหนด** — ขอบเขตแอปเปลี่ยนไปแล้ว
> (ตัด Serial/USB, multi-layer slicing, Grid/Tapered/Wedge cuts ออกทั้งหมด)
> ดูขอบเขตปัจจุบันที่ [CONCEPT.md §6](CONCEPT.md)

---

## 🧮 สูตรสำคัญ (สรุปย่อ)

รายละเอียดเต็มอยู่ใน [CONCEPT.md](CONCEPT.md) §2–3

```
Block_Bottom_Extent(θ) = |(W/2)·sin θ| + |(T/2)·cos θ| + LO
LB(θ)                  = Block_Bottom_Extent(θ) + BO
Top safe Y             = H + topOffset
G93 feed               = feedRate ÷ distanceMm
```

**แกน:** X = แนวนอน (origin = ศูนย์กลาง turntable) · Y = แนวตั้ง (origin = ฐานก้อนโฟม) · Z = หมุน
**Floor:** Y = 0 = ระนาบเดียวกับ GridHelper

---

## ⚠️ กติกาที่ห้ามละเมิด (ย่อ)

| เรื่อง | กติกา |
| :--- | :--- |
| **การคำนวณ** | ทุกอย่างใน `src/` ต้องเป็น mathematical function ล้วน — ❌ ห้าม AI API / network |
| **ขอบเขตแอป** | CAM เท่านั้น — ❌ ไม่มี machine control, Serial/USB, Grid/Tapered/Wedge, 3D-printer slicing |
| **แกน** | 2-axis (X, Y) + 1 rotary (Z) เท่านั้น |
| **Cut mode v1** | Method 1 (ตัดซ้ายเท่านั้น) — Method 2 = v2 |
| **Feed** | G93 inverse time |
| **Settle** | ดึง Y เท่านั้น — X/Z คงเดิม |

รายละเอียดเต็ม: [CONCEPT.md §6–7](CONCEPT.md) และ [`../UCP.md`](../UCP.md)

---

## 📂 ที่อื่นที่ควรรู้

| Path | เนื้อหา |
| :--- | :--- |
| `Example/` | โมเดลตัวอย่าง + G-code อ้างอิงจาก DevFoam (golden reference) |
| `src/lib/` | ★ คณิตศาสตร์ทั้งหมด (toolpath, silhouette, gcode, settle) |
| `src/lib/checkpoints/` | โค้ดทดลองที่เก็บไว้ — 🚫 `silhouette-edges-v1.js` ห้ามเปิด (พังบนมือถือ) |
