# คู่มือ: ทำ VS Code Web แบบ Self-hosted บน Mac + Tailscale
### สำหรับเปิดจากมือถือ (เช่น Samsung S26 Ultra) และปรับ Layout เฉพาะมือถือ

**ผู้เขียน:** Cline (AI coding agent)
**วันที่:** 2026-09-06
**เครื่องที่ใช้เขียนคู่มือ:** macOS, VS Code CLI 1.136 (อยู่ที่ `/usr/local/bin/code`), ติดตั้ง Tailscale และรันอยู่แล้ว

---

## เป้าหมาย
1. รัน VS Code Web บนเครื่อง Mac ของเราเอง (ไม่พึ่งหน้า vscode.dev ที่ Microsoft โฮสต์)
2. ให้มือถือเข้าถึงผ่าน **Tailscale** (ใช้เบราว์เซอร์อะไรก็ได้ เช่น Samsung Internet — ไม่ต้องลง Kiwi/Stylus)
3. ฉีด CSS/JS เข้าหน้าเว็บนี้ได้ **โดยตรง** เพื่อให้ Layout เปลี่ยนเฉพาะตอนเปิดจากมือถือ ส่วน Desktop ยังเป็นแบบเดิม

> เหตุผล: หน้า vscode.dev เป็นของ Microsoft ฉีด CSS ไม่ได้ แต่ถ้าเรา serve เอง เราควบคุม HTML ที่โหลดได้ทั้งหมด → แก้ Layout ได้จริง

---

## ส่วนที่ 1 — ตรวจสอบ Tailscale

เปิด Terminal บน Mac แล้วรัน:

    tailscale status
    tailscale ip -4

- จำค่า IP ที่ขึ้นต้นด้วย `100.x.y.z` ไว้ เรียกมันว่า `<TAILSCALE_IP>`
- บนมือถือ S26 Ultra: ติดตั้งแอป **Tailscale** จาก Play Store แล้วล็อกอินด้วย**บัญชีเดียวกัน** เปิด VPN ค้างไว้
- ทดสอบ: เปิด Samsung Internet ไปที่ `http://<TAILSCALE_IP>:8000` (ยังไม่ต้องมีอะไรตอบก็ได้ แค่ให้เห็นว่าเข้าได้)

---

## ส่วนที่ 2 — รัน VS Code Web Server

1. สร้าง secret token เอาไว้กันคนอื่นเข้าถึง เช่น:

    export VS_WEB_TOKEN="เปลี่ยนเป็นรหัสยาว ๆ ของคุณ"

2. รันเซิร์ฟเวอร์ โดย **ผูกกับ IP ของ Tailscale เท่านั้น** (ไม่ใช้ 0.0.0.0 เพื่อไม่เปิดออกสู่ LAN/Wi-Fi สาธารณะ):

    code serve-web \
      --host <TAILSCALE_IP> \
      --port 8000 \
      --connection-token "$VS_WEB_TOKEN" \
      --accept-server-license-terms

   ตัวอย่างจริง:

    code serve-web --host 100.64.0.5 --port 8000 --connection-token "mysecret123" --accept-server-license-terms

   หมายเหตุ: คำสั่งที่ถูกต้องคือ `code serve-web` เท่านั้น (ถ้าพิมพ์ `code tunnel serve-web` จะ error เพราะ CLI แยกคำสั่ง `tunnel` กับ `serve-web` คนละตัว)

3. ถ้า macOS ถามให้อนุญาตรับ connection ผ่าน firewall → กด Allow
4. เปิดจากมือถือ (Samsung Internet ได้เลย):

    http://<TAILSCALE_IP>:8000/?tkn=<VS_WEB_TOKEN>

5. ถ้าอยากให้เปิดเป็น "แอป" เต็มจอ: ใน Samsung Internet เลือก **Add to Home screen** เพื่อเก็บ URL นี้ไว้

