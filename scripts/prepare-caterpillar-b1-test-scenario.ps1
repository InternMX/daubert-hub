# Prepares the B1 E2E scenario in the TEST input folder ONLY (Dropbox\Pruebas\REMISIONES CAT\00_ARCHIVOS A PROCESAR). Never touches PROD folders, PostgreSQL or n8n.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\prepare-caterpillar-b1-test-scenario.ps1 [-Remove]
# Creates, oldest first (the workflow processes oldest modification time first):
#   1. a COPY of the already-emitted legacy file "SC PLANTA 2 PRUEBA PG FINAL2" (TEST document 268: COMPLETADA, 4 remissions, no snapshot) -> must be SKIPPED_HISTORICAL
#   2. a NEW valid P2 programming "PRUEBA B1 20261026" (distinct name and quantities) -> must be emitted and finish COMPLETADA
# -Remove deletes exactly those two named files from the TEST input folder (nothing else).
param([switch]$Remove)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = 'C:\Users\06\Documents\Dropbox\Pruebas\REMISIONES CAT'
$input = Join-Path $root '00_ARCHIVOS A PROCESAR'
$programacion = 'PROGRAMACI' + [char]0x00D3 + 'N DE ENTREGA'   # ASCII-only script: Windows PowerShell 5.1 reads BOM-less files as ANSI
$historicalSource = Join-Path $root "$programacion CAT SC PLANTA 2 PRUEBA PG FINAL2.xlsx"
$newSource = Join-Path $input 'PROGRAMACION DE ENTREGA CAT P2 PRUEBA REGEN 017 20261023.xlsx'
$historicalTarget = Join-Path $input "$programacion CAT SC PLANTA 2 PRUEBA PG FINAL2.xlsx"
$newTarget = Join-Path $input 'PROGRAMACION DE ENTREGA CAT P2 PRUEBA B1 20261026.xlsx'

if ($Remove) {
  foreach ($f in @($historicalTarget, $newTarget)) { if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force; "removed: $f" } }
  return
}
if (-not (Test-Path -LiteralPath $input)) { throw "TEST input folder not found: $input" }
foreach ($f in @($historicalSource, $newSource)) { if (-not (Test-Path -LiteralPath $f)) { throw "Missing source: $f" } }
foreach ($f in @($historicalTarget, $newTarget)) { if (Test-Path -LiteralPath $f) { throw "Already exists (use -Remove first): $f" } }

Copy-Item -LiteralPath $historicalSource -Destination $historicalTarget
Copy-Item -LiteralPath $newSource -Destination $newTarget

# New programming: change two requested quantities (cell I8 1920 -> 1980 and I9 520 -> 540) so the content, hash and manifest are new. Cached formula values are updated too.
$zip = [System.IO.Compression.ZipFile]::Open($newTarget, [System.IO.Compression.ZipArchiveMode]::Update)
try {
  $entry = $zip.GetEntry('xl/worksheets/sheet1.xml')
  $reader = New-Object System.IO.StreamReader($entry.Open(), [System.Text.Encoding]::UTF8)
  $xml = $reader.ReadToEnd(); $reader.Close()
  $patched = $xml.Replace('<c r="I8" s="12"><v>1920</v></c>', '<c r="I8" s="12"><v>1980</v></c>').Replace('<c r="I9" s="12"><v>520</v></c>', '<c r="I9" s="12"><v>540</v></c>')
  $patched = $patched.Replace('<f>+I8/60</f><v>32</v>', '<f>+I8/60</f><v>33</v>').Replace('<f>+I9/30</f><v>17.333333333333332</v>', '<f>+I9/30</f><v>18</v>')
  $patched = $patched.Replace('<f>I8*N8</f><v>3532.8</v>', '<f>I8*N8</f><v>3643.2</v>')
  if ($patched -eq $xml) { throw 'Expected cells not found in the source workbook' }
  $entry.Delete()
  $new = $zip.CreateEntry('xl/worksheets/sheet1.xml')
  $writer = New-Object System.IO.StreamWriter($new.Open(), (New-Object System.Text.UTF8Encoding($false)))
  $writer.Write($patched); $writer.Close()
} finally { $zip.Dispose() }

# Oldest first: the historical file must be scanned before the new one (the workflow sorts by modification time, cutoff 2026-09-22).
(Get-Item -LiteralPath $historicalTarget).LastWriteTime = [datetime]'2026-10-26 07:00:00'
(Get-Item -LiteralPath $newTarget).LastWriteTime = [datetime]'2026-10-26 08:00:00'
Get-ChildItem -LiteralPath $input -File | Sort-Object LastWriteTime | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize | Out-String -Width 200
