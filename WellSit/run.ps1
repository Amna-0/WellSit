# Convenience launcher for PostureCare.
# Starts a local static file server (needed because camera access + ES modules
# require an http:// origin, not file://) and opens the app in your browser.

$port = 5500
$root = $PSScriptRoot

Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "Set-Location `"$root`"; Write-Host 'PostureCare server running at http://localhost:$port/  (close this window to stop)' -ForegroundColor Cyan; py -m http.server $port"
)

Start-Sleep -Seconds 1
Start-Process "http://localhost:$port/index.html"
