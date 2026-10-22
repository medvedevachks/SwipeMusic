#requires -Version 5.1
<#
.SYNOPSIS
  Проверяет уже запущенный production backend и ничего не изменяет.

.DESCRIPTION
  Читает только /api/health, локальные TCP listeners и git status.
  Не входит в аккаунт, не меняет базу и не перезапускает процесс.
#>

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

function Test-IgnoredRuntimePath {
  param([string]$Path)
  $normalized = $Path.Trim().Trim('"').Replace('\', '/')
  if ($normalized -eq 'data' -or $normalized.StartsWith('data/')) { return $true }
  if ($normalized -eq 'secrets' -or $normalized.StartsWith('secrets/')) { return $true }
  if ($normalized -like 'receive-*.ps1') { return $true }
  return $false
}

function Get-ListeningLocals {
  param([int]$Port)
  $locals = @()
  $lines = & netstat.exe -ano -p tcp
  if ($LASTEXITCODE -ne 0) {
    throw 'netstat завершился с ошибкой.'
  }
  foreach ($line in @($lines)) {
    if ($line -match '^\s*TCP\s+(\S+)\s+\S+\s+LISTENING\s+\d+\s*$') {
      $localAddress = $Matches[1]
      if ($localAddress -match ":$Port$") {
        $locals += $localAddress
      }
    }
  }
  return $locals
}

function Get-HealthPayload {
  $request = [System.Net.HttpWebRequest]::Create('http://127.0.0.1:8787/api/health')
  $request.Method = 'GET'
  $request.Timeout = 5000
  $request.AllowAutoRedirect = $false
  $request.Accept = 'application/json'
  $response = $request.GetResponse()
  try {
    $status = [int]$response.StatusCode
    $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
    try {
      $body = $reader.ReadToEnd()
    } finally {
      $reader.Close()
    }
    if ($body.Length -gt 2048) {
      $body = $body.Substring(0, 2048)
    }
    return @{ Status = $status; Body = $body }
  } finally {
    $response.Close()
  }
}

try {
  $healthStatus = 'FAIL'
  $healthDetail = 'Backend не ответил на http://127.0.0.1:8787/api/health.'
  try {
    $payload = Get-HealthPayload
    if ($payload.Status -lt 200 -or $payload.Status -ge 300) {
      $healthDetail = "HTTP status $($payload.Status)."
    } else {
      $parsed = $payload.Body | ConvertFrom-Json
      if ($parsed.ok -eq $true) {
        $healthStatus = 'OK'
        $healthDetail = $null
      } else {
        $healthDetail = 'JSON не содержит ok:true.'
      }
    }
  } catch {
    $healthDetail = 'Backend не ответил на http://127.0.0.1:8787/api/health.'
  }

  $bindStatus = 'FAIL'
  $bindDetail = '127.0.0.1:8787 не слушает.'
  try {
    $listeners = @(Get-ListeningLocals -Port 8787)
    $external = @($listeners | Where-Object { $_ -ne '127.0.0.1:8787' })
    if ($listeners -contains '127.0.0.1:8787' -and $external.Count -eq 0) {
      $bindStatus = 'OK'
      $bindDetail = $null
    } elseif ($external.Count -gt 0) {
      $bindDetail = 'Внешний bind: ' + ($external -join ', ')
    }
  } catch {
    $bindDetail = 'Не удалось проверить bind 8787.'
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
    $scriptDir = Split-Path -Parent $PSCommandPath
    $repoRoot = (Resolve-Path -LiteralPath (Join-Path $scriptDir '..\..')).Path
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
          $gitDetail = 'Tracked working tree грязный.'
        }
      }
    }
  }

  Write-OperatorLine "[$healthStatus] Backend health"
  if ($healthDetail) { Write-OperatorLine $healthDetail }

  Write-OperatorLine "[$bindStatus] Backend bind 127.0.0.1:8787"
  if ($bindDetail) { Write-OperatorLine $bindDetail }

  Write-OperatorLine "[$gitStatus] Git working tree"
  if ($gitBranch) { Write-OperatorLine "branch: $gitBranch" }
  if ($gitCommit) { Write-OperatorLine "commit: $gitCommit" }
  if ($gitDetail) { Write-OperatorLine $gitDetail }
  foreach ($dirtyLine in $gitDirty) {
    Write-OperatorLine $dirtyLine
  }

  Write-OperatorLine ''
  if ($healthStatus -eq 'OK' -and $bindStatus -eq 'OK' -and $gitStatus -eq 'OK') {
    Write-OperatorLine 'BACKEND SMOKE TEST: PASS'
    exit 0
  }

  Write-OperatorLine 'BACKEND SMOKE TEST: FAIL'
  exit 1
} catch {
  Write-OperatorLine '[FAIL] Backend smoke test'
  Write-OperatorLine 'Проверка не завершилась. Секреты не выводятся.'
  Write-OperatorLine ''
  Write-OperatorLine 'BACKEND SMOKE TEST: FAIL'
  exit 1
}
