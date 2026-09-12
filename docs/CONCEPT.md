# NC7 Studio3D CAM Concept Document V2

Source of Truth ฉบับสมบูรณ์สำหรับการพัฒนา NC7 Studio3D CAM — ซอฟต์แวร์ CAM สำหรับ CNC Hot Wire Foam Cutter Machine ของ NC7

## 1. Project Overview

เป้าหมายของโปรเจกต์นี้คือการพัฒนาเว็บแอปพลิเคชัน CAM สำหรับ CNC Hot Wire Foam Cutter Machine ของ NC7 โดยเน้นการสร้าง Toolpath จากไฟล์ `.STL` สำหรับเครื่องจักรแบบ 2-Axis (X, Y) ร่วมกับ Rotary Axis และสามารถแพ็กเป็นแอปพลิเคชันเดสก์ท็อปด้วย Electron ได้ในภายหลัง

## 2. Machine & Hardware Kinematics

> * **Structure:** 2-Axis Sync (X1=X2, Y1=Y2 — towers always sync; no taper)
> * **Core Geometry:** แกน Z (Rotary) สเกล **1 mm G-code = 1°**; หมุน **Z+ only (CW)**; ช่วง **0–360°**
> * **Coordinate System:**
>   * **X** = แนวนอน; Origin X = ศูนย์กลาง turntable
>   * **Y** = แนวตั้ง; Origin Y v1 = **ฐานก้อนโฟม** (Y=0 ที่ด้านล่าง)
>   * **Z** = หมุนโต๊ะ

### 2.1 นิยามค่าพารามิเตอร์

| พารามิเตอร์ | ความหมาย |
| :--- | :--- |
| **LO** | Lower Offset / Line Clearance Offset (ระยะเผื่อความปลอดภัยของเส้นลวด) |
| **BO** | Bottom Offset (ระยะเผื่อความปลอดภัยด้านล่างสุด; default **1 mm**, user editable) |
| **Kerf** | ชดเชยเส้นผ่านศูนย์กลางลวด (default **2 mm**, user editable) |
| **topOffset** | ระยะ top safe สูงกว่ายอดก้อน (default **20 mm**, user editable) |

### 2.2 Cut Mode v1 — Method 1 (LOCKED)

> **Method 1** — ตัด **ด้านซ้ายเท่านั้น** (Left single step per rotation); **X ติดลบตลอด** profile cut  
> Method 2 (Left + Right full silhouette) = **v2 only**

ลำดับตัดต่อ 1 rotation step:

1. Lead-in → profile cut (X &lt; 0)
2. Top safe — ดึงลวด **Y ↑** ออกเหนือก้อน
3. Retract X ออกจาก silhouette
4. Index — `G1 Z+={360/N} F160` (G93 inverse time)

Preview 2D = **WYSIWYG** (เส้นแดงซ้าย = ตัดซ้ายจริง; ไม่ mirror แบบ DevFoam detect view)

### 2.3 Safe Points v1 (LOCKED)

| จุด | มุม Z | สูตร Y |
| :--- | :--- | :--- |
| **Top safe** | 90° (fixed v1) | **Y = H + topOffset** (relative จากฐานก้อน; ไม่ใช่ absolute machine mm) |
| **Bottom safe (LB)** | 0° (fixed v1) | `LB(θ) = Block_Bottom_Extent(θ) + BO`; v2: auto default `hypot(W,T,H)/2 + 20` |

**topOffset** คือระยะเหนือยอดก้อน (default 20 mm) — ใน DevFoam sample อาจเห็นค่า Y สูงกว่า เพราะมี block Y-offset แยก; NC7 ใช้ origin ที่ฐานก้อน ดังนั้น top safe = **H + topOffset** โดยตรง

### 2.4 G-code Output v1 (LOCKED)

| หัวข้อ | ค่า |
| :--- | :--- |
| **Units / mode** | `G90 G21` absolute mm |
| **Feed mode** | **`G93` inverse time** (ไม่ใช้ G94 mm/min) |
| **Axes** | X, Y, Z เท่านั้น (ไม่มี U/V) |
| **Spindle** | `S1000` + `M3` start / `M5` stop |
| **Cut order** | จาก **บน → ล่าง** (top first) |
| **End** | `M5`, `G30` |

อ้างอิงรูปแบบจาก DevFoam `Example/StackedCut.nc` แต่ NC7 export **Method 1 เท่านั้น** (ไม่มี pass ด้านขวา). ดู `docs/DevFoamLogic.md` สำหรับ logic ฉบับเต็มและตัวอย่าง Left-Right

## 3. Core Features

### 3.1 SPA Architecture & 3 Main Sections Layout

| Section | ชื่อองค์ประกอบ | หน้าที่หลัก |
| :--- | :--- | :--- |
| **Section 1** | ControlPanel | รับค่า Input (Width, Thickness, Height, LO), สไลเดอร์มุม, และ Action Buttons (Apply, Cut, Cancel, Help) |
| **Section 2** | PathPreviewCanvas | แสดงผล 2D Toolpath, Block Boundary (BB), จุด Safe Points (LB), และ Left-Side Cut WYSIWYG |
| **Section 3** | ModelViewport3D | แสดงโมเดล 3D (.STL) แบบคงที่ พร้อมระนาบตัด (Cutting Plane) แบบหมุนตามสไลเดอร์ |

### 3.2 Mathematical Optimization & Killer Features

