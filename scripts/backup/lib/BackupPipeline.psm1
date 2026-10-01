#Requires -Version 5.1
<#
    BackupPipeline.psm1
    Orquestación del backup (pasos 1-14) como funciones de módulo, para que
    el pipeline completo pueda ejercitarse en el mismo proceso con mocks de
    los tres seams de procesos externos:
        Invoke-ExternalProcess  (BackupPgTools)   pg_dump / pg_restore / pg_dumpall
        Invoke-SevenZipProcess  (BackupPackaging) 7z (empaquetado sin cifrar)
        Invoke-AgeProcess       (BackupEncryption) age (cifrado con clave pública)
    En producción esos seams lanzan los binarios reales; las pruebas no
    necesitan crear ni compilar ningún ejecutable falso.

    El entrypoint canónico (Start-DaubertPostgresBackup.ps1) es un envoltorio
    fino: reúne los parámetros del CLI y sale con el código que devuelve
    Invoke-DaubertBackupRun.

    Precedencia de configuración: parámetro explícito del CLI > config.json
    (-ConfigPath) > detección portable. Sin -ConfigPath NO se lee
    %ProgramData% (aislamiento).
#>

Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot 'BackupConfig.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupLocalConfig.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupNaming.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupLogging.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupLock.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupHash.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupPgTools.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupPackaging.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupEncryption.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupRetention.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupPublish.psm1') -DisableNameChecking

class BackupStageError : System.Exception {
    [int]$ExitCode
    BackupStageError([string]$Message, [int]$ExitCode) : base($Message) {
        $this.ExitCode = $ExitCode
    }
}

# Códigos de salida documentados en docs/operations/postgresql-backup-automation.md
$script:ExitCodes = @{
    Success                     = 0
    UnexpectedError             = 1
    LockHeld                    = 2
    PrerequisiteError           = 3
    PgDumpFailed                = 4
    ValidationFailed            = 5
    HashFailed                  = 6
    PublishFailed               = 7
    RetentionFailed             = 8
    PackagingFailed             = 9
    EncryptionFailed            = 10
    EncryptionValidationFailed  = 11
    PublishIntegrityCheckFailed = 12
}

function Resolve-BackupRunConfig {
    <#
        Construye la configuración de una ejecución:
        config.json (si -ConfigPath) < parámetros explícitos del CLI
        (-CliParameters, claves = parámetros de Get-BackupConfig) < nada más.
        Las herramientas sin ruta se detectan de forma portable.
        Devuelve { Config, Schedule, Errors } (Schedule = schedule efectivo del tier: config.json sobre defaults).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][ValidateSet('Frequent', 'Daily', 'Monthly')][string]$Tier,
        [string]$ConfigPath,
        [hashtable]$CliParameters = @{}
    )

    $configParams = @{ Tier = $Tier }
    $schedule = Get-DefaultSchedule -Tier $Tier
    $errors = New-Object System.Collections.Generic.List[string]

    if ($ConfigPath) {
        $local = Read-LocalBackupConfig -Path $ConfigPath
        if (-not $local.IsValid) {
            $errors.Add("Configuración inválida en '$ConfigPath':")
            foreach ($e in $local.Errors) { $errors.Add(" - $e") }
            return [pscustomobject]@{ Config = $null; Errors = $errors.ToArray() }
        }
        foreach ($kv in (ConvertTo-BackupConfigParameters -LocalConfig $local.Config -Tier $Tier).GetEnumerator()) {
            $configParams[$kv.Key] = $kv.Value
        }
        $schedule = Get-LocalConfigSchedule -Config $local.Config -Tier $Tier
    }

    # Los parámetros explícitos del CLI SIEMPRE prevalecen sobre config.json.
    foreach ($key in $CliParameters.Keys) { $configParams[$key] = $CliParameters[$key] }

    # Detección portable como último recurso (nunca rutas de usuario).
    $detectors = @{ PgBinPath = { Find-PostgresBinPath }; SevenZipPath = { Find-SevenZipPath }; AgePath = { Find-AgePath } }
    foreach ($name in $detectors.Keys) {
        if (-not $configParams.ContainsKey($name) -or [string]::IsNullOrWhiteSpace([string]$configParams[$name])) {
            $found = & $detectors[$name]
            if ($found) { $configParams[$name] = $found }
        }
    }

    [pscustomobject]@{ Config = (Get-BackupConfig @configParams); Schedule = $schedule; Errors = @() }
}

