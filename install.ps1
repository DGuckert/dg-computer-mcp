$ErrorActionPreference = 'Stop'
$Archive = 'https://computer.danielslefhosted.xyz/source.zip'
$InstallDir = Join-Path $env:LOCALAPPDATA 'DGComputerMCP'
$Gateway = if ($env:DG_GATEWAY_URL) { $env:DG_GATEWAY_URL } else { 'wss://computer.danielslefhosted.xyz/v1/connect' }
Write-Host 'DG Computer MCP installer' -ForegroundColor Cyan
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 20+ is required. Install it from https://nodejs.org/ and rerun.' }
$NodeMajor = [int]((node -p "process.versions.node.split('.')[0]").Trim())
if ($NodeMajor -lt 20) { throw 'Node.js 20 or later is required.' }
$ClientId = Read-Host 'Client ID'
$Secure = Read-Host 'Client secret' -AsSecureString
$Ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
try { $ClientSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Ptr) }
if (-not $ClientId.StartsWith('dgc_') -or $ClientSecret.Length -lt 32) { throw 'Invalid client ID or secret.' }
$Temp = Join-Path $env:TEMP ('dgcomputer-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $Temp -Force | Out-Null
try {
  $Zip = Join-Path $Temp 'source.zip'
  Invoke-WebRequest -Uri $Archive -OutFile $Zip
  Expand-Archive -Path $Zip -DestinationPath $Temp -Force
  $Source = Get-ChildItem $Temp -Directory | Where-Object { $_.Name -like 'dg-computer-mcp-*' } | Select-Object -First 1
  if (-not $Source) { throw 'Could not find extracted DG Computer source.' }
  if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
  Move-Item $Source.FullName $InstallDir
} finally { Remove-Item $Temp -Recurse -Force -ErrorAction SilentlyContinue }
Push-Location $InstallDir
try { npm ci --omit=dev } finally { Pop-Location }
$Config = @{ serverUrl=$Gateway; clientId=$ClientId; clientSecret=$ClientSecret } | ConvertTo-Json
$ClientConfigPath = Join-Path $InstallDir 'client.json'
[IO.File]::WriteAllText($ClientConfigPath,$Config,[Text.UTF8Encoding]::new($false))
& icacls.exe $ClientConfigPath /inheritance:r /grant:r "$($env:USERNAME):(F)" | Out-Null
$Mcp = @{ mcpServers = @{ 'dg-computer' = @{ command='node'; args=@((Join-Path $InstallDir 'index.mjs')) } } } | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText((Join-Path $InstallDir 'mcp-config.json'),$Mcp,[Text.UTF8Encoding]::new($false))
$TaskName='DGComputerGateway'
$Action=New-ScheduledTaskAction -Execute 'node.exe' -Argument ('"' + (Join-Path $InstallDir 'client\agent.mjs') + '"')
$Trigger=New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Principal=New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Description 'Authenticated DG Computer gateway connection' -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Host "Installed to $InstallDir" -ForegroundColor Green
Write-Host "MCP config: $(Join-Path $InstallDir 'mcp-config.json')"
Write-Host 'Merge the mcpServers entry into your MCP client configuration, then restart that client.'
Write-Host 'The gateway client starts automatically at Windows logon.'
