SR Dashboard (Offline) - Local Setup

This project is designed to run 100% offline, but two third-party JS libraries must be present locally:

  libs/xlsx.full.min.js     (SheetJS / xlsx)
  libs/chart.umd.min.js     (Chart.js)

Because this chat environment cannot bundle external CDN files automatically, run the included helper once:

  Windows: right-click get_libs.ps1 -> Run with PowerShell
  (Requires internet ONLY ONCE)

After the files are downloaded, you can disconnect from internet and just open index.html.

Sources (official CDN listings):
- Chart.js on cdnjs: https://cdnjs.com/libraries/Chart.js
- xlsx (SheetJS) on cdnjs: https://cdnjs.com/libraries/xlsx
