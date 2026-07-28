#Requires -Version 5.1
param(
  [ValidateSet('chrome', 'edge', 'windows', 'android', 'auto')]
  [string]$Device = 'auto',
  [switch]$Prod,
  [string]$ServerUrl = ''
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$env:PATH = "C:\flutter\bin;$env:PATH"
$env:FLUTTER_STORAGE_BASE_URL = "https://storage.flutter-io.cn"
$env:PUB_HOSTED_URL = "https://pub.flutter-io.cn"

if (-not (Get-Command flutter -ErrorAction SilentlyContinue)) {
  Write-Error "找不到 flutter，请确认 C:\flutter\bin 已加入 PATH"
}

$flavor = if ($Prod) { 'prod' } else { 'local' }
$url = $ServerUrl
if (-not $url) {
  if ($Prod) {
    $url = 'https://qqovo.top'
  } elseif ($Device -eq 'android') {
    $url = 'http://10.0.2.2:4000'
  } else {
    $url = 'http://localhost:4000'
  }
}

$webPort = 57920

Write-Host "OpenMusic mobile local run" -ForegroundColor Cyan
Write-Host "  flavor = $flavor"
Write-Host "  server = $url (build-time only, not shown in app)"
Write-Host "  device = $Device"
Write-Host ""
Write-Host "请确认仓库根目录已执行: npm run dev  (API :4000)" -ForegroundColor Yellow
Write-Host ""

flutter pub get | Out-Host

$defines = @(
  "--dart-define=OM_FLAVOR=$flavor",
  "--dart-define=OM_SERVER_URL=$url"
)

# Chrome 直连 DevTools 在部分版本会触发 Flutter 工具崩溃；改用 web-server + 手动开 Chrome。
$useWebServer = $Device -in @('auto', 'chrome', 'edge')
$browser = if ($Device -eq 'edge') { 'edge' } else { 'chrome' }

if ($useWebServer) {
  $urlToOpen = "http://localhost:$webPort"
  Write-Host "Web: $urlToOpen (编译完成后用 $browser 打开)" -ForegroundColor DarkGray
  Start-Job -ScriptBlock {
    param($openUrl, $openBrowser)
    Start-Sleep -Seconds 12
    $chromeCandidates = @(
      "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
      "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
      "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
    )
    if ($openBrowser -eq 'edge') {
      $edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
      if (Test-Path $edge) { Start-Process $edge $openUrl; return }
    }
    foreach ($path in $chromeCandidates) {
      if (Test-Path $path) { Start-Process $path $openUrl; return }
    }
    Start-Process $openUrl
  } -ArgumentList $urlToOpen, $browser | Out-Null
  $args = @(
    'run', '-d', 'web-server',
    '--web-port', "$webPort",
    '--web-hostname', 'localhost'
  ) + $defines
} elseif ($Device -eq 'android') {
  $args = @('run') + $defines
} else {
  $args = @('run', '-d', $Device) + $defines
}

Write-Host ("flutter " + ($args -join ' ')) -ForegroundColor DarkGray
& flutter @args
