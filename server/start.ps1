$ErrorActionPreference = 'Stop'
$projectDirectory = $PSScriptRoot
$environmentPython = Join-Path $projectDirectory '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $environmentPython)) { throw 'Run setup.ps1 first.' }
Set-Location -LiteralPath $projectDirectory
Write-Output 'TalkEval motion forecast: http://127.0.0.1:8765'
& $environmentPython (Join-Path $projectDirectory 'app.py')
