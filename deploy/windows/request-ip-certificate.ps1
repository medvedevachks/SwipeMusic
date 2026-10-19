#requires -Version 5.1
<#
.SYNOPSIS
  Запрашивает публичный IP-сертификат Let's Encrypt через Posh-ACME.

.DESCRIPTION
  Использует только профиль shortlived и плагин WebSelfHost на порту 80.
  Не создаёт правила firewall или NAT, не останавливает IIS или Caddy
  и не перезагружает Caddy. Закрытый ключ не печатает.
#>
param(
  [string]$PublicIp,
  [string]$ContactEmail,
  [switch]$Staging
)

$ErrorActionPreference = 'Stop'
$minimumVersion = [version]'4.31.1'
$certificateDirectory = 'C:\SwipeMusic\secrets\certs'

function Write-OperatorLine {
  param([string]$Message)
  $encoding = if ([Console]::OutputEncoding.CodePage -eq 65001) {
    New-Object System.Text.UTF8Encoding $false
  } else {
    [System.Text.Encoding]::GetEncoding(866)
  }
  $bytes = $encoding.GetBytes($Message + "`r`n")
  $stream = [Console]::OpenStandardOutput()
  $stream.Write($bytes, 0, $bytes.Length)
  $stream.Flush()
}

function Fail {
  param([string]$Message)
  Write-OperatorLine $Message
  exit 1
}

function Test-ReservedIPv4 {
  param([byte[]]$Bytes)
  if ($Bytes.Length -ne 4) { return $true }
  $a = $Bytes[0]
  $b = $Bytes[1]
  if ($a -eq 0) { return $true }
  if ($a -eq 10) { return $true }
  if ($a -eq 127) { return $true }
  if ($a -eq 100 -and $b -ge 64 -and $b -le 127) { return $true }
  if ($a -eq 169 -and $b -eq 254) { return $true }
  if ($a -eq 172 -and $b -ge 16 -and $b -le 31) { return $true }
  if ($a -eq 192 -and $b -eq 0 -and $Bytes[2] -eq 0) { return $true }
  if ($a -eq 192 -and $b -eq 0 -and $Bytes[2] -eq 2) { return $true }
  if ($a -eq 192 -and $b -eq 168) { return $true }
  if ($a -eq 198 -and $b -ge 18 -and $b -le 19) { return $true }
  if ($a -eq 198 -and $b -eq 51 -and $Bytes[2] -eq 100) { return $true }
  if ($a -eq 203 -and $b -eq 0 -and $Bytes[2] -eq 113) { return $true }
  if ($a -ge 224) { return $true }
  return $false
}

