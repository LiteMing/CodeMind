#requires -Version 7.0

[CmdletBinding()]
param(
  [string]$Executable,
  [int]$Port = 0,
  [string]$ReportPath,
  [switch]$KeepArtifacts,
  [switch]$IncludeRegression
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repoRoot = Split-Path -Parent $PSScriptRoot
$results = [System.Collections.Generic.List[object]]::new()
$serverProcess = $null
$serverStdoutTask = $null
$serverStderrTask = $null
$serverStdout = ''
$serverStderr = ''
$httpClient = $null
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("codemind-p1-contract-" + [guid]::NewGuid().ToString('N'))
$dataDir = Join-Path $tempRoot 'data'

function Add-Result {
  param(
    [string]$Id,
    [string]$Name,
    [ValidateSet('PASS', 'FAIL', 'SKIP')]
    [string]$Status,
    [string]$Detail = ''
  )
  $results.Add([pscustomobject]@{
    id = $Id
    name = $Name
    status = $Status
    detail = $Detail
  })
  $color = switch ($Status) {
    'PASS' { 'Green' }
    'FAIL' { 'Red' }
    default { 'Yellow' }
  }
  Write-Host ("[{0}] {1} {2}{3}" -f $Status, $Id, $Name, $(if ($Detail) { " - $Detail" } else { '' })) -ForegroundColor $color
}

function Test-Step {
  param(
    [string]$Id,
    [string]$Name,
    [scriptblock]$Action
  )
  try {
    & $Action
    Add-Result -Id $Id -Name $Name -Status PASS
    return $true
  } catch {
    Add-Result -Id $Id -Name $Name -Status FAIL -Detail $_.Exception.Message
    return $false
  }
}

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) {
    throw $Message
  }
}

function Assert-Equal {
  param($Expected, $Actual, [string]$Label)
  if ($Expected -ne $Actual) {
    throw "$Label expected <$Expected>, got <$Actual>"
  }
}

function Get-FreePort {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try {
    return ([Net.IPEndPoint]$listener.LocalEndpoint).Port
  } finally {
    $listener.Stop()
  }
}

function Get-ListeningProcessIds {
  param([int]$ListenPort)
  try {
    return @(Get-NetTCPConnection -State Listen -LocalPort $ListenPort -ErrorAction Stop |
      Select-Object -ExpandProperty OwningProcess -Unique)
  } catch {
    $pattern = ":$ListenPort\s+.*LISTENING\s+(\d+)\s*$"
    return @(netstat -ano | ForEach-Object {
      if ($_ -match $pattern) { [int]$Matches[1] }
    } | Sort-Object -Unique)
  }
}

function Resolve-CodeMindExecutable {
  if ($Executable) {
    $resolved = Resolve-Path -LiteralPath $Executable -ErrorAction Stop
    return $resolved.Path
  }
  $candidate = Get-ChildItem -LiteralPath (Join-Path $repoRoot 'build/bin') -Filter 'CodeMind-*.exe' -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notlike '*.pending.exe' } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $candidate) {
    throw 'No versioned CodeMind EXE found under build/bin. Run npm run build:desktop or pass -Executable.'
  }
  return $candidate.FullName
}

function Invoke-ProcessCapture {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory = $repoRoot,
    [hashtable]$Environment = @{},
    [int]$TimeoutSeconds = 120
  )
  $resolvedFilePath = if (Test-Path -LiteralPath $FilePath) {
    (Resolve-Path -LiteralPath $FilePath).Path
  } else {
    $command = Get-Command $FilePath -CommandType Application -ErrorAction Stop | Select-Object -First 1
    $command.Source
  }
  $psi = [Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $resolvedFilePath
  $psi.WorkingDirectory = $WorkingDirectory
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  foreach ($argument in $Arguments) {
    [void]$psi.ArgumentList.Add($argument)
  }
  foreach ($key in $Environment.Keys) {
    $psi.Environment[$key] = [string]$Environment[$key]
  }
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $psi
  $started = $false
  try {
    [void]$process.Start()
    $started = $true
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      $process.Kill($true)
      $process.WaitForExit()
      throw "Process timed out after $TimeoutSeconds seconds: $resolvedFilePath $($Arguments -join ' ')"
    }
    return [pscustomobject]@{
      ExitCode = $process.ExitCode
      Stdout = $stdoutTask.GetAwaiter().GetResult()
      Stderr = $stderrTask.GetAwaiter().GetResult()
    }
  } finally {
    if ($started -and -not $process.HasExited) {
      $process.Kill($true)
      $process.WaitForExit()
    }
    $process.Dispose()
  }
}

