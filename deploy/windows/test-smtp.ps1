#requires -Version 5.1
<#
.SYNOPSIS
  Проверяет универсальные SMTP-параметры production.env.

.DESCRIPTION
  По умолчанию письмо не отправляет. -SendTest отправляет одно тестовое
  письмо через общий Nodemailer transport, без привязки к конкретному relay.
  SMTP_PASSWORD не печатает.
#>
param(
  [string]$EnvFile = 'C:\SwipeMusic\secrets\production.env',
  [switch]$SendTest,
  [string]$To
)

$ErrorActionPreference = 'Stop'

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

function Test-UnfilledValue {
  param([AllowNull()][string]$Value)
  if ($null -eq $Value) { return $true }
  $trimmed = $Value.Trim()
  if ($trimmed.Length -eq 0) { return $true }
  if ($trimmed -match '<[^>]+>') { return $true }
  return $false
}

function Read-ProductionEnv {
  param([string]$Path)
  $map = @{}
  $lineNumber = 0
  foreach ($line in (Get-Content -LiteralPath $Path -Encoding UTF8)) {
    $lineNumber++
    $trimmed = $line.Trim()
    if ($trimmed.Length -eq 0) { continue }
    if ($trimmed.StartsWith('#')) { continue }
    $separator = $trimmed.IndexOf('=')
    if ($separator -lt 1) {
      throw "Некорректная строка $lineNumber в production.env."
    }
    $name = $trimmed.Substring(0, $separator).Trim()
    $value = $trimmed.Substring($separator + 1)
    if ($name -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
      throw "Некорректное имя переменной в строке $lineNumber."
    }
    $map[$name] = $value
  }
  return $map
}

