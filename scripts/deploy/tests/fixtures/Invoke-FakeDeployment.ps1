# Test-only script: no Git, Docker, HTTP, credentials or services.
param([switch]$Deploy, [string]$Candidate, [switch]$RequireSynchronizedMain, [switch]$RequireClosedWindow)
if (-not $Deploy -or -not $RequireSynchronizedMain -or $Candidate -notmatch '\A[0-9a-f]{40}\z') { exit 99 }
Write-Host 'password=valor-ficticio-no-publicar'
Write-Output 'salida-libre-no-publicar'
if ($RequireClosedWindow) { exit 0 }
exit 5