function Start-CodeMindServer {
  param([string]$ExePath, [int]$ListenPort)
  $psi = [Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $ExePath
  $psi.WorkingDirectory = $repoRoot
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  [void]$psi.ArgumentList.Add('serve')
  $psi.Environment['CODE_MIND_PORT'] = [string]$ListenPort
  $psi.Environment['CODE_MIND_DATA_DIR'] = $dataDir
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $psi
  [void]$process.Start()
  $script:serverStdoutTask = $process.StandardOutput.ReadToEndAsync()
  $script:serverStderrTask = $process.StandardError.ReadToEndAsync()
  return $process
}

function Send-Http {
  param(
    [string]$Method,
    [string]$Path,
    $Body = $null,
    [hashtable]$Headers = @{}
  )
  $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::new($Method), $Path)
  foreach ($key in $Headers.Keys) {
    [void]$request.Headers.TryAddWithoutValidation($key, [string]$Headers[$key])
  }
  if ($null -ne $Body) {
    $payload = if ($Body -is [string]) { $Body } else { $Body | ConvertTo-Json -Depth 100 -Compress }
    $request.Content = [Net.Http.StringContent]::new($payload, [Text.Encoding]::UTF8, 'application/json')
  }
  $response = $httpClient.SendAsync($request).GetAwaiter().GetResult()
  $responseBody = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  $responseHeaders = @{}
  foreach ($header in $response.Headers) {
    $responseHeaders[$header.Key] = @($header.Value)
  }
  foreach ($header in $response.Content.Headers) {
    $responseHeaders[$header.Key] = @($header.Value)
  }
  $json = $null
  if ($responseBody) {
    try { $json = $responseBody | ConvertFrom-Json -Depth 100 } catch { }
  }
  $request.Dispose()
  $response.Dispose()
  return [pscustomobject]@{
    Status = [int]$response.StatusCode
    Headers = $responseHeaders
    Body = $responseBody
    Json = $json
  }
}

function Command-Headers {
  param(
    [int]$Revision,
    [string]$Key,
    [string]$Partition = 'development',
    [string]$Token = ''
  )
  $headers = @{
    'If-Match' = '"rev-{0}"' -f $Revision
    'X-CodeMind-Partition' = $Partition
    'Idempotency-Key' = $Key
  }
  if ($Token) {
    $headers['Authorization'] = "Bearer $Token"
  }
  return $headers
}

function Get-MapDocument {
  param([string]$MapId, [string]$Token = '')
  $headers = @{}
  if ($Token) { $headers['Authorization'] = "Bearer $Token" }
  $response = Send-Http -Method GET -Path "/api/maps/$MapId" -Headers $headers
  Assert-Equal 200 $response.Status 'GET map status'
  return $response.Json
}

function Invoke-McpBatch {
  param(
    [string]$ExePath,
    [string]$BaseUrl,
    [string]$Token,
    [object[]]$Requests,
    [int]$TimeoutSeconds = 30
  )
  $psi = [Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $ExePath
  $psi.WorkingDirectory = $repoRoot
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  [void]$psi.ArgumentList.Add('mcp')
  $psi.Environment['CODEMIND_API_URL'] = $BaseUrl
  $psi.Environment['CODEMIND_ACCESS_TOKEN'] = $Token
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $psi
  $stdoutBuffer = [IO.MemoryStream]::new()
  $started = $false
  try {
    [void]$process.Start()
    $started = $true
    $stdoutTask = $process.StandardOutput.BaseStream.CopyToAsync($stdoutBuffer)
    $stderrTask = $process.StandardError.ReadToEndAsync()
    foreach ($request in $Requests) {
      $body = $request | ConvertTo-Json -Depth 100 -Compress
      $length = [Text.Encoding]::UTF8.GetByteCount($body)
      $process.StandardInput.Write("Content-Length: $length`r`n`r`n$body")
      $process.StandardInput.Flush()
    }
    $process.StandardInput.Close()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      $process.Kill($true)
      $process.WaitForExit()
      throw "MCP process timed out after $TimeoutSeconds seconds"
    }
    $stdoutTask.GetAwaiter().GetResult()
    return [pscustomobject]@{
      ExitCode = $process.ExitCode
      StdoutBytes = $stdoutBuffer.ToArray()
      Stderr = $stderrTask.GetAwaiter().GetResult()
    }
  } finally {
    if ($started -and -not $process.HasExited) {
      $process.Kill($true)
      $process.WaitForExit()
    }
    $process.Dispose()
    $stdoutBuffer.Dispose()
  }
}

function Parse-McpResponses {
  param([byte[]]$Payload)
  $responses = @()
  $index = 0
  $delimiter = [byte[]](13, 10, 13, 10)
  while ($index -lt $Payload.Length) {
    $headerEnd = -1
    for ($cursor = $index; $cursor -le $Payload.Length - $delimiter.Length; $cursor++) {
      if (
        $Payload[$cursor] -eq 13 -and
        $Payload[$cursor + 1] -eq 10 -and
        $Payload[$cursor + 2] -eq 13 -and
        $Payload[$cursor + 3] -eq 10
      ) {
        $headerEnd = $cursor
        break
      }
    }
    if ($headerEnd -lt 0) {
      throw "MCP stdout contains unframed trailing bytes at offset $index"
    }
    $header = [Text.Encoding]::ASCII.GetString($Payload, $index, $headerEnd - $index)
    $match = [regex]::Match($header, '(?im)^Content-Length:\s*(\d+)\s*$')
    if (-not $match.Success) {
      throw "MCP response missing Content-Length near offset $index"
    }
    $length = [int]$match.Groups[1].Value
    $bodyStart = $headerEnd + 4
    if ($bodyStart + $length -gt $Payload.Length) {
      throw 'MCP response body is truncated'
    }
    $body = [Text.Encoding]::UTF8.GetString($Payload, $bodyStart, $length)
    $responses += ($body | ConvertFrom-Json -Depth 100)
    $index = $bodyStart + $length
  }
  if ($index -ne $Payload.Length) {
    throw "MCP stdout was not consumed exactly: $index/$($Payload.Length) bytes"
  }
  return $responses
}

