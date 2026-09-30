#Requires -Version 5.1
<#
    BackupN8nPipeline.psm1
    Orquestación del backup de n8n (V1), misma arquitectura que el de PostgreSQL:

      staging plaintext
        -> bundle .7z SIN contraseña
        -> age con recipient público
        -> validación estructural
        -> eliminar TODO plaintext
        -> SHA-256
        -> publicar .age + .age.sha256
        -> retención

    Contenido del bundle plaintext (exactamente): database.sqlite (snapshot por
    node:sqlite, nunca copia del original), config (obligatorio, jamás se abre
    ni se imprime), storage\ (copia estable, si existe), nodes\ (si existe) y
    manifest.json. Nunca se incluyen el .sqlite original, -wal, -shm, logs\ ni
    n8nEventLog*.log, y jamás se escribe ni se borra nada dentro de n8nRoot.

    Seams de procesos externos (mockeables): Invoke-NodeProcess (BackupN8nSqlite),
    Invoke-SevenZipProcess (BackupPackaging), Invoke-AgeProcess (BackupEncryption).
    El producer NO necesita ni admite una identidad/clave privada de age.
#>

Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot 'BackupConfig.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupNaming.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupLogging.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupLock.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupHash.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupPackaging.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupEncryption.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupRetention.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupPublish.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupN8nConfig.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupN8nSqlite.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupN8nStaging.psm1') -DisableNameChecking

# Mismos códigos que el backup de PostgreSQL donde hay equivalente; 4 = snapshot SQLite, 13 = storage inestable.
$script:N8nExitCodes = @{
    Success                     = 0
    UnexpectedError             = 1
    LockHeld                    = 2
    PrerequisiteError           = 3
    SnapshotFailed              = 4
    ValidationFailed            = 5
    HashFailed                  = 6
    PublishFailed               = 7
    RetentionFailed             = 8
    PackagingFailed             = 9
    EncryptionFailed            = 10
    EncryptionValidationFailed  = 11
    PublishIntegrityCheckFailed = 12
    StorageUnstable             = 13
}

function New-N8nStageError {
    param([string]$Message, [int]$ExitCode)
    $ex = New-Object System.Exception($Message)
    $ex.Data['ExitCode'] = $ExitCode
    return $ex
}

function Get-N8nStageExitCode {
    param($Exception)
    if ($Exception -and $Exception.Data.Contains('ExitCode')) { return [int]$Exception.Data['ExitCode'] }
    return $script:N8nExitCodes.UnexpectedError
}