function Test-TcpPort {
  param([string]$HostName, [int]$Port)
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $wait = $client.BeginConnect($HostName, $Port, $null, $null)
    if (-not $wait.AsyncWaitHandle.WaitOne(5000, $false)) {
      return $false
    }
    $client.EndConnect($wait)
    return $client.Connected
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

try {
  $configStatus = 'FAIL'
  $configDetail = $null
  $credentialStatus = $null
  $hostName = $null
  $port = 0
  $secureText = $null
  $from = $null
  $user = $null
  $password = $null
  $dnsStatus = $null
  $dnsDetail = $null
  $tcpStatus = $null
  $tcpDetail = $null
  $sendStatus = $null
  $sendDetail = $null

  if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
    $configDetail = 'Файл окружения не найден.'
  } else {
    $envMap = Read-ProductionEnv -Path $EnvFile
    $missing = @()
    foreach ($name in @('SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_FROM')) {
      if (-not $envMap.ContainsKey($name) -or (Test-UnfilledValue -Value $envMap[$name])) {
        $missing += $name
      }
    }
    $passwordMissing = -not $envMap.ContainsKey('SMTP_PASSWORD') -or (Test-UnfilledValue -Value $envMap['SMTP_PASSWORD'])
    if ($passwordMissing) {
      $credentialStatus = 'WAIT'
    }
    if ($missing.Count -gt 0) {
      $configDetail = 'Не заполнены: ' + ($missing -join ', ')
    } else {
      $portText = $envMap['SMTP_PORT'].Trim()
      $secureText = $envMap['SMTP_SECURE'].Trim()
      $portOk = [int]::TryParse($portText, [ref]$port) -and $port -ge 1 -and $port -le 65535
      if (-not $portOk) {
        $configDetail = 'SMTP_PORT задан некорректно.'
      } elseif ($secureText -ne 'true' -and $secureText -ne 'false') {
        $configDetail = 'SMTP_SECURE должен быть true или false.'
      } else {
        $configStatus = 'OK'
        $hostName = $envMap['SMTP_HOST'].Trim()
        $from = $envMap['SMTP_FROM'].Trim()
        $user = $envMap['SMTP_USER'].Trim()
        if (-not $passwordMissing) {
          $password = $envMap['SMTP_PASSWORD']
        }
      }
    }
    $envMap = $null
  }

  if ($configStatus -eq 'OK') {
    try {
      $addresses = @([System.Net.Dns]::GetHostAddresses($hostName))
      if ($addresses.Count -gt 0) {
        $dnsStatus = 'OK'
      } else {
        $dnsStatus = 'FAIL'
        $dnsDetail = 'SMTP_HOST не разрешился.'
      }
    } catch {
      $dnsStatus = 'FAIL'
      $dnsDetail = 'SMTP_HOST не разрешился.'
    }

    if ($dnsStatus -eq 'OK') {
      if (Test-TcpPort -HostName $hostName -Port $port) {
        $tcpStatus = 'OK'
      } else {
        $tcpStatus = 'FAIL'
        $tcpDetail = 'TCP-подключение к SMTP не удалось.'
      }
    }
  }

  if ($SendTest) {
    if ($credentialStatus -eq 'WAIT') {
      $sendStatus = $null
    } elseif ([string]::IsNullOrWhiteSpace($To) -or $To.Trim() -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') {
      $sendStatus = 'FAIL'
      $sendDetail = 'Для -SendTest укажите -To с адресом получателя.'
    } elseif ($configStatus -ne 'OK' -or $tcpStatus -ne 'OK') {
      $sendStatus = 'FAIL'
      $sendDetail = 'Письмо не отправлено: SMTP ещё не готов.'
    } else {
      $scriptDir = Split-Path -Parent $PSCommandPath
      $helper = Join-Path $scriptDir 'smtp-test-send.mjs'
      $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
      if (-not $nodeCmd -or -not (Test-Path -LiteralPath $helper -PathType Leaf)) {
        $sendStatus = 'FAIL'
        $sendDetail = 'Node.js или SMTP helper не найден.'
      } else {
        $previous = @{
          SMTP_HOST = [Environment]::GetEnvironmentVariable('SMTP_HOST', 'Process')
          SMTP_PORT = [Environment]::GetEnvironmentVariable('SMTP_PORT', 'Process')
          SMTP_SECURE = [Environment]::GetEnvironmentVariable('SMTP_SECURE', 'Process')
          SMTP_USER = [Environment]::GetEnvironmentVariable('SMTP_USER', 'Process')
          SMTP_PASSWORD = [Environment]::GetEnvironmentVariable('SMTP_PASSWORD', 'Process')
          SMTP_FROM = [Environment]::GetEnvironmentVariable('SMTP_FROM', 'Process')
          SMTP_TEST_TO = [Environment]::GetEnvironmentVariable('SMTP_TEST_TO', 'Process')
        }
        try {
          $env:SMTP_HOST = $hostName
          $env:SMTP_PORT = [string]$port
          $env:SMTP_SECURE = $secureText
          $env:SMTP_USER = $user
          $env:SMTP_PASSWORD = $password
          $env:SMTP_FROM = $from
          $env:SMTP_TEST_TO = $To.Trim()
          $preference = $ErrorActionPreference
          $ErrorActionPreference = 'Continue'
          $sendOutput = ''
          $sendExit = 1
          try {
            $sendLines = @(& $nodeCmd.Source $helper 2>&1 | ForEach-Object { "$_" })
            $sendExit = $LASTEXITCODE
            $sendOutput = $sendLines -join "`n"
          } catch {
            $sendOutput = [string]$_.Exception.Message
            if ($LASTEXITCODE) { $sendExit = $LASTEXITCODE }
          } finally {
            $ErrorActionPreference = $preference
          }
          if ($sendExit -eq 0) {
            $sendStatus = 'OK'
          } else {
            $sendStatus = 'FAIL'
            $redacted = $sendOutput
            if ($password) {
              $redacted = $redacted.Replace($password, '[redacted]')
            }
            $sendDetail = ($redacted.Trim())
            if ([string]::IsNullOrWhiteSpace($sendDetail)) {
              $sendDetail = 'Отправка тестового письма не удалась.'
            }
          }
        } finally {
          foreach ($name in @($previous.Keys)) {
            if ($null -eq $previous[$name]) {
              Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
            } else {
              Set-Item -Path "Env:$name" -Value $previous[$name]
            }
          }
          $password = $null
        }
      }
    }
  }

  Write-OperatorLine "[$configStatus] SMTP configuration"
  if ($configStatus -eq 'OK') {
    Write-OperatorLine "host: $hostName"
    Write-OperatorLine "port: $port"
    Write-OperatorLine "secure: $secureText"
    Write-OperatorLine "from: $from"
  } elseif ($configDetail) {
    Write-OperatorLine $configDetail
  }
  if ($credentialStatus -eq 'WAIT') {
    Write-OperatorLine '[WAIT] SMTP credentials'
  }
  if ($dnsStatus) {
    Write-OperatorLine "[$dnsStatus] SMTP DNS"
    if ($dnsDetail) { Write-OperatorLine $dnsDetail }
  }
  if ($tcpStatus) {
    Write-OperatorLine "[$tcpStatus] SMTP TCP"
    if ($tcpDetail) { Write-OperatorLine $tcpDetail }
  }
  if ($sendStatus) {
    Write-OperatorLine "[$sendStatus] SMTP send"
    if ($sendDetail) { Write-OperatorLine $sendDetail }
  }

  $failed = $configStatus -ne 'OK' -or $dnsStatus -eq 'FAIL' -or $tcpStatus -eq 'FAIL' -or $sendStatus -eq 'FAIL'
  $waiting = $credentialStatus -eq 'WAIT'
  Write-OperatorLine ''
  if (-not $failed -and -not $waiting -and ($dnsStatus -eq 'OK') -and ($tcpStatus -eq 'OK') -and (-not $SendTest -or $sendStatus -eq 'OK')) {
    Write-OperatorLine 'SMTP TEST: PASS'
    exit 0
  }
  if ($waiting -and -not $failed) {
    Write-OperatorLine 'SMTP TEST: NOT READY'
    exit 1
  }
  Write-OperatorLine 'SMTP TEST: FAIL'
  exit 1
} catch {
  Write-OperatorLine '[FAIL] SMTP test'
  Write-OperatorLine 'Проверка не завершилась. Пароль SMTP не выводится.'
  Write-OperatorLine ''
  Write-OperatorLine 'SMTP TEST: FAIL'
  exit 1
}
