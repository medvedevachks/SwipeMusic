#requires -Version 5.1
<#
.SYNOPSIS
  Запускает production backend Swipe Music на 127.0.0.1.

.DESCRIPTION
  Корень репозитория определяется относительно этого скрипта.
  Окружение читается из production.env, ключ провайдера — только из
  отдельного файла. Значение ключа не печатается.
#>
param(
  [string]$EnvFile = 'C:\SwipeMusic\secrets\production.env',
  [string]$ProviderKeyFile = 'C:\SwipeMusic\secrets\provider-session.key'
)

$ErrorActionPreference = 'Stop'

function Write-OperatorMessage {
  param([string]$Message)
  $encoding = if ([Console]::OutputEncoding.CodePage -eq 65001) {
    New-Object System.Text.UTF8Encoding $false
  } else {
    [System.Text.Encoding]::GetEncoding(866)
  }
  $bytes = $encoding.GetBytes($Message + "`r`n")
  $stream = [Console]::OpenStandardError()
  $stream.Write($bytes, 0, $bytes.Length)
  $stream.Flush()
}

function Fail {
  param([string]$Message)
  Write-OperatorMessage $Message
  exit 1
}

$scriptDir = Split-Path -Parent $PSCommandPath
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $scriptDir '..\..')).Path

if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
  Fail "Не найден файл окружения: $EnvFile"
}

if (-not (Test-Path -LiteralPath $ProviderKeyFile -PathType Leaf)) {
  Fail "Не найден файл ключа провайдера: $ProviderKeyFile"
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Fail 'Node.js не найден в PATH.'
}

$skippedProviderKey = $false
foreach ($line in (Get-Content -LiteralPath $EnvFile -Encoding UTF8)) {
  $trimmed = $line.Trim()
  if ($trimmed.Length -eq 0) { continue }
  if ($trimmed.StartsWith('#')) { continue }

  $separator = $trimmed.IndexOf('=')
  if ($separator -lt 1) {
    Fail 'Некорректная строка в файле окружения: ожидается KEY=value.'
  }

  $name = $trimmed.Substring(0, $separator).Trim()
  $value = $trimmed.Substring($separator + 1)
  if ($name -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
    Fail 'Некорректное имя переменной в файле окружения.'
  }

  if ($name -eq 'PROVIDER_SESSION_KEY') {
    $skippedProviderKey = $true
    continue
  }

  Set-Item -Path "Env:$name" -Value $value
}

if ($skippedProviderKey) {
  Write-OperatorMessage 'PROVIDER_SESSION_KEY из файла окружения пропущен: ключ берётся только из файла ключа.'
}

$rawKey = [System.IO.File]::ReadAllText($ProviderKeyFile)
if ($rawKey.Length -gt 0 -and [int][char]$rawKey[0] -eq 0xFEFF) {
  $rawKey = $rawKey.Substring(1)
}
$providerKey = $rawKey.Trim()
if ($providerKey.Length -eq 0) {
  Fail 'Файл ключа провайдера пуст.'
}

try {
  $keyBytes = [Convert]::FromBase64String($providerKey)
  $canonicalKey = [Convert]::ToBase64String($keyBytes)
} catch {
  Fail 'Ключ провайдера не является корректным base64.'
}

if ($keyBytes.Length -ne 32 -or $canonicalKey -ne $providerKey) {
  Fail 'Ключ провайдера должен быть base64 ровно на 32 байта.'
}

Set-Item -Path Env:PROVIDER_SESSION_KEY -Value $providerKey

Set-Location -LiteralPath $repoRoot
& $nodeCmd.Source --experimental-strip-types server/index.ts
if ($null -eq $LASTEXITCODE) {
  exit 1
}
exit $LASTEXITCODE
