#requires -Version 5.1
<#
.SYNOPSIS
  Проверяет готовность к выпуску IP-сертификата и ничего не изменяет.

.DESCRIPTION
  Не создаёт каталоги, не читает секреты, не ставит модули и не получает сертификат.
#>

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

function Get-NewestPoshAcmeVersion {
  $modules = @(Get-Module -ListAvailable -Name Posh-ACME)
  if ($modules.Count -eq 0) {
    return $null
  }
  return ($modules | Sort-Object Version -Descending | Select-Object -First 1).Version
}

function Get-TcpPortRows {
  param([int]$Port)
  $rows = @()
  $lines = & netstat.exe -ano -p tcp
  if ($LASTEXITCODE -ne 0) {
    throw 'netstat завершился с ошибкой.'
  }
  foreach ($line in @($lines)) {
    if ($line -match '^\s*TCP\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s*$') {
      if ($Matches[1] -match ":$Port$") {
        $rows += ('{0} {1} pid={2}' -f $Matches[1], $Matches[3], $Matches[4])
      }
    }
  }
  return $rows
}

function Test-GitPathIgnored {
  param([string]$Repo, [string]$RelativePath)
  & git -C $Repo check-ignore -q -- $RelativePath
  return ($LASTEXITCODE -eq 0)
}

try {
  $powershellStatus = 'FAIL'
  $powershellDetail = 'Нужен Windows PowerShell 5.1.'
  $hostVersion = $PSVersionTable.PSVersion
  $hostEdition = [string]$PSVersionTable.PSEdition
  if ($hostEdition -eq 'Desktop' -and $hostVersion.Major -eq 5 -and $hostVersion.Minor -ge 1) {
    $powershellStatus = 'OK'
    $powershellDetail = [string]$hostVersion
  }

  $moduleStatus = 'FAIL'
  $moduleDetail = 'Posh-ACME не установлен.'
  $moduleVersion = Get-NewestPoshAcmeVersion
  if ($moduleVersion -and $moduleVersion -ge $minimumVersion) {
    $moduleStatus = 'OK'
    $moduleDetail = [string]$moduleVersion
  } elseif ($moduleVersion) {
    $moduleDetail = "Найдена версия $moduleVersion. Нужна не ниже 4.31.1."
  }

  $portStatus = 'FAIL'
  $portDetail = $null
  $portRows = @()
  try {
    $portRows = @(Get-TcpPortRows -Port 80)
    $listening = @($portRows | Where-Object { $_ -match '\sLISTENING\s' })
    if ($listening.Count -gt 0) {
      $portDetail = 'Порт 80 занят listener. Скрипт его не останавливает.'
    } else {
      $portStatus = 'OK'
      $portDetail = 'LISTENING на порту 80 нет.'
    }
  } catch {
    $portDetail = 'Не удалось проверить порт 80.'
  }

  $directoryStatus = 'WAIT'
  $directoryDetail = 'Каталог C:\SwipeMusic\secrets\certs ещё не создан.'
  if (Test-Path -LiteralPath $certificateDirectory -PathType Container) {
    $directoryStatus = 'OK'
    $directoryDetail = $null
  } elseif (Test-Path -LiteralPath $certificateDirectory) {
    $directoryStatus = 'FAIL'
    $directoryDetail = 'C:\SwipeMusic\secrets\certs существует, но это не каталог.'
  }

  $gitStatus = 'FAIL'
  $gitDetail = $null
  $gitCmd = Get-Command git -ErrorAction SilentlyContinue
  if (-not $gitCmd) {
    $gitDetail = 'Git не найден в PATH.'
  } else {
    $scriptDir = Split-Path -Parent $PSCommandPath
    $repoRoot = (Resolve-Path -LiteralPath (Join-Path $scriptDir '..\..')).Path
    $runtimePaths = @('secrets/certs', 'secrets/provider-session.key', 'secrets/production.env')
    $notIgnored = @()
    foreach ($runtimePath in $runtimePaths) {
      if (-not (Test-GitPathIgnored -Repo $repoRoot -RelativePath $runtimePath)) {
        $notIgnored += $runtimePath
      }
    }
    if ($notIgnored.Count -eq 0) {
      $gitStatus = 'OK'
    } else {
      $gitDetail = 'Git не игнорирует secrets/: ' + ($notIgnored -join ', ')
    }
  }

  Write-OperatorLine "[$powershellStatus] PowerShell 5.1"
  if ($powershellDetail) { Write-OperatorLine $powershellDetail }

  Write-OperatorLine "[$moduleStatus] Posh-ACME"
  if ($moduleDetail) { Write-OperatorLine $moduleDetail }

  Write-OperatorLine "[$portStatus] Port 80 available"
  if ($portDetail) { Write-OperatorLine $portDetail }
  foreach ($row in $portRows) {
    Write-OperatorLine $row
  }

  Write-OperatorLine "[$directoryStatus] Certificate directory"
  if ($directoryDetail) { Write-OperatorLine $directoryDetail }

  Write-OperatorLine "[$gitStatus] Git ignore secrets"
  if ($gitDetail) { Write-OperatorLine $gitDetail }

  $blocking = @(
    $powershellStatus,
    $moduleStatus,
    $portStatus,
    $directoryStatus,
    $gitStatus
  ) | Where-Object { $_ -ne 'OK' }

  Write-OperatorLine ''
  if ($blocking.Count -eq 0) {
    Write-OperatorLine 'ACME PRE-FLIGHT: READY'
    exit 0
  }

  Write-OperatorLine 'ACME PRE-FLIGHT: NOT READY'
  exit 1
} catch {
  Write-OperatorLine '[FAIL] ACME preflight'
  Write-OperatorLine 'Проверка не завершилась. Секреты не читаются и не выводятся.'
  Write-OperatorLine ''
  Write-OperatorLine 'ACME PRE-FLIGHT: NOT READY'
  exit 1
}
