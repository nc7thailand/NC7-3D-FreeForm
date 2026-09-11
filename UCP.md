# UCP — User Communication Protocol

> โปรโตคอลการสื่อสารระหว่าง **Bank (User)** กับ **AI Assistant** ในโปรเจกต์นี้
> Version: `2.0` · อัพเดท: 11 กันยายน 2026 · Owner: Bank

---

## 1. ภาษา (Language)

| Area | Language |
|------|----------|
| Thinking & Coding (internal) | English |
| User commands | Thai **หรือ** English |
| Agent replies (report) | **Thai เท่านั้น** |
| Code, paths, technical terms | คงไว้ตามเดิม (English) |

---

## 2. คำสั่งควบคุม (Control Commands)

| คำสั่ง | ชื่อโหมด | ความหมาย |
|---|---|---|
| `!chat` · `/Chat` | 🟦 **Chat Mode** | คุย/บรีนสตรอม — **ห้ามแก้โค้ด** ✍️ ทำ Markdown docs ได้ |
| `!run` · `/Run` | 🟩 **Run Mode** | ลงมือทำงาน — แก้โค้ดได้เต็มที่ + **3-attempt rule** |

### กติกาการอ่านคำสั่ง

1. ต้องเป็นข้อความที่ **ขึ้นต้น** ด้วย `!chat`, `!run`, `/Chat`, หรือ `/Run` (case-insensitive)
2. ถ้าคำสั่งอยู่ใน **code block** หรืออัญประกาศ (`"..."`) → ถือเป็นข้อความธรรมดา
3. ถ้าส่งหลายคำสั่งในข้อความเดียว → **คำสั่งสุดท้ายชนะ**
4. โหมดเป็นแบบ **sticky** — คงอยู่จนกว่าจะสลับด้วยคำสั่งอีกตัว
5. คำสั่งสลับโหมด **ไม่ต้องมีข้อความอื่นกำกับ** ก็ได้

---

## 3. ค่าเริ่มต้น (Default Mode)

- เริ่มต้นเป็น **🟩 Run Mode** เสมอ
- เปลี่ยนเป็น Chat Mode เมื่อ Bank ส่ง `!chat` หรือ `/Chat`

---

## 4. พฤติกรรมของผู้ช่วยในแต่ละโหมด

### 🟦 Chat Mode — คุย / บรีนสตรอม

**ทำได้**
- คุย ตอบคำถาม วิเคราะห์ เสนอไอเดีย
- **อ่านไฟล์/ค้นหาโค้ดแบบ read-only**
- ยกตัวอย่างโค้ดสั้นๆ ในคำตอบได้ — แต่ไม่เขียนลงไฟล์
- ✍️ **สร้าง/แก้ไข Markdown docs** ได้ (`.md` files เท่านั้น)

**ห้าม**
- แก้ไข / สร้าง / ลบไฟล์ code (`.js`, `.jsx`, `.css`, `.json`, ฯลฯ)
- รันคำสั่งที่เปลี่ยนสถานะ (build, install, start server, git commit, ฯลฯ)
- ลงมือ implement

### 🟩 Run Mode — ลงมือทำงาน

- ทำได้เต็มที่: อ่าน/เขียน/แก้ไฟล์, รันคำสั่ง, test
- **3-attempt rule:** ถ้าแก้ไม่สำเร็จ 3 ครั้ง → หยุดและรายงาน
- ก่อนลบไฟล์/แก้ของสำคัญ → ยืนยันกับ Bank ก่อนเสมอ

---

## 5. การประกาศสลับโหมด

- เข้า Chat Mode → `🟦 Chat Mode ON — คุย/บรีนสตรอม (ยังไม่แก้โค้ด)`
- เข้า Run Mode → `🟩 Run Mode ON — ลงมือทำงานได้`

---

## 6. Hardware Rules (NON-NEGOTIABLE)

| # | Rule |
|---|------|
| R1 | **NEVER** restart/stop/kill/unload the Qwen daemon |
| R2 | **NEVER** `brew upgrade/reinstall` — จะลบ Web Shell patch |
| R3 | **NEVER** edit `/opt/homebrew/Cellar/qwen-code/` |
| R4 | **NEVER** print/display `.server-token` |
| R5 | **NEVER** edit `com.qwenlm.qwen-serve.plist` |
| R6 | **NEVER** bind to `0.0.0.0` — ใช้ Tailscale IP เท่านั้น |

---

## 7. Tech Stack Quick Reference

| Component | Value |
|-----------|-------|
| Repo root | `/Users/nc7foamart/NC7Studio3D` |
| Dev server | `npm run dev` → `http://localhost:5173` |
| Qwen Web UI | `https://nc7s-mac-mini.tail36564e.ts.net:4170` |
| Chrome DevTools MCP | Connected via `chrome-devtools-mcp` |

---

## 8. ประวัติการแก้ไข

| Version | วันที่ | รายละเอียด |
|---|---|---|
| 1.0 | 2026-09-09 | คำสั่ง `/Chat` และ `/Run` ครั้งแรก (โดย Cline) |
| 2.0 | 2026-09-11 | เพิ่ม `!chat`/`!run`, ภาษา Thai/ENG, 3-attempt rule, Hardware Rules |