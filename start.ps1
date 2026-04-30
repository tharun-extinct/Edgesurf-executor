# EdgeSurf Executor — Launcher
# Detects running Edge, restarts it with CDP enabled, and injects shortcuts.
# Edge auto-restores all tabs on restart — no data loss.

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

# ── Step 1: Check if CDP is already available ───────────────────────────────
$cdpReady = $false
try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json" -TimeoutSec 2 -ErrorAction Stop
    $cdpReady = $true
    Write-Host "[Launcher] Edge already running with CDP on port $Port" -ForegroundColor Green
} catch {
    $cdpReady = $false
}

# ── Step 2: If no CDP, restart Edge with debug port ─────────────────────────
if (-not $cdpReady) {
    $edgeRunning = Get-Process msedge -ErrorAction SilentlyContinue

    if ($edgeRunning) {
        Write-Host "[Launcher] Edge is running without CDP. Restarting with debug port..." -ForegroundColor Yellow
        Write-Host "[Launcher] All your tabs will be restored automatically." -ForegroundColor Yellow
        Write-Host ""

        # Gracefully close Edge (sends WM_CLOSE, allows session save)
        $edgeRunning | ForEach-Object { $_.CloseMainWindow() | Out-Null }

        # Wait for Edge to fully exit (up to 10 seconds)
        $timeout = 10
        $elapsed = 0
        while ((Get-Process msedge -ErrorAction SilentlyContinue) -and ($elapsed -lt $timeout)) {
            Start-Sleep -Milliseconds 500
            $elapsed += 0.5
        }

        # Force kill any remaining Edge processes
        Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1

        Write-Host "[Launcher] Edge closed. Relaunching with CDP on port $Port..." -ForegroundColor Cyan
    } else {
        Write-Host "[Launcher] Starting Edge with CDP on port $Port..." -ForegroundColor Cyan
    }

    # Launch Edge with debug port + open edge://surf (uses default profile — tabs restore)
    Start-Process -FilePath $edgePath -ArgumentList "--remote-debugging-port=$Port", "--restore-last-session", "edge://surf"
    Start-Sleep -Seconds 5
}

# ── Step 3: Ensure edge://surf is open ──────────────────────────────────────
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

# ── Step 4: Run injector ────────────────────────────────────────────────────
Write-Host "[Launcher] Running injector..." -ForegroundColor Cyan
Write-Host ""

$env:CDP_PORT = $Port
node "$PSScriptRoot\src\injector.js"