function Remove-OrphanedStagingDirectory {
    <#
        Limpieza de staging HUÃ‰RFANO: directorios <StagingRoot>\<RunId> que dejÃ³ una ejecuciÃ³n
        anterior que muriÃ³ sin ejecutar su `finally` (kill por timeout de Task Scheduler,
        apagado, crash) y que pueden contener dumps en texto plano.

        Es seguro porque SOLO se invoca con el lock exclusivo ya adquirido (cualquier otra
        ejecuciÃ³n viva tendrÃ­a el lock, asÃ­ que todo directorio ajeno es huÃ©rfano) y porque:
          - solo mira DENTRO de StagingRoot (se valida la ruta);
          - solo borra directorios cuyo nombre es un RunId (32 hex), nunca otros nombres;
          - nunca toca $KeepPath (el staging de la ejecuciÃ³n actual);
          - nunca toca el destino de backups ni archivos publicados.
        Idempotente. Devuelve los nombres eliminados.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$StagingRoot,
        [string]$KeepPath
    )

    if (-not (Test-Path -LiteralPath $StagingRoot -PathType Container)) { return @() }
    $removed = New-Object System.Collections.Generic.List[string]
    foreach ($dir in (Get-ChildItem -LiteralPath $StagingRoot -Directory -ErrorAction SilentlyContinue)) {
        if ($dir.Name -notmatch '^[0-9a-f]{32}$') { continue }
        if ($KeepPath -and ($dir.FullName.TrimEnd('\') -eq $KeepPath.TrimEnd('\'))) { continue }
        if (-not (Test-PathIsWithinRoot -Path $dir.FullName -Root $StagingRoot)) { continue }
        Remove-Item -LiteralPath $dir.FullName -Recurse -Force -ErrorAction SilentlyContinue
        if (-not (Test-Path -LiteralPath $dir.FullName)) { $removed.Add($dir.Name) }
    }
    return $removed.ToArray()
}
function Get-BackupDueState {
    <#
        ¿Toca hacer el backup de esta configuración? Solo cuenta el último backup PUBLICADO VÁLIDO
        (.age + .sha256, ver Get-LatestPublishedBackup); no hay archivo de estado ni base de datos.
        Frequent no tiene periodo: siempre toca. Sin -Schedule se usa el schedule por defecto del tier.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Config,
        $Schedule,
        [Parameter(Mandatory = $true)][datetime]$Now
    )

    if ($null -eq $Schedule) { $Schedule = Get-DefaultSchedule -Tier $Config.Tier }
    $latest = $null
    if ($Config.TierDir) {
        $pattern = Get-BackupFileNamePattern -Kind Archive -Tier $Config.Tier -Database $Config.PgDatabase
        $latest = Get-LatestPublishedBackup -TargetDir $Config.TierDir -Pattern $pattern
    }
    return (Test-BackupDue -Tier $Config.Tier -Schedule $Schedule -Now $Now -LatestPublished $latest)
}

function Get-BackupDueStateSafe {
    <#
        Igual que Get-BackupDueState pero NUNCA lanza: si no se puede determinar (carpeta ilegible, schedule
        inválido, ...) devuelve Due = $true con el mensaje en Error. -OnlyIfDue solo puede OMITIR un backup cuando
        hay certeza de que ya existe; ante la duda se sigue al pipeline normal, que registra los errores por el
        mecanismo existente (log JSONL y exit code). Siempre devuelve la propiedad Error ($null si todo fue bien).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Config,
        $Schedule,
        [Parameter(Mandatory = $true)][datetime]$Now
    )

    try {
        $state = Get-BackupDueState -Config $Config -Schedule $Schedule -Now $Now -ErrorAction Stop
        return [pscustomobject]@{ Due = [bool]$state.Due; Reason = $state.Reason; ScheduledInstant = $state.ScheduledInstant; LatestPublished = $state.LatestPublished; Error = $null }
    }
    catch {
        return [pscustomobject]@{ Due = $true; Reason = 'due_check_error'; ScheduledInstant = $null; LatestPublished = $null; Error = $_.Exception.Message }
    }
}

