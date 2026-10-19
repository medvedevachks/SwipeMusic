#requires -Version 5.1
<#
.SYNOPSIS
  Проверяет production-конфигурацию Swipe Music и ничего не изменяет.

.DESCRIPTION
  Только чтение: база, секреты, сборка, порт 8787 и git status.
  Не пишет файлы, не ставит службы, не запускает backend и Caddy.
  Не печатает provider key, PROVIDER_SESSION_KEY и SMTP_PASSWORD.
#>
param(
  [string]$DatabasePath = 'C:\SwipeMusic\data\swipemusic.sqlite',
  [string]$EnvFile = 'C:\SwipeMusic\secrets\production.env',
  [string]$ProviderKeyFile = 'C:\SwipeMusic\secrets\provider-session.key',
  [string]$RepoRoot = ''
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
  if ($null -eq $Value) {
    return $true
  }
  $trimmed = $Value.Trim()
  if ($trimmed.Length -eq 0) {
    return $true
  }
  if ($trimmed -match '<[^>]+>') {
    return $true
  }
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
      throw "Некорректная строка $lineNumber в production.env: ожидается KEY=value."
    }

    $name = $trimmed.Substring(0, $separator).Trim()
    $value = $trimmed.Substring($separator + 1)
    if ($name -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
      throw "Некорректное имя переменной в строке $lineNumber production.env."
    }

    $map[$name] = $value
  }
  return $map
}

function Test-CanonicalProviderKeyFile {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return 'Файл ключа провайдера не найден.'
  }

  $rawKey = [System.IO.File]::ReadAllText($Path)
  if ($rawKey.Length -gt 0 -and [int][char]$rawKey[0] -eq 0xFEFF) {
    $rawKey = $rawKey.Substring(1)
  }
  $providerKey = $rawKey.Trim()
  $rawKey = $null
  if ($providerKey.Length -eq 0) {
    return 'Файл ключа провайдера пуст.'
  }

  $keyBytes = $null
  $canonicalKey = $null
  try {
    $keyBytes = [Convert]::FromBase64String($providerKey)
    $canonicalKey = [Convert]::ToBase64String($keyBytes)
  } catch {
    return 'Ключ провайдера не является корректным base64.'
  }

  $valid = $null -ne $keyBytes -and $keyBytes.Length -eq 32 -and $canonicalKey.Equals($providerKey)
  $providerKey = $null
  $keyBytes = $null
  $canonicalKey = $null
  if (-not $valid) {
    return 'Ключ провайдера должен быть canonical base64 ровно на 32 байта.'
  }

  return $null
}

function Test-PortListening {
  param([int]$Port)
  $lines = & netstat.exe -ano -p tcp
  if ($LASTEXITCODE -ne 0) {
    throw 'netstat завершился с ошибкой.'
  }
  foreach ($line in $lines) {
    if ($line -match '^\s*TCP\s+(\S+)\s+\S+\s+LISTENING\s+\d+\s*$') {
      if ($Matches[1] -match ":$Port$") {
        return $true
      }
    }
  }
  return $false
}

