#!/bin/bash
# ============================================================
# patch-workbench.sh  (เวอร์ชันตรวจสอบแล้ว — verified version)
# ------------------------------------------------------------
# เพิ่ม mobile layout (vscode-web-mobile.css) เข้าไปในหน้า workbench.html
# ที่ code serve-web โหลดจริง
#
# เขียนโดย: Cline (AI coding agent) — แก้จากร่างของ Gemini ที่ path ผิด
# ตรวจสอบแล้วบนเครื่องจริง:
#   - ไฟล์จริงอยู่ใต้ ~/.vscode/cli/serve-web/<commit>/... (ไม่ใช่ในตัวแอป)
#   - CSP อนุญาต inline <style> แต่ inline <script> ต้องมี nonce placeholder
#   - รันซ้ำได้ (idempotent) สำรองไฟล์อัตโนมัติครั้งแรก
# ============================================================
set -euo pipefail

CSS_FILE="${NC7_CSS_FILE:-/Users/nc7foamart/NC7Studio3D/tools/vscode-web-mobile/vscode-web-mobile.css}"

# ให้ override path ได้ (ใช้สำหรับทดสอบ)
WB_HTML="${WORKBENCH_HTML:-}"

if [[ -z "$WB_HTML" ]]; then
  # 1) หา commit ที่ตรงกับ CLI เวอร์ชันปัจจุบัน
  commit="$(code --version 2>/dev/null | sed -n '2p' || true)"
  if [[ -n "$commit" ]]; then
    cand="$HOME/.vscode/cli/serve-web/$commit/out/vs/code/browser/workbench/workbench.html"
    [[ -f "$cand" ]] && WB_HTML="$cand"
  fi
fi

if [[ -z "$WB_HTML" ]]; then
  # 2) fallback: ใช้ commit ล่าสุดที่มีในเครื่อง
  dir="$(ls -dt "$HOME"/.vscode/cli/serve-web/*/out/vs/code/browser/workbench 2>/dev/null | head -1 || true)"
  if [[ -n "$dir" && -f "$dir/workbench.html" ]]; then
    WB_HTML="$dir/workbench.html"
  fi
fi

if [[ -z "$WB_HTML" || ! -f "$WB_HTML" ]]; then
  echo "ERROR: หา workbench.html ไม่เจอ" >&2
  echo "       ให้รัน 'code serve-web' อย่างน้อย 1 ครั้งเพื่อดาวน์โหลด server แล้วลองใหม่" >&2
  exit 1
fi

if [[ ! -f "$CSS_FILE" ]]; then
  echo "ERROR: ไม่พบไฟล์ CSS: $CSS_FILE" >&2
  exit 1
fi

echo "Target: $WB_HTML"

# สำรองไฟล์ครั้งแรกเท่านั้น
BACKUP="${WB_HTML}.bak"
if [[ ! -f "$BACKUP" ]]; then
  cp "$WB_HTML" "$BACKUP"
  echo "Backup ครั้งแรก: $BACKUP"
fi

export NC7_WB_HTML="$WB_HTML"
export NC7_CSS_FILE="$CSS_FILE"
python3 <<'PY'
import os, re, sys

path = os.environ['NC7_WB_HTML']
css_path = os.environ['NC7_CSS_FILE']

with open(css_path, encoding='utf-8') as f:
    css = f.read()
with open(path, encoding='utf-8') as f:
    html = f.read()

# ลบของเก่าที่เคยแทรกไว้ (กันแทรกซ้ำ) — ครอบคลุมทั้งเวอร์ชันที่แทรกด้วยมือ
# และเวอร์ชันร่างแรกของ Gemini
style_re     = re.compile(r'<style id="nc7-mobile">.*?</style>', re.S)
script_ours  = re.compile(r'<script id="nc7-mobile-script".*?</script>', re.S)
script_gemini= re.compile(r'<script>.*?NC7 Mobile Layout Applied.*?</script>', re.S)

removed = 0
for rx in (style_re, script_ours, script_gemini):
    html, n = rx.subn('', html)
    removed += n

# CSS ในไฟล์ vscode-web-mobile.css มี @media มือถือครอบอยู่แล้ว -> ไม่ครอบซ้ำ
injection = (
    '\n<!-- NC7 mobile layout (patched by patch-workbench.sh) -->\n'
    '<style id="nc7-mobile">\n' + css + '\n</style>\n'
    # CSP บังคับ nonce -> ใช้ placeholder เดียวกับที่ server แทนที่ให้อัตโนมัติ
    '<script id="nc7-mobile-script" nonce="{{WORKBENCH_SCRIPT_NONCE}}">\n'
    "window.addEventListener('DOMContentLoaded', () => {\n"
    "  if (window.matchMedia('(hover: none) and (pointer: coarse) and (max-width: 1100px)').matches) {\n"
    "    console.log('[nc7] mobile layout applied');\n"
    '  }\n'
    '});\n'
    '</script>\n'
)

if '</body>' not in html:
    sys.exit('ERROR: ไม่พบ </body> ใน ' + path)

html = html.replace('</body>', injection + '</body>', 1)

with open(path, 'w', encoding='utf-8') as f:
    f.write(html)

print(f'OK: ลบของเก่าไป {removed} จุด และแทรก mobile layout แล้ว -> {path}')
PY

echo
echo "เสร็จแล้ว ถ้า code serve-web กำลังรันอยู่ ให้ restart แล้วเปิดหน้าเว็บใหม่"
echo "วิธี restart: Ctrl+C ที่หน้าต่างที่รัน server แล้วรันคำสั่ง code serve-web ใหม่"
