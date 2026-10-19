#requires -Version 5.1
<#
.SYNOPSIS
  Ставит Posh-ACME 4.31.1 или новее, если подходящей версии ещё нет.

.DESCRIPTION
  Не получает сертификат, не открывает порты и не меняет firewall или NAT.
  Другие PowerShell-модули не устанавливает.
#>

$ErrorActionPreference = 'Stop'
$minimumVersion = [version]'4.31.1'

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

function Get-NewestPoshAcmeVersion {
  $modules = @(Get-Module -ListAvailable -Name Posh-ACME)
  if ($modules.Count -eq 0) {
    return $null
  }
  return ($modules | Sort-Object Version -Descending | Select-Object -First 1).Version
}

try {
  $hostVersion = $PSVersionTable.PSVersion
  $hostEdition = [string]$PSVersionTable.PSEdition
  if ($hostEdition -ne 'Desktop' -or $hostVersion.Major -ne 5 -or $hostVersion.Minor -lt 1) {
    Fail 'Нужен Windows PowerShell 5.1. Сертификат не запрашивается.'
  }

  $installed = Get-NewestPoshAcmeVersion
  if ($installed -and $installed -ge $minimumVersion) {
    Write-OperatorLine ("Posh-ACME {0} уже установлен. Переустановка не выполняется." -f $installed)
    exit 0
  }

  if ($installed) {
    Write-OperatorLine ("Найден Posh-ACME {0}. Нужна версия не ниже {1}." -f $installed, $minimumVersion)
  } else {
    Write-OperatorLine ("Posh-ACME не найден. Будет установлена версия не ниже {0}." -f $minimumVersion)
  }

  $nuget = Get-PackageProvider -Name NuGet -ErrorAction SilentlyContinue | Sort-Object Version -Descending | Select-Object -First 1
  if (-not $nuget -or $nuget.Version -lt [version]'2.8.5.201') {
    Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force | Out-Null
  }

  $repository = Get-PSRepository -Name PSGallery -ErrorAction SilentlyContinue
  if (-not $repository) {
    Fail 'Репозиторий PSGallery не найден. Сертификат не запрашивается.'
  }
  if ($repository.InstallationPolicy -ne 'Trusted') {
    Set-PSRepository -Name PSGallery -InstallationPolicy Trusted
    Write-OperatorLine 'PSGallery отмечен как Trusted, чтобы установка прошла без запроса.'
  }

  Install-Module -Name Posh-ACME -Repository PSGallery -MinimumVersion $minimumVersion -Scope CurrentUser -Force -AllowClobber

  $after = Get-NewestPoshAcmeVersion
  if (-not $after -or $after -lt $minimumVersion) {
    Fail 'Posh-ACME не достиг версии 4.31.1. Сертификат не запрашивается.'
  }

  Write-OperatorLine ("Posh-ACME {0} установлен. Сертификат не запрашивается." -f $after)
  exit 0
} catch {
  Write-OperatorLine 'Установка Posh-ACME не выполнена. Сертификат не запрашивается.'
  if ($_.Exception.Message) {
    Write-OperatorLine $_.Exception.Message
  }
  exit 1
}
