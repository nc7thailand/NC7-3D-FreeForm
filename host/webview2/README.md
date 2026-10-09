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
| `NC7_CAM_SERVICE` | Path to `nc7-cam-service` (default: search `host/native/NC7CamService/build/`) |
| `NC7_CAM_BACKEND` | Force the page backend: `worker` (default), `native`, or `main` |

## Native CAM IPC

The host bridges `window.chrome.webview` messages on channel `nc7-cam` to a separate **nc7-cam-service** process (newline-delimited JSON). The page chooses a backend in `src/lib/camBackend.js`:

| Backend | When |
|---------|------|
| `worker` | Default. Also used inside WebView2 while the native engine reports `productionReady: false`. |
| `native` | WebView2 is present **and** the service hello says `productionReady: true`, or `NC7_CAM_BACKEND=native`. |
| `main` | No `Worker` and no production-ready native service. |

The current C++ service is a **skeleton**. It returns the same `cutJob` keys as `camWorker.js` (angles, cutting-plane frames, stock, overlay version) but the polylines are a convex-hull stand-in, not the production silhouette raster. Leave `productionReady` false until that raster is ported; forcing `native` is for protocol checks only.

Build the service, then point the host at it:

```powershell
make -C host/native/NC7CamService
$env:NC7_CAM_SERVICE = "host/native/NC7CamService/build/nc7-cam-service.exe"
$env:NC7_CAM_BACKEND = "native"   # optional; exercises the skeleton
dotnet run --project host/webview2/NC7WebViewHost
```

Protocol details: `host/native/NC7CamService/README.md`.

## Crash reproduction checklist

1. Import a 10–20 MB STL or dense mesh (>50k tris → auto-simplify).
2. Run full toolpath (N=16) and open Simulate + G-code preview.
3. Note whether tab/process survives at 4096 MB; retry at 8192 MB.
4. Inspect telemetry in DevTools console: `window.__NC7_TELEMETRY__`

## macOS / Linux dev

WebView2 runs on Windows only. On macOS, build the native service and check the IPC protocol with `npm run verify:cam-ipc` (worker fallback is what the page uses unless `NC7_CAM_BACKEND=native`). For browser heap testing:

```bash
./scripts/launch-edge-heap-test.sh 4096
```

Requires [Microsoft Edge](https://www.microsoft.com/edge) installed.
