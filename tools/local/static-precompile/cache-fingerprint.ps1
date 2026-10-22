# Shader content identity: used only after native GPU/driver and translator-feature checks.
# Refuse shortcuts without source files: a packaged release cannot infer translator changes from its EXE timestamp.
function Get-KytyShaderFingerprint([string]$Root, [string]$Seeds, [string]$GameId) {
    $source = Join-Path $Root 'src\graphics'
    $cacheDir = Join-Path $Root '_PipelineCache\static'
    if (!(Test-Path -LiteralPath $Seeds -PathType Leaf) -or !(Test-Path -LiteralPath $source -PathType Container)) { return $null }
    $binaries = @(@('.binaries', '.blobs', '.bin') | ForEach-Object { Join-Path $cacheDir ($GameId + $_) } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
    # Explicitly handle an empty cache: it cannot be asserted current.
    if (!$binaries.Count) { return $null }
    $binary = Get-Item -LiteralPath $binaries[0]
    $paths = @($Seeds)
    $hints = Join-Path $Root ('tools\local\static-precompile\hints-' + $GameId + '.hints')
    $states = Join-Path $Root 'tools\local\static-precompile\pass-states.json'
    if (Test-Path -LiteralPath $hints) { $paths += $hints }
    if (Test-Path -LiteralPath $states) { $paths += $states }
    $paths += @(Get-ChildItem -LiteralPath $source -File -Recurse |
        Where-Object { $_.Extension -in @('.h', '.cpp', '.inc') } | ForEach-Object { $_.FullName })
    $paths = @($paths | Sort-Object -Unique)
    if ($paths.Count -lt 10) { return $null }
    $identity = [System.Text.StringBuilder]::new()
    foreach ($file in $paths) {
        $relative = $file.Substring($Root.TrimEnd('\').Length + 1).Replace('\', '/')
        $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
        [void]$identity.Append($relative).Append('=').Append($hash).Append([char]10)
    }
    $bytes = [Text.Encoding]::UTF8.GetBytes($identity.ToString())
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $digest = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '') }
    finally { $sha.Dispose() }
    return [pscustomobject]@{
        Schema = 1
        Game = $GameId
        Digest = $digest
        CacheLength = [int64]$binary.Length
        CacheWriteTicks = [int64]$binary.LastWriteTimeUtc.Ticks
    }
}
function Test-KytyShaderFingerprint([string]$Root, [string]$GameId, $Fingerprint) {
    if (!$Fingerprint) { return $false }
    $file = Join-Path $Root ('_Build\static-precompile\cache-fingerprint-' + $GameId + '.json')
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) { return $false }
    try {
        $old = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
        return $old.Schema -eq 1 -and $old.Game -eq $Fingerprint.Game -and
            $old.Digest -eq $Fingerprint.Digest -and
            [int64]$old.CacheLength -eq $Fingerprint.CacheLength -and
            [int64]$old.CacheWriteTicks -eq $Fingerprint.CacheWriteTicks
    } catch { return $false }
}
function Save-KytyShaderFingerprint([string]$Root, [string]$GameId, $Fingerprint) {
    if (!$Fingerprint) { return }
    $dir = Join-Path $Root '_Build\static-precompile'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $file = Join-Path $dir ('cache-fingerprint-' + $GameId + '.json')
    $temp = $file + '.tmp'
    $Fingerprint | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $temp -Encoding UTF8
    Move-Item -LiteralPath $temp -Destination $file -Force
}
