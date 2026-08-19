[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$RecoverySetDirectory,
  [Parameter(Mandatory = $true)][string]$ConfirmDatabaseName,
  [Parameter(Mandatory = $true)][string]$ConfirmBucketName,
  [string]$EnvFile = ".env.deploy",
  [string]$ComposeFile = "deploy/docker-compose.yml",
  [string]$S3ClientEndpoint = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$envPath = if ([System.IO.Path]::IsPathRooted($EnvFile)) { $EnvFile } else { Join-Path $repoRoot $EnvFile }
$composePath = if ([System.IO.Path]::IsPathRooted($ComposeFile)) { $ComposeFile } else { Join-Path $repoRoot $ComposeFile }
$manifestTool = Join-Path $PSScriptRoot "recovery-set-manifest.mjs"
$recoverySetItem = Get-Item -LiteralPath $RecoverySetDirectory -Force
if (-not $recoverySetItem.PSIsContainer) { throw "Recovery-set path is not a directory: $RecoverySetDirectory" }
if (($recoverySetItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
  throw "Recovery-set root must not be a symbolic link or reparse point: $RecoverySetDirectory"
}
$recoverySetPath = $recoverySetItem.FullName
$databasePath = Join-Path $recoverySetPath "database.dump"
$objectsPath = Join-Path $recoverySetPath "objects"
$containerPath = "/tmp/restore-$([System.IO.Path]::GetFileName($recoverySetPath)).dump"

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

& node $manifestTool verify $recoverySetPath
if ($LASTEXITCODE -ne 0) { throw "Recovery-set SHA-256 verification failed; no restore action was taken" }
$recoveryDatabaseName = & node $manifestTool metadata $recoverySetPath database.name
if ($LASTEXITCODE -ne 0) { throw "Could not read the recovery-set database identity" }
$recoveryBucketName = & node $manifestTool metadata $recoverySetPath objectStorage.bucket
if ($LASTEXITCODE -ne 0) { throw "Could not read the recovery-set bucket identity" }
if ($ConfirmDatabaseName -cne ([string]$recoveryDatabaseName)) {
  throw "Recovery set database '$recoveryDatabaseName' does not match confirmed target '$ConfirmDatabaseName'"
}
if ($ConfirmBucketName -cne ([string]$recoveryBucketName)) {
  throw "Recovery set bucket '$recoveryBucketName' does not match confirmed target '$ConfirmBucketName'"
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
if ($ConfirmBucketName -cne $s3Bucket) { throw "Confirmation '$ConfirmBucketName' does not match target bucket '$s3Bucket'" }

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
$restoreComplete = $false
$failure = $null
$remoteVerificationRoot = $null

Push-Location $repoRoot
try {
  $databaseName = (& docker @compose exec -T postgres sh -ceu 'printf %s "$POSTGRES_DB"').Trim()
  if ($LASTEXITCODE -ne 0 -or -not $databaseName) { throw "Could not read the target database name" }
  if ($ConfirmDatabaseName -cne $databaseName) { throw "Confirmation '$ConfirmDatabaseName' does not match target '$databaseName'" }

  & docker @compose cp $databasePath "postgres:$containerPath"
  if ($LASTEXITCODE -ne 0) { throw "Could not copy the database archive into the PostgreSQL container" }
  & docker @compose exec -T postgres pg_restore --list $containerPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Backup is not a readable PostgreSQL custom-format archive" }

  $servicesStopped = $true
  & docker @compose stop gateway api
  if ($LASTEXITCODE -ne 0) { throw "Could not stop API write traffic" }

  $s3DeleteOptions = @("--only-show-errors")
  $s3TransferOptions = @("--only-show-errors", "--no-progress")
  if (-not [string]::IsNullOrWhiteSpace($s3TransferEndpoint)) {
    $s3DeleteOptions += @("--endpoint-url", $s3TransferEndpoint)
    $s3TransferOptions += @("--endpoint-url", $s3TransferEndpoint)
  }
  & aws s3 rm "s3://$s3Bucket" --recursive @s3DeleteOptions
  if ($LASTEXITCODE -ne 0) { throw "Could not clear the confirmed target bucket; exit code $LASTEXITCODE" }
  & aws s3 cp $objectsPath "s3://$s3Bucket" --recursive @s3TransferOptions
  if ($LASTEXITCODE -ne 0) { throw "S3 object upload failed with exit code $LASTEXITCODE" }

  $remoteVerificationRoot = Join-Path ([System.IO.Path]::GetTempPath()) "ai-marriage-remote-verify-$([Guid]::NewGuid().ToString('N'))"
  $remoteVerificationObjects = Join-Path $remoteVerificationRoot "objects"
  New-Item -ItemType Directory -Force -Path $remoteVerificationObjects | Out-Null
  & aws s3 sync "s3://$s3Bucket" $remoteVerificationObjects @s3TransferOptions
  if ($LASTEXITCODE -ne 0) { throw "Could not download restored objects for verification; exit code $LASTEXITCODE" }
  & node $manifestTool verify-objects $recoverySetPath $remoteVerificationObjects
  if ($LASTEXITCODE -ne 0) { throw "Remote object SHA-256 verification failed" }

  & docker @compose exec -T postgres sh -ceu 'psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=on --command "$1"' -- 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
  if ($LASTEXITCODE -ne 0) { throw "Could not reset the target database schema" }
  & docker @compose exec -T postgres sh -ceu 'pg_restore --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --no-owner --no-privileges --exit-on-error "$1"' -- $containerPath
  if ($LASTEXITCODE -ne 0) { throw "pg_restore failed with exit code $LASTEXITCODE" }
  & docker @compose run --rm migrate
  if ($LASTEXITCODE -ne 0) { throw "Post-restore migration failed" }
  & docker @compose up -d api web gateway
  if ($LASTEXITCODE -ne 0) { throw "Services did not restart cleanly" }

  $servicesStopped = $false
  $restoreComplete = $true
}
catch {
  $failure = $_
}
finally {
  try {
    try {
      & docker @compose exec -T postgres rm -f $containerPath 2>$null | Out-Null
      if ($servicesStopped -and -not $restoreComplete) {
        & docker @compose stop gateway api
        if ($LASTEXITCODE -ne 0) {
          if (-not $failure) { $failure = [System.Exception]::new("Restore failed and partially started services could not be stopped") }
          else { Write-Warning "Could not confirm that gateway and API are stopped after the restore failure." }
        }
        Write-Warning "Restore did not complete. API and gateway remain stopped for inspection."
      }
    } catch {
      if (-not $failure) { $failure = $_ } else { Write-Warning "Service cleanup after restore also failed: $($_.Exception.Message)" }
    }
    try {
      if ($remoteVerificationRoot -and (Test-Path -LiteralPath $remoteVerificationRoot)) {
        Remove-Item -LiteralPath $remoteVerificationRoot -Recurse -Force
      }
    } catch {
      if (-not $failure) { $failure = $_ } else { Write-Warning "Remote verification cleanup also failed: $($_.Exception.Message)" }
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
Write-Host "Complete recovery set restored to database '$ConfirmDatabaseName' and bucket '$ConfirmBucketName'."
