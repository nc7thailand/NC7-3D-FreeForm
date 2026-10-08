# NC7 WebView2 Desktop Shell (POC)

Windows-only host that wraps the Vite/React frontend in **Microsoft Edge WebView2** with a configurable V8 heap cap.

## Quick start (Windows)

```powershell
# 1. Build the web app
cd ..\..
npm run build

# 2. Run dev server (optional — host defaults to http://localhost:5173/)
npm run dev

# 3. Launch WebView2 host — test 4096 MB heap
$env:NC7_WEBVIEW_HEAP_MB = "4096"
$env:NC7_APP_URL = "http://localhost:5173/"
dotnet run --project host/webview2/NC7WebViewHost

# 4. Repeat crash reproduction with 8192 MB
$env:NC7_WEBVIEW_HEAP_MB = "8192"
dotnet run --project host/webview2/NC7WebViewHost
```

Or use the helper script:

```powershell
.\scripts\webview2-heap-test.ps1 -HeapMB 4096
.\scripts\webview2-heap-test.ps1 -HeapMB 8192
```

## Environment variables

| Variable | Purpose |
|----------|---------|
| `NC7_WEBVIEW_HEAP_MB` | V8 old-space cap via `--js-flags=--max-old-space-size=N` (try **4096** or **8192**) |
| `NC7_APP_URL` | URL to load (default: `http://localhost:5173/`, else packaged `dist/index.html`) |

## Crash reproduction checklist

1. Import a 10–20 MB STL or dense mesh (>50k tris → auto-simplify).
2. Run full toolpath (N=16) and open Simulate + G-code preview.
3. Note whether tab/process survives at 4096 MB; retry at 8192 MB.
4. Inspect telemetry in DevTools console: `window.__NC7_TELEMETRY__`

## macOS / Linux dev

WebView2 runs on Windows only. For local browser testing on macOS use Edge/Chromium flags:

```bash
./scripts/launch-edge-heap-test.sh 4096
```

Requires [Microsoft Edge](https://www.microsoft.com/edge) installed.
