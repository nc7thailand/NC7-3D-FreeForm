# VS Code for the Web — mobile stylesheet (S26 Ultra)

You reach VS Code from your Samsung S26 Ultra through the official
**Remote Tunnels** service, i.e. you open a URL like
`https://vscode.dev/tunnel/<your-mac-name>` in the phone browser.

This folder contains `vscode-web-mobile.css` — a stylesheet that changes the
VS Code *workbench layout* **only when VS Code is used from a phone**.

---

## 1. The important constraint (read this first)

`vscode.dev` is hosted by Microsoft. A stylesheet you keep on your Mac can
**never** reach it. The style has to be injected by the **browser on the phone** —
which is actually a good thing here, because it automatically means:

- The layout changes **only on the phone**, never on your Mac or any desktop.
- Nothing is installed or patched on your Mac, and VS Code updates can't break it.

The stylesheet itself is also wrapped in a *mobile media query*
(`hover: none` + `pointer: coarse` + `max-width: 1100px`), so even if you load
it in a desktop browser it stays dormant there — it only fires on a touch
phone in portrait or landscape.

### What CSS can and cannot do to VS Code's layout
The workbench panel geometry (which sidebars exist, their pixel widths, editor
splits) is owned by VS Code's **JavaScript layout engine**; your CSS cannot
re-partition panels. What the stylesheet *can* and *does* do:

| Change | Effect |
|---|---|
| 32px title bar | a few extra pixels of code height |
| flush panels / no floating-card gutters | no wasted ~4px gutters on every side |
| 46px activity-bar touch cells | much easier icon tapping on the phone |
| capped Command-Center pill | title row stays usable on a 412px screen |
| trimmed editor chrome padding | slightly more room for the editor |

Panels you want **closed** on the phone (e.g. the secondary side bar on the
right) can't be force-closed by CSS — do it once with ☰ → **View → Appearance →
Toggle Secondary Side Bar**, and VS Code remembers it.

---

## 2. Install it (official tunnel route)

Samsung Internet cannot inject custom page CSS, so use a browser that can.

### Recommended: Kiwi Browser + Stylus
1. On the S26 Ultra, install **Kiwi Browser** (Play Store) — a Chromium browser
   that runs desktop Chrome extensions.
2. Open Kiwi → visit the Chrome Web Store and install **Stylus**
   (or search `stylus`; publisher "Stylus Team").
3. In Kiwi, open your tunnel: `https://vscode.dev/tunnel/<your-mac-name>`.
4. Tap the **Stylus** icon → **Write style for this site** (if you don't see
   the icon, Stylus → open Stylus dashboard → "Write new style").
5. Give it a name, e.g. `vscode.dev mobile layout`.
   - **Applies to:** set to URLs starting with `https://vscode.dev/`
   - Paste the entire contents of `vscode-web-mobile.css` into the code box.
6. Save / enable. Refresh vscode.dev and the phone layout is active.

Alternative browser: **Firefox for Android** also supports the Stylus add-on,
with the same steps (Firefox → Add-ons → Stylus).

### Verify + tweak
- Rotate the phone and reload: both portrait and landscape (≤ 1100 CSS px)
  should apply the style.
- If something looks off after a VS Code update, open vscode.dev, tap the
  ☰ menu → **Help → Toggle Developer Tools**, right-click the element you want
  to change → Copy selector, and adjust the stylesheet. (Developer Tools is a
  normal Chrome devtools panel in Kiwi.)

### Bonus tips for the phone
- **Add vscode.dev to the home screen** in Kiwi → it then opens full-screen
  like an app, and the tunnel URL is saved.
- Bigger code font? That's an editor setting (gear icon → Font Size), not CSS.
- If you own a Bluetooth keyboard, `Cmd/Ctrl+B` toggles the explorer sidebar
  and `Cmd/Ctrl+Alt+B` toggles the secondary side bar — handy to maximize code.

---

## 3. Optional deeper route: serve VS Code from your Mac (full layout control)

If you ever want *true* per-device panel layout (auto-close the secondary
sidebar, auto-hide the activity bar, etc.), the only way is to serve the web
UI yourself, because then you control the page that is loaded. Your Mac
already runs Tailscale, so this works with any browser including Samsung
Internet:

```bash
# on your Mac — run a second, self-hosted web instance
# NOTE: the correct command is "code serve-web" (NOT "code tunnel serve-web")
code serve-web --host 0.0.0.0 --port 8000 \
  --connection-token <a-secret> --accept-server-license-terms
```

Then open `http://<your-mac-tailscale-ip>:8000/?tkn=<a-secret>` on the phone.

### Where the served page actually lives (verified on disk)

The CLI downloads its own server build under your home folder — the workbench
page is **not** inside the `/Applications/Visual Studio Code.app` bundle:

```
~/.vscode/cli/serve-web/<commit>/out/vs/code/browser/workbench/workbench.html
```

Get `<commit>` from the 2nd line of `code --version`. On this Mac (VS Code
1.136) it is `a44adf7f53e00964ab890f9f8758a334f1fc15bc`.

### Patching (use the ready-made script)

Run `patch-workbench.sh` from this folder — it auto-locates the file by
commit, backs it up once, and injects a `<style id="nc7-mobile">` (with the
whole `vscode-web-mobile.css` content) plus an optional marked `<script>`
before `</body>`. It is idempotent (safe to re-run).

Manual edit, if you prefer: back the file up, insert before `</body>`:

```html
<style id="nc7-mobile">
  <!-- paste the full contents of vscode-web-mobile.css here (it already
       contains its own @media mobile query — do not wrap it again) -->
</style>
```

Verified facts about this page:
- CSP header allows inline `<style>` (`style-src 'unsafe-inline'`) — no nonce
  needed for CSS.
- CSP `script-src` uses `'nonce-...'` → any inline `<script>` you add **must**
  carry `nonce="{{WORKBENCH_SCRIPT_NONCE}}"`; the server substitutes a valid
  per-request nonce (placeholders are replaced globally).

Caveats: a VS Code update creates a **new** `<commit>` folder, so re-run
`patch-workbench.sh` after updates. Restart `code serve-web` after patching.

---

## Files
- `vscode-web-mobile.css` — the stylesheet. Tested against VS Code Web 1.136.x
  DOM in a 412 × 915 CSS-px (S26 Ultra-class) viewport.
