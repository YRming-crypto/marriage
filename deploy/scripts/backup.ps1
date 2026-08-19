[CmdletBinding()]
param(
  [string]$EnvFile = ".env.deploy",
  [string]$OutputDirectory = "../ai-marriage-backups",
  [string]$ComposeFile = "deploy/docker-compose.yml",
  [string]$S3ClientEndpoint = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$envPath = if ([System.IO.Path]::IsPathRooted($EnvFile)) { $EnvFile } else { Join-Path $repoRoot $EnvFile }
$composePath = if ([System.IO.Path]::IsPathRooted($ComposeFile)) { $ComposeFile } else { Join-Path $repoRoot $ComposeFile }
$backupRoot = if ([System.IO.Path]::IsPathRooted($OutputDirectory)) {
  [System.IO.Path]::GetFullPath($OutputDirectory)
} else {
  [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputDirectory))
}
$manifestTool = Join-Path $PSScriptRoot "recovery-set-manifest.mjs"
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$setId = "ai-marriage-$stamp"
$recoverySetPath = Join-Path $backupRoot $setId
$partialRoot = "$recoverySetPath.partial"
$databasePath = Join-Path $partialRoot "database.dump"
$partialDatabasePath = "$databasePath.partial"
$objectsPath = Join-Path $partialRoot "objects"
$containerPath = "/tmp/$setId.dump"

function Get-ResolvedComposeValue([string]$Name) {
  $value = $composeConfigJson | & node $manifestTool compose-env api $Name
  if ($LASTEXITCODE -ne 0) { throw "Could not read resolved API environment value '$Name'" }
  return [string]$value
}

function Assert-RequiredValue([string]$Name, [string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { throw "Required deployment value is empty: $Name" }
}

if (-not (Test-Path -LiteralPath $envPath)) { throw "Environment file not found: $envPath" }
if (-not (Test-Path -LiteralPath $composePath)) { throw "Compose file not found: $composePath" }
if (-not (Test-Path -LiteralPath $manifestTool)) { throw "Manifest tool not found: $manifestTool" }
foreach ($command in @("node", "docker", "aws")) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Required command not found: $command" }
}

$compose = @("compose", "--env-file", $envPath, "-f", $composePath)
$composeConfigJson = (& docker @compose config --format json | Out-String)
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($composeConfigJson)) { throw "Could not resolve the Docker Compose configuration" }

$s3Bucket = Get-ResolvedComposeValue "S3_BUCKET"
$s3Region = Get-ResolvedComposeValue "S3_REGION"
$s3Endpoint = Get-ResolvedComposeValue "S3_ENDPOINT"
$s3AccessKey = Get-ResolvedComposeValue "S3_ACCESS_KEY"
$s3SecretKey = Get-ResolvedComposeValue "S3_SECRET_KEY"
Assert-RequiredValue "S3_BUCKET" $s3Bucket
Assert-RequiredValue "S3_REGION" $s3Region
Assert-RequiredValue "S3_ACCESS_KEY" $s3AccessKey
Assert-RequiredValue "S3_SECRET_KEY" $s3SecretKey
$s3TransferEndpoint = if ([string]::IsNullOrWhiteSpace($S3ClientEndpoint)) { $s3Endpoint } else { $S3ClientEndpoint }

if (Test-Path -LiteralPath $recoverySetPath) { throw "Recovery set already exists: $recoverySetPath" }
if (Test-Path -LiteralPath $partialRoot) { throw "Partial recovery set already exists: $partialRoot" }
New-Item -ItemType Directory -Force -Path $objectsPath | Out-Null

$awsVariableNames = @("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_DEFAULT_REGION", "AWS_EC2_METADATA_DISABLED")
$previousAwsEnvironment = @{}
foreach ($name in $awsVariableNames) {
  $previousAwsEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}
[Environment]::SetEnvironmentVariable("AWS_ACCESS_KEY_ID", $s3AccessKey, "Process")
[Environment]::SetEnvironmentVariable("AWS_SECRET_ACCESS_KEY", $s3SecretKey, "Process")
[Environment]::SetEnvironmentVariable("AWS_DEFAULT_REGION", $s3Region, "Process")
[Environment]::SetEnvironmentVariable("AWS_EC2_METADATA_DISABLED", "true", "Process")

$servicesStopped = $false
$backupComplete = $false
$failure = $null