function Get-McpResponseById {
  param([object[]]$Responses, [int]$Id)
  $response = $Responses | Where-Object { $_.id -eq $Id } | Select-Object -First 1
  if (-not $response) { throw "Missing MCP response id $Id" }
  return $response
}

function Compare-FileBytes {
  param([string]$Left, [string]$Right)
  $leftHash = (Get-FileHash -LiteralPath $Left -Algorithm SHA256).Hash
  $rightHash = (Get-FileHash -LiteralPath $Right -Algorithm SHA256).Hash
  return $leftHash -eq $rightHash
}

function Write-JsonFile {
  param([string]$Path, $Value)
  $json = $Value | ConvertTo-Json -Depth 100
  [IO.File]::WriteAllText($Path, $json + "`n", [Text.UTF8Encoding]::new($false))
}

function Stop-Server {
  if (-not $script:serverProcess) { return }
  if (-not $script:serverProcess.HasExited) {
    $script:serverProcess.Kill($true)
    $script:serverProcess.WaitForExit()
  }
  if ($script:serverStdoutTask) { $script:serverStdout = $script:serverStdoutTask.GetAwaiter().GetResult() }
  if ($script:serverStderrTask) { $script:serverStderr = $script:serverStderrTask.GetAwaiter().GetResult() }
  New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $tempRoot 'server.stdout.log'), $script:serverStdout, [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText((Join-Path $tempRoot 'server.stderr.log'), $script:serverStderr, [Text.UTF8Encoding]::new($false))
  $script:serverProcess.Dispose()
  $script:serverProcess = $null
}

