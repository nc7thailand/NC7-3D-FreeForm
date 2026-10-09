param(
  [ValidateSet(4096, 8192)]
  [int]$HeapMB = 4096,
  [string]$AppUrl = "http://localhost:5173/"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Write-Host ""
Write-Host "NC7 WebView2 heap test"
Write-Host "======================"
Write-Host "Heap cap: ${HeapMB} MB"
Write-Host "App URL:  $AppUrl"
Write-Host ""

$env:NC7_WEBVIEW_HEAP_MB = "$HeapMB"
$env:NC7_APP_URL = $AppUrl

Push-Location $Root
try {
  dotnet run --project (Join-Path $Root "host/webview2/NC7WebViewHost")
} finally {
  Pop-Location
}
