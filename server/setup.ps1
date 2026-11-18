param([string]$Python = "python")
$ErrorActionPreference = 'Stop'
$projectDirectory = $PSScriptRoot
$environmentPython = Join-Path $projectDirectory '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $environmentPython)) {
    & $Python -m venv (Join-Path $projectDirectory '.venv')
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.10-3.12 is required.' }
}
& $environmentPython -m pip install torch --index-url https://download.pytorch.org/whl/cpu
if ($LASTEXITCODE -ne 0) { throw 'PyTorch installation failed.' }
& $environmentPython -m pip install -r (Join-Path $projectDirectory 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
Set-Location -LiteralPath $projectDirectory
& $environmentPython -c 'from motion import download_pose_model; print(download_pose_model())'
if ($LASTEXITCODE -ne 0) { throw 'Pose model download failed.' }
Write-Output 'Ready. Run start.ps1 to open the local application.'
