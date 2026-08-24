param(
  [Parameter(Mandatory = $true)]
  [string]$BackupDirectory,
  [int]$RetentionDays = 14
)

$ErrorActionPreference = 'Stop'

if (-not $env:DATABASE_URL) {
  throw 'DATABASE_URL is required.'
}

$resolvedDirectory = [System.IO.Path]::GetFullPath($BackupDirectory)
New-Item -ItemType Directory -Force -Path $resolvedDirectory | Out-Null

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$target = Join-Path $resolvedDirectory "hysteria2-$timestamp.dump"
& pg_dump --format=custom --no-owner --no-privileges --file=$target $env:DATABASE_URL
if ($LASTEXITCODE -ne 0) {
  throw "pg_dump failed with exit code $LASTEXITCODE."
}

$cutoff = (Get-Date).AddDays(-$RetentionDays)
Get-ChildItem -LiteralPath $resolvedDirectory -Filter 'hysteria2-*.dump' -File |
  Where-Object { $_.LastWriteTime -lt $cutoff } |
  Remove-Item -Force

Write-Output $target
