$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$resultPath = Join-Path $repositoryRoot "persistence-smoke-result.json"
$runLogPath = Join-Path $repositoryRoot "persistence-smoke-run.log"

function Write-SmokeLog([string] $Message) {
  $Message | Tee-Object -FilePath $runLogPath -Append
}

trap {
  $failure = "PERSISTENCE_SMOKE_FAILED line {0}: {1}" -f $_.InvocationInfo.ScriptLineNumber, $_.Exception.Message
  $failure | Set-Content -Path $resultPath -Encoding UTF8
  Write-SmokeLog $failure
  Stop-SmokeApi
  exit 1
}

$baseUrl = "http://127.0.0.1:4194"
$userPhone = "13900004194"
$peerPhone = "13900004195"
$adminPhone = "13900139999"
$testOtp = "123456"
$databaseUrl = if ($env:PERSISTENCE_DATABASE_URL) { $env:PERSISTENCE_DATABASE_URL } else { "postgresql://ai_marriage:ai_marriage_dev_password@127.0.0.1:5432/ai_marriage" }
$s3Endpoint = if ($env:PERSISTENCE_S3_ENDPOINT) { $env:PERSISTENCE_S3_ENDPOINT } else { "http://127.0.0.1:9000" }
$s3AccessKey = if ($env:PERSISTENCE_S3_ACCESS_KEY) { $env:PERSISTENCE_S3_ACCESS_KEY } else { "minioadmin" }
$s3SecretKey = if ($env:PERSISTENCE_S3_SECRET_KEY) { $env:PERSISTENCE_S3_SECRET_KEY } else { "minioadmin_dev_password" }
$s3Bucket = if ($env:PERSISTENCE_S3_BUCKET) { $env:PERSISTENCE_S3_BUCKET } else { "ai-marriage-local" }
$nodeCommand = if ($env:PERSISTENCE_NODE_COMMAND) { $env:PERSISTENCE_NODE_COMMAND } else { "node" }
$script:smokeApiProcess = $null
$script:smokeStdoutTask = $null
$script:smokeStderrTask = $null
$script:smokeStdoutPath = $null
$script:smokeStderrPath = $null

function Stop-SmokeApi {
  if ($script:smokeApiProcess) {
    if (-not $script:smokeApiProcess.HasExited) {
      $script:smokeApiProcess.Kill()
      $script:smokeApiProcess.WaitForExit(5000) | Out-Null
    }
    if ($script:smokeStdoutTask) {
      Set-Content -LiteralPath $script:smokeStdoutPath -Encoding utf8 -Value ($script:smokeStdoutTask.GetAwaiter().GetResult())
    }
    if ($script:smokeStderrTask) {
      Set-Content -LiteralPath $script:smokeStderrPath -Encoding utf8 -Value ($script:smokeStderrTask.GetAwaiter().GetResult())
    }
    $script:smokeApiProcess.Dispose()
    $script:smokeApiProcess = $null
    $script:smokeStdoutTask = $null
    $script:smokeStderrTask = $null
    $script:smokeStdoutPath = $null
    $script:smokeStderrPath = $null
  }
  Start-Sleep -Seconds 1
}