function Invoke-DaubertN8nBackup {
    <#
        Ejecuta el pipeline completo para una configuración ya resuelta y devuelve
        el exit code (0 = éxito). Nunca llama a `exit`.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Config,
        [switch]$DryRun,
        [int]$LockTimeoutSeconds = 0,
        [int]$NodeTimeoutSeconds = 600,
        [int]$SevenZipTimeoutSeconds = 600,
        [int]$AgeTimeoutSeconds = 600,
        [int]$StorageCopyAttempts = 3,
        [datetime]$Now = (Get-Date)
    )

    $ExitCodes = $script:N8nExitCodes
    $tier = $Config.Tier

    $prereq = Test-N8nBackupPrerequisite -Config $Config
    if (-not $prereq.IsValid) {
        foreach ($e in $prereq.Errors) { Write-Error $e -ErrorAction Continue }
        return $ExitCodes.PrerequisiteError
    }

    $RunId = New-BackupRunId
    $timestamp = New-BackupTimestamp -Now $Now
    $tierToken = (Get-N8nTierDefinition -Tier $tier).FileToken
    $LogPath = Join-Path $Config.LogDir ("n8n_backup_{0}_{1}_{2}.log.jsonl" -f $tierToken, $timestamp, $RunId.Substring(0, 8))
    $stagingDir = Join-Path $Config.N8nStagingRoot $RunId
    $bundleDir = Join-Path $stagingDir 'bundle'

    Write-BackupLogEntry -LogPath $LogPath -RunId $RunId -Tier $tier -Stage 'run' -Result 'start' -Message "DryRun=$($DryRun.IsPresent)"

    $exitCode = $ExitCodes.UnexpectedError
    $lockHandle = $null

    try {
        try {
            $lockHandle = Enter-BackupLock -LockFilePath $Config.LockFilePath -TimeoutSeconds $LockTimeoutSeconds
            Write-BackupLogEntry -LogPath $LogPath -RunId $RunId -Tier $tier -Stage 'lock' -Result 'success'
        }
        catch {
            Write-BackupLogEntry -LogPath $LogPath -RunId $RunId -Tier $tier -Stage 'lock' -Result 'failure' -Message $_.Exception.Message
            Write-Error $_.Exception.Message -ErrorAction Continue
            return $ExitCodes.LockHeld
        }

        # Con el lock en mano, todo staging ajeno de n8n es huérfano (plaintext residual de un kill).
        $orphans = @(Remove-OrphanedN8nStaging -N8nStagingRoot $Config.N8nStagingRoot -KeepPath $stagingDir)
        if ($orphans.Count -gt 0) {
            Write-BackupLogEntry -LogPath $LogPath -RunId $RunId -Tier $tier -Stage 'cleanup_orphan_staging' -Result 'info' -Message "$($orphans.Count) directorio(s) de staging huerfano(s) eliminado(s)"
        }

        try {
            New-Item -ItemType Directory -Path $bundleDir -Force | Out-Null

            # --- 1. Snapshot SQLite por node:sqlite (nunca Copy-Item sobre database.sqlite) ---
            $snapshotPath = Join-Path $bundleDir 'database.sqlite'
            $sourceDb = Join-Path $Config.N8nRoot 'database.sqlite'
            try {
                $snapshot = Measure-BackupStage -LogPath $LogPath -RunId $RunId -Tier $tier -Stage 'sqlite_snapshot' -ScriptBlock {
                    Invoke-N8nSqliteSnapshot -NodePath $Config.NodePath -HelperPath $Config.HelperScriptPath -SourcePath $sourceDb -DestinationPath $snapshotPath -TimeoutSeconds $NodeTimeoutSeconds
                }
            }
            catch {
                $kind = if ($_.Exception.Data.Contains('Kind')) { [string]$_.Exception.Data['Kind'] } else { 'Helper' }
                $code = if ($kind -eq 'QuickCheck') { $ExitCodes.ValidationFailed } else { $ExitCodes.SnapshotFailed }
                throw (New-N8nStageError -Message $_.Exception.Message -ExitCode $code)
            }

            # --- 2. config (obligatorio): solo se COPIA, jamás se abre ni se registra su contenido ---
            $configSource = Join-Path $Config.N8nRoot 'config'
            try {
                Measure-BackupStage -LogPath $LogPath -RunId $RunId -Tier $tier -Stage 'copy_config' -ScriptBlock {
                    if (-not (Test-Path -LiteralPath $configSource -PathType Leaf)) { throw "No existe el archivo 'config' de n8n (obligatorio)." }
                    Copy-Item -LiteralPath $configSource -Destination (Join-Path $bundleDir 'config') -ErrorAction Stop
                } | Out-Null
            }
            catch {
                throw (New-N8nStageError -Message "No se pudo incluir el archivo 'config' de n8n (obligatorio en esta versión del backup)." -ExitCode $ExitCodes.ValidationFailed)
            }

            # --- 3. storage\ (copia estable, si existe) ---
            $storageInfo = [pscustomobject]@{ Included = $false; FileCount = 0; SizeBytes = [long]0; StableCopy = $false }
            $storageSource = Join-Path $Config.N8nRoot 'storage'
            if (Test-Path -LiteralPath $storageSource -PathType Container) {
                try {
                    $copy = Measure-BackupStage -LogPath $LogPath -RunId $RunId -Tier $tier -Stage 'copy_storage_stable' -ScriptBlock {
                        Copy-N8nStorageStable -Source $storageSource -Destination (Join-Path $bundleDir 'storage') -MaxAttempts $StorageCopyAttempts
                    }
                }
                catch {
                    $code = if ($_.Exception.Data.Contains('Kind') -and $_.Exception.Data['Kind'] -eq 'StorageUnstable') { $ExitCodes.StorageUnstable } else { $ExitCodes.UnexpectedError }
                    throw (New-N8nStageError -Message $_.Exception.Message -ExitCode $code)
                }
                Write-BackupLogEntry -LogPath $LogPath -RunId $RunId -Tier $tier -Stage 'copy_storage_stable' -Result 'info' -Message "attempts=$($copy.Attempts) files=$($copy.FileCount)"
                $storageInfo = [pscustomobject]@{ Included = $true; FileCount = $copy.FileCount; SizeBytes = $copy.SizeBytes; StableCopy = [bool]$copy.StableCopy }
            }
            else {
                Write-BackupLogEntry -LogPath $LogPath -RunId $RunId -Tier $tier -Stage 'copy_storage_stable' -Result 'skipped' -Message 'storage no existe en esta instalación.'
            }

            # --- 4. nodes\ (si existe) + community packages ---
            $nodesInfo = [pscustomobject]@{ Included = $false; FileCount = 0 }
            $community = @()
            $nodesSource = Join-Path $Config.N8nRoot 'nodes'
            if (Test-Path -LiteralPath $nodesSource -PathType Container) {
                $nodesDest = Join-Path $bundleDir 'nodes'
                try {
                    Measure-BackupStage -LogPath $LogPath -RunId $RunId -Tier $tier -Stage 'copy_nodes' -ScriptBlock {
                        Copy-N8nDirectoryTree -Source $nodesSource -Destination $nodesDest
                    } | Out-Null
                }
                catch {
                    throw (New-N8nStageError -Message "Falló la copia de nodes: $($_.Exception.Message)" -ExitCode $ExitCodes.UnexpectedError)
                }
                $m = Measure-N8nTree -Path $nodesDest
                $nodesInfo = [pscustomobject]@{ Included = $true; FileCount = $m.FileCount }
                $community = @(Get-N8nCommunityPackage -NodesPath $nodesDest)
            }
            else {
                Write-BackupLogEntry -LogPath $LogPath -RunId $RunId -Tier $tier -Stage 'copy_nodes' -Result 'skipped' -Message 'nodes no existe en esta instalación.'
            }

            # --- 5. manifest.json (antes de empaquetar) ---
            $n8nVersion = Get-N8nVersion -PackagePath $Config.N8nPackagePath
            $nodeVersion = Get-N8nNodeVersion -NodePath $Config.NodePath
            if (-not $n8nVersion) { Write-BackupLogEntry -LogPath $LogPath -RunId $RunId -Tier $tier -Stage 'manifest' -Result 'warning' -Message 'No se pudo determinar la versión de n8n (se registra unknown).' }
            $manifest = New-N8nManifest -Tier $tier -CreatedAt $Now -N8nVersion $n8nVersion -NodeVersion $nodeVersion -Database $snapshot -Storage $storageInfo -Nodes $nodesInfo -CommunityNodes $community
            Write-N8nManifest -Manifest $manifest -Path (Join-Path $bundleDir 'manifest.json')
            Write-BackupLogEntry -LogPath $LogPath -RunId $RunId -Tier $tier -Stage 'manifest' -Result 'success'

            # --- 6. Bundle .7z SIN contraseña ---
            $sources = @('database.sqlite', 'config', 'manifest.json')
            if ($storageInfo.Included) { $sources += 'storage' }
            if ($nodesInfo.Included) { $sources += 'nodes' }
            $bundlePath = Join-Path $stagingDir ("n8n_{0}_{1}.bundle.7z" -f $tierToken, $timestamp)
            $bundleResult = Measure-BackupStage -LogPath $LogPath -RunId $RunId -Tier $tier -Stage 'package_bundle' -ScriptBlock {
                New-PlainBundle -SevenZipPath $Config.SevenZipPath -BundlePath $bundlePath -WorkingDirectory $bundleDir -SourceFileNames $sources -TimeoutSeconds $SevenZipTimeoutSeconds
            }
            if (-not $bundleResult.Success -or -not (Test-Path -LiteralPath $bundlePath -PathType Leaf)) {
                throw (New-N8nStageError -Message "El empaquetado (7z sin cifrar) falló (exit code $($bundleResult.ExitCode))." -ExitCode $ExitCodes.PackagingFailed)
            }

            # --- 7. Cifrado ASIMÉTRICO con age (solo recipient público) ---
            $archiveFileName = New-N8nArchiveFileName -Tier $tier -Timestamp $timestamp
            $stagingArchivePath = Join-Path $stagingDir $archiveFileName
            $encryptResult = Measure-BackupStage -LogPath $LogPath -RunId $RunId -Tier $tier -Stage 'encrypt_age' -ScriptBlock {
                New-AgeEncryptedArtifact -AgePath $Config.AgePath -RecipientsFilePath $Config.RecipientsFilePath -InputPath $bundlePath -OutputPath $stagingArchivePath -TimeoutSeconds $AgeTimeoutSeconds
            }
            if (-not $encryptResult.Success -or -not (Test-Path -LiteralPath $stagingArchivePath -PathType Leaf)) {
                throw (New-N8nStageError -Message "El cifrado con age falló (exit code $($encryptResult.ExitCode))." -ExitCode $ExitCodes.EncryptionFailed)
            }

            # --- 8. Validación ESTRUCTURAL del artefacto cifrado ---
            $archiveCheck = Measure-BackupStage -LogPath $LogPath -RunId $RunId -Tier $tier -Stage 'validate_age_structure' -ScriptBlock {
                Test-AgeArtifactStructure -Path $stagingArchivePath
            }
            if (-not $archiveCheck.IsValid) {
                throw (New-N8nStageError -Message "La validación estructural del artefacto cifrado falló ($($archiveCheck.Reason)); no se publica." -ExitCode $ExitCodes.EncryptionValidationFailed)
            }

            # --- 9. Eliminar TODO el plaintext (snapshot, config, storage, nodes, manifest y bundle) ---
            Remove-Item -LiteralPath $bundleDir -Recurse -Force -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath $bundlePath -Force -ErrorAction SilentlyContinue
            if ((Test-Path -LiteralPath $bundleDir) -or (Test-Path -LiteralPath $bundlePath)) {
                throw (New-N8nStageError -Message 'No se pudo eliminar todo el plaintext de staging tras cifrar; no se publica.' -ExitCode $ExitCodes.UnexpectedError)
            }
            Write-BackupLogEntry -LogPath $LogPath -RunId $RunId -Tier $tier -Stage 'cleanup_plaintext' -Result 'success' -Message 'snapshot, config, storage, nodes, manifest y bundle eliminados de staging tras cifrar'

            # --- 10. SHA-256 sobre el artefacto cifrado ---
            try {
                Measure-BackupStage -LogPath $LogPath -RunId $RunId -Tier $tier -Stage 'hash' -ScriptBlock { New-BackupFileHash -Path $stagingArchivePath } | Out-Null
            }
            catch {
                throw (New-N8nStageError -Message "Falló el cálculo de hash SHA-256 del artefacto cifrado: $($_.Exception.Message)" -ExitCode $ExitCodes.HashFailed)
            }

            # --- 11. Publicación (nunca en DryRun) ---
            if (-not $DryRun) {
                try {
                    $publishedPath = Measure-BackupStage -LogPath $LogPath -RunId $RunId -Tier $tier -Stage 'publish_archive' -ScriptBlock {
                        Publish-BackupArtifact -StagingPath $stagingArchivePath -DestinationDir $Config.TierDir -BackupRoot $Config.BackupRoot -FileName $archiveFileName
                    }
                }
                catch {
                    throw (New-N8nStageError -Message "Falló la publicación al destino final: $($_.Exception.Message)" -ExitCode $ExitCodes.PublishFailed)
                }
                $postPublishOk = Measure-BackupStage -LogPath $LogPath -RunId $RunId -Tier $tier -Stage 'verify_published_hash' -ScriptBlock { Test-BackupFileHash -Path $publishedPath }
                if (-not $postPublishOk) {
                    Remove-Item -LiteralPath $publishedPath -Force -ErrorAction SilentlyContinue
                    Remove-Item -LiteralPath "$publishedPath.sha256" -Force -ErrorAction SilentlyContinue
                    throw (New-N8nStageError -Message 'El hash del archivo publicado no coincide con el sidecar; se revirtió la publicación.' -ExitCode $ExitCodes.PublishIntegrityCheckFailed)
                }
            }
            else {
                Write-BackupLogEntry -LogPath $LogPath -RunId $RunId -Tier $tier -Stage 'publish' -Result 'skipped' -Message 'DryRun: no se publica al destino final.'
            }

            # --- 12. Retención (Weekly 56 días / OnChange 90 días; DryRun no borra) ---
            try {
                $cutoff = Get-RetentionCutoffDate -RetentionUnit $Config.RetentionUnit -RetentionValue $Config.RetentionValue -Now $Now
                $pattern = Get-N8nArchiveFileNamePattern -Tier $tier
                $retentionResult = Measure-BackupStage -LogPath $LogPath -RunId $RunId -Tier $tier -Stage 'retention_archive' -ScriptBlock {
                    Invoke-BackupRetention -BackupRoot $Config.BackupRoot -TargetDir $Config.TierDir -Pattern $pattern -CutoffDate $cutoff -DryRun:$DryRun
                }
                Write-BackupLogEntry -LogPath $LogPath -RunId $RunId -Tier $tier -Stage 'retention_archive' -Result 'info' -Message ("deleted={0} would_delete={1} kept={2}" -f $retentionResult.Deleted.Count, $retentionResult.WouldDelete.Count, $retentionResult.Kept.Count)
            }
            catch {
                throw (New-N8nStageError -Message "El backup se completó y publicó, pero la retención falló: $($_.Exception.Message)" -ExitCode $ExitCodes.RetentionFailed)
            }

            $exitCode = $ExitCodes.Success
            Write-BackupLogEntry -LogPath $LogPath -RunId $RunId -Tier $tier -Stage 'run' -Result 'success' -Message "DryRun=$($DryRun.IsPresent)"
        }
        catch {
            $exitCode = Get-N8nStageExitCode -Exception $_.Exception
            Write-BackupLogEntry -LogPath $LogPath -RunId $RunId -Tier $tier -Stage 'run' -Result 'failure' -Message $_.Exception.Message
            Write-Error $_.Exception.Message -ErrorAction Continue
        }
        finally {
            # Limpieza de staging SIEMPRE (éxito o error): solo el directorio de este RunId.
            if (Test-Path -LiteralPath $stagingDir) { Remove-Item -LiteralPath $stagingDir -Recurse -Force -ErrorAction SilentlyContinue }
        }
    }
    finally {
        Exit-BackupLock -LockHandle $lockHandle
    }

    return $exitCode
}

