# Fetch only version-specific published hints from the known chenxiao07 upstream repository.
# The GitHub Contents API supplies both the bytes and the Git blob SHA-1; verify both
# before an atomic local replacement. A network outage must never discard local hints.
function Sync-KytyReleasedHints([string]$Root, [string]$GameId) {
    if ($GameId -notmatch '^[A-Z]{4}[0-9]{5}_[0-9.]+$') {
        Write-Host 'hints: invalid game identity; keeping installed hints'
        return
    }
    $name = "hints-$GameId.hints"
    $relative = "tools/local/static-precompile/$name"
    $destination = Join-Path $Root ("tools\local\static-precompile\" + $name)
    $uri = "https://api.github.com/repos/chenxiao07/KytyPS5/contents/$relative"
    $temp = $null
    try {
        $response = Invoke-RestMethod -Uri $uri -TimeoutSec 12 -ErrorAction Stop -Headers @{
            'User-Agent' = 'KytyPS5-Shader-Hints-Updater'
            'Accept' = 'application/vnd.github+json'
        }
        if ($response.name -cne $name -or $response.path -cne $relative -or
            $response.encoding -cne 'base64' -or $response.type -cne 'file' -or
            $response.size -lt 64 -or $response.size -gt (2 * 1024 * 1024) -or
            $response.sha -cnotmatch '^[a-f0-9]{40}$' -or !$response.content) {
            throw 'upstream response does not describe the expected version-specific hints'
        }
        [byte[]]$data = [Convert]::FromBase64String(($response.content -replace '\s', ''))
        if ($data.Length -ne [int]$response.size) { throw 'upstream hints byte count mismatch' }
        $header = [Text.Encoding]::ASCII.GetBytes("blob $($data.Length)`0")
        [byte[]]$object = New-Object byte[] ($header.Length + $data.Length)
        [Buffer]::BlockCopy($header, 0, $object, 0, $header.Length)
        [Buffer]::BlockCopy($data, 0, $object, $header.Length, $data.Length)
        $sha = [Security.Cryptography.SHA1]::Create()
        try { $gitHash = [BitConverter]::ToString($sha.ComputeHash($object)).Replace('-', '').ToLowerInvariant() }
        finally { $sha.Dispose() }
        if ($gitHash -cne $response.sha) { throw 'Git blob SHA-1 failed verification' }
        $sha256 = [Security.Cryptography.SHA256]::Create()
        try { $remoteHash = [BitConverter]::ToString($sha256.ComputeHash($data)).Replace('-', '') }
        finally { $sha256.Dispose() }
        if (Test-Path -LiteralPath $destination -PathType Leaf) {
            if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -eq $remoteHash) {
                Write-Host "hints: published $name already installed (SHA-256 verified)"
                return
            }
        }
        New-Item -ItemType Directory -Force (Split-Path $destination) | Out-Null
        $temp = "$destination.sync-$([guid]::NewGuid().ToString('N')).tmp"
        [IO.File]::WriteAllBytes($temp, $data)
        if (Test-Path -LiteralPath $destination -PathType Leaf) {
            $backup = "$destination.backup-before-sync"
            [IO.File]::Replace($temp, $destination, $backup)
        } else {
            [IO.File]::Move($temp, $destination)
        }
        Write-Host "hints: UPDATED $name from chenxiao07/KytyPS5 ($($data.Length) bytes, SHA-256 $remoteHash); old hints preserved as backup"
    } catch {
        Write-Host ("hints: online check unavailable/invalid (" + $_.Exception.Message +
                    "); keeping installed hints, continuing offline")
    } finally {
        if ($temp -and (Test-Path -LiteralPath $temp)) {
            Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
        }
    }
}