**ข้อควรรู้:**
- คำสั่งนี้ต้องรันค้างไว้ ถ้าปิด Terminal เซิร์ฟเวอร์จะหยุด ให้ Gemini ช่วยสร้าง **launchd plist** (บริการ autostart) ให้ด้วย
- รันพร้อม Remote Tunnels เดิม (`code tunnel agent host`) ได้ ไม่ขัดกัน เพราะเป็นเซิร์ฟเวอร์คนละตัว แต่ถ้าใช้งานพร้อมกันอาจมี extension host 2 ตัว — ถ้าเห็นอะไรผิดปกติ ให้ใช้ทีละตัว

---

## ส่วนที่ 3 — ฉีด CSS/JS เพื่อ Layout เฉพาะมือถือ

VS Code Web จะ serve หน้า workbench จากไฟล์จริงที่อยู่ใต้โฟลเดอร์เซิร์ฟเวอร์ของ CLI (**ไม่ใช่** ในตัวแอป /Applications):

    ~/.vscode/cli/serve-web/<commit>/out/vs/code/browser/workbench/workbench.html

- หาค่า `<commit>` ได้จากบรรทัดที่ 2 ของคำสั่ง `code --version`
- ตัวอย่างจริงบนเครื่องนี้ (VS Code 1.136):
  `~/.vscode/cli/serve-web/a44adf7f53e00964ab890f9f8758a334f1fc15bc/out/vs/code/browser/workbench/workbench.html`
- **แนะนำให้ใช้สคริปต์ `patch-workbench.sh` ที่ตรวจ path ให้อัตโนมัติ** (อยู่ในโฟลเดอร์เดียวกับไฟล์นี้) แทนการแก้มือ

### ขั้นตอน (แก้ด้วยมือ ถ้าต้องการ)
1. สำรองไฟล์ก่อนแก้เสมอ (ไฟล์นี้อยู่ใน home ของเรา → **ไม่ต้องใช้ sudo**):

    cp ~/.vscode/cli/serve-web/<commit>/out/vs/code/browser/workbench/workbench.html ~/.vscode/cli/serve-web/<commit>/out/vs/code/browser/workbench/workbench.html.bak

2. เปิดไฟล์ด้วย editor:

    nano ~/.vscode/cli/serve-web/<commit>/out/vs/code/browser/workbench/workbench.html

3. หาตำแหน่ง `</body>` แล้วแทรก `<style>` ก่อนบรรทัดนั้น (CSS จากไฟล์ `vscode-web-mobile.css` **มี media query ครอบอยู่แล้ว** ไม่ต้องครอบซ้ำ):

    <style id="nc7-mobile">
      /* วางเนื้อหา CSS ทั้งหมดจากไฟล์ vscode-web-mobile.css ตรงนี้ (ทั้งไฟล์ รวม @media ข้างใน) */
    </style>

   - CSS ที่ทดสอบแล้วกับ VS Code Web 1.136 อยู่ในไฟล์:
     `/Users/nc7foamart/NC7Studio3D/tools/vscode-web-mobile/vscode-web-mobile.css`
   - ตรวจสอบแล้ว: CSP ของหน้าเว็บอนุญาต inline `<style>` ได้ (`style-src 'unsafe-inline'`) จึงไม่ต้อง nonce

4. (ไม่บังคับ) ถ้าจะเพิ่ม `<script>` เอง ระวัง: CSP บังคับ inline script ต้องมี nonce → ต้องใส่ attribute `nonce="{{WORKBENCH_SCRIPT_NONCE}}"` (เซิร์ฟเวอร์จะแทนที่ค่าให้อัตโนมัติทุกครั้งที่เสิร์ฟ) เช่น:

    <script id="nc7-mobile-script" nonce="{{WORKBENCH_SCRIPT_NONCE}}">
    window.addEventListener('DOMContentLoaded', () => {
      if (window.matchMedia('(hover: none) and (pointer: coarse) and (max-width: 1100px)').matches) {
        console.log('[nc7] mobile layout applied');
      }
    });
    </script>

