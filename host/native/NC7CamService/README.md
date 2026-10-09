# nc7-cam-service

Small native process that speaks the WebView2 CAM protocol. The React page posts a job; `NC7WebViewHost` writes one JSON object per line to this process and streams reply lines back with `PostWebMessageAsJson`.

This build is a **skeleton** (`engine: "native-skeleton"`, `productionReady: false`):

- `rotationN`, cut mode, and cut angles match `src/lib/cutJob.js`.
- Each cutting-plane frame matches `cuttingPlane()` in `src/lib/toolpath.js`.
- Geometry is floor-settled the same way as `applyFloorSettle()`.
- Profiles and overlay contours are the convex hull of the projected vertices, **not** the production silhouette raster in `src/lib/silhouette.js`.

The page therefore keeps using `camWorker.js` until a later engine sets `productionReady: true`. Set `NC7_CAM_BACKEND=native` only to exercise the bridge.

## Build

```bash
make -C host/native/NC7CamService
# binary: host/native/NC7CamService/build/nc7-cam-service
```

Windows can use the same Makefile (MSVC/clang `c++` or `g++`) or CMake. The host looks for `nc7-cam-service.exe` next to that `build/` directory, or `NC7_CAM_SERVICE`.

## Protocol

One JSON object per line. The process writes a `hello` line on startup.

```json
{"channel":"nc7-cam","type":"hello","protocolVersion":1,"engine":"native-skeleton","engineVersion":"0.1.0","productionReady":false,"actions":["hello","ping","computeToolpath"]}
```

Request:

```json
{"id":1,"action":"computeToolpath","payload":{"geometry":{"uuid":"…","userData":{"nc7ModelRevision":0},"positionEncoding":"base64-f32le","position":"…","positionCount":72,"indexEncoding":"base64-u32le","index":"…","indexCount":36},"rotationN":16,"stock":{"w":40,"t":30,"h":40},"cutMode":"left-to-right","planePoint":[0,0,-15]}}
```

`position` may instead be a JSON array of finite numbers. `planePoint` may be omitted; the service then uses `(0, 0, -stock.t/2)`.

Replies for the same `id`:

- `{"type":"progress","done":1,"total":8}`
- `{"type":"result","status":"success","engine":"native-skeleton","cutJob":{…}}`

`cutJob` uses the worker keys: `rotationN`, `cutCount`, `mode`, `cuts`, `stock`, `sourceGeometryUuid`, `sourceModelRevision`, `overlayContourVersion`. Each cut has `index`, `thetaDeg`, `profile` (`polylines`, `pointCount`, `frame`, `source`), and `overlayContour`. `compileGcode` is intentionally absent; the page compiles G-code on the worker.

`ping` returns `{"status":"success","pong":true}`. A bad line returns `status: "error"` and the process keeps reading.

Check the protocol without WebView2:

```bash
npm run verify:cam-ipc
```
