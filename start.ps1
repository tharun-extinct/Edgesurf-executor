# EdgeSurf Executor — Launcher
# Launches Edge with CDP enabled, opens edge://surf, and runs the injector.

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

# Check if CDP port is already listening (Edge already running with debug port)
$cdpReady = $false
try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json" -TimeoutSec 2 -ErrorAction Stop
    $cdpReady = $true
    Write-Host "[Launcher] Edge already running with CDP on port $Port" -ForegroundColor Green
} catch {
    $cdpReady = $false
}

if (-not $cdpReady) {
    Write-Host "[Launcher] Starting Edge with --remote-debugging-port=$Port ..." -ForegroundColor Cyan
    # Use a separate user-data-dir if Edge is already running without the debug flag
    $edgeRunning = Get-Process msedge -ErrorAction SilentlyContinue
    if ($edgeRunning) {
        Write-Host "[Launcher] Edge is already running. Using separate profile to enable CDP." -ForegroundColor Yellow
        $tempProfile = Join-Path $env:TEMP "EdgeSurf-CDP-Profile"
        Start-Process -FilePath $edgePath -ArgumentList "--remote-debugging-port=$Port", "--user-data-dir=$tempProfile", "edge://surf"
    } else {
        Start-Process -FilePath $edgePath -ArgumentList "--remote-debugging-port=$Port", "edge://surf"
    }
    Start-Sleep -Seconds 5
}

# Ensure edge://surf is open — navigate if needed
try {
    $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json" -ErrorAction Stop
    $hasSurf = $targets | Where-Object { $_.url -like "*surf*" }
    if (-not $hasSurf) {
        Write-Host "[Launcher] Opening edge://surf tab..." -ForegroundColor Cyan
        Start-Process -FilePath $edgePath -ArgumentList "edge://surf"
        Start-Sleep -Seconds 3
    }
} catch {
    Write-Host "[Launcher] Warning: Could not verify edge://surf tab" -ForegroundColor Yellow
}

Write-Host "[Launcher] Running injector..." -ForegroundColor Cyan

$env:CDP_PORT = $Port
node "$PSScriptRoot\src\injector.js"
