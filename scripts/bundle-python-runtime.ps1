param(
    [string]$RuntimeDir = (Join-Path (Split-Path -Parent $PSScriptRoot) "python-runtime")
)

$ErrorActionPreference = "Stop"
$PyReleaseTag = "20251120"
$PyVersion = "3.12.12"
$PyArch = "x86_64-pc-windows-msvc"
$PyFile = "cpython-${PyVersion}+${PyReleaseTag}-${PyArch}-install_only.tar.gz"
$Url = "https://github.com/astral-sh/python-build-standalone/releases/download/${PyReleaseTag}/$($PyFile -replace '\+','%2B')"
$Root = Split-Path -Parent $PSScriptRoot
$Requirements = Join-Path $Root "backend\requirements.txt"

Write-Host "Bundling Python ${PyVersion} (${PyArch}) into ${RuntimeDir} ..."

if (Test-Path $RuntimeDir) { Remove-Item -Recurse -Force $RuntimeDir }
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

$Tarball = Join-Path $env:TEMP "cnc-python-embed.tar.gz"
Write-Host "Downloading $Url ..."
Invoke-WebRequest -Uri $Url -OutFile $Tarball

Write-Host "Extracting ..."
tar -xzf $Tarball -C $RuntimeDir

$Py = Join-Path $RuntimeDir "python\python.exe"
if (-not (Test-Path $Py)) {
    Write-Error "Expected executable not found: $Py"
    exit 1
}

$env:PYTHONHOME = Join-Path $RuntimeDir "python"
$env:PYTHONNOUSERSITE = "1"
Write-Host "Installing pip dependencies ..."
& $Py -m pip install --no-warn-script-location --upgrade pip
& $Py -m pip install --no-warn-script-location -r $Requirements

Write-Host "Done. Python: $(& $Py -c 'import sys; print(sys.executable)')"

# ---- 清理无用文件，压缩体积 ----
Write-Host "Cleaning up to reduce size ..."

$LibDir = Join-Path $RuntimeDir "python\Lib"
$SiteDir = Join-Path $LibDir "site-packages"

# 移除 pip
Remove-Item -Recurse -Force (Join-Path $SiteDir "pip") -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\pip\cache" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$env:APPDATA\pip" -ErrorAction SilentlyContinue
Get-ChildItem $SiteDir -Filter "*.whl" -Recurse | Remove-Item -Force -ErrorAction SilentlyContinue

# 清理 __pycache__
Get-ChildItem $RuntimeDir -Directory -Filter "__pycache__" -Recurse | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem $RuntimeDir -Filter "*.pyc" -Recurse | Remove-Item -Force -ErrorAction SilentlyContinue

# 移除不必要的标准库模块
foreach ($mod in @("tkinter", "idlelib", "ensurepip", "distutils", "lib2to3")) {
    Remove-Item -Recurse -Force (Join-Path $LibDir $mod) -ErrorAction SilentlyContinue
}

Remove-Item -Recurse -Force (Join-Path $RuntimeDir "python\share") -ErrorAction SilentlyContinue

Write-Host "Cleanup done."
