# Generate a multi-size Windows application icon from the user's installed game art.
# Never check proprietary game art into the source repository.
param(
    [Parameter(Mandatory=$true)][string]$Output,
    [string]$GameIcon,
    [string]$ProjectRoot
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
if (!$ProjectRoot) { $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path }
if (!$GameIcon -and $env:KYTY_GAME_ICON) { $GameIcon = $env:KYTY_GAME_ICON }
if (!$GameIcon) {
    $settings = Join-Path $ProjectRoot 'launcher-settings.json'
    if (Test-Path -LiteralPath $settings) {
        try {
            $data = Get-Content -LiteralPath $settings -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($data.game) { $GameIcon = Join-Path $data.game 'sce_sys\icon0.png' }
        } catch { Write-Host 'Icon: could not read saved game path, using original fallback art.' }
    }
}
$useGameIcon = $GameIcon -and (Test-Path -LiteralPath $GameIcon -PathType Leaf)
$source = $null
if ($useGameIcon) {
    $source = [Drawing.Image]::FromFile($GameIcon)
    Write-Host "ICON_SOURCE=game ($($source.Width)x$($source.Height))"
} else {
    Write-Host 'ICON_SOURCE=generated-fallback (no proprietary assets distributed)'
}
$frames = [System.Collections.Generic.List[byte[]]]::new()
try {
    foreach ($size in @(16,24,32,48,64,128,256)) {
        $bitmap = [Drawing.Bitmap]::new($size, $size, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
            $graphics = [Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.Clear([Drawing.Color]::Transparent)
                $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
                $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                if ($source) {
                    $side = [Math]::Min($source.Width, $source.Height)
                    $src = [Drawing.Rectangle]::new([int](($source.Width-$side)/2),[int](($source.Height-$side)/2),$side,$side)
                    $dst = [Drawing.Rectangle]::new(0,0,$size,$size)
                    $graphics.DrawImage($source, $dst, $src, [Drawing.GraphicsUnit]::Pixel)
                } else {
                    # A neutral stylized stone-ring-and-sword glyph for source-only/CI builds.
                    $base = [Drawing.Color]::FromArgb(255,29,31,34)
                    $gold = [Drawing.Color]::FromArgb(255,199,172,119)
                    $steel = [Drawing.Color]::FromArgb(255,224,226,221)
                    $graphics.FillEllipse([Drawing.SolidBrush]::new($base),0,0,$size-1,$size-1)
                    $ringPen = [Drawing.Pen]::new($gold,[Math]::Max(1.2,$size/22))
                    $graphics.DrawEllipse($ringPen,$size*.10,$size*.10,$size*.79,$size*.79)
                    $ringPen.Dispose()
                    $blade = [Drawing.PointF[]]@(
                        [Drawing.PointF]::new($size*.50,$size*.09),
                        [Drawing.PointF]::new($size*.60,$size*.64),
                        [Drawing.PointF]::new($size*.50,$size*.75),
                        [Drawing.PointF]::new($size*.40,$size*.64)
                    )
                    $graphics.FillPolygon([Drawing.SolidBrush]::new($steel),$blade)
                    $crossPen = [Drawing.Pen]::new($gold,[Math]::Max(1,$size/14))
                    $graphics.DrawLine($crossPen,$size*.27,$size*.64,$size*.73,$size*.64)
                    $graphics.DrawLine($crossPen,$size*.50,$size*.64,$size*.50,$size*.87)
                    $crossPen.Dispose()
                }
            } finally { $graphics.Dispose() }
            $memory = [IO.MemoryStream]::new()
            try {
                if ($size -eq 256) {
                    # PNG compression is supported for the 256 px entry on modern Windows.
                    $bitmap.Save($memory,[Drawing.Imaging.ImageFormat]::Png)
                } else {
                    # Smaller entries use a standard 32-bit BGRA DIB + AND mask.
                    # This is reliably decoded by System.Drawing.Icon and Windows taskbar/shell.
                    $bw = [IO.BinaryWriter]::new($memory, [Text.Encoding]::UTF8, $true)
                    try {
                        $strideMask = [int]([Math]::Ceiling($size / 32.0) * 4)
                        $pixelBytes = $size * $size * 4
                        $maskBytes = $strideMask * $size
                        $bw.Write([uint32]40)                # BITMAPINFOHEADER size
                        $bw.Write([int32]$size)              # width
                        $bw.Write([int32]($size * 2))        # XOR + AND heights
                        $bw.Write([uint16]1)                # planes
                        $bw.Write([uint16]32)               # bit depth
                        $bw.Write([uint32]0)                # BI_RGB
                        $bw.Write([uint32]($pixelBytes + $maskBytes))
                        for($j=0; $j -lt 4; $j++){ $bw.Write([uint32]0) }
                        for($y=$size-1; $y -ge 0; $y--){
                            for($x=0; $x -lt $size; $x++){
                                $p = $bitmap.GetPixel($x,$y)
                                $bw.Write([byte]$p.B)
                                $bw.Write([byte]$p.G)
                                $bw.Write([byte]$p.R)
                                $bw.Write([byte]$p.A)
                            }
                        }
                        for($y=$size-1; $y -ge 0; $y--){
                            $row = [byte[]]::new($strideMask)
                            for($x=0; $x -lt $size; $x++){
                                if($bitmap.GetPixel($x,$y).A -lt 128){
                                    $index=[int][Math]::Floor($x/8)
                                    $row[$index] = [byte]($row[$index] -bor (1 -shl (7 - ($x % 8))))
                                }
                            }
                            $bw.Write($row)
                        }
                    } finally { $bw.Dispose() }
                }
                $frames.Add($memory.ToArray())
            } finally { $memory.Dispose() }
        } finally { $bitmap.Dispose() }
    }
} finally { if ($source) { $source.Dispose() } }
$folder = Split-Path -Parent $Output
if (!(Test-Path -LiteralPath $folder)) { New-Item -ItemType Directory -Path $folder -Force | Out-Null }
$stream = [IO.File]::Open($Output,[IO.FileMode]::Create,[IO.FileAccess]::Write,[IO.FileShare]::None)
try {
    $writer=[IO.BinaryWriter]::new($stream)
    try {
        $writer.Write([uint16]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]$frames.Count)
        $offset = 6 + $frames.Count * 16
        for ($i=0; $i -lt $frames.Count; $i++) {
            $sz = @(16,24,32,48,64,128,256)[$i]
            $writer.Write([byte]($sz % 256))
            $writer.Write([byte]($sz % 256))
            $writer.Write([byte]0)
            $writer.Write([byte]0)
            $writer.Write([uint16]1)
            $writer.Write([uint16]32)
            $writer.Write([uint32]$frames[$i].Length)
            $writer.Write([uint32]$offset)
            $offset += $frames[$i].Length
        }
        foreach ($frame in $frames) { $writer.Write($frame) }
    } finally { $writer.Dispose() }
} finally { $stream.Dispose() }
Write-Host "ICON_OK=$Output FRAMES=7 BYTES=$((Get-Item -LiteralPath $Output).Length)"
