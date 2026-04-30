# EdgeSurf Executor — Launcher
# Opens Edge in debug mode with your profile, loads only edge://surf (no homepage).

param(
    [int]$Port = 9222
)

$edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edgePath)) {
    $edgePath = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
}

if (-not (Test-Path $edgePath)) {
    Write-Error "Microsoft Edge not found. Please update the path in this script."
    exit 1
}

$userDataDir = "C:/Users/<user_name>/AppData/Local/Microsoft/Edge/User Data"

# Check if CDP port is already listening
$cdpReady = $false
try {
    $null = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json" -TimeoutSec 2 -ErrorAction Stop
    $cdpReady = $true
    Write-Host "[Launcher] Edge already running with CDP on port $Port" -ForegroundColor Green
} catch {
    $cdpReady = $false
}

if (-not $cdpReady) {
    Write-Host "[Launcher] Launching Edge (debug mode, port $Port)..." -ForegroundColor Cyan

    Start-Process -FilePath $edgePath -ArgumentList @(
        "--remote-debugging-port=$Port"
        "--user-data-dir=$userDataDir"
        "--no-first-run"
        "--no-default-browser-check"
        "--restore-last-session=false"
        "--homepage=about:blank"
        "--no-startup-window"
    )

    # Wait for Edge to start, then open only edge://surf
    Start-Sleep -Seconds 3
    Start-Process -FilePath $edgePath -ArgumentList @(
        "--user-data-dir=$userDataDir"
        "edge://surf"
    )
    Start-Sleep -Seconds 3
}

Write-Host "[Launcher] Running injector..." -ForegroundColor Cyan
Write-Host ""

$env:CDP_PORT = $Port
node "$PSScriptRoot\src\injector.js"
