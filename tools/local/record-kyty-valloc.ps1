# Stage 6D Windows ETW VirtualAlloc provenance, opt-in ONLY.
# Does not start the game, alter its memory or change Windows registry.
# Run from an elevated PowerShell, then immediately start Kyty launcher/game.
# A circular 256 MiB ETL contains SYSTEM-WIDE process/module/stack paths;
# keep it local and inspect in Windows Performance Analyzer.
param(
    [ValidateRange(30, 240)][int]$Seconds = 150,
    [string]$Output = "",
    [switch]$WhatIf
)
$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if ([string]::IsNullOrWhiteSpace($Output)) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $Output = Join-Path $root "_Build\run-logs\kyty-valloc-$stamp.etl"
} elseif (![System.IO.Path]::IsPathRooted($Output)) {
    $Output = Join-Path $root $Output
}
$Output = [System.IO.Path]::GetFullPath($Output)
$command = Get-Command xperf.exe -ErrorAction SilentlyContinue
if (!$command) { throw 'Windows Performance Toolkit xperf.exe not found.' }
$flags = @('-on', 'PROC_THREAD+LOADER+VIRT_ALLOC',
    '-stackwalk', 'VirtualAlloc+VirtualFree',
    '-BufferSize', '1024', '-MinBuffers', '16', '-MaxBuffers', '64',
    '-MaxFile', '256', '-FileMode', 'Circular')
Write-Host "STAGE6D_XPERF_EXEC=$($command.Source)"
Write-Host "STAGE6D_OUTPUT=$Output"
Write-Host "STAGE6D_SECONDS=$Seconds"
Write-Host 'STAGE6D_MAX_ETL_MIB=256 (circular; oldest events may be replaced)'
if ($WhatIf) {
    Write-Host 'STAGE6D_DRY_RUN_PASS (no ETW session started)'
    exit 0
}
$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Open PowerShell as Administrator. Trace not started.'
}
if (Test-Path -LiteralPath $Output) { throw 'Refusing to overwrite an existing ETL file.' }
$parent = Split-Path -Parent $Output
if (!(Test-Path -LiteralPath $parent)) { throw 'Output directory does not exist; no trace started.' }
$drive = [System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($Output))
if ($drive.AvailableFreeSpace -lt 2GB) { throw 'Need at least 2 GiB free on ETL output drive.' }
$available = (Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory * 1KB
if ($available -lt 4GB) { throw 'Under 4 GiB RAM currently available; refusing to add tracing overhead.' }
# Avoid replacing or stopping a pre-existing kernel ETW trace.
$loggers = & $command.Source -loggers 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect existing ETW sessions; no trace started.' }
if ($loggers -match '(?m)^\s*Logger Name\s*:\s*NT Kernel Logger\s*$') {
    throw 'NT Kernel Logger is already active; refusing to interrupt another trace.'
}
$started = $false
try {
    Write-Host "STAGE6D_CAPTURE_START - open your Kyty launcher and begin a short session NOW"
    & $command.Source @flags
    if ($LASTEXITCODE -ne 0) { throw "xperf start failed ($LASTEXITCODE); not capturing." }
    $started = $true
    Start-Sleep -Seconds $Seconds
} finally {
    if ($started) {
        Write-Host "STAGE6D_CAPTURE_STOP - saving ETL to $Output"
        & $command.Source -stop -d $Output
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "xperf stop/export failed ($LASTEXITCODE); inspect trace session manually."
        } elseif (Test-Path -LiteralPath $Output) {
            $item = Get-Item -LiteralPath $Output
            Write-Host "STAGE6D_CAPTURE_PASS bytes=$($item.Length) path=$Output"
        }
    }
}
Write-Host 'STAGE6D_NOTE: ETL contains system-wide process details. Keep it on this PC.'