5. บันทึก ปิด แล้ว restart เซิร์ฟเวอร์ `code serve-web` และเปิดหน้าเว็บจากมือถือใหม่ (refresh) → Layout มือถือควรทำงาน
6. เปิดจาก Mac/Desktop browser → ควรเป็น Layout ปกติเหมือนเดิม (เพราะ media query ไม่ผ่าน)

> ⚠️ เวลาอัปเดต VS Code จะมีโฟลเดอร์ `<commit>` ใหม่ → ต้องรัน `patch-workbench.sh` ซ้ำอีกครั้ง

---

## ส่วนที่ 4 — วิธีทดสอบ
- Desktop: เปิด `http://127.0.0.1:8000/?tkn=<VS_WEB_TOKEN>` บน Mac → ต้องได้ Layout ปกติ
- มือถือแนวตั้ง: เปิดผ่าน Tailscale → ต้องได้ Layout แบบจอสัมผัส (title bar เล็กลง, ปุ่ม activity bar ใหญ่ขึ้น, ไม่มีช่องว่างรอบ panel)
- มือถือแนวนอน (หมุนจอ): ยังต้องได้ Layout มือถือ เพราะความกว้าง ≤ 1100px
- เปิด "Desktop site" ในเบราว์เซอร์มือถือ: ถ้าหน้าจอกว้างเกิน 1100px CSS จะไม่ทำงาน (เป็นไปตามการออกแบบ)

---

## ส่วนที่ 5 — ความปลอดภัยและข้อควรระวัง
- `--connection-token` คือกุญแจสำคัญ ห้ามแชร์ ควรใช้รหัสยาวสุ่ม
- ใช้ `--host` เป็น IP Tailscale (100.x) ไม่ใช่ `0.0.0.0` เพื่อไม่เปิดสู่เครือข่ายอื่น
- ถ้าต้องการให้คนอื่นเข้าถึงได้ ใช้ Tailscale "Share" หรือ ACL แทนการเปิดพอร์ตสาธารณะ
- การแก้ `workbench.html` ภายในตัวแอป VS Code **จะถูกทับเมื่ออัปเดต VS Code** → หลังอัปเดตต้องแทรกใหม่ (เก็บโค้ดไว้ในไฟล์แยก แล้วค่อยวาง)
- ไม่แนะนำให้แก้ไฟล์ในตัวแอปถ้าไม่ยอมรับข้อจำกัดข้างต้น — ทางเลือกที่สะอาดกว่าคือให้ Gemini แนะนำการรันจาก code-server/สำเนาแยก

---

## ส่วนที่ 6 — ไฟล์อ้างอิงบนเครื่องนี้
- CSS ต้นฉบับที่ทดสอบแล้ว: `/Users/nc7foamart/NC7Studio3D/tools/vscode-web-mobile/vscode-web-mobile.css`
- README ภาษาอังกฤษ (วิธีใช้กับ vscode.dev + วิธี self-host): `/Users/nc7foamart/NC7Studio3D/tools/vscode-web-mobile/README.md`

---

## สิ่งที่ขอให้ Gemini ช่วยทำต่อ
1. อ่านไฟล์ `vscode-web-mobile.css` แล้วรวมเนื้อหาเข้ากับ `<style>` ในส่วนที่ 3
2. สร้าง **launchd plist** สำหรับให้ `code tunnel serve-web` รันอัตโนมัติเมื่อเปิดเครื่อง (KeepAlive) พร้อมวิธีโหลด/ทดสอบ
3. เขียนสคริปต์ `patch-workbench.sh` ที่สำรองไฟล์ + แทรก `<style>`/`<script>` ให้อัตโนมัติ (กันพลาดตอนทำมือ)
4. เขียน `<script>` สำหรับปิด Secondary Side Bar อัตโนมัติเฉพาะมือถือ (ถ้าทำได้โดยไม่พัง)
