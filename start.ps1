$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Starting Resume Matcher..." -ForegroundColor Cyan

# 1. Redis (WSL)
Write-Host "[1/4] Starting Redis..." -ForegroundColor Yellow
wsl -e bash -c "sudo service redis-server start 2>/dev/null; redis-cli ping" | Out-Null

# 2. Backend
Write-Host "[2/4] Starting backend on http://localhost:10000 ..." -ForegroundColor Yellow
Start-Process -WindowStyle Normal -FilePath "powershell" -ArgumentList @(
  "-NoExit", "-Command",
  "Set-Location '$root\backend'; .\.venv\Scripts\Activate.ps1; `$env:PYTHONPATH=(Get-Location); uvicorn app.main:app --host 0.0.0.0 --port 10000 --reload"
)

# 3. Worker
Write-Host "[3/4] Starting RQ worker..." -ForegroundColor Yellow
Start-Process -WindowStyle Normal -FilePath "powershell" -ArgumentList @(
  "-NoExit", "-Command",
  "Set-Location '$root\backend'; .\.venv\Scripts\Activate.ps1; `$env:PYTHONPATH=(Get-Location); python -m app.worker"
)

# 4. Frontend
Write-Host "[4/4] Starting frontend on http://localhost:3000 ..." -ForegroundColor Yellow
Start-Process -WindowStyle Normal -FilePath "powershell" -ArgumentList @(
  "-NoExit", "-Command",
  "Set-Location '$root\frontend'; npm run dev"
)

Start-Sleep -Seconds 3
Write-Host "`nAll services running:" -ForegroundColor Green
Write-Host "  Backend  -> http://localhost:10000/docs" -ForegroundColor White
Write-Host "  Frontend -> http://localhost:3000" -ForegroundColor White
Write-Host "  Redis    -> localhost:6379" -ForegroundColor White
Write-Host "`nPress any key to stop all..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

# Cleanup
Write-Host "Shutting down..." -ForegroundColor Yellow
Get-Process python, uvicorn, node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
wsl -e bash -c "sudo service redis-server stop" 2>$null
Write-Host "Done." -ForegroundColor Green
