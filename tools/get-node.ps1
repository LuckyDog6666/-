# Download a portable Node.js (LTS v22) into .\runtime\node with SHA256 verification.
# Tries the China mirror first, then the official site.
$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root 'runtime'
$dest = Join-Path $runtime 'node'
New-Item -ItemType Directory -Force -Path $runtime | Out-Null

switch ($env:PROCESSOR_ARCHITECTURE) {
  'ARM64' { $arch = 'arm64' }
  'x86'   { $arch = 'x86' }
  default { $arch = 'x64' }
}
$bases = @('https://npmmirror.com/mirrors/node/latest-v22.x', 'https://nodejs.org/dist/latest-v22.x')
foreach ($base in $bases) {
  try {
    Write-Host "  -> $base"
    $sums = (Invoke-WebRequest -UseBasicParsing -Uri "$base/SHASUMS256.txt" -TimeoutSec 30).Content
    if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
    $line = ($sums -split "`n") | Where-Object { $_ -match "node-v[\d\.]+-win-$arch\.zip\s*$" } | Select-Object -First 1
    if (-not $line) { throw "no zip for win-$arch" }
    $parts = $line.Trim() -split '\s+'
    $hash = $parts[0]; $file = $parts[1]
    $zip = Join-Path $runtime $file
    Write-Host "  downloading $file ..."
    Invoke-WebRequest -UseBasicParsing -Uri "$base/$file" -OutFile $zip -TimeoutSec 600
    $actual = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLower()
    if ($actual -ne $hash.ToLower()) { Remove-Item $zip -Force; throw "SHA256 mismatch" }
    $tmp = Join-Path $runtime 'extract'
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $inner = Get-ChildItem $tmp | Select-Object -First 1
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    Move-Item $inner.FullName $dest
    Remove-Item $tmp -Recurse -Force
    Remove-Item $zip -Force
    Write-Host "  Node.js ready: $dest"
    exit 0
  } catch {
    Write-Host "  failed: $($_.Exception.Message)"
  }
}
exit 1
