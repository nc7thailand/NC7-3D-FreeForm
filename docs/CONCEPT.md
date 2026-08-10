# NC7 Studio3D CAM Concept Document V2

Source of Truth ฉบับสมบูรณ์สำหรับการพัฒนา NC7 Studio3D CAM — ซอฟต์แวร์ CAM สำหรับ CNC Hot Wire Foam Cutter Machine ของ NC7

## 1. Project Overview

เป้าหมายของโปรเจกต์นี้คือการพัฒนาเว็บแอปพลิเคชัน CAM สำหรับ CNC Hot Wire Foam Cutter Machine ของ NC7 โดยเน้นการสร้าง Toolpath จากไฟล์ `.STL` สำหรับเครื่องจักรแบบ 2-Axis (X, Y) ร่วมกับ Rotary Axis และสามารถแพ็กเป็นแอปพลิเคชันเดสก์ท็อปด้วย Electron ได้ในภายหลัง

## 2. Machine & Hardware Kinematics

> * **Structure:** รองรับระบบ 2-Axis Sync (X, Y) ร่วมกับ Rotary Axis
> * **Core Geometry:** กำหนดแกน Z (Rotary) โดยมีสเกล 1 mm = 1°
> * **Coordinate System:** ใช้จุด Origin ที่ X=0, Y=0

### 2.1 นิยามค่าพารามิเตอร์

| พารามิเตอร์ | ความหมาย |
| :--- | :--- |
| **LO** | Lower Offset / Line Clearance Offset (ระยะเผื่อความปลอดภัยของเส้นลวด) |
| **BO** | Bottom Offset (ระยะเผื่อความปลอดภัยด้านล่างสุด) |

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

### Communication / Serial Interface

* (เติมรายละเอียดการเชื่อมต่อกับ CNC machine / G-code output เมื่อออกแบบเสร็จ)

## 5. Tech Stack & Tooling

> * **Engine:** Node.js/JavaScript V8 Engine ในการคำนวณเรขาคณิต
> * **3D Rendering:** Three.js + WebGL (GPU)
> * **Background Processing:** Web Workers
> * **Desktop Packaging:** Electron (ในภายหลัง)

## 6. Future Roadmap

* การเชื่อมต่อกับ CNC Machine โดยตรง (Serial/USB)
* รองรับ STL Slicing หลายชั้น (คล้าย DevFoam 3D Cut Sliced STL)
* ฟีเจอร์ Grid Cut, Tapered Cut, และ Wedges (อ้างอิงจาก DevFoam 3)
* AI-assisted toolpath optimization