function Test-IgnoredRuntimePath {
  param([string]$Path)
  $normalized = $Path.Trim().Trim('"').Replace('\', '/')
  if ($normalized -eq 'data' -or $normalized.StartsWith('data/')) { return $true }
  if ($normalized -eq 'secrets' -or $normalized.StartsWith('secrets/')) { return $true }
  if ($normalized -like 'receive-*.ps1') { return $true }
  return $false
}

try {
  if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $scriptDir = Split-Path -Parent $PSCommandPath
    $RepoRoot = (Resolve-Path -LiteralPath (Join-Path $scriptDir '..\..')).Path
  } else {
    $RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
  }

  $databasePath = $DatabasePath
  $envFile = $EnvFile
  $providerKeyFile = $ProviderKeyFile

  $databaseStatus = 'FAIL'
  $databaseDetail = 'Файл базы не найден.'
  if (Test-Path -LiteralPath $databasePath -PathType Leaf) {
    $databaseLength = (Get-Item -LiteralPath $databasePath).Length
    if ($databaseLength -gt 0) {
      $databaseStatus = 'OK'
      $databaseDetail = $null
    } else {
      $databaseDetail = 'Файл базы пуст.'
    }
  }

  $providerStatus = 'FAIL'
  $providerDetail = Test-CanonicalProviderKeyFile -Path $providerKeyFile
  if ($null -eq $providerDetail) {
    $providerStatus = 'OK'
  }

  $nodeStatus = 'FAIL'
  $nodeDetail = 'Node.js не найден в PATH.'
  $nodeVersion = $null
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCmd) {
    $nodeVersion = ([string](& $nodeCmd.Source -v)).Trim()
    if ($LASTEXITCODE -eq 0 -and $nodeVersion.Length -gt 0) {
      $nodeStatus = 'OK'
      $nodeDetail = $null
    } else {
      $nodeDetail = 'Не удалось прочитать версию Node.js.'
      $nodeVersion = $null
    }
  }

  $frontendStatus = 'FAIL'
  $frontendDetail = $null
  $missingFiles = @()
  if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'server\index.ts') -PathType Leaf)) {
    $missingFiles += 'server/index.ts'
  }
  if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'dist\index.html') -PathType Leaf)) {
    $missingFiles += 'dist/index.html'
  }
  if ($missingFiles.Count -eq 0) {
    $frontendStatus = 'OK'
  } else {
    $frontendDetail = 'Не найдено: ' + ($missingFiles -join ', ')
  }

  $envStatus = 'FAIL'
  $envDetail = $null
  $smtpStatus = 'WAIT'
  $smtpDetail = 'SMTP не заполнен.'
  $envMap = $null

  if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
    $envDetail = 'Файл production.env не найден.'
  } else {
    try {
      $envMap = Read-ProductionEnv -Path $envFile
    } catch {
      $envDetail = $_.Exception.Message
      $smtpStatus = 'FAIL'
      $smtpDetail = 'production.env не прочитан, SMTP проверить нельзя.'
    }
  }

  if ($null -ne $envMap) {
    $requiredNames = @('NODE_ENV', 'PORT', 'DATABASE_PATH', 'APP_PUBLIC_URL', 'MAIL_TRANSPORT')
    $missingNames = @()
    foreach ($name in $requiredNames) {
      if (-not $envMap.ContainsKey($name) -or (Test-UnfilledValue -Value $envMap[$name])) {
        $missingNames += $name
      }
    }

    if ($missingNames.Count -gt 0) {
      $envDetail = 'Не заполнены: ' + ($missingNames -join ', ')
    } elseif ($envMap['NODE_ENV'].Trim() -ne 'production') {
      $envDetail = 'NODE_ENV должен быть production.'
    } else {
      $envStatus = 'OK'
    }

    $transport = $null
    if ($envMap.ContainsKey('MAIL_TRANSPORT')) {
      $transport = $envMap['MAIL_TRANSPORT'].Trim()
    }

    if ($transport -eq 'smtp') {
      $smtpNames = @(
        'SMTP_HOST',
        'SMTP_PORT',
        'SMTP_SECURE',
        'SMTP_USER',
        'SMTP_PASSWORD',
        'SMTP_FROM'
      )
      $missingSmtp = @()
      foreach ($name in $smtpNames) {
        if (-not $envMap.ContainsKey($name) -or (Test-UnfilledValue -Value $envMap[$name])) {
          $missingSmtp += $name
        }
      }

      if ($missingSmtp.Count -gt 0) {
        $smtpStatus = 'WAIT'
        $smtpDetail = 'SMTP не заполнен.'
      } else {
        $smtpPortText = $envMap['SMTP_PORT'].Trim()
        $smtpSecureText = $envMap['SMTP_SECURE'].Trim()
        $smtpPort = 0
        $smtpPortOk = [int]::TryParse($smtpPortText, [ref]$smtpPort) -and $smtpPort -ge 1 -and $smtpPort -le 65535
        if (-not $smtpPortOk) {
          $smtpStatus = 'FAIL'
          $smtpDetail = 'SMTP_PORT задан некорректно.'
        } elseif ($smtpSecureText -ne 'true' -and $smtpSecureText -ne 'false') {
          $smtpStatus = 'FAIL'
          $smtpDetail = 'SMTP_SECURE должен быть true или false.'
        } else {
          $smtpStatus = 'OK'
          $smtpDetail = $null
        }
      }
    } elseif (-not (Test-UnfilledValue -Value $transport)) {
      $smtpStatus = 'FAIL'
      $smtpDetail = 'production требует MAIL_TRANSPORT=smtp.'
    }
  }

  $envMap = $null

  $portStatus = 'FAIL'
  $portDetail = $null
  try {
    if (Test-PortListening -Port 8787) {
      $portDetail = 'Порт 8787 уже занят.'
    } else {
      $portStatus = 'OK'
    }
  } catch {
    $portDetail = 'Не удалось проверить порт 8787.'
  }

  $gitStatus = 'FAIL'
  $gitDetail = $null
  $gitBranch = $null
  $gitCommit = $null
  $gitDirty = @()
  $gitCmd = Get-Command git -ErrorAction SilentlyContinue
  if (-not $gitCmd) {
    $gitDetail = 'Git не найден в PATH.'
  } else {
    $gitBranch = ([string](& git -C $repoRoot branch --show-current)).Trim()
    $gitCommit = ([string](& git -C $repoRoot rev-parse HEAD)).Trim()
    if ($LASTEXITCODE -ne 0 -or $gitCommit -notmatch '^[0-9a-fA-F]{40}$') {
      $gitDetail = 'Не удалось прочитать текущий commit.'
      $gitCommit = $null
    } else {
      $statusOutput = & git -C $repoRoot status --porcelain=v1 --untracked-files=all
      if ($LASTEXITCODE -ne 0) {
        $gitDetail = 'Не удалось прочитать git status.'
      } else {
        foreach ($line in @($statusOutput)) {
          $text = [string]$line
          if ([string]::IsNullOrWhiteSpace($text)) { continue }
          if ($text.Length -lt 4) {
            $gitDirty += $text
            continue
          }
          $code = $text.Substring(0, 2)
          $path = $text.Substring(3)
          if ($code -eq '!!') { continue }
          if (($code -eq '??') -and (Test-IgnoredRuntimePath -Path $path)) { continue }
          $gitDirty += $text
        }
        if ($gitDirty.Count -eq 0) {
          $gitStatus = 'OK'
        } else {
          $gitDetail = 'git status --short не пустой.'
        }
      }
    }
  }

  Write-OperatorLine "[$databaseStatus] Database"
  if ($databaseDetail) { Write-OperatorLine $databaseDetail }

  Write-OperatorLine "[$providerStatus] Provider key"
  if ($providerDetail) { Write-OperatorLine $providerDetail }

  Write-OperatorLine "[$nodeStatus] Node.js"
  if ($nodeVersion) { Write-OperatorLine $nodeVersion }
  if ($nodeDetail) { Write-OperatorLine $nodeDetail }

  Write-OperatorLine "[$frontendStatus] Frontend build"
  if ($frontendDetail) { Write-OperatorLine $frontendDetail }

  Write-OperatorLine "[$envStatus] Production environment"
  if ($envDetail) { Write-OperatorLine $envDetail }

  Write-OperatorLine "[$smtpStatus] SMTP configuration"
  if ($smtpDetail) { Write-OperatorLine $smtpDetail }

  Write-OperatorLine "[$portStatus] Port 8787 available"
  if ($portDetail) { Write-OperatorLine $portDetail }

  Write-OperatorLine "[$gitStatus] Git working tree"
  if ($gitBranch) { Write-OperatorLine "branch: $gitBranch" }
  if ($gitCommit) { Write-OperatorLine "commit: $gitCommit" }
  if ($gitDetail) { Write-OperatorLine $gitDetail }
  foreach ($dirtyLine in $gitDirty) {
    Write-OperatorLine $dirtyLine
  }

  $ready = @(
    $databaseStatus,
    $providerStatus,
    $nodeStatus,
    $frontendStatus,
    $envStatus,
    $smtpStatus,
    $portStatus,
    $gitStatus
  ) | Where-Object { $_ -ne 'OK' }

  Write-OperatorLine ''
  if ($ready.Count -eq 0) {
    Write-OperatorLine 'PRE-FLIGHT: READY'
    exit 0
  }

  Write-OperatorLine 'PRE-FLIGHT: NOT READY'
  exit 1
} catch {
  Write-OperatorLine '[FAIL] Preflight'
  Write-OperatorLine 'Проверка не завершилась. Секреты не выводятся.'
  Write-OperatorLine ''
  Write-OperatorLine 'PRE-FLIGHT: NOT READY'
  exit 1
}