function Invoke-DaubertBackup {
    <#
        Ejecuta el pipeline completo para una configuración ya resuelta y
        devuelve el exit code (0 = éxito). Nunca llama a `exit`.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Config,
        [switch]$DryRun,
        [int]$LockTimeoutSeconds = 0,
        [int]$SevenZipTimeoutSeconds = 300,
        [int]$AgeTimeoutSeconds = 300,
        [datetime]$Now = (Get-Date),
        [switch]$OnlyIfDue,
        $Schedule
    )

    $ExitCodes = $script:ExitCodes

    # -OnlyIfDue (Daily/Monthly por Task Scheduler): si ya existe el backup válido de este periodo, no hay
    # nada que hacer. Es un éxito (exit 0) y no deja log ni toca el lock. Se vuelve a comprobar DENTRO del lock.
    $initialDueError = $null
    if ($OnlyIfDue) {
        $dueState = Get-BackupDueStateSafe -Config $Config -Schedule $Schedule -Now $Now
        $initialDueError = $dueState.Error
        if (-not $dueState.Due) {
            Write-Verbose ("Backup $($Config.Tier) omitido: ya existe un backup publicado válido del periodo (ultimo=$($dueState.LatestPublished.ToString('s')), instante programado=$($dueState.ScheduledInstant.ToString('s'))).")
            return $ExitCodes.Success
        }
    }

    $prereq = Test-BackupPrerequisite -Config $Config
    if (-not $prereq.IsValid) {
        foreach ($e in $prereq.Errors) { Write-Error $e -ErrorAction Continue }
        return $ExitCodes.PrerequisiteError
    }

    $RunId = New-BackupRunId
    $timestamp = New-BackupTimestamp -Now $Now
    $LogPath = Join-Path $Config.LogDir ("backup_{0}_{1}_{2}.log.jsonl" -f $Config.Tier.ToUpperInvariant(), $timestamp, $RunId.Substring(0, 8))
    $stagingDir = Join-Path $Config.StagingRoot $RunId

    Write-BackupLogEntry -LogPath $LogPath -RunId $RunId -Tier $Config.Tier -Stage 'run' -Result 'start' -Message "DryRun=$($DryRun.IsPresent)"
    if ($initialDueError) {
        Write-BackupLogEntry -LogPath $LogPath -RunId $RunId -Tier $Config.Tier -Stage 'due_check' -Result 'warning' -Message "No se pudo determinar si ya existe el backup de este periodo; se continúa con el backup normal. Detalle: $initialDueError"
    }

    $exitCode = $ExitCodes.UnexpectedError
    $lockHandle = $null

    try {
        try {
            $lockHandle = Enter-BackupLock -LockFilePath $Config.LockFilePath -TimeoutSeconds $LockTimeoutSeconds
            Write-BackupLogEntry -LogPath $LogPath -RunId $RunId -Tier $Config.Tier -Stage 'lock' -Result 'success'
        }
        catch {
            Write-BackupLogEntry -LogPath $LogPath -RunId $RunId -Tier $Config.Tier -Stage 'lock' -Result 'failure' -Message $_.Exception.Message
            Write-Error $_.Exception.Message -ErrorAction Continue
            return $ExitCodes.LockHeld
        }

        if ($OnlyIfDue) {
            $dueState = Get-BackupDueStateSafe -Config $Config -Schedule $Schedule -Now $Now
            if ($dueState.Error) {
                Write-BackupLogEntry -LogPath $LogPath -RunId $RunId -Tier $Config.Tier -Stage 'due_check' -Result 'warning' -Message "No se pudo repetir la comprobación dentro del lock; se continúa con el backup normal. Detalle: $($dueState.Error)"
            }
            if (-not $dueState.Due) {
                Write-BackupLogEntry -LogPath $LogPath -RunId $RunId -Tier $Config.Tier -Stage 'due_check' -Result 'skipped' -Message 'Otra ejecución ya publicó el backup válido de este periodo; no se genera uno nuevo.'
                return $ExitCodes.Success
            }
        }

        # Con el lock en mano, cualquier staging de otra ejecuciÃ³n es huÃ©rfano (plaintext residual de un kill).
        $orphans = @(Remove-OrphanedStagingDirectory -StagingRoot $Config.StagingRoot -KeepPath $stagingDir)
        if ($orphans.Count -gt 0) {
            Write-BackupLogEntry -LogPath $LogPath -RunId $RunId -Tier $Config.Tier -Stage 'cleanup_orphan_staging' -Result 'info' -Message "$($orphans.Count) directorio(s) de staging huerfano(s) eliminado(s)"
        }
        try {
            New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null

            # --- 1. Dump principal ---
            $dumpFileName = New-BackupFileName -Kind Dump -Tier $Config.Tier -Database $Config.PgDatabase -Timestamp $timestamp
            $stagingDumpPath = Join-Path $stagingDir $dumpFileName

            $dumpResult = Measure-BackupStage -LogPath $LogPath -RunId $RunId -Tier $Config.Tier -Stage 'pg_dump' -ScriptBlock {
                Invoke-PgDump -Config $Config -OutputPath $stagingDumpPath
            }

            $dumpFileOk = (Test-Path -LiteralPath $stagingDumpPath -PathType Leaf) -and ((Get-Item -LiteralPath $stagingDumpPath).Length -gt 0)
            if (-not $dumpResult.Success -or -not $dumpFileOk) {
                throw [BackupStageError]::new("pg_dump falló o produjo un archivo vacío/inexistente (exit code $($dumpResult.ExitCode)).", $ExitCodes.PgDumpFailed)
            }

            # --- 2. Validación obligatoria (nunca "existe el archivo" == éxito) ---
            $restoreCheck = Measure-BackupStage -LogPath $LogPath -RunId $RunId -Tier $Config.Tier -Stage 'pg_restore_list' -ScriptBlock {
                Invoke-PgRestoreList -Config $Config -DumpPath $stagingDumpPath
            }
            if (-not $restoreCheck.IsValid) {
                throw [BackupStageError]::new("Validación con pg_restore -l falló o el dump está vacío (exit=$($restoreCheck.ExitCode), entradas=$($restoreCheck.EntryCount)).", $ExitCodes.ValidationFailed)
            }

            $plaintextFileNames = New-Object System.Collections.Generic.List[string]
            $plaintextFileNames.Add($dumpFileName)

            # --- 3. Schema-only (Daily y Monthly) ---
            if ($Config.SchemaOnlySnapshot) {
                $schemaFileName = New-BackupFileName -Kind SchemaOnly -Tier $Config.Tier -Database $Config.PgDatabase -Timestamp $timestamp
                $schemaOnlyStagingPath = Join-Path $stagingDir $schemaFileName

                $schemaResult = Measure-BackupStage -LogPath $LogPath -RunId $RunId -Tier $Config.Tier -Stage 'pg_dump_schema_only' -ScriptBlock {
                    Invoke-PgDump -Config $Config -OutputPath $schemaOnlyStagingPath -SchemaOnly
                }
                $schemaFileOk = (Test-Path -LiteralPath $schemaOnlyStagingPath -PathType Leaf) -and ((Get-Item -LiteralPath $schemaOnlyStagingPath).Length -gt 0)
                if (-not $schemaResult.Success -or -not $schemaFileOk) {
                    throw [BackupStageError]::new("pg_dump --schema-only falló o produjo un archivo vacío (exit code $($schemaResult.ExitCode)).", $ExitCodes.PgDumpFailed)
                }

                $schemaRestoreCheck = Measure-BackupStage -LogPath $LogPath -RunId $RunId -Tier $Config.Tier -Stage 'pg_restore_list_schema_only' -ScriptBlock {
                    Invoke-PgRestoreList -Config $Config -DumpPath $schemaOnlyStagingPath
                }
                if (-not $schemaRestoreCheck.IsValid) {
                    throw [BackupStageError]::new("Validación del schema-only con pg_restore -l falló (exit=$($schemaRestoreCheck.ExitCode)).", $ExitCodes.ValidationFailed)
                }

                $plaintextFileNames.Add($schemaFileName)
            }

            # --- 4. Globals (solo Monthly; nunca se publican fuera del artefacto cifrado) ---
            if ($Config.IncludeGlobals) {
                $globalsFileName = New-BackupFileName -Kind Globals -Tier $Config.Tier -Database $Config.PgDatabase -Timestamp $timestamp
                $globalsStagingPath = Join-Path $stagingDir $globalsFileName

                $globalsResult = Measure-BackupStage -LogPath $LogPath -RunId $RunId -Tier $Config.Tier -Stage 'pg_dumpall_globals' -ScriptBlock {
                    Invoke-PgDumpAllGlobals -Config $Config -OutputPath $globalsStagingPath
                }
                if (-not $globalsResult.Success) {
                    throw [BackupStageError]::new("pg_dumpall --globals-only falló (exit code $($globalsResult.ExitCode)).", $ExitCodes.PgDumpFailed)
                }
                if (-not (Test-GlobalsDumpContent -Path $globalsStagingPath)) {
                    throw [BackupStageError]::new("El dump de globals está vacío o no contiene sentencias reconocibles.", $ExitCodes.ValidationFailed)
                }

                $plaintextFileNames.Add($globalsFileName)
            }

            # --- 6. Empaquetado (solo si hay más de un artefacto plano) ---
            $bundleFileName = $null
            $toEncryptPath = $null
            if ($plaintextFileNames.Count -gt 1) {
                $bundleFileName = New-BackupFileName -Kind Bundle -Tier $Config.Tier -Database $Config.PgDatabase -Timestamp $timestamp
                $stagingBundlePath = Join-Path $stagingDir $bundleFileName

                $bundleResult = Measure-BackupStage -LogPath $LogPath -RunId $RunId -Tier $Config.Tier -Stage 'package_bundle' -ScriptBlock {
                    New-PlainBundle -SevenZipPath $Config.SevenZipPath -BundlePath $stagingBundlePath -WorkingDirectory $stagingDir -SourceFileNames $plaintextFileNames.ToArray() -TimeoutSeconds $SevenZipTimeoutSeconds
                }
                if (-not $bundleResult.Success -or -not (Test-Path -LiteralPath $stagingBundlePath -PathType Leaf)) {
                    throw [BackupStageError]::new("El empaquetado (7z sin cifrar) falló (exit code $($bundleResult.ExitCode)).", $ExitCodes.PackagingFailed)
                }
                $toEncryptPath = $stagingBundlePath
            }
            else {
                Write-BackupLogEntry -LogPath $LogPath -RunId $RunId -Tier $Config.Tier -Stage 'package_bundle' -Result 'skipped' -Message 'Un solo artefacto plano: se cifra directamente, sin empaquetar.'
                $toEncryptPath = Join-Path $stagingDir $plaintextFileNames[0]
            }

            # --- 7. Cifrado ASIMÉTRICO con age (solo clave pública) ---
            $archiveFileName = New-BackupFileName -Kind Archive -Tier $Config.Tier -Database $Config.PgDatabase -Timestamp $timestamp
            $stagingArchivePath = Join-Path $stagingDir $archiveFileName

            $encryptResult = Measure-BackupStage -LogPath $LogPath -RunId $RunId -Tier $Config.Tier -Stage 'encrypt_age' -ScriptBlock {
                New-AgeEncryptedArtifact -AgePath $Config.AgePath -RecipientsFilePath $Config.RecipientsFilePath -InputPath $toEncryptPath -OutputPath $stagingArchivePath -TimeoutSeconds $AgeTimeoutSeconds
            }
            if (-not $encryptResult.Success -or -not (Test-Path -LiteralPath $stagingArchivePath -PathType Leaf)) {
                throw [BackupStageError]::new("El cifrado con age falló (exit code $($encryptResult.ExitCode)).", $ExitCodes.EncryptionFailed)
            }

            # --- 8. Validación ESTRUCTURAL del artefacto cifrado ---
            $archiveCheck = Measure-BackupStage -LogPath $LogPath -RunId $RunId -Tier $Config.Tier -Stage 'validate_age_structure' -ScriptBlock {
                Test-AgeArtifactStructure -Path $stagingArchivePath
            }
            if (-not $archiveCheck.IsValid) {
                throw [BackupStageError]::new("La validación estructural del artefacto cifrado falló ($($archiveCheck.Reason)); no se publica.", $ExitCodes.EncryptionValidationFailed)
            }

            # --- 9. Limpiar plaintext (incl. el bundle intermedio) ---
            $toDelete = @(@($plaintextFileNames) + @($bundleFileName) | Where-Object { $_ })
            foreach ($plainName in $toDelete) {
                Remove-Item -LiteralPath (Join-Path $stagingDir $plainName) -Force -ErrorAction SilentlyContinue
            }
            Write-BackupLogEntry -LogPath $LogPath -RunId $RunId -Tier $Config.Tier -Stage 'cleanup_plaintext' -Result 'success' -Message "$($toDelete.Count) archivo(s) de texto plano/bundle eliminados de staging tras cifrar"

            # --- 10. SHA-256 sobre el artefacto cifrado ---
            try {
                Measure-BackupStage -LogPath $LogPath -RunId $RunId -Tier $Config.Tier -Stage 'hash' -ScriptBlock {
                    New-BackupFileHash -Path $stagingArchivePath
                } | Out-Null
            }
            catch {
                throw [BackupStageError]::new("Falló el cálculo de hash SHA-256 del artefacto cifrado: $($_.Exception.Message)", $ExitCodes.HashFailed)
            }

            # --- 11. Publicación (nunca en DryRun) ---
            $publishedPath = $null
            if (-not $DryRun) {
                try {
                    $publishedPath = Measure-BackupStage -LogPath $LogPath -RunId $RunId -Tier $Config.Tier -Stage 'publish_archive' -ScriptBlock {
                        Publish-BackupArtifact -StagingPath $stagingArchivePath -DestinationDir $Config.TierDir -BackupRoot $Config.BackupRoot -FileName $archiveFileName
                    }
                }
                catch {
                    throw [BackupStageError]::new("Falló la publicación al destino final: $($_.Exception.Message)", $ExitCodes.PublishFailed)
                }

                # --- 12. Hash del archivo YA publicado ---
                $postPublishOk = Measure-BackupStage -LogPath $LogPath -RunId $RunId -Tier $Config.Tier -Stage 'verify_published_hash' -ScriptBlock {
                    Test-BackupFileHash -Path $publishedPath
                }
                if (-not $postPublishOk) {
                    Remove-Item -LiteralPath $publishedPath -Force -ErrorAction SilentlyContinue
                    Remove-Item -LiteralPath "$publishedPath.sha256" -Force -ErrorAction SilentlyContinue
                    throw [BackupStageError]::new("El hash del archivo publicado no coincide con el sidecar tras la publicación; se revirtió la publicación.", $ExitCodes.PublishIntegrityCheckFailed)
                }
            }
            else {
                Write-BackupLogEntry -LogPath $LogPath -RunId $RunId -Tier $Config.Tier -Stage 'publish' -Result 'skipped' -Message 'DryRun: no se publica al destino final.'
            }

            # --- 13. Retención ---
            try {
                $cutoff = Get-RetentionCutoffDate -RetentionUnit $Config.RetentionUnit -RetentionValue $Config.RetentionValue -Now $Now
                $archivePattern = Get-BackupFileNamePattern -Kind Archive -Tier $Config.Tier -Database $Config.PgDatabase

                $retentionResult = Measure-BackupStage -LogPath $LogPath -RunId $RunId -Tier $Config.Tier -Stage 'retention_archive' -ScriptBlock {
                    Invoke-BackupRetention -BackupRoot $Config.BackupRoot -TargetDir $Config.TierDir -Pattern $archivePattern -CutoffDate $cutoff -DryRun:$DryRun
                }
                Write-BackupLogEntry -LogPath $LogPath -RunId $RunId -Tier $Config.Tier -Stage 'retention_archive' -Result 'info' -Message ("deleted={0} would_delete={1} kept={2}" -f $retentionResult.Deleted.Count, $retentionResult.WouldDelete.Count, $retentionResult.Kept.Count)
            }
            catch {
                throw [BackupStageError]::new("El backup se completó y publicó, pero la retención falló: $($_.Exception.Message)", $ExitCodes.RetentionFailed)
            }

            $exitCode = $ExitCodes.Success
            Write-BackupLogEntry -LogPath $LogPath -RunId $RunId -Tier $Config.Tier -Stage 'run' -Result 'success' -Message "DryRun=$($DryRun.IsPresent)"
        }
        catch [BackupStageError] {
            $exitCode = $_.Exception.ExitCode
            Write-BackupLogEntry -LogPath $LogPath -RunId $RunId -Tier $Config.Tier -Stage 'run' -Result 'failure' -Message $_.Exception.Message
            Write-Error $_.Exception.Message -ErrorAction Continue
        }
        catch {
            $exitCode = $ExitCodes.UnexpectedError
            Write-BackupLogEntry -LogPath $LogPath -RunId $RunId -Tier $Config.Tier -Stage 'run' -Result 'failure' -Message $_.Exception.Message
            Write-Error $_.Exception.Message -ErrorAction Continue
        }
        finally {
            # --- 14. Limpieza de staging SIEMPRE (solo el directorio de este RunId) ---
            if (Test-Path -LiteralPath $stagingDir) {
                Remove-Item -LiteralPath $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }
    finally {
        Exit-BackupLock -LockHandle $lockHandle
    }

    return $exitCode
}

function Invoke-DaubertBackupRun {
    <#
        Punto de entrada de alto nivel usado por el entrypoint canónico:
        resuelve la configuración (config.json + CLI) y ejecuta el pipeline.
        Devuelve el exit code.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][ValidateSet('Frequent', 'Daily', 'Monthly')][string]$Tier,
        [string]$ConfigPath,
        [hashtable]$CliParameters = @{},
        [switch]$DryRun,
        [int]$LockTimeoutSeconds = 0,
        [int]$SevenZipTimeoutSeconds = 300,
        [int]$AgeTimeoutSeconds = 300,
        [datetime]$Now = (Get-Date),
        [switch]$OnlyIfDue
    )

    $resolved = Resolve-BackupRunConfig -Tier $Tier -ConfigPath $ConfigPath -CliParameters $CliParameters
    if ($resolved.Errors.Count -gt 0) {
        foreach ($e in $resolved.Errors) { Write-Error $e -ErrorAction Continue }
        return $script:ExitCodes.PrerequisiteError
    }
    return (Invoke-DaubertBackup -Config $resolved.Config -DryRun:$DryRun -LockTimeoutSeconds $LockTimeoutSeconds -SevenZipTimeoutSeconds $SevenZipTimeoutSeconds -AgeTimeoutSeconds $AgeTimeoutSeconds -Now $Now -OnlyIfDue:$OnlyIfDue -Schedule $resolved.Schedule)
}

Export-ModuleMember -Function Resolve-BackupRunConfig, Get-BackupDueState, Get-BackupDueStateSafe, Invoke-DaubertBackup, Invoke-DaubertBackupRun, Remove-OrphanedStagingDirectory