#### 3.2.1 Dynamic Block Boundary (BB) Rotation
> * กรอบสี่เหลี่ยมก้อนโฟม (BB) จะหมุน (Rotate) ตามมุม θ (Angle Slider) แบบ Real-time บน Section 2

#### 3.2.2 Dynamic Angle-Bound Bottom Safe Point (LB)
> * สูตรคำนวณตำแหน่งจุดถอยลวดล่างสุด (LB) ที่ปรับเปลี่ยนค่าอัตโนมัติสัมพันธ์กับมุมหมุนและความกว้าง/หนาของก้อนโฟม เพื่อลดระยะวิ่งฟรี (Air-Cutting):
> * Block_Bottom_Extent(θ) = |(Width / 2) * sin(θ)| + |(Thickness / 2) * cos(θ)| + LO
> * LB(θ) = Block_Bottom_Extent(θ) + BO

#### 3.2.3 Cross-Section Plane Sync
> * **Section 3 (3D):** โมเดล STL อยู่นิ่ง แต่ระนาบตัด (Cutting Plane) หมุนตามค่า θ
> * **Section 2 (2D):** เส้นตัดที่เกิดขึ้นจากการ slice จะอัปเดตบน Canvas ทันทีที่สไลเดอร์เปลี่ยน เพื่อให้ผู้ใช้เห็น Toolpath ที่ถูกต้องในแต่ละองศา

## 4. System Architecture

### Frontend (SPA)

* **Section 1 — ControlPanel:** ส่วนควบคุม input และ action
* **Section 2 — PathPreviewCanvas:** แสดงผล toolpath 2D แบบ WYSIWYG
* **Section 3 — ModelViewport3D:** เรนเดอร์โมเดล 3D และระนาบตัด

### Backend

* Node.js/JavaScript V8 Engine สำหรับการคำนวณเรขาคณิต (ระดับมิลลิวินาที)
* ใช้ Web Workers เพื่อจัดการคำนวณหนักใน Background
* ใช้ GPU ผ่าน Three.js/WebGL สำหรับการเรนเดอร์ 3D ให้ UI ลื่นไหลที่ 60 FPS

### Communication / Output

* G-code post-processor ตาม §2.4 (G93, Method 1, top safe = H + topOffset)
* Output = ไฟล์ `.nc` ที่ผู้ใช้ดาวน์โหลดไปโหลดเข้าเครื่องเอง — แอปนี้ **ไม่คุยกับเครื่องโดยตรง**

## 5. Tech Stack & Tooling

> * **Engine:** Node.js/JavaScript V8 Engine ในการคำนวณเรขาคณิต
> * **3D Rendering:** Three.js + WebGL (GPU)
> * **Background Processing:** Web Workers
> * **Desktop Packaging:** Electron (ในภายหลัง)

## 6. ขอบเขตของแอป (LOCKED)

NC7 Studio3D เป็น **CAM software** — ไม่ใช่ machine controller

| | |
| :--- | :--- |
| **คือ** | เครื่องมือสร้าง G-code จากโมเดล STL สำหรับเครื่องลวดร้อน NC7 |
| **ไม่ใช่** | โปรแกรมควบคุมเครื่อง, ไม่มี jog / homing / feed override |
| **ห้ามมี** | Serial/USB ต่อเครื่องจริง, machine control ใดๆ |
| **แกนที่รองรับ** | 2-axis (X, Y) + 1 rotary axis (Z) เท่านั้น |
| **ห้ามมี** | Grid Cut, Tapered Cut, Wedges — เครื่อง NC7 ทำไม่ได้ |
| **ไม่ใช่** | 3D-printer slicer — ไม่ได้ slice เป็นชั้นๆ แบบ FDM<br>แต่ใช้ **ray casting** ฉายเงา (silhouette) ลงระนาบตัด เพื่อหาเส้นตัด |
| **Output** | ไฟล์ `.nc` ให้ผู้ใช้ดาวน์โหลดไปโหลดเข้าเครื่องเอง |

## 7. กติกาการคำนวณ (NON-NEGOTIABLE)

> **ทุกขั้นตอนการคำนวณใน `src/` ต้องเป็น mathematical function ล้วน**

| ข้อ | กติกา |
| :--- | :--- |
| 1 | **ห้ามเรียก AI API / model inference** ในตัวแอปที่ส่งมอบ |
| 2 | **ห้ามพึ่ง network** — ต้องทำงานได้ตอนไม่มีเน็ต |
| 3 | **Deterministic** — input เดิม ต้องได้ G-code เดิมเสมอ |
| 4 | **Reproducible** — เปิดโปรเจกต์เก่า ต้องได้ toolpath เดิม |
| 5 | **Explainable** — ช่างต้องอธิบายได้ว่าค่านี้มาจากสูตรไหน |

AI ใช้ได้เฉพาะ **ตอนพัฒนา** (ช่วยเขียนสูตรคณิตศาสตร์) — ผลผลิตที่ส่งมอบต้องเป็น
คณิตศาสตร์บริสุทธิ์ที่รันได้เอง รายละเอียด pipeline ดู `docs/ARCHITECTURE.md`

## 8. Future Roadmap

* **Toolpath optimization แบบ deterministic** — ลด air-cut distance
  * เริ่มจากงานง่าย → ยาก (step by step)
  * ต้องเป็นคณิตศาสตร์ล้วน ไม่พึ่ง AI/machine learning