function Test-PublicIpAddress {
  param([AllowNull()][string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $false
  }
  $candidate = $Value.Trim()
  if ($candidate.StartsWith('[') -and $candidate.EndsWith(']') -and $candidate.Length -gt 2) {
    $candidate = $candidate.Substring(1, $candidate.Length - 2)
  }
  if ($candidate.Contains('%') -or $candidate.Contains('/')) {
    return $false
  }

  $parsed = $null
  if (-not [System.Net.IPAddress]::TryParse($candidate, [ref]$parsed)) {
    return $false
  }
  if ($parsed.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork) {
    return -not (Test-ReservedIPv4 -Bytes $parsed.GetAddressBytes())
  }
  if ($parsed.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetworkV6) {
    return $false
  }
  if (
    [System.Net.IPAddress]::IsLoopback($parsed) -or
    $parsed.IsIPv4MappedToIPv6 -or
    $parsed.IsIPv6LinkLocal -or
    $parsed.IsIPv6Multicast -or
    $parsed.IsIPv6SiteLocal
  ) {
    return $false
  }

  $bytes = $parsed.GetAddressBytes()
  $unspecified = $true
  foreach ($part in $bytes) {
    if ($part -ne 0) {
      $unspecified = $false
      break
    }
  }
  if ($unspecified) { return $false }
  if (($bytes[0] -band 0xFE) -eq 0xFC) { return $false }
  if ($bytes[0] -eq 0x20 -and $bytes[1] -eq 0x01 -and $bytes[2] -eq 0x0D -and $bytes[3] -eq 0xB8) {
    return $false
  }
  return $true
}

function Get-CanonicalPublicIp {
  param([string]$Value)
  $candidate = $Value.Trim()
  if ($candidate.StartsWith('[') -and $candidate.EndsWith(']') -and $candidate.Length -gt 2) {
    $candidate = $candidate.Substring(1, $candidate.Length - 2)
  }
  $parsed = $null
  [void][System.Net.IPAddress]::TryParse($candidate, [ref]$parsed)
  return $parsed.ToString()
}

function Test-Port80Listening {
  $lines = & netstat.exe -ano -p tcp
  if ($LASTEXITCODE -ne 0) {
    throw 'netstat завершился с ошибкой.'
  }
  foreach ($line in @($lines)) {
    if ($line -match '^\s*TCP\s+(\S+)\s+\S+\s+LISTENING\s+(\d+)\s*$' -and $Matches[1] -match ':80$') {
      return $true
    }
  }
  return $false
}

function Get-NewestPoshAcmeVersion {
  $modules = @(Get-Module -ListAvailable -Name Posh-ACME)
  if ($modules.Count -eq 0) {
    return $null
  }
  return ($modules | Sort-Object Version -Descending | Select-Object -First 1).Version
}

function Invoke-IpCertificateRequest {
  param(
    [string]$PublicIp,
    [string]$ContactEmail,
    [switch]$Staging
  )

  $hostVersion = $PSVersionTable.PSVersion
  $hostEdition = [string]$PSVersionTable.PSEdition
  if ($hostEdition -ne 'Desktop' -or $hostVersion.Major -ne 5 -or $hostVersion.Minor -lt 1) {
    Fail 'Нужен Windows PowerShell 5.1.'
  }
  if (-not (Test-PublicIpAddress -Value $PublicIp)) {
    Fail 'PublicIp должен быть публичным IPv4 или IPv6. Loopback, private и link-local отклоняются.'
  }

  $canonicalIp = Get-CanonicalPublicIp -Value $PublicIp
  $contact = $null
  if (-not [string]::IsNullOrWhiteSpace($ContactEmail)) {
    $contact = $ContactEmail.Trim()
    if ($contact -match '^mailto:') {
      $contact = $contact.Substring(7)
    }
    if ($contact -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') {
      Fail 'ContactEmail выглядит некорректно.'
    }
    $contact = 'mailto:' + $contact
  }

  $installed = Get-NewestPoshAcmeVersion
  if (-not $installed -or $installed -lt $minimumVersion) {
    Fail 'Нужен Posh-ACME не ниже 4.31.1. Сначала запустите install-poshacme.ps1.'
  }
  Import-Module Posh-ACME -MinimumVersion $minimumVersion -ErrorAction Stop

  if (Test-Port80Listening) {
    Fail 'Порт 80 занят. WebSelfHost использует внешний HTTP-01 порт 80. IIS и Caddy не останавливаются.'
  }

  $directoryUrl = 'LE_PROD'
  $endpointLabel = 'production'
  if ($Staging) {
    $directoryUrl = 'LE_STAGE'
    $endpointLabel = 'staging'
  }

  Set-PAServer -DirectoryUrl $directoryUrl
  $profile = Get-PAProfile -Profile shortlived
  if (-not $profile) {
    Fail 'Профиль shortlived недоступен. IP-сертификат без него не запрашивается.'
  }

  $account = Get-PAAccount -ErrorAction SilentlyContinue
  if (-not $account -and -not $contact) {
    Fail 'ACME-аккаунта ещё нет. Для первого запроса укажите -ContactEmail.'
  }

  $request = @{
    Domain = $canonicalIp
    Plugin = 'WebSelfHost'
    Profile = 'shortlived'
    DirectoryUrl = $directoryUrl
    AcceptTOS = $true
  }
  if ($contact) {
    $request.Contact = @($contact)
  }

  $issued = @(New-PACertificate @request) | Select-Object -Last 1
  if (-not $issued) {
    Fail 'Posh-ACME не вернул объект сертификата.'
  }

  $fullChainSource = [string]$issued.FullChainFile
  $keySource = [string]$issued.KeyFile
  if ([string]::IsNullOrWhiteSpace($fullChainSource) -or [string]::IsNullOrWhiteSpace($keySource)) {
    Fail 'В объекте Posh-ACME нет путей FullChainFile и KeyFile.'
  }
  if ($fullChainSource -eq $keySource) {
    Fail 'Пути сертификата и ключа в объекте Posh-ACME совпали.'
  }
  if (-not (Test-Path -LiteralPath $fullChainSource -PathType Leaf) -or -not (Test-Path -LiteralPath $keySource -PathType Leaf)) {
    Fail 'Файлы из объекта Posh-ACME не найдены.'
  }

  if (-not (Test-Path -LiteralPath $certificateDirectory -PathType Container)) {
    New-Item -ItemType Directory -Path $certificateDirectory | Out-Null
  }
  $fullChainDestination = Join-Path $certificateDirectory 'fullchain.pem'
  $keyDestination = Join-Path $certificateDirectory 'privkey.pem'
  Copy-Item -LiteralPath $fullChainSource -Destination $fullChainDestination -Force
  Copy-Item -LiteralPath $keySource -Destination $keyDestination -Force

  $subject = [string]$issued.Subject
  if ([string]::IsNullOrWhiteSpace($subject)) {
    $subject = $canonicalIp
  }
  $expires = 'unknown'
  if ($issued.NotAfter -is [datetime]) {
    $expires = $issued.NotAfter.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  }

  Write-OperatorLine ("subject: {0}" -f $subject)
  Write-OperatorLine ("ip: {0}" -f $canonicalIp)
  Write-OperatorLine ("expires: {0}" -f $expires)
  Write-OperatorLine ("endpoint: {0}" -f $endpointLabel)
  Write-OperatorLine ("fullchain: {0}" -f $fullChainDestination)
  Write-OperatorLine ("privkey: {0}" -f $keyDestination)
  exit 0
}

if ($MyInvocation.InvocationName -ne '.') {
  try {
    Invoke-IpCertificateRequest -PublicIp $PublicIp -ContactEmail $ContactEmail -Staging:$Staging
  } catch {
    Write-OperatorLine 'Запрос сертификата не выполнен.'
    $safeMessage = [string]$_.Exception.Message
    if ($safeMessage -and $safeMessage -notmatch 'PRIVATE KEY') {
      Write-OperatorLine $safeMessage
    }
    exit 1
  }
}
