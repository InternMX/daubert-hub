#Requires -Version 5.1
<#
    Pruebas de BackupPackaging.psm1 (empaquetado SIN cifrar, paso 6 del
    pipeline). Usa el 7-Zip REAL instalado ('C:\Program Files\7-Zip\7z.exe')
    cuando está disponible: al no involucrar contraseña ni prompts, no
    tiene ninguna de las limitaciones encontradas con el mecanismo
    interactivo anterior. Se salta si 7-Zip real no está disponible.

    Ejecutar con: powershell -NoProfile -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\backup\tests\BackupPackaging.Tests.ps1"
#>

$moduleRoot = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $moduleRoot 'lib\BackupPackaging.psm1') -Force

$script:realSevenZipPath = 'C:\Program Files\7-Zip\7z.exe'
$script:realSevenZipAvailable = Test-Path -LiteralPath $script:realSevenZipPath -PathType Leaf

Describe 'BackupPackaging - New-PlainBundle (sin cifrar, sin contraseña)' {

    BeforeEach {
        $script:root = Join-Path ([System.IO.Path]::GetTempPath()) ("daubert-backup-packaging-test-" + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $script:root -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $script:root 'a.dump') -Value 'contenido de prueba A' -Encoding UTF8
        Set-Content -LiteralPath (Join-Path $script:root 'b.sql') -Value 'contenido de prueba B' -Encoding UTF8
        $script:bundlePath = Join-Path $script:root 'bundle.7z'
    }

    AfterEach {
        Remove-Item -LiteralPath $script:root -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'crea un bundle .7z con varios archivos, SIN pedir ni usar ninguna contraseña' -Skip:(-not $script:realSevenZipAvailable) {
        $result = New-PlainBundle -SevenZipPath $script:realSevenZipPath -BundlePath $script:bundlePath -WorkingDirectory $script:root -SourceFileNames @('a.dump', 'b.sql') -TimeoutSeconds 30
        $result.Success | Should Be $true
        Test-Path -LiteralPath $script:bundlePath | Should Be $true
    }

    It 'el bundle puede listarse SIN contraseña (no está cifrado)' -Skip:(-not $script:realSevenZipAvailable) {
        New-PlainBundle -SevenZipPath $script:realSevenZipPath -BundlePath $script:bundlePath -WorkingDirectory $script:root -SourceFileNames @('a.dump', 'b.sql') -TimeoutSeconds 30 | Out-Null

        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $script:realSevenZipPath
        $psi.Arguments = "l `"$script:bundlePath`""
        $psi.RedirectStandardOutput = $true
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true
        $proc = New-Object System.Diagnostics.Process
        $proc.StartInfo = $psi
        [void]$proc.Start()
        $stdout = $proc.StandardOutput.ReadToEnd()
        $proc.WaitForExit(10000) | Out-Null

        $proc.ExitCode | Should Be 0
        $stdout | Should Match 'a\.dump'
        $stdout | Should Match 'b\.sql'
    }

    It 'reporta fallo si se referencia un archivo fuente inexistente' -Skip:(-not $script:realSevenZipAvailable) {
        $result = New-PlainBundle -SevenZipPath $script:realSevenZipPath -BundlePath $script:bundlePath -WorkingDirectory $script:root -SourceFileNames @('no-existe.dump') -TimeoutSeconds 30
        $result.Success | Should Be $false
    }

    It 'lanza si 7z.exe no existe en la ruta indicada' {
        { New-PlainBundle -SevenZipPath (Join-Path $script:root 'no-existe-7z.exe') -BundlePath $script:bundlePath -WorkingDirectory $script:root -SourceFileNames @('a.dump') -TimeoutSeconds 10 } | Should Throw
    }
}

Describe 'BackupPackaging - New-PlainBundle con Invoke-SevenZipProcess mockeado (sin 7z real ni falso)' {

    BeforeEach {
        $global:SzSim = @{ ExitCode = 0; StdErr = ''; Captured = $null }
        Mock Invoke-SevenZipProcess {
            $global:SzSim.Captured = @{ Path = $SevenZipPath; Args = $ArgumentList; Cwd = $WorkingDirectory; Timeout = $TimeoutSeconds }
            [pscustomobject]@{ ExitCode = $global:SzSim.ExitCode; StdOut = ''; StdErr = $global:SzSim.StdErr }
        } -ModuleName BackupPackaging
    }

    It 'arma "a -t7z -mx=N -y <bundle> <archivos>" y la carpeta de trabajo' {
        $r = New-PlainBundle -SevenZipPath 'ruta-simulada' -BundlePath 'C:	mp.7z' -WorkingDirectory 'C:	mp' -SourceFileNames @('a.dump', 'b.sql') -CompressionLevel 3 -TimeoutSeconds 42
        $r.Success | Should Be $true
        $global:SzSim.Captured.Args | Should Be @('a', '-t7z', '-mx=3', '-y', 'C:	mp.7z', 'a.dump', 'b.sql')
        $global:SzSim.Captured.Cwd | Should Be 'C:	mp'
        $global:SzSim.Captured.Timeout | Should Be 42
    }

    It 'nunca usa contraseña (-p) ni cifrado de cabeceras (-mhe)' {
        New-PlainBundle -SevenZipPath 'ruta-simulada' -BundlePath 'b.7z' -WorkingDirectory '.' -SourceFileNames @('a.dump') | Out-Null
        ($global:SzSim.Captured.Args -join ' ') | Should Not Match '(^|\s)-p'
        ($global:SzSim.Captured.Args -join ' ') | Should Not Match '-mhe'
    }

    It 'reporta fallo y stderr cuando 7z termina con código distinto de 0' {
        $global:SzSim.ExitCode = 2; $global:SzSim.StdErr = 'Cannot find file'
        $r = New-PlainBundle -SevenZipPath 'ruta-simulada' -BundlePath 'b.7z' -WorkingDirectory '.' -SourceFileNames @('x')
        $r.Success | Should Be $false
        $r.ExitCode | Should Be 2
        $r.StdErrTail | Should Match 'Cannot find'
    }
}

Describe 'BackupPackaging - Invoke-SevenZipProcess (seam real, probado con binarios del sistema; sin ejecutables falsos)' {

    BeforeAll { $script:cmd = $env:ComSpec; $script:ping = Join-Path $env:SystemRoot 'System32\PING.EXE' }

    It 'devuelve exit code, stdout y stderr' {
        $r = Invoke-SevenZipProcess -SevenZipPath $script:cmd -ArgumentList @('/c', 'echo listo& echo aviso 1>&2& exit 2')
        $r.ExitCode | Should Be 2
        $r.StdOut | Should Match 'listo'
        $r.StdErr | Should Match 'aviso'
    }

    It 'ejecuta en la carpeta de trabajo indicada' {
        $dir = Join-Path ([System.IO.Path]::GetTempPath()) ('daubert-sz-cwd-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        try {
            $r = Invoke-SevenZipProcess -SevenZipPath $script:cmd -ArgumentList @('/c', 'cd') -WorkingDirectory $dir
            $r.StdOut.Trim() | Should Be $dir
        }
        finally { Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue }
    }

    It 'termina el proceso y lanza si excede el timeout' {
        { Invoke-SevenZipProcess -SevenZipPath $script:ping -ArgumentList @('-n', '30', '127.0.0.1') -TimeoutSeconds 1 } | Should Throw
    }

    It 'lanza si el ejecutable no existe' {
        { Invoke-SevenZipProcess -SevenZipPath (Join-Path ([System.IO.Path]::GetTempPath()) 'no-existe-empaquetador.bin') -ArgumentList @('a') } | Should Throw
    }
}
