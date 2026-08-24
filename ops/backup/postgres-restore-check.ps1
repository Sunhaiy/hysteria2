param(
  [Parameter(Mandatory = $true)]
  [string]$BackupFile,
  [Parameter(Mandatory = $true)]
  [string]$MaintenanceDatabaseUrl
)

$ErrorActionPreference = 'Stop'

$resolvedBackup = [System.IO.Path]::GetFullPath($BackupFile)
if (-not (Test-Path -LiteralPath $resolvedBackup -PathType Leaf)) {
  throw "Backup file does not exist: $resolvedBackup"
}

$databaseName = "hysteria2_restore_check_$([Guid]::NewGuid().ToString('N'))"
$created = $false

try {
  & psql $MaintenanceDatabaseUrl -v ON_ERROR_STOP=1 -c "CREATE DATABASE $databaseName"
  if ($LASTEXITCODE -ne 0) { throw 'Failed to create restore-check database.' }
  $created = $true

  $builder = [System.UriBuilder]$MaintenanceDatabaseUrl
  $builder.Path = "/$databaseName"
  $restoreUrl = $builder.Uri.AbsoluteUri
  & pg_restore --no-owner --no-privileges --dbname=$restoreUrl $resolvedBackup
  if ($LASTEXITCODE -ne 0) { throw 'pg_restore failed.' }

  $tableCount = & psql $restoreUrl -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'"
  if ($LASTEXITCODE -ne 0 -or [int]$tableCount -lt 1) {
    throw 'Restore completed without application tables.'
  }
  Write-Output "Restore check passed with $tableCount public tables."
}
finally {
  if ($created) {
    & psql $MaintenanceDatabaseUrl -v ON_ERROR_STOP=1 -c "DROP DATABASE $databaseName WITH (FORCE)"
  }
}
