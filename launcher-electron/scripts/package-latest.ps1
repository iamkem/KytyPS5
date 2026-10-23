# Package into the checkout's only latest Launcher directory.
$ErrorActionPreference='Stop'
$source=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$project=if($env:KYTY_PROJECT_ROOT){$env:KYTY_PROJECT_ROOT}else{(Resolve-Path (Join-Path $source '..')).Path}
if(!(Test-Path (Join-Path $project 'run-windows.ps1'))){throw 'Invalid project directory'}
$out=Join-Path $project '_Build\latest\launcher'
$packer=Join-Path $source 'node_modules\.bin\electron-packager.cmd'
if(!(Test-Path $packer)){throw 'Install node dependencies first'}
Push-Location $source
try {
 & $packer . DemonsSoulsLauncher --platform=win32 --arch=x64 "--out=$out" --overwrite --icon=assets/game.ico --ignore=tests --ignore=package-lock.json
 if($LASTEXITCODE -ne 0){throw 'Launcher package failed'}
 Write-Host "LATEST_LAUNCHER=$out"
}finally{Pop-Location}
