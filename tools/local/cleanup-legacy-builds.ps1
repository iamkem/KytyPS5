[CmdletBinding()]
param([switch]$Apply,[switch]$CloseSmokeProcesses)
$ErrorActionPreference='Stop'
$project=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
# In a DevSpace worktree, the actual deployment root is the explicitly configured user checkout.
if ($env:KYTY_BUILD_CLEAN_ROOT) { $project=$env:KYTY_BUILD_CLEAN_ROOT }
$build=Join-Path $project '_Build'
if (!(Test-Path -LiteralPath $build -PathType Container)) { throw 'Build root not found' }
$build=(Resolve-Path -LiteralPath $build).Path.TrimEnd('\')
$required=@(
 'latest\native-build\kyty_emulator.exe',
 'latest\native-build\kyty_shader_precompile.exe',
 'latest\launcher\DemonsSoulsLauncher-win32-x64\DemonsSoulsLauncher.exe'
)
foreach($file in $required) {
 $path=Join-Path $build $file
 if (!(Test-Path -LiteralPath $path -PathType Leaf) -or (Get-Item -LiteralPath $path).Length -lt 100000) {
  throw "Refusing cleanup: latest artifact missing or truncated: $path"
 }
}
# Only terminate the exact smoke-created Electron tree, never an interactive Launcher.
if($Apply -and $CloseSmokeProcesses) {
 $entries=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'DemonsSoulsLauncher.exe'})
 $rootSmoke=@($entries | Where-Object {
  $_.CommandLine -like '*--smoke-ui*' -and
  $_.ExecutablePath -like ($build+'\latest\launcher\*')
 })
 foreach($main in $rootSmoke) {
  $children=@($entries | Where-Object {
   $_.ParentProcessId -eq $main.ProcessId -and
   $_.ExecutablePath -like ($build+'\latest\launcher\*')
  })
  foreach($child in $children) {
   Write-Host "SMOKE_CLEANUP_ONLY pid=$($child.ProcessId) parent=$($main.ProcessId)"
   Stop-Process -Id $child.ProcessId -Force -ErrorAction Stop
  }
  Write-Host "SMOKE_CLEANUP_ONLY pid=$($main.ProcessId) root=1"
  Stop-Process -Id $main.ProcessId -Force -ErrorAction Stop
 }
 Start-Sleep -Milliseconds 300
}
$processes=@(Get-Process kyty_emulator,kyty_shader_precompile,DemonsSoulsLauncher -ErrorAction SilentlyContinue)
if($processes.Count -gt 0) {
 throw ("Refusing cleanup: running process(es) " + (($processes | ForEach-Object {"$($_.ProcessName):$($_.Id)"}) -join ','))
}
# Preserve latest/, run-logs/ and static-precompile/. NEVER traverse outside _Build.
$names=@(
 'demons-souls-launcher','demons-souls-launcher-v2','demons-souls-launcher-v3',
 'demons-souls-launcher-v4','demons-souls-launcher-v5','demons-souls-launcher-v6',
 'demons-souls-launcher-v7','demons-souls-launcher-v8','demons-souls-launcher-v9',
 'demons-souls-launcher-v10','demons-souls-launcher-v11','demons-souls-launcher-v12',
 'demons-souls-launcher-v13','demons-souls-launcher-v14','demons-souls-launcher-v15',
 'integrated','launcher-electron','launcher-icon','windows','windows-chenxiao',
 'windows-chenxiao-guard','windows-chenxiao-v15','windows-ram-adaptive',
 'windows-ram-offload','windows-ram-stutter-guard','windows-stage7-resource'
)
$legacyTools=@(
 'kyty-binary-index-audit.exe','kyty-ram-census.exe','kyty-working-set-sampler.exe',
 'memory-pressure-backing-smoke.exe','memory-pressure-mapped-discard-smoke.exe',
 'memory-pressure-policy-test.exe','stage7-file-backing-smoke.exe','stage7-resource-policy-test.exe'
)
$removed=0
foreach($name in $names) {
 $path=Join-Path $build $name
 if(!(Test-Path -LiteralPath $path -PathType Container)){continue}
 if($name -notmatch '^[a-z0-9-]+$' -or !([IO.Path]::GetFullPath($path)).StartsWith($build+'\',[StringComparison]::OrdinalIgnoreCase)){
  throw "Refusing unexpected path $path"
 }
 Write-Host ("LEGACY_BUILD_" + $(if($Apply){'REMOVE'}else{'PLAN'}) + " dir=$name")
 if($Apply){Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop}
 $removed++
}
foreach($name in $legacyTools) {
 $path=Join-Path $build $name
 if(!(Test-Path -LiteralPath $path -PathType Leaf)){continue}
 Write-Host ("LEGACY_TOOL_" + $(if($Apply){'REMOVE'}else{'PLAN'}) + " name=$name")
 if($Apply){Remove-Item -LiteralPath $path -Force -ErrorAction Stop}
 $removed++
}
Write-Host "CLEANUP_RESULT applied=$([bool]$Apply) legacy_removed=$removed preserved=latest,run-logs,static-precompile"
Write-Host 'CLEANUP_NOTE _PipelineCache, game saves, game data, shader fingerprints, and source working tree are untouched.'