Push-Location $repoRoot
try {
  $databaseName = (& docker @compose exec -T postgres sh -ceu 'printf %s "$POSTGRES_DB"').Trim()
  if ($LASTEXITCODE -ne 0 -or -not $databaseName) { throw "Could not read the source database name" }

  $servicesStopped = $true
  & docker @compose stop gateway api
  if ($LASTEXITCODE -ne 0) { throw "Could not pause API write traffic" }

  & docker @compose exec -T postgres sh -ceu 'pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --format=custom --compress=9 --file "$1"' -- $containerPath
  if ($LASTEXITCODE -ne 0) { throw "pg_dump failed with exit code $LASTEXITCODE" }
  & docker @compose cp "postgres:$containerPath" $partialDatabasePath
  if ($LASTEXITCODE -ne 0) { throw "Could not copy the PostgreSQL archive from the container" }
  & docker @compose exec -T postgres pg_restore --list $containerPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Created backup is not a readable PostgreSQL archive" }
  Move-Item -LiteralPath $partialDatabasePath -Destination $databasePath

  $s3Options = @("--only-show-errors", "--no-progress")
  if (-not [string]::IsNullOrWhiteSpace($s3TransferEndpoint)) { $s3Options += @("--endpoint-url", $s3TransferEndpoint) }
  & aws s3 sync "s3://$s3Bucket" $objectsPath @s3Options
  if ($LASTEXITCODE -ne 0) { throw "S3 object backup failed with exit code $LASTEXITCODE" }

  $revision = "unknown"
  if (Get-Command git -ErrorAction SilentlyContinue) {
    $gitRevision = & git -C $repoRoot rev-parse HEAD 2>$null
    if ($LASTEXITCODE -eq 0 -and $gitRevision) { $revision = ([string]$gitRevision).Trim() }
  }
  $metadata = [ordered]@{
    formatVersion = 1
    recoverySetId = $setId
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    applicationRevision = $revision
    database = [ordered]@{ file = "database.dump"; name = $databaseName; format = "postgresql-custom" }
    objectStorage = [ordered]@{ directory = "objects"; bucket = $s3Bucket; region = $s3Region; endpoint = $s3Endpoint }
  }
  $metadata | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 -LiteralPath (Join-Path $partialRoot "recovery-set.json")

  & node $manifestTool create $partialRoot
  if ($LASTEXITCODE -ne 0) { throw "Could not create recovery-set SHA-256 manifest" }
  & node $manifestTool verify $partialRoot
  if ($LASTEXITCODE -ne 0) { throw "Recovery-set SHA-256 verification failed" }

  Move-Item -LiteralPath $partialRoot -Destination $recoverySetPath
  $backupComplete = $true
}
catch {
  $failure = $_
}
finally {
  try {
    try {
      & docker @compose exec -T postgres rm -f $containerPath 2>$null | Out-Null
      if ($servicesStopped) {
        & docker @compose up -d api web gateway
        if ($LASTEXITCODE -ne 0) {
          & docker @compose stop gateway api
          if ($LASTEXITCODE -ne 0) {
            Write-Warning "Could not confirm that gateway and API are stopped after the service restart failure."
          }
          if (-not $failure) { $failure = [System.Exception]::new("Backup finished, but application services could not be restarted") }
          else { Write-Warning "Application services could not be restarted after the backup failure." }
        } else {
          $servicesStopped = $false
        }
      }
    } catch {
      if (-not $failure) { $failure = $_ } else { Write-Warning "Service cleanup after backup also failed: $($_.Exception.Message)" }
    }
    try {
      if (-not $backupComplete -and (Test-Path -LiteralPath $partialRoot)) {
        Remove-Item -LiteralPath $partialRoot -Recurse -Force
      }
    } catch {
      if (-not $failure) { $failure = $_ } else { Write-Warning "Partial backup cleanup also failed: $($_.Exception.Message)" }
    }
  } finally {
    try {
      foreach ($name in $awsVariableNames) {
        [Environment]::SetEnvironmentVariable($name, $previousAwsEnvironment[$name], "Process")
      }
    } catch {
      if (-not $failure) { $failure = $_ } else { Write-Warning "AWS environment restoration also failed: $($_.Exception.Message)" }
    } finally {
      try { Pop-Location } catch {
        if (-not $failure) { $failure = $_ } else { Write-Warning "Working-directory restoration also failed: $($_.Exception.Message)" }
      }
    }
  }
}

if ($failure) { throw $failure }
Write-Host "Complete recovery set created and verified: $recoverySetPath"
