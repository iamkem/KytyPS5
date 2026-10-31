#requires -Version 5.1
<#
.SYNOPSIS
  Review and optionally recycle exactly the obsolete G3-B Launcher staging directory.
.DESCRIPTION
  Dry-run by default. Will never clean the repo root, latest binaries, shader inputs,
  saves, logs, backups, caches or user files. Uses the Windows Recycle Bin for recovery.
.EXAMPLE
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\local\windows\cleanup-obsolete-artifacts.ps1
.EXAMPLE
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\local\windows\cleanup-obsolete-artifacts.ps1 -Execute
#>
[CmdletBinding()]
param([switch] $Execute)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$gitMarker = Join-Path $root '.git'
$launcher = Join-Path $root 'launcher.cmd'
$latestExe = Join-Path $root '_Build\latest\launcher\DemonsSoulsLauncher-win32-x64\DemonsSoulsLauncher.exe'
$nativeExe = Join-Path $root '_Build\latest\native-build\kyty_emulator.exe'
$targetPath = [IO.Path]::GetFullPath((Join-Path $root '_Build\g3b-staging'))
$expectedPath = [IO.Path]::GetFullPath((Join-Path $root '_Build\g3b-staging'))

if (-not (Test-Path -LiteralPath $gitMarker) -or
    -not (Test-Path -LiteralPath $launcher -PathType Leaf) -or
    -not (Test-Path -LiteralPath $latestExe -PathType Leaf) -or
    -not (Test-Path -LiteralPath $nativeExe -PathType Leaf)) {
    throw 'Refusing cleanup: canonical repository, launcher, or latest binaries are missing.'
}
if (-not [string]::Equals($targetPath, $expectedPath, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing cleanup: target does not match the explicit allowlist.'
}
if (-not (Test-Path -LiteralPath $targetPath)) {
    Write-Host "ALREADY CLEAN: obsolete G3-B staging directory not found: $targetPath"
    exit 0
}
$dir = Get-Item -LiteralPath $targetPath -Force
if (-not $dir.PSIsContainer -or ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Refusing cleanup: target is not an ordinary directory (or is a reparse point).'
}
$items = @(Get-ChildItem -LiteralPath $dir.FullName -Force -Recurse -ErrorAction Stop)
$links = @($items | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
if ($links.Count -ne 0) {
    throw "Refusing cleanup: $($links.Count) nested reparse point(s) present."
}
$files = @($items | Where-Object { -not $_.PSIsContainer })
if (-not (Test-Path -LiteralPath (Join-Path $dir.FullName 'launcher\DemonsSoulsLauncher-win32-x64\DemonsSoulsLauncher.exe') -PathType Leaf)) {
    throw 'Refusing cleanup: directory shape does not match the obsolete G3-B Launcher staging.'
}

# Fail closed on inaccessible process inventory or any running process from the staging tree.
$processes = @(Get-CimInstance Win32_Process -ErrorAction Stop)
$prefix = $dir.FullName.TrimEnd('\') + '\'
$active = @($processes | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
})
if ($active.Count -ne 0) {
    throw "Refusing cleanup: $($active.Count) process(es) are running from staging."
}

$bytes = ($files | Measure-Object -Property Length -Sum).Sum
if ($null -eq $bytes) { $bytes = 0 }
$mb = [Math]::Round($bytes / 1MB, 2)
Write-Host "TARGET   : $($dir.FullName)"
Write-Host "CONTENTS : $($files.Count) files, $mb MiB"
Write-Host 'PROTECTED: _Build/latest, shader-feature-trial, static-precompile, scene-benchmark, logs, backups, saves, mods, hints, personal files'
if (-not $Execute) {
    Write-Host 'DRY RUN ONLY. To move this single obsolete staging directory to the Recycle Bin, add -Execute.'
    exit 0
}

Add-Type -AssemblyName Microsoft.VisualBasic
[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(
    $dir.FullName,
    [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
    [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
)
if (Test-Path -LiteralPath $targetPath) { throw 'Cleanup not complete: staging directory still exists.' }
Write-Host "CLEANED: moved obsolete staging to Recycle Bin ($mb MiB)."
