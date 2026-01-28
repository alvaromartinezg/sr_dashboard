# One-time library download (requires internet ONCE)
# After this, the dashboard runs 100% offline.
$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$libs = Join-Path $here "libs"
New-Item -ItemType Directory -Force -Path $libs | Out-Null

Write-Host "Downloading offline libraries to $libs ..."

# Chart.js (UMD build)
$chartUrl = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.5.0/chart.umd.min.js"
Invoke-WebRequest -Uri $chartUrl -OutFile (Join-Path $libs "chart.umd.min.js")

# SheetJS (xlsx)
$xlsxUrl = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"
Invoke-WebRequest -Uri $xlsxUrl -OutFile (Join-Path $libs "xlsx.full.min.js")

Write-Host "Done. Now open index.html."
