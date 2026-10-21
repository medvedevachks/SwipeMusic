#requires -Version 5.1
<#
  Локальные mkcert-сертификаты для npm run dev:lan.
  IP сети задаётся явно. Скрипт не выбирает адаптер сам и не ставит mkcert.
#>
param(
  [string]$LanIp
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $ProjectRoot

function Show-Ipv4Candidates {
  Write-Host 'Доступные IPv4-адреса этого ПК:'
  Write-Host ''
  $shown = $false
  try {
    $rows = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
      Where-Object { $_.IPAddress -ne '127.0.0.1' })
    foreach ($row in $rows) {
      $shown = $true
      Write-Host ("  {0,-16} {1}" -f $row.IPAddress, $row.InterfaceAlias)
    }
  } catch {
    Write-Host 'Get-NetIPAddress недоступен, вывод ipconfig:'
    Write-Host ''
    ipconfig
    $shown = $true
  }

  if (-not $shown) {
    Write-Host '  (не найдено адресов кроме 127.0.0.1)'
  }

  Write-Host ''
  Write-Host 'Выберите IP своей Wi-Fi или Ethernet сети.'
  Write-Host 'Адреса 169.254.* обычно link-local, а VPN/виртуальные адаптеры — не сеть телефона.'
  Write-Host 'Скрипт сам адрес не выбирает.'
  Write-Host ''
  Write-Host 'Повторите запуск:'
  Write-Host '  powershell -ExecutionPolicy Bypass -File .\scripts\setup-lan-pwa.ps1 -LanIp <IP>'
}

function Test-LanIpv4([string]$Value) {
  $parts = $Value.Split('.')
  if ($parts.Count -ne 4) {
    return $false
  }
  foreach ($part in $parts) {
    if ($part -notmatch '^\d+$') {
      return $false
    }
    $number = [int]$part
    if ($number -lt 0 -or $number -gt 255) {
      return $false
    }
  }
  return $true
}

if ([string]::IsNullOrWhiteSpace($LanIp)) {
  Write-Host 'Параметр -LanIp не передан.'
  Write-Host ''
  Show-Ipv4Candidates
  exit 1
}

if (-not (Test-LanIpv4 $LanIp)) {
  Write-Host "Некорректный IPv4: $LanIp"
  Write-Host ''
  Show-Ipv4Candidates
  exit 1
}

$mkcert = Get-Command mkcert -ErrorAction SilentlyContinue
if (-not $mkcert) {
  Write-Host 'mkcert не найден. Автоматическая установка не выполняется.'
  Write-Host ''
  Write-Host 'Установите mkcert и запустите скрипт снова:'
  Write-Host '  winget install FiloSottile.mkcert'
  exit 1
}

$certDir = Join-Path $ProjectRoot '.certs'
New-Item -ItemType Directory -Force -Path $certDir | Out-Null
$certFile = Join-Path $certDir 'lan-cert.pem'
$keyFile = Join-Path $certDir 'lan-key.pem'

Write-Host 'Локальный CA mkcert (может запросить подтверждение Windows):'
& mkcert -install
if ($LASTEXITCODE -ne 0) {
  throw "mkcert -install завершился с кодом $LASTEXITCODE"
}

Write-Host ''
Write-Host "Сертификат для $LanIp, localhost, 127.0.0.1"
& mkcert -cert-file $certFile -key-file $keyFile $LanIp 'localhost' '127.0.0.1'
if ($LASTEXITCODE -ne 0) {
  throw "mkcert завершился с кодом $LASTEXITCODE"
}

$caRoot = (& mkcert -CAROOT).Trim()
$publicCa = Join-Path $caRoot 'rootCA.pem'
$privateCa = Join-Path $caRoot 'rootCA-key.pem'

$originFile = Join-Path $certDir 'lan-origin.txt'
Set-Content -LiteralPath $originFile -Value "https://${LanIp}:5173" -Encoding ascii -NoNewline

Write-Host ''
Write-Host "HTTPS URL: https://${LanIp}:5173"
Write-Host "Dev origin записан явно: $originFile"
Write-Host 'Production этот файл не читает. Другие origin задаются только через APP_ALLOWED_ORIGINS, без wildcard.'
Write-Host "Каталог CA: $caRoot"
Write-Host ''
Write-Host 'На Android нужен только публичный корневой сертификат:'
Write-Host "  $publicCa"
Write-Host ''
Write-Host 'НИКОГДА не переносите на телефон приватный ключ CA:'
Write-Host "  $privateCa"
Write-Host ''
Write-Host 'Дальше, в двух терминалах из корня проекта:'
Write-Host '  npm run dev:auth'
Write-Host '  npm run dev:lan'
Write-Host ''
Write-Host 'Backend остаётся на 127.0.0.1:8787 и в LAN не открывается.'
Write-Host 'Если телефон не открывает URL, проверьте Windows Firewall: Private network, TCP 5173 для Node/Vite. Порт 8787 наружу не открывайте.'
