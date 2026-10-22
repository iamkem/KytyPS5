param(
  [Parameter(Mandatory=$true)][string]$Archive,
  [Parameter(Mandatory=$true)][string]$Destination
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$limitFiles=4000
$limitBytes=[long]8GB
$limitOne=[long]2GB
$base=[IO.Path]::GetFullPath($Destination).TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar
$zip=[IO.Compression.ZipFile]::OpenRead($Archive)
try{
  $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $count=0
  [long]$total=0
  foreach($entry in $zip.Entries){
    $name=$entry.FullName.Replace('\','/')
    if([string]::IsNullOrEmpty($name) -or $name.StartsWith('/') -or
       $name.Contains(':') -or $name.Contains([char]0)){throw "Unsafe ZIP entry: $name"}
    $parts=$name.TrimEnd('/').Split('/')
    if($parts | Where-Object {$_ -in @('','..','.') -or $_.EndsWith('.') -or $_.EndsWith(' ') -or $_ -match '[<>|"?*]'}){throw "Unsafe ZIP path: $name"}
    $mode=($entry.ExternalAttributes -shr 16) -band 0xF000
    if($mode -eq 0xA000 -or ($entry.ExternalAttributes -band 0x400) -ne 0){throw "ZIP symlink or reparse point rejected: $name"}
    $file=[IO.Path]::GetFullPath((Join-Path $base ($name -replace '/', [IO.Path]::DirectorySeparatorChar)))
    if(!$file.StartsWith($base,[StringComparison]::OrdinalIgnoreCase)){throw "ZIP path escapes destination"}
    if($name.EndsWith('/')){continue}
    if(!$seen.Add($name)){throw "Duplicate ZIP path (case-insensitive): $name"}
    $count++;$total+=$entry.Length
    if($count -gt $limitFiles -or $entry.Length -gt $limitOne -or $total -gt $limitBytes){throw "ZIP exceeds extraction safety limits"}
  }
  if($count -eq 0){throw "ZIP has no files"}
  [long]$actualTotal=0
  foreach($entry in $zip.Entries){
    if($entry.FullName.Replace('\','/').EndsWith('/')){continue}
    $file=[IO.Path]::GetFullPath((Join-Path $base ($entry.FullName.Replace('\','/') -replace '/', [IO.Path]::DirectorySeparatorChar)))
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file)) | Out-Null
    $in=$entry.Open()
    $out=[IO.File]::Open($file,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try{
      $buffer=[byte[]]::new(1048576)
      [long]$written=0
      do{
        $n=$in.Read($buffer,0,$buffer.Length)
        if($n -gt 0){
          $out.Write($buffer,0,$n);$written+=$n;$actualTotal+=$n
          if($written -gt $limitOne -or $actualTotal -gt $limitBytes){throw "ZIP expanded past safety limits"}
        }
      }while($n -gt 0)
      if($written -ne $entry.Length){throw "ZIP size mismatch: $($entry.FullName)"}
    }finally{$out.Dispose();$in.Dispose()}
  }
  Write-Host "MOD_ZIP_EXTRACTED=$count BYTES=$actualTotal"
}finally{$zip.Dispose()}