New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
$exe = Resolve-CodeMindExecutable
if ($Port -eq 0) { $Port = Get-FreePort }
$baseUrl = "http://127.0.0.1:$Port"
if (-not $ReportPath) {
  $reportDir = Join-Path $repoRoot 'build/reports'
  New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
  $ReportPath = Join-Path $reportDir ("p1-contract-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
}

Write-Host "CodeMind executable: $exe"
Write-Host "Temporary data: $dataDir"
Write-Host "Temporary API: $baseUrl"

try {
  $existingOwners = Get-ListeningProcessIds $Port
  if ($existingOwners.Count -gt 0) {
    throw "Port $Port is already owned by PID(s): $($existingOwners -join ', ')"
  }
  $serverProcess = Start-CodeMindServer -ExePath $exe -ListenPort $Port
  $httpClient = [Net.Http.HttpClient]::new()
  $httpClient.BaseAddress = [Uri]$baseUrl
  $httpClient.Timeout = [TimeSpan]::FromSeconds(10)

  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 250
    if ($serverProcess.HasExited) {
      Stop-Server
      throw "Server exited before becoming ready. stderr: $serverStderr"
    }
    $owners = Get-ListeningProcessIds $Port
    if ($owners.Count -gt 0 -and -not ($owners -contains $serverProcess.Id)) {
      throw "Port $Port was captured by unexpected PID(s): $($owners -join ', '); expected $($serverProcess.Id)"
    }
    if (-not ($owners -contains $serverProcess.Id)) { continue }
    try {
      $health = Send-Http -Method GET -Path '/api/health'
      if ($health.Status -eq 200) { $ready = $true; break }
    } catch { }
  }
  if (-not $ready) { throw "Server did not become ready on $baseUrl" }
  Add-Result -Id F2 -Name 'serve mode starts and health responds' -Status PASS

  $createMap = Send-Http -Method POST -Path '/api/maps' -Body @{ title = 'P1 Contract Automation' }
  Assert-Equal 201 $createMap.Status 'create map status'
  $mapId = [string]$createMap.Json.id
  $rootNode = $createMap.Json.nodes | Where-Object { $_.kind -eq 'root' } | Select-Object -First 1
  if (-not $rootNode) { throw 'Created map has no root node' }
  $rootId = [string]$rootNode.id

  [void](Test-Step B1 'missing If-Match returns 428' {
    $response = Send-Http -Method POST -Path "/api/maps/$mapId/nodes" -Body @{ parentId = $rootId; title = 'B1' }
    Assert-Equal 428 $response.Status 'status'
  })
  [void](Test-Step B3 'missing partition returns partition_required' {
    $response = Send-Http -Method POST -Path "/api/maps/$mapId/nodes" -Headers @{ 'If-Match' = '"rev-1"'; 'Idempotency-Key' = 'b3' } -Body @{ parentId = $rootId; title = 'B3' }
    Assert-Equal 400 $response.Status 'status'
    Assert-Equal 'partition_required' $response.Json.code 'code'
  })
  [void](Test-Step B4 'missing idempotency key returns invalid_idempotency_key' {
    $response = Send-Http -Method POST -Path "/api/maps/$mapId/nodes" -Headers @{ 'If-Match' = '"rev-1"'; 'X-CodeMind-Partition' = 'development' } -Body @{ parentId = $rootId; title = 'B4' }
    Assert-Equal 400 $response.Status 'status'
    Assert-Equal 'invalid_idempotency_key' $response.Json.code 'code'
  })
  [void](Test-Step B5 'stable partition is read-only' {
    $response = Send-Http -Method POST -Path "/api/maps/$mapId/nodes" -Headers (Command-Headers 1 'b5' 'stable') -Body @{ parentId = $rootId; title = 'B5' }
    Assert-Equal 403 $response.Status 'status'
    Assert-Equal 'stable_partition_read_only' $response.Json.code 'code'
  })

  $replayBody = @{ parentId = $rootId; title = 'Replay once' }
  $replayHeaders = Command-Headers 1 'b6-replay'
  $firstReplay = Send-Http -Method POST -Path "/api/maps/$mapId/nodes" -Headers $replayHeaders -Body $replayBody
  $secondReplay = Send-Http -Method POST -Path "/api/maps/$mapId/nodes" -Headers $replayHeaders -Body $replayBody
  [void](Test-Step B6 'identical command replays without another revision' {
    Assert-Equal 201 $firstReplay.Status 'first status'
    Assert-Equal 201 $secondReplay.Status 'second status'
    Assert-Equal 'true' ([string]$secondReplay.Headers['X-CodeMind-Idempotent-Replay'][0]) 'replay header'
    $document = Get-MapDocument $mapId
    Assert-Equal 2 ([int]$document.meta.revision) 'revision'
    Assert-Equal 2 @($document.nodes).Count 'node count'
  })
  [void](Test-Step B2 'stale revision returns structured 412' {
    $response = Send-Http -Method POST -Path "/api/maps/$mapId/nodes" -Headers (Command-Headers 1 'b2-stale') -Body @{ parentId = $rootId; title = 'Stale' }
    Assert-Equal 412 $response.Status 'status'
    Assert-Equal 1 ([int]$response.Json.expectedRevision) 'expectedRevision'
    Assert-Equal 2 ([int]$response.Json.actualRevision) 'actualRevision'
    Assert-Equal '"rev-2"' ([string]$response.Headers.ETag[0]) 'ETag'
  })
  [void](Test-Step B7 'same key with different payload returns 409' {
    $response = Send-Http -Method POST -Path "/api/maps/$mapId/nodes" -Headers $replayHeaders -Body @{ parentId = $rootId; title = 'Different' }
    Assert-Equal 409 $response.Status 'status'
    Assert-Equal 'idempotency_key_reused' $response.Json.code 'code'
  })

  $deleteTargetResponse = Send-Http -Method POST -Path "/api/maps/$mapId/nodes" -Headers (Command-Headers 2 'b8-create') -Body @{ parentId = $rootId; title = 'Delete target' }
  Assert-Equal 201 $deleteTargetResponse.Status 'B8 setup create status'
  $deleteTargetId = [string]$deleteTargetResponse.Json.id
  $deleteHeaders = Command-Headers 3 'b8-delete'
  $deleteFirst = Send-Http -Method DELETE -Path "/api/maps/$mapId/nodes/$deleteTargetId`?cascade=true" -Headers $deleteHeaders
  [void](Test-Step B8 'delete query participates in fingerprint' {
    Assert-Equal 200 $deleteFirst.Status 'first delete status'
    $response = Send-Http -Method DELETE -Path "/api/maps/$mapId/nodes/$deleteTargetId`?cascade=false" -Headers $deleteHeaders
    Assert-Equal 409 $response.Status 'second delete status'
    Assert-Equal 'idempotency_key_reused' $response.Json.code 'code'
  })
  [void](Test-Step B9 'failed command is not cached' {
    $headers = Command-Headers 4 'b9-retry'
    $failed = Send-Http -Method POST -Path "/api/maps/$mapId/nodes" -Headers $headers -Body @{ parentId = 'missing-parent'; title = 'Bad' }
    Assert-Equal 400 $failed.Status 'failed status'
    $fixed = Send-Http -Method POST -Path "/api/maps/$mapId/nodes" -Headers $headers -Body @{ parentId = $rootId; title = 'Corrected' }
    Assert-Equal 201 $fixed.Status 'corrected status'
    $document = Get-MapDocument $mapId
    Assert-Equal 5 ([int]$document.meta.revision) 'revision'
  })

  $agentAResponse = Send-Http -Method POST -Path '/api/tokens' -Body @{ mapId = $mapId; accessLevel = 'editor'; actorKind = 'agent'; displayName = 'automation-agent-a' }
  Start-Sleep -Milliseconds 2
  $agentBResponse = Send-Http -Method POST -Path '/api/tokens' -Body @{ mapId = $mapId; accessLevel = 'editor'; actorKind = 'agent'; displayName = 'automation-agent-b' }
  $viewerResponse = Send-Http -Method POST -Path '/api/tokens' -Body @{ mapId = $mapId; accessLevel = 'viewer'; actorKind = 'human'; displayName = 'automation-viewer' }
  $agentA = [string]$agentAResponse.Json.secret
  $agentB = [string]$agentBResponse.Json.secret
  $viewer = [string]$viewerResponse.Json.secret
  [void](Test-Step C1 'agent token contains actorKind and secret' {
    Assert-Equal 201 $agentAResponse.Status 'status'
    Assert-Equal 'agent' ([string]$agentAResponse.Json.actorKind) 'actorKind'
    Assert-Equal 'editor' ([string]$agentAResponse.Json.accessLevel) 'accessLevel'
    Assert-True ($agentA.Length -gt 20) 'agent secret is missing'
  })

  $otherMapResponse = Send-Http -Method POST -Path '/api/maps' -Body @{ title = 'Other map' }
  $otherMapId = [string]$otherMapResponse.Json.id
  [void](Test-Step C2 'scoped token reads own map and rejects another map' {
    $own = Send-Http -Method GET -Path "/api/maps/$mapId/tree" -Headers @{ Authorization = "Bearer $agentA" }
    $other = Send-Http -Method GET -Path "/api/maps/$otherMapId/tree" -Headers @{ Authorization = "Bearer $agentA" }
    Assert-Equal 200 $own.Status 'own map status'
    Assert-Equal 403 $other.Status 'other map status'
  })
  [void](Test-Step C3 'scoped editor token cannot list all maps' {
    $response = Send-Http -Method GET -Path '/api/maps' -Headers @{ Authorization = "Bearer $agentA" }
    Assert-Equal 403 $response.Status 'status'
  })
  [void](Test-Step C4 'viewer token cannot write' {
    $response = Send-Http -Method POST -Path "/api/maps/$mapId/nodes" -Headers (Command-Headers 5 'c4-viewer' 'development' $viewer) -Body @{ parentId = $rootId; title = 'Viewer write' }
    Assert-Equal 403 $response.Status 'status'
  })
  [void](Test-Step C5 'idempotency scope includes actorId' {
    $writeA = Send-Http -Method POST -Path "/api/maps/$mapId/nodes" -Headers (Command-Headers 5 'actor-scope-1' 'development' $agentA) -Body @{ parentId = $rootId; title = 'Actor A' }
    Assert-Equal 201 $writeA.Status 'actor A status'
    $writeB = Send-Http -Method POST -Path "/api/maps/$mapId/nodes" -Headers (Command-Headers 6 'actor-scope-1' 'development' $agentB) -Body @{ parentId = $rootId; title = 'Actor B' }
    Assert-Equal 201 $writeB.Status 'actor B status'
  })
  [void](Test-Step C6 'client identity fields are ignored by REST writes' {
    $response = Send-Http -Method POST -Path "/api/maps/$mapId/nodes" -Headers (Command-Headers 7 'c6-spoof' 'development' $agentA) -Body @{
      parentId = $rootId
      title = 'Identity spoof test'
      author = 'human'
      actor = @{ id = 'spoofed' }
      pending = $true
      actorKind = 'human'
    }
    Assert-Equal 201 $response.Status 'write status'
    $createdNodeId = [string]$response.Json.id
    foreach ($field in @('author', 'actor', 'pending', 'actorKind')) {
      Assert-True (-not ($response.Json.PSObject.Properties.Name -contains $field)) "response persisted forbidden field $field"
    }
    $storedDocument = Get-MapDocument $mapId $agentA
    $storedNode = $storedDocument.nodes | Where-Object { $_.id -eq $createdNodeId } | Select-Object -First 1
    Assert-True ($null -ne $storedNode) 'created node was not found after reload'
    foreach ($field in @('author', 'actor', 'pending', 'actorKind')) {
      Assert-True (-not ($storedNode.PSObject.Properties.Name -contains $field)) "stored node contains forbidden field $field"
    }
  })

  $revisionBeforeMcp = [int](Get-MapDocument $mapId).meta.revision
  $mcpCreateArgs = @{
    mapId = $mapId
    expectedRevision = $revisionBeforeMcp
    partition = 'development'
    idempotencyKey = 'd6-mcp-replay'
    parentId = $rootId
    title = 'MCP once'
  }
  $mcpRequests = @(
    @{ jsonrpc = '2.0'; id = 1; method = 'initialize'; params = @{ protocolVersion = '2024-11-05'; capabilities = @{}; clientInfo = @{ name = 'p1-contract'; version = '1.0' } } },
    @{ jsonrpc = '2.0'; id = 2; method = 'tools/list'; params = @{} },
    @{ jsonrpc = '2.0'; id = 3; method = 'tools/call'; params = @{ name = 'get_tree'; arguments = @{ mapId = $mapId } } },
    @{ jsonrpc = '2.0'; id = 4; method = 'tools/call'; params = @{ name = 'create_node'; arguments = $mcpCreateArgs } },
    @{ jsonrpc = '2.0'; id = 5; method = 'tools/call'; params = @{ name = 'create_node'; arguments = $mcpCreateArgs } },
    @{ jsonrpc = '2.0'; id = 6; method = 'tools/call'; params = @{ name = 'create_node'; arguments = @{
      mapId = $mapId; expectedRevision = $revisionBeforeMcp; partition = 'development'; idempotencyKey = 'd3-stale'; parentId = $rootId; title = 'Stale MCP'
    } } },
    @{ jsonrpc = '2.0'; id = 7; method = 'tools/call'; params = @{ name = 'create_node'; arguments = @{
      mapId = $mapId; expectedRevision = ($revisionBeforeMcp + 1); partition = 'stable'; idempotencyKey = 'd5-stable'; parentId = $rootId; title = 'Stable MCP'
    } } }
  )
  $mcpRun = Invoke-McpBatch -ExePath $exe -BaseUrl $baseUrl -Token $agentA -Requests $mcpRequests
  $mcpResponses = Parse-McpResponses $mcpRun.StdoutBytes
  [void](Test-Step F3 'mcp mode completes stdio session' {
    Assert-Equal 0 $mcpRun.ExitCode 'MCP exit code'
    Assert-True ($mcpResponses.Count -ge 7) "expected 7 MCP responses, got $($mcpResponses.Count); stderr=$($mcpRun.Stderr)"
  })
  [void](Test-Step D1 'MCP write schemas require command envelope' {
    $toolsResponse = Get-McpResponseById $mcpResponses 2
    $writeNames = @('create_node', 'update_node', 'delete_node', 'batch_operations', 'import_fragment')
    foreach ($name in $writeNames) {
      $tool = $toolsResponse.result.tools | Where-Object { $_.name -eq $name } | Select-Object -First 1
      Assert-True ($null -ne $tool) "missing tool $name"
      foreach ($field in @('expectedRevision', 'partition', 'idempotencyKey')) {
        Assert-True (@($tool.inputSchema.required) -contains $field) "$name does not require $field"
      }
    }
  })
  [void](Test-Step D2 'MCP get_tree and create_node succeed' {
    $treeResponse = Get-McpResponseById $mcpResponses 3
    $createResponse = Get-McpResponseById $mcpResponses 4
    Assert-True (-not [bool]$treeResponse.result.isError) 'get_tree returned an error'
    Assert-True (-not [bool]$createResponse.result.isError) 'create_node returned an error'
    $payload = $createResponse.result.content[0].text | ConvertFrom-Json -Depth 100
    Assert-Equal ($revisionBeforeMcp + 1) ([int]$payload.revision) 'MCP result revision'
  })
  [void](Test-Step D3 'MCP exposes structured revision conflict' {
    $response = Get-McpResponseById $mcpResponses 6
    Assert-True ([bool]$response.result.isError) 'stale MCP call was not an error'
    $payload = $response.result.content[0].text | ConvertFrom-Json -Depth 100
    Assert-Equal 'revision_conflict' ([string]$payload.error.code) 'error code'
    Assert-Equal ($revisionBeforeMcp + 1) ([int]$payload.error.actualRevision) 'actualRevision'
  })
  [void](Test-Step D5 'MCP propagates stable partition rejection' {
    $response = Get-McpResponseById $mcpResponses 7
    Assert-True ([bool]$response.result.isError) 'stable MCP call was not an error'
    Assert-True ([string]$response.result.content[0].text -match 'stable_partition_read_only') 'stable error code missing from MCP text'
  })
  [void](Test-Step D6 'MCP identical tool calls replay once' {
    $first = Get-McpResponseById $mcpResponses 4
    $second = Get-McpResponseById $mcpResponses 5
    Assert-Equal ([string]$first.result.content[0].text) ([string]$second.result.content[0].text) 'MCP replay payload'
    $document = Get-MapDocument $mapId
    Assert-Equal ($revisionBeforeMcp + 1) ([int]$document.meta.revision) 'revision after MCP replay'
    Assert-Equal 1 @($document.nodes | Where-Object { $_.title -eq 'MCP once' }).Count 'MCP node count'
  })

  Stop-Server
  $serverProcess = $null
  $httpClient.Dispose()
  $httpClient = $null

  $runtimePath = Join-Path $dataDir "maps/$mapId.json"
  if (-not (Test-Path -LiteralPath $runtimePath)) { throw "Runtime map not found: $runtimePath" }
  $formatRoot = Join-Path $tempRoot 'format'
  $out1 = Join-Path $formatRoot 'out1'
  $out2 = Join-Path $formatRoot 'out2'
  $outLayout = Join-Path $formatRoot 'layout-change'
  $outSemantic = Join-Path $formatRoot 'semantic-change'
  $outRound = Join-Path $formatRoot 'roundtrip'
  New-Item -ItemType Directory -Path $formatRoot -Force | Out-Null

  $export1 = Invoke-ProcessCapture $exe @('format', 'export', '--input', $runtimePath, '--out-dir', $out1)
  $export2 = Invoke-ProcessCapture $exe @('format', 'export', '--input', $runtimePath, '--out-dir', $out2)
  [void](Test-Step E1 'format export is byte deterministic' {
    Assert-Equal 0 $export1.ExitCode "first export exit: $($export1.Stderr)"
    Assert-Equal 0 $export2.ExitCode "second export exit: $($export2.Stderr)"
    Assert-True (Compare-FileBytes "$out1/semantic.json" "$out2/semantic.json") 'semantic bytes differ'
    Assert-True (Compare-FileBytes "$out1/layout.json" "$out2/layout.json") 'layout bytes differ'
  })

  $semanticRuntimePath = Join-Path $formatRoot 'semantic-runtime.json'
  $semanticRuntime = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json -Depth 100
  $semanticTargetId = [string]$semanticRuntime.nodes[0].id
  $semanticRuntime.nodes[0].title = 'Changed semantic title'
  Write-JsonFile $semanticRuntimePath $semanticRuntime
  $semanticExport = Invoke-ProcessCapture $exe @('format', 'export', '--input', $semanticRuntimePath, '--out-dir', $outSemantic)
  [void](Test-Step E2 'title change affects semantic but not layout' {
    Assert-Equal 0 $semanticExport.ExitCode "semantic export exit: $($semanticExport.Stderr)"
    Assert-True (-not (Compare-FileBytes "$out1/semantic.json" "$outSemantic/semantic.json")) 'semantic bytes did not change'
    Assert-True (Compare-FileBytes "$out1/layout.json" "$outSemantic/layout.json") 'layout bytes changed after title-only edit'
    $baselineSemantic = Get-Content -LiteralPath "$out1/semantic.json" -Raw | ConvertFrom-Json -Depth 100
    $changedSemantic = Get-Content -LiteralPath "$outSemantic/semantic.json" -Raw | ConvertFrom-Json -Depth 100
    $baselineTarget = $baselineSemantic.nodes | Where-Object { $_.id -eq $semanticTargetId } | Select-Object -First 1
    $changedTarget = $changedSemantic.nodes | Where-Object { $_.id -eq $semanticTargetId } | Select-Object -First 1
    Assert-True ($null -ne $baselineTarget -and $null -ne $changedTarget) 'changed semantic node is missing'
    $changedTarget.title = $baselineTarget.title
    Assert-Equal ($baselineSemantic | ConvertTo-Json -Depth 100 -Compress) ($changedSemantic | ConvertTo-Json -Depth 100 -Compress) 'semantic content after normalizing target title'
  })

  $layoutRuntimePath = Join-Path $formatRoot 'layout-runtime.json'
  $layoutRuntime = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json -Depth 100
  $layoutRuntime.nodes[0].position.x = [double]$layoutRuntime.nodes[0].position.x + 123
  $layoutRuntime.nodes[0] | Add-Member -NotePropertyName width -NotePropertyValue 420 -Force
  $layoutRuntime.nodes[0] | Add-Member -NotePropertyName collapsed -NotePropertyValue $true -Force
  $layoutRuntime.theme = if ($layoutRuntime.theme -eq 'dark') { 'light' } else { 'dark' }
  Write-JsonFile $layoutRuntimePath $layoutRuntime
  $layoutExport = Invoke-ProcessCapture $exe @('format', 'export', '--input', $layoutRuntimePath, '--out-dir', $outLayout)
  [void](Test-Step E3 'layout-only change leaves semantic bytes unchanged' {
    Assert-Equal 0 $layoutExport.ExitCode "layout export exit: $($layoutExport.Stderr)"
    Assert-True (Compare-FileBytes "$out1/semantic.json" "$outLayout/semantic.json") 'semantic bytes changed after layout-only edit'
    Assert-True (-not (Compare-FileBytes "$out1/layout.json" "$outLayout/layout.json")) 'layout bytes did not change'
  })

  $roundRuntime = Join-Path $formatRoot 'roundtrip-runtime.json'
  $roundImport = Invoke-ProcessCapture $exe @('format', 'import', '--semantic', "$out1/semantic.json", '--layout', "$out1/layout.json", '--output', $roundRuntime)
  $roundExport = Invoke-ProcessCapture $exe @('format', 'export', '--input', $roundRuntime, '--out-dir', $outRound)
  [void](Test-Step E4 'strict format import/export roundtrip is stable' {
    Assert-Equal 0 $roundImport.ExitCode "import exit: $($roundImport.Stderr)"
    Assert-Equal 0 $roundExport.ExitCode "round export exit: $($roundExport.Stderr)"
    Assert-True (Compare-FileBytes "$out1/semantic.json" "$outRound/semantic.json") 'roundtrip semantic differs'
    Assert-True (Compare-FileBytes "$out1/layout.json" "$outRound/layout.json") 'roundtrip layout differs'
  })

  [void](Test-Step E5 'invalid semantic variants are rejected without output' {
    $variants = @('self-parent', 'duplicate-id', 'missing-parent', 'invalid-order')
    foreach ($variant in $variants) {
      $invalidSemantic = Get-Content -LiteralPath "$out1/semantic.json" -Raw | ConvertFrom-Json -Depth 100
      $nonRoot = $invalidSemantic.nodes | Where-Object { $_.parentId } | Select-Object -First 1
      if (-not $nonRoot) { throw 'No non-root semantic node available for invalid input test' }
      switch ($variant) {
        'self-parent' { $nonRoot.parentId = $nonRoot.id }
        'duplicate-id' { $nonRoot.id = $invalidSemantic.nodes[0].id }
        'missing-parent' { $nonRoot.parentId = 'missing-parent-id' }
        'invalid-order' { $nonRoot.order = 99 }
      }
      $invalidSemanticPath = Join-Path $formatRoot "invalid-$variant-semantic.json"
      $invalidOutput = Join-Path $formatRoot "invalid-$variant-runtime.json"
      Write-JsonFile $invalidSemanticPath $invalidSemantic
      $invalidImport = Invoke-ProcessCapture $exe @('format', 'import', '--semantic', $invalidSemanticPath, '--layout', "$out1/layout.json", '--output', $invalidOutput)
      Assert-True ($invalidImport.ExitCode -ne 0) "$variant import unexpectedly succeeded"
      Assert-True (-not (Test-Path -LiteralPath $invalidOutput)) "$variant runtime output was created"
    }
  })

  $overwriteAttempt = Invoke-ProcessCapture $exe @('format', 'export', '--input', $runtimePath, '--out-dir', $out1)
  [void](Test-Step E6a 'format refuses overwrite without force' {
    Assert-True ($overwriteAttempt.ExitCode -ne 0) 'export unexpectedly overwrote existing files'
  })
  if (Get-Command go -ErrorAction SilentlyContinue) {
    $rollbackTest = Invoke-ProcessCapture 'go' @('test', '.', '-run', '^TestFormatCLIExportRollsBackWholeOutputSetOnCommitFailure$', '-count=1') $repoRoot
    [void](Test-Step E6b 'format atomic rollback injection test passes' {
      Assert-Equal 0 $rollbackTest.ExitCode "go rollback test failed: $($rollbackTest.Stdout) $($rollbackTest.Stderr)"
    })
  } else {
    Add-Result -Id E6b -Name 'format atomic rollback injection test' -Status SKIP -Detail 'Go toolchain is unavailable'
  }

  $formatHelp = Invoke-ProcessCapture $exe @('format', '--help')
  [void](Test-Step F4 'format mode accepts help command' {
    Assert-Equal 0 $formatHelp.ExitCode "format help exit: $($formatHelp.Stderr)"
  })

  if ($IncludeRegression) {
    $goRegression = Invoke-ProcessCapture 'go' @('test', './...') $repoRoot
    [void](Test-Step R1 'go test ./...' { Assert-Equal 0 $goRegression.ExitCode "$($goRegression.Stdout) $($goRegression.Stderr)" })
    $frontendRegression = Invoke-ProcessCapture 'npm' @('test') (Join-Path $repoRoot 'frontend')
    [void](Test-Step R2 'frontend vitest' { Assert-Equal 0 $frontendRegression.ExitCode "$($frontendRegression.Stdout) $($frontendRegression.Stderr)" })
    $vscodeRegression = Invoke-ProcessCapture 'npm' @('run', 'compile') (Join-Path $repoRoot 'vscode-extension')
    [void](Test-Step R3 'VS Code compile' { Assert-Equal 0 $vscodeRegression.ExitCode "$($vscodeRegression.Stdout) $($vscodeRegression.Stderr)" })
  } else {
    Add-Result -Id R1-R3 -Name 'full regression suites (use -IncludeRegression)' -Status SKIP
  }

  Add-Result -Id A -Name 'UI conflict recovery and recorded UX findings' -Status SKIP -Detail 'manual by design'
  Add-Result -Id D4/D7 -Name 'external Agent retry behavior and key etiquette' -Status SKIP -Detail 'requires observable Agent tool trace'
  Add-Result -Id F-manual -Name 'GUI, console visibility and shared-data multi-process behavior' -Status SKIP -Detail 'manual by design'
  Add-Result -Id G -Name 'visual, AI, snapshot, drag and clipboard regression' -Status SKIP -Detail 'manual by design'
} catch {
  Add-Result -Id SETUP -Name 'test harness setup/execution' -Status FAIL -Detail $_.Exception.Message
} finally {
  Stop-Server
  if ($httpClient) { $httpClient.Dispose() }

  $failedCount = @($results | Where-Object status -eq FAIL).Count
  $retainArtifacts = $KeepArtifacts -or $failedCount -gt 0

  $report = [pscustomobject]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    executable = $exe
    baseUrl = $baseUrl
    artifactsKept = [bool]$retainArtifacts
    artifacts = if ($retainArtifacts) { $tempRoot } else { $null }
    passed = @($results | Where-Object status -eq PASS).Count
    failed = @($results | Where-Object status -eq FAIL).Count
    skipped = @($results | Where-Object status -eq SKIP).Count
    results = $results
  }
  $reportDirectory = Split-Path -Parent $ReportPath
  if ($reportDirectory) { New-Item -ItemType Directory -Path $reportDirectory -Force | Out-Null }
  Write-JsonFile -Path $ReportPath -Value $report

  Write-Host ''
  Write-Host ("Summary: {0} passed, {1} failed, {2} skipped" -f $report.passed, $report.failed, $report.skipped)
  Write-Host "Report: $ReportPath"
  if ($retainArtifacts) {
    Write-Host "Artifacts kept: $tempRoot"
  } elseif (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}

if (@($results | Where-Object status -eq FAIL).Count -gt 0) {
  exit 1
}