function Test-SmokePortInUse {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $connection = $client.ConnectAsync("127.0.0.1", 4194)
    return $connection.Wait(250) -and $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Start-SmokeApi([string] $logSuffix) {
  if (Test-SmokePortInUse) { throw "Persistence smoke port 4194 is already in use by another process." }
  $script:smokeStdoutPath = Join-Path $repositoryRoot "persistence-api-$logSuffix.log"
  $script:smokeStderrPath = Join-Path $repositoryRoot "persistence-api-$logSuffix.error.log"
  Remove-Item -LiteralPath $script:smokeStdoutPath -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $script:smokeStderrPath -ErrorAction SilentlyContinue
  $env:NODE_ENV = "development"
  $env:ALLOW_DEV_OTP = "true"
  $env:DEV_OTP_CODE = "123456"
  $env:API_PORT = "4194"
  $env:DATABASE_URL = $databaseUrl
  $env:APP_ENCRYPTION_KEY = "local-persistence-verification-key-123456789"
  $env:CORS_ALLOWED_ORIGINS = "http://127.0.0.1:4183"
  $env:SMS_PROVIDER = "console"
  $env:OBJECT_STORAGE_PROVIDER = "s3"
  $env:S3_ENDPOINT = $s3Endpoint
  $env:S3_REGION = "us-east-1"
  $env:S3_ACCESS_KEY = $s3AccessKey
  $env:S3_SECRET_KEY = $s3SecretKey
  $env:S3_BUCKET = $s3Bucket
  $env:S3_PUBLIC_BASE_URL = "${s3Endpoint}/${s3Bucket}"
  $env:S3_FORCE_PATH_STYLE = "true"
  $env:AVATAR_MODEL_PROVIDER = "deterministic"
  $env:ADMIN_PHONES = $adminPhone
  $nodePath = (Get-Command $nodeCommand -ErrorAction Stop).Source
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $nodePath
  $startInfo.Arguments = "apps/api/dist/start.js"
  $startInfo.WorkingDirectory = $repositoryRoot
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $script:smokeApiProcess = [System.Diagnostics.Process]::new()
  $script:smokeApiProcess.StartInfo = $startInfo
  if (-not $script:smokeApiProcess.Start()) { throw "Could not start the persistence API process." }
  $script:smokeStdoutTask = $script:smokeApiProcess.StandardOutput.ReadToEndAsync()
  $script:smokeStderrTask = $script:smokeApiProcess.StandardError.ReadToEndAsync()

  $deadline = (Get-Date).AddSeconds(30)
  do {
    try {
      Invoke-RestMethod "$baseUrl/api/health" -TimeoutSec 2 | Out-Null
      return
    } catch {
      if ($script:smokeApiProcess.HasExited) {
        $failedStderrPath = $script:smokeStderrPath
        Stop-SmokeApi
        Get-Content $failedStderrPath -ErrorAction SilentlyContinue
        throw "Persistence API exited before becoming healthy."
      }
      Start-Sleep -Seconds 1
    }
  } while ((Get-Date) -lt $deadline)

  $failedStderrPath = $script:smokeStderrPath
  Stop-SmokeApi
  Get-Content $failedStderrPath -ErrorAction SilentlyContinue
  throw "Persistence API failed to start."
}

function Send-Json(
  [string] $Method,
  [string] $Path,
  $Body,
  [Microsoft.PowerShell.Commands.WebRequestSession] $Session
) {
  $parameters = @{
    Uri = "$baseUrl$Path"
    Method = $Method
    WebSession = $Session
  }
  if ($null -ne $Body) {
    $parameters.ContentType = "application/json; charset=utf-8"
    $jsonBody = $Body | ConvertTo-Json -Depth 8 -Compress
    $parameters.Body = [System.Text.Encoding]::UTF8.GetBytes($jsonBody)
  }
  try {
    Invoke-RestMethod @parameters
  } catch {
    $response = $_.Exception.Response
    $details = $_.ErrorDetails.Message
    if (-not $details -and $response -and $response.PSObject.Methods.Name -contains "GetResponseStream") {
      $stream = $response.GetResponseStream()
      if ($stream) {
        $reader = New-Object System.IO.StreamReader($stream)
        $details = $reader.ReadToEnd()
      }
    }
    throw ("HTTP {0} {1} failed: {2}" -f $Method, $Path, $details)
  }
}

function Convert-UnicodeEscape([string] $Value) {
  [regex]::Unescape($Value)
}

$female = Convert-UnicodeEscape "\u5973\u6027"
$male = Convert-UnicodeEscape "\u7537\u6027"
$neverMarried = Convert-UnicodeEscape "\u672a\u5a5a"
$seriousRelationship = Convert-UnicodeEscape "\u8ba4\u771f\u4ea4\u5f80"
$neverSmokes = Convert-UnicodeEscape "\u4e0d\u5438\u70df"
$hasChildren = Convert-UnicodeEscape "\u6709\u5b50\u5973"
$noChildren = Convert-UnicodeEscape "\u65e0\u5b50\u5973"
$momentTag = Convert-UnicodeEscape "\u52a8\u6001"
$completeAnswers = @{}
$completeAnswers[(Convert-UnicodeEscape "\u51fa\u73b0\u5206\u6b67\u65f6\uff0c\u4f60\u901a\u5e38\u600e\u6837\u5904\u7406\uff1f")] = "Calm down first and discuss honestly."
$completeAnswers[(Convert-UnicodeEscape "\u4f60\u5e73\u65f6\u66f4\u4e60\u60ef\u600e\u6837\u8868\u8fbe\u5173\u5fc3\uff1f")] = "Listen carefully and help with everyday tasks."
$completeAnswers[(Convert-UnicodeEscape "\u5f53\u4f60\u9700\u8981\u72ec\u5904\u65f6\uff0c\u4f1a\u600e\u6837\u544a\u8bc9\u5bf9\u65b9\uff1f")] = "Explain clearly and agree when to talk again."
$completeAnswers[(Convert-UnicodeEscape "\u4f60\u7406\u60f3\u4e2d\u7684\u5468\u672b\u662f\u4ec0\u4e48\u6837\u7684\uff1f")] = "Walking, reading and cooking together."
$completeAnswers[(Convert-UnicodeEscape "\u4f60\u7684\u65e5\u5e38\u4f5c\u606f\u548c\u751f\u6d3b\u8282\u594f\u662f\u600e\u6837\u7684\uff1f")] = "Regular workdays and relaxed weekends."
$completeAnswers[(Convert-UnicodeEscape "\u4f60\u5e0c\u671b\u4e24\u4e2a\u4eba\u600e\u6837\u5206\u62c5\u5bb6\u52a1\uff1f")] = "Discuss responsibilities and share them fairly."
$completeAnswers[(Convert-UnicodeEscape "\u672a\u6765\u51e0\u5e74\u662f\u5426\u613f\u610f\u4e3a\u5173\u7cfb\u8c03\u6574\u57ce\u5e02\uff1f")] = "Discuss work and family needs before deciding."
$completeAnswers[(Convert-UnicodeEscape "\u4f60\u671f\u5f85\u4e09\u5230\u4e94\u5e74\u540e\u7684\u751f\u6d3b\u662f\u4ec0\u4e48\u6837\u7684\uff1f")] = "A stable home with companionship and personal space."
$completeAnswers[(Convert-UnicodeEscape "\u4f60\u5e0c\u671b\u4e24\u4e2a\u4eba\u600e\u6837\u5546\u91cf\u50a8\u84c4\u548c\u65e5\u5e38\u5f00\u652f\uff1f")] = "Keep daily spending clear and decide large expenses together."
$completeAnswers[(Convert-UnicodeEscape "\u4f60\u5e0c\u671b\u600e\u6837\u4e0e\u53cc\u65b9\u7236\u6bcd\u76f8\u5904\uff1f")] = "Respect both families and protect the couple's decisions."
$completeAnswers[(Convert-UnicodeEscape "\u4f60\u5bf9\u662f\u5426\u8981\u5b69\u5b50\u6216\u4e0e\u5b50\u5973\u76f8\u5904\u6709\u4ec0\u4e48\u60f3\u6cd5\uff1f")] = "Respect existing family responsibilities and discuss major choices."
$completeAnswers[(Convert-UnicodeEscape "\u8282\u5047\u65e5\u548c\u91cd\u8981\u5bb6\u5ead\u5b89\u6392\uff0c\u4f60\u5e0c\u671b\u600e\u6837\u534f\u5546\uff1f")] = "Plan early and keep the arrangement fair."
$completeAnswers[(Convert-UnicodeEscape "\u54ea\u4e9b\u884c\u4e3a\u662f\u4f60\u660e\u786e\u4e0d\u80fd\u63a5\u53d7\u7684\uff1f")] = "Dishonesty, violence and prolonged refusal to communicate."
$completeAnswers[(Convert-UnicodeEscape "\u4f60\u5e0c\u671b\u5f7c\u6b64\u4fdd\u7559\u54ea\u4e9b\u4e2a\u4eba\u7a7a\u95f4\uff1f")] = "Keep friendships, interests and reasonable time alone."
$completeAnswers[(Convert-UnicodeEscape "\u4f60\u6700\u5e0c\u671b\u5bf9\u65b9\u5148\u4e86\u89e3\u4f60\u7684\u54ea\u4e00\u9762\uff1f")] = "I value honesty, stability and patient communication."

Stop-SmokeApi
Remove-Item $resultPath -ErrorAction SilentlyContinue
Remove-Item $runLogPath -ErrorAction SilentlyContinue
Start-SmokeApi "first"

$userSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$peerSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$adminSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession

Send-Json POST "/api/auth/otp/request" @{ phone = $userPhone } $userSession | Out-Null
Write-SmokeLog "step=user-otp-requested"
$verified = Send-Json POST "/api/auth/otp/verify" @{ phone = $userPhone; code = $testOtp } $userSession
Write-SmokeLog "step=user-verified"
$userId = $verified.data.user.id

Send-Json POST "/api/auth/otp/request" @{ phone = $peerPhone } $peerSession | Out-Null
Write-SmokeLog "step=peer-otp-requested"
$peerVerified = Send-Json POST "/api/auth/otp/verify" @{ phone = $peerPhone; code = $testOtp } $peerSession
Write-SmokeLog "step=peer-verified"
$peerUserId = $peerVerified.data.user.id

Send-Json PATCH "/api/me/profile" @{
  nickname = "Persistence Test User"
  gender = $female
  birthYear = 1978
  city = "Shanghai"
  district = "Xuhui"
  job = "Product testing"
  maritalStatus = $neverMarried
  goal = $seriousRelationship
  introduction = "Used to verify database and object storage recovery across API restarts."
  smokingStatus = $neverSmokes
  childrenStatus = $hasChildren
  preference = @{
    preferredGender = $male
    relationshipGoal = $seriousRelationship
    region = "same city"
    valuedQualities = "honest, stable, communicative"
    dealBreakers = "dishonesty and disrespect"
  }
  answers = $completeAnswers
} $userSession | Out-Null
Write-SmokeLog "step=profile-saved"

Send-Json PATCH "/api/me/profile" @{
  nickname = "Persistence Test Peer"
  gender = $male
  birthYear = 1975
  city = "Shanghai"
  district = "Pudong"
  job = "Engineering management"
  maritalStatus = $neverMarried
  goal = $seriousRelationship
  introduction = "Used as the second account in the persistent contact-flow verification."
  smokingStatus = $neverSmokes
  childrenStatus = $noChildren
  preference = @{
    preferredGender = $female
    relationshipGoal = $seriousRelationship
    region = "same city"
    valuedQualities = "honest, stable, communicative"
    dealBreakers = "dishonesty and disrespect"
  }
  answers = $completeAnswers
} $peerSession | Out-Null
Write-SmokeLog "step=peer-profile-saved"

$existingPhotos = Send-Json GET "/api/me/photos" $null $userSession
foreach ($existingPhoto in @($existingPhotos.data.items)) {
  Send-Json DELETE "/api/me/photos/$($existingPhoto.id)" $null $userSession | Out-Null
}
Write-SmokeLog "step=old-photos-cleared"

$existingPeerPhotos = Send-Json GET "/api/me/photos" $null $peerSession
foreach ($existingPhoto in @($existingPeerPhotos.data.items)) {
  Send-Json DELETE "/api/me/photos/$($existingPhoto.id)" $null $peerSession | Out-Null
}
Write-SmokeLog "step=peer-old-photos-cleared"

$png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zt9sAAAAASUVORK5CYII="
$uploaded = Send-Json POST "/api/me/photos" @{
  filename = "portrait.png"
  mimeType = "image/png"
  sizeBytes = 68
  dataUrl = "data:image/png;base64,$png"
} $userSession
$photoId = $uploaded.data.photo.id
Write-SmokeLog "step=photo-uploaded"
$peerUploaded = Send-Json POST "/api/me/photos" @{
  filename = "peer-portrait.png"
  mimeType = "image/png"
  sizeBytes = 68
  dataUrl = "data:image/png;base64,$png"
} $peerSession
$peerPhotoId = $peerUploaded.data.photo.id
Write-SmokeLog "step=peer-photo-uploaded"
Send-Json POST "/api/me/avatar-profile/generate" @{} $userSession | Out-Null
Write-SmokeLog "step=avatar-generated"
Send-Json POST "/api/me/avatar-profile/enable" @{} $userSession | Out-Null
Write-SmokeLog "step=avatar-enabled"
Send-Json POST "/api/me/avatar-profile/generate" @{} $peerSession | Out-Null
Write-SmokeLog "step=peer-avatar-generated"
Send-Json POST "/api/me/avatar-profile/enable" @{} $peerSession | Out-Null
Write-SmokeLog "step=peer-avatar-enabled"

Send-Json POST "/api/auth/otp/request" @{ phone = $adminPhone } $adminSession | Out-Null
Write-SmokeLog "step=admin-otp-requested"
Send-Json POST "/api/auth/otp/verify" @{ phone = $adminPhone; code = $testOtp } $adminSession | Out-Null
Write-SmokeLog "step=admin-verified"
Send-Json POST "/api/admin/profiles/$userId/approve" @{} $adminSession | Out-Null
Write-SmokeLog "step=profile-approved"
Send-Json POST "/api/admin/photos/$photoId/approve" @{} $adminSession | Out-Null
Write-SmokeLog "step=photo-approved"
Send-Json POST "/api/admin/profiles/$peerUserId/approve" @{} $adminSession | Out-Null
Write-SmokeLog "step=peer-profile-approved"
Send-Json POST "/api/admin/photos/$peerPhotoId/approve" @{} $adminSession | Out-Null
Write-SmokeLog "step=peer-photo-approved"
Send-Json PATCH "/api/me/visibility" @{ visibility = "public" } $userSession | Out-Null
Write-SmokeLog "step=user-visibility-public"

$existingOwnContent = Send-Json GET "/api/me/content" $null $userSession
foreach ($existingItem in @($existingOwnContent.data.items)) {
  if (@($existingItem.tags) -contains $momentTag) {
    Send-Json DELETE "/api/me/content/$($existingItem.id)" $null $userSession | Out-Null
  }
}
Write-SmokeLog "step=old-member-moments-cleared"

$momentCreated = Send-Json POST "/api/me/moments" @{
  body = "Persistent member moment image verification."
  images = @(@{
    filename = "moment.png"
    mimeType = "image/png"
    sizeBytes = 68
    dataUrl = "data:image/png;base64,$png"
  })
} $userSession
$momentId = $momentCreated.data.content.id
$momentImageUrl = [string](@($momentCreated.data.content.imageUrls)[0])
if (-not $momentImageUrl.StartsWith("/api/content-images/") -or $momentImageUrl.Length -gt 2048) { throw "Member moment returned an invalid image URL." }
Send-Json POST "/api/admin/content/$momentId/publish" @{} $adminSession | Out-Null
Write-SmokeLog "step=member-moment-published"

$memberId = "member-$userId"
$peerMemberId = "member-$peerUserId"
$topicQuestions = @(
  Convert-UnicodeEscape "\u5468\u672b\u901a\u5e38\u600e\u4e48\u5b89\u6392\uff1f"
  Convert-UnicodeEscape "\u5e0c\u671b\u5efa\u7acb\u600e\u6837\u7684\u5173\u7cfb\uff1f"
  Convert-UnicodeEscape "\u9047\u5230\u5206\u6b67\u65f6\u600e\u6837\u6c9f\u901a\uff1f"
)
Send-Json POST "/api/members/$peerMemberId/interest" @{} $userSession | Out-Null
$avatarSession = Send-Json POST "/api/avatar-sessions" @{ memberId = $peerMemberId } $userSession
$avatarSessionId = $avatarSession.data.session.id
foreach ($question in $topicQuestions) {
  Send-Json POST "/api/avatar-sessions/$avatarSessionId/messages" @{ text = $question } $userSession | Out-Null
}
$chatRequest = Send-Json POST "/api/chat-requests" @{ avatarSessionId = $avatarSessionId } $userSession
$accepted = Send-Json POST "/api/chat-requests/$($chatRequest.data.request.id)/accept" @{} $peerSession
$conversationId = $accepted.data.conversation.id
Write-SmokeLog "step=first-direction-chat-accepted"

Send-Json POST "/api/members/$memberId/interest" @{} $peerSession | Out-Null
$reverseAvatarSession = Send-Json POST "/api/avatar-sessions" @{ memberId = $memberId } $peerSession
$reverseAvatarSessionId = $reverseAvatarSession.data.session.id
foreach ($question in $topicQuestions) {
  Send-Json POST "/api/avatar-sessions/$reverseAvatarSessionId/messages" @{ text = $question } $peerSession | Out-Null
}
$reverseChatRequest = Send-Json POST "/api/chat-requests" @{ avatarSessionId = $reverseAvatarSessionId } $peerSession
$reverseAccepted = Send-Json POST "/api/chat-requests/$($reverseChatRequest.data.request.id)/accept" @{} $userSession
if ($reverseAccepted.data.conversation.id -ne $conversationId) { throw "Bidirectional requests created different conversations." }
Write-SmokeLog "step=reverse-chat-reused-conversation"

Send-Json POST "/api/conversations/$conversationId/messages" @{
  text = "Persistent conversation verification."
  clientMessageId = "persistence-smoke-message"
} $userSession | Out-Null
Write-SmokeLog "step=conversation-message-saved"
Stop-SmokeApi
Write-SmokeLog "step=api-stopped"
Start-SmokeApi "restart"
Write-SmokeLog "step=api-restarted"

$me = Send-Json GET "/api/me" $null $userSession
$photos = Send-Json GET "/api/me/photos" $null $userSession
$avatar = Send-Json GET "/api/me/avatar-profile" $null $userSession
$peerAvatar = Send-Json GET "/api/me/avatar-profile" $null $peerSession
$members = Send-Json GET "/api/members?city=Shanghai" $null $adminSession
$conversations = Send-Json GET "/api/conversations" $null $userSession
$persistedConversation = @($conversations.data.items) | Where-Object id -eq $conversationId
$conversationMessages = Send-Json GET "/api/conversations/$conversationId/messages" $null $userSession
$photoResponse = Invoke-WebRequest -Uri "$baseUrl/api/photos/$photoId/content" -WebSession $userSession -UseBasicParsing
$peerPhotoResponse = Invoke-WebRequest -Uri "$baseUrl/api/photos/$peerPhotoId/content" -WebSession $peerSession -UseBasicParsing
$momentImageResponse = Invoke-WebRequest -Uri "$baseUrl$momentImageUrl" -UseBasicParsing
$publicMoments = Send-Json GET "/api/content?tag=$([System.Uri]::EscapeDataString($momentTag))" $null $adminSession
$persistedMoment = @($publicMoments.data.items) | Where-Object id -eq $momentId

if (@($persistedConversation).Count -ne 1) { throw "The unique conversation was not restored after restart." }
if (@($conversationMessages.data.items | Where-Object clientMessageId -eq "persistence-smoke-message").Count -ne 1) { throw "The persistent conversation message was not restored exactly once." }
if (@($persistedMoment).Count -ne 1) { throw "The published member moment was not restored after restart." }
if ($momentImageResponse.Headers["Content-Type"] -notlike "image/png*" -or $momentImageResponse.RawContentStream.Length -ne 68) { throw "The member moment image was not restored from object storage after restart." }

Send-Json DELETE "/api/me/content/$momentId" $null $userSession | Out-Null
Write-SmokeLog "step=member-moment-deleted"

Send-Json POST "/api/users/$peerUserId/block" @{} $userSession | Out-Null
Write-SmokeLog "step=peer-blocked"
Stop-SmokeApi
Start-SmokeApi "blocked-restart"
$blockedConversations = Send-Json GET "/api/conversations" $null $userSession
$blockedConversation = @($blockedConversations.data.items) | Where-Object id -eq $conversationId
if ($blockedConversation.status -ne "blocked") { throw "Blocked conversation state was not restored after restart." }
$contentAfterMomentDeletion = Send-Json GET "/api/me/content" $null $userSession
if (@($contentAfterMomentDeletion.data.items | Where-Object id -eq $momentId).Count -ne 0) { throw "Deleted member moment was restored after restart." }
Write-SmokeLog "step=blocked-state-restored"

Send-Json DELETE "/api/users/$peerUserId/block" $null $userSession | Out-Null
Write-SmokeLog "step=peer-unblocked"
Stop-SmokeApi
Start-SmokeApi "unblocked-restart"
$unblockedConversations = Send-Json GET "/api/conversations" $null $userSession
$unblockedConversation = @($unblockedConversations.data.items) | Where-Object id -eq $conversationId
if ($unblockedConversation.status -ne "active") { throw "Unblocked conversation state was not restored after restart." }
Write-SmokeLog "step=unblocked-state-restored"

Send-Json PATCH "/api/me/profile" @{
  nickname = "Persistence Test User Updated"
  gender = $female
  birthYear = 1978
  city = "Shanghai"
  district = "Xuhui"
  job = "Product testing"
  maritalStatus = $neverMarried
  goal = $seriousRelationship
  introduction = "Updated to verify that resubmission pauses the AI avatar across restarts."
  smokingStatus = $neverSmokes
  childrenStatus = $hasChildren
  preference = @{
    preferredGender = $male
    relationshipGoal = $seriousRelationship
    region = "same city"
    valuedQualities = "honest, stable, communicative"
    dealBreakers = "dishonesty and disrespect"
  }
  answers = $completeAnswers
} $userSession | Out-Null
Write-SmokeLog "step=profile-resubmitted"
Stop-SmokeApi
Start-SmokeApi "resubmitted-restart"
$resubmittedAvatar = Send-Json GET "/api/me/avatar-profile" $null $userSession
$membersAfterResubmission = Send-Json GET "/api/members?city=Shanghai" $null $adminSession
if ($resubmittedAvatar.data.avatarProfile.status -ne "paused") { throw "Profile resubmission did not keep the AI avatar paused after restart." }
if (@($membersAfterResubmission.data.items | Where-Object id -eq $memberId).Count -ne 0) { throw "Pending profile was publicly restored after restart." }
Write-SmokeLog "step=resubmission-state-restored"

$result = [pscustomobject]@{
  userId = $me.data.user.id
  nickname = $me.data.profile.nickname
  photoCount = @($photos.data.items).Count
  photoStatus = $photos.data.items[0].reviewStatus
  photoContentType = $photoResponse.Headers["Content-Type"]
  photoContentBytes = $photoResponse.RawContentStream.Length
  peerPhotoContentBytes = $peerPhotoResponse.RawContentStream.Length
  momentImageContentBytes = $momentImageResponse.RawContentStream.Length
  memberMomentRestored = @($persistedMoment).Count -eq 1
  memberMomentDeletionPersisted = @($contentAfterMomentDeletion.data.items | Where-Object id -eq $momentId).Count -eq 0
  avatarStatusBeforeResubmission = $avatar.data.avatarProfile.status
  peerAvatarStatus = $peerAvatar.data.avatarProfile.status
  publicMemberFoundBeforeResubmission = [bool](@($members.data.items) | Where-Object id -eq $memberId)
  uniqueConversationRestored = @($persistedConversation).Count -eq 1
  conversationMessageRestored = @($conversationMessages.data.items | Where-Object clientMessageId -eq "persistence-smoke-message").Count -eq 1
  blockedStateRestored = $blockedConversation.status -eq "blocked"
  unblockedStateRestored = $unblockedConversation.status -eq "active"
  avatarPausedAfterResubmission = $resubmittedAvatar.data.avatarProfile.status -eq "paused"
  memberHiddenAfterResubmission = @($membersAfterResubmission.data.items | Where-Object id -eq $memberId).Count -eq 0
}

if ($result.nickname -ne "Persistence Test User") { throw "Profile was not restored after the first restart." }
if ($result.photoCount -lt 1 -or $result.photoStatus -ne "approved") { throw "Approved photo was not restored after restart." }
if ($result.photoContentType -notlike "image/png*" -or $result.photoContentBytes -ne 68) { throw "Photo content was not restored from object storage after restart." }
if ($result.peerPhotoContentBytes -ne 68) { throw "Peer photo content was not restored from object storage after restart." }
if ($result.momentImageContentBytes -ne 68 -or -not $result.memberMomentRestored -or -not $result.memberMomentDeletionPersisted) { throw "Member moment persistence verification failed." }
if ($result.avatarStatusBeforeResubmission -ne "enabled" -or $result.peerAvatarStatus -ne "enabled") { throw "Enabled avatar profiles were not restored after restart." }
if (-not $result.publicMemberFoundBeforeResubmission) { throw "Approved public member was not returned after restart." }

$resultJson = $result | ConvertTo-Json -Compress
$resultJson | Set-Content -Path $resultPath -Encoding UTF8
Write-SmokeLog $resultJson
Stop-SmokeApi
