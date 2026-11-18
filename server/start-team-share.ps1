$ErrorActionPreference = 'Stop'
$projectDirectory = $PSScriptRoot
$pythonForTeam = Join-Path $projectDirectory '.venv\Scripts\python.exe'
$teamRuntime = Join-Path $projectDirectory 'data\team-share'
New-Item -ItemType Directory -Path $teamRuntime -Force | Out-Null
try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:18766/team/health' -TimeoutSec 2
} catch { $health = $null }
if (-not $health) {
    Start-Process -FilePath $pythonForTeam -ArgumentList '-X','utf8','share_team.py','start' -WorkingDirectory $projectDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $teamRuntime 'manager.stdout.log') -RedirectStandardError (Join-Path $teamRuntime 'manager.stderr.log') | Out-Null
}
$teamState = $null
$verifiedReady = $false
for ($attempt = 0; $attempt -lt 125; $attempt++) {
    Start-Sleep -Seconds 1
    $statePath = Join-Path $teamRuntime 'current.owner.json'
    if (Test-Path -LiteralPath $statePath) {
        $teamState = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($teamState.status -eq 'ready') {
            try { $runningShare = Invoke-RestMethod -Uri 'http://127.0.0.1:18766/team/health' -TimeoutSec 2 } catch { $runningShare = $null }
            if ($runningShare.protected -eq $true -and $runningShare.share_id -eq $teamState.share_id) { $verifiedReady = $true; break }
        }
        if ($attempt -gt 5 -and $teamState.status -eq 'failed') { break }
    }
}
if ($verifiedReady) {
    Write-Host 'Share this URL and access code with your teammates:'
    Write-Host $teamState.url
    Write-Host ('Access code: ' + $teamState.access_code)
    Write-Host 'Keep this computer online. Use the stop-sharing launcher to close access.'
} else {
    Write-Host 'The tunnel is not ready. Check data/team-share logs.'
}