function Invoke-DaubertN8nBackupRun {
    <# Punto de entrada de alto nivel del entrypoint: resuelve la configuración y ejecuta el pipeline. #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][ValidateSet('Weekly', 'OnChange')][string]$Tier,
        [string]$ConfigPath,
        [hashtable]$CliParameters = @{},
        [switch]$DryRun,
        [int]$LockTimeoutSeconds = 0,
        [int]$NodeTimeoutSeconds = 600,
        [int]$SevenZipTimeoutSeconds = 600,
        [int]$AgeTimeoutSeconds = 600,
        [int]$StorageCopyAttempts = 3,
        [datetime]$Now = (Get-Date)
    )

    $resolved = Resolve-N8nBackupRunConfig -Tier $Tier -ConfigPath $ConfigPath -CliParameters $CliParameters
    if (@($resolved.Errors).Count -gt 0) {
        foreach ($e in $resolved.Errors) { Write-Error $e -ErrorAction Continue }
        return $script:N8nExitCodes.PrerequisiteError
    }
    return (Invoke-DaubertN8nBackup -Config $resolved.Config -DryRun:$DryRun -LockTimeoutSeconds $LockTimeoutSeconds -NodeTimeoutSeconds $NodeTimeoutSeconds -SevenZipTimeoutSeconds $SevenZipTimeoutSeconds -AgeTimeoutSeconds $AgeTimeoutSeconds -StorageCopyAttempts $StorageCopyAttempts -Now $Now)
}

Export-ModuleMember -Function Invoke-DaubertN8nBackup, Invoke-DaubertN8nBackupRun
