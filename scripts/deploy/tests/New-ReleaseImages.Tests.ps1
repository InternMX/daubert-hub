# Pester 3.4 tests for scripts\deploy\New-ReleaseImages.ps1 (release artefacts are never overwritten).
# Run with:  Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\deploy\tests
# No Docker or git process is started: docker is shadowed by a test function and the seams are mocked.

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here '..\New-ReleaseImages.ps1')

$script:FullSha = '0123456789abcdef0123456789abcdef01234567'

function Set-RepoGitMock {
    Mock Enter-ReleaseBuildLock { 'lock-de-prueba' }
    Mock Exit-ReleaseBuildLock { }
    Mock Invoke-RepoGit { return '0123456789abcdef0123456789abcdef01234567' } -ParameterFilter { $A[0] -eq 'rev-parse' }
    Mock Invoke-RepoGit { return '{ "name": "daubert-hub", "version": "1.3.0" }' } -ParameterFilter { $A[0] -eq 'show' }
}

Describe 'Get-ReleaseConflicts: nada se sobrescribe' {
    Context 'sin etiquetas, manifiesto ni tar previos no hay conflictos' {
        It 'sin etiquetas, manifiesto ni tar previos no hay conflictos' {
            Mock Get-ReleaseTagState { 'absent' }
            Mock Test-ReleasePath { $false }
            @(Get-ReleaseConflicts 'daubert-hub' '0123456' 'C:\fuera\imagenes.json' 'C:\fuera\tars').Count | Should Be 0
        }
    }
    Context 'la etiqueta api existente es un conflicto' {
        It 'la etiqueta api existente es un conflicto' {
            Mock Get-ReleaseTagState { 'present' } -ParameterFilter { $Tag -eq 'daubert-hub-api:release-0123456' }
            Mock Get-ReleaseTagState { 'absent' } -ParameterFilter { $Tag -eq 'daubert-hub-web:release-0123456' }
            Mock Test-ReleasePath { $false }
            $c = @(Get-ReleaseConflicts 'daubert-hub' '0123456' '' '')
            $c.Count | Should Be 1
            $c[0] | Should Match 'daubert-hub-api:release-0123456 ya existe'
        }
    }
    Context 'la etiqueta web existente es un conflicto (el caso de -ManufacturingUi sobre el mismo commit)' {
        It 'la etiqueta web existente es un conflicto (el caso de -ManufacturingUi sobre el mismo commit)' {
            Mock Get-ReleaseTagState { 'absent' } -ParameterFilter { $Tag -eq 'daubert-hub-api:release-0123456' }
            Mock Get-ReleaseTagState { 'present' } -ParameterFilter { $Tag -eq 'daubert-hub-web:release-0123456' }
            Mock Test-ReleasePath { $false }
            $c = @(Get-ReleaseConflicts 'daubert-hub' '0123456' '' '')
            $c.Count | Should Be 1
            $c[0] | Should Match 'daubert-hub-web:release-0123456 ya existe'
        }
    }
    Context 'ambas etiquetas existentes son dos conflictos' {
        It 'ambas etiquetas existentes son dos conflictos' {
            Mock Get-ReleaseTagState { 'present' }
            Mock Test-ReleasePath { $false }
            @(Get-ReleaseConflicts 'daubert-hub' '0123456' '' '').Count | Should Be 2
        }
    }
    Context 'un estado indeterminado de Docker es un conflicto (falla cerrado)' {
        It 'un estado indeterminado de Docker es un conflicto (falla cerrado)' {
            Mock Get-ReleaseTagState { 'unknown' }
            Mock Test-ReleasePath { $false }
            $c = @(Get-ReleaseConflicts 'daubert-hub' '0123456' '' '')
            $c.Count | Should Be 2
            $c[0] | Should Match 'no se pudo comprobar'
        }
    }
    Context 'un manifiesto existente es un conflicto' {
        It 'un manifiesto existente es un conflicto' {
            Mock Get-ReleaseTagState { 'absent' }
            Mock Test-ReleasePath { $true } -ParameterFilter { $Path -eq 'C:\fuera\imagenes.json' }
            Mock Test-ReleasePath { $false }
            $c = @(Get-ReleaseConflicts 'daubert-hub' '0123456' 'C:\fuera\imagenes.json' '')
            $c.Count | Should Be 1
            $c[0] | Should Match 'manifiesto'
        }
    }
    Context 'un tar existente en -SaveDir es un conflicto' {
        It 'un tar existente en -SaveDir es un conflicto' {
            Mock Get-ReleaseTagState { 'absent' }
            Mock Test-ReleasePath { $true } -ParameterFilter { $Path -like '*daubert-hub-web-release-0123456.tar' }
            Mock Test-ReleasePath { $false }
            $c = @(Get-ReleaseConflicts 'daubert-hub' '0123456' '' 'C:\fuera\tars')
            $c.Count | Should Be 1
            $c[0] | Should Match 'daubert-hub-web-release-0123456.tar ya existe'
        }
    }
    Context 'respeta el prefijo de ensayo' {
        It 'respeta el prefijo de ensayo' {
            Mock Get-ReleaseTagState { 'absent' }
            Mock Test-ReleasePath { $false }
            $null = Get-ReleaseConflicts 'daubert-hub-rbtest' '0123456' '' ''
            Assert-MockCalled Get-ReleaseTagState -Times 1 -Exactly -ParameterFilter { $Tag -eq 'daubert-hub-rbtest-api:release-0123456' }
            Assert-MockCalled Get-ReleaseTagState -Times 1 -Exactly -ParameterFilter { $Tag -eq 'daubert-hub-rbtest-web:release-0123456' }
        }
    }
}

Describe 'Get-ReleaseTagState: solo "No such image" significa ausente' {
    Context 'exit 0 => present' {
        It 'exit 0 => present' {
            function docker { $global:LASTEXITCODE = 0; 'sha256:abc' }
            Get-ReleaseTagState 'daubert-hub-api:release-0123456' | Should Be 'present'
        }
    }
    Context 'No such image => absent' {
        It 'No such image => absent' {
            function docker { $global:LASTEXITCODE = 1; 'Error response from daemon: No such image: daubert-hub-api:release-0123456' }
            Get-ReleaseTagState 'daubert-hub-api:release-0123456' | Should Be 'absent'
        }
    }
    Context 'Docker no accesible => unknown' {
        It 'Docker no accesible => unknown' {
            function docker { $global:LASTEXITCODE = 1; 'error during connect: Get "http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/v1.47/images/json": open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.' }
            Get-ReleaseTagState 'daubert-hub-api:release-0123456' | Should Be 'unknown'
        }
    }
    Context 'cualquier otro error => unknown' {
        It 'cualquier otro error => unknown' {
            function docker { $global:LASTEXITCODE = 125; 'unexpected failure' }
            Get-ReleaseTagState 'daubert-hub-api:release-0123456' | Should Be 'unknown'
        }
    }
}

Describe 'Invoke-ReleaseImagesMain: se niega antes de construir' {
    Context '-Build con una etiqueta existente devuelve 1 y no construye nada' {
        It '-Build con una etiqueta existente devuelve 1 y no construye nada' {
            Set-RepoGitMock
            Mock Get-ReleaseConflicts { @('la etiqueta daubert-hub-web:release-0123456 ya existe: no se sobrescribe una imagen de release') }
            Mock Invoke-ReleaseBuild { }
            Mock Write-Host { }
            $code = Invoke-ReleaseImagesMain @{ Commit = 'HEAD'; Build = $true; Manifest = 'C:\fuera-del-repo\imagenes.json'; ImagePrefix = 'daubert-hub'; SaveDir = ''; ManufacturingUi = $true; Repo = 'C:\repo' }
            $code | Should Be 1
            Assert-MockCalled Invoke-ReleaseBuild -Times 0 -Exactly
            Assert-MockCalled Write-Host -ParameterFilter { [string]$Object -like 'NO SE CONSTRUYE NADA*' } -Times 1
        }
    }
    Context 'el modo plan informa BLOQUEARIA, devuelve 0 y no construye' {
        It 'el modo plan informa BLOQUEARIA, devuelve 0 y no construye' {
            Set-RepoGitMock
            Mock Get-ReleaseConflicts { @('el manifiesto C:\fuera-del-repo\imagenes.json ya existe: no se sobrescribe') }
            Mock Invoke-ReleaseBuild { }
            Mock Write-Host { }
            $code = Invoke-ReleaseImagesMain @{ Commit = 'HEAD'; Build = $false; Manifest = 'C:\fuera-del-repo\imagenes.json'; ImagePrefix = 'daubert-hub'; SaveDir = ''; ManufacturingUi = $false; Repo = 'C:\repo' }
            $code | Should Be 0
            Assert-MockCalled Invoke-ReleaseBuild -Times 0 -Exactly
            Assert-MockCalled Write-Host -ParameterFilter { [string]$Object -like 'BLOQUEARIA: el manifiesto*' } -Times 1
        }
    }
    Context '-Build sin conflictos construye una sola vez con el commit, la version y la UI pedidos' {
        It '-Build sin conflictos construye una sola vez con el commit, la version y la UI pedidos' {
            Set-RepoGitMock
            Mock Get-ReleaseConflicts { @() }
            Mock Invoke-ReleaseBuild { }
            Mock Write-Host { }
            $code = Invoke-ReleaseImagesMain @{ Commit = 'HEAD'; Build = $true; Manifest = 'C:\fuera-del-repo\imagenes.json'; ImagePrefix = 'daubert-hub'; SaveDir = 'C:\fuera-del-repo\tars'; ManufacturingUi = $true; Repo = 'C:\repo' }
            $code | Should Be 0
            Assert-MockCalled Invoke-ReleaseBuild -Times 1 -Exactly -ParameterFilter { $Full -eq $script:FullSha -and $Short -eq '0123456' -and $Version -eq '1.3.0' -and $Ui -eq $true -and $SaveDirPath -eq 'C:\fuera-del-repo\tars' }
        }
    }
    Context '-Build sin -Manifest devuelve 1 sin consultar conflictos ni construir' {
        It '-Build sin -Manifest devuelve 1 sin consultar conflictos ni construir' {
            Set-RepoGitMock
            Mock Get-ReleaseConflicts { @() }
            Mock Invoke-ReleaseBuild { }
            Mock Write-Host { }
            Invoke-ReleaseImagesMain @{ Commit = 'HEAD'; Build = $true; Manifest = ''; ImagePrefix = 'daubert-hub'; SaveDir = ''; ManufacturingUi = $false; Repo = 'C:\repo' } | Should Be 1
            Assert-MockCalled Invoke-ReleaseBuild -Times 0 -Exactly
            Assert-MockCalled Get-ReleaseConflicts -Times 0 -Exactly
        }
    }
    Context '-Build con el manifiesto dentro del repositorio devuelve 1' {
        It '-Build con el manifiesto dentro del repositorio devuelve 1' {
            Set-RepoGitMock
            Mock Get-ReleaseConflicts { @() }
            Mock Invoke-ReleaseBuild { }
            Mock Write-Host { }
            Invoke-ReleaseImagesMain @{ Commit = 'HEAD'; Build = $true; Manifest = 'C:\repo\out\imagenes.json'; ImagePrefix = 'daubert-hub'; SaveDir = ''; ManufacturingUi = $false; Repo = 'C:\repo' } | Should Be 1
            Assert-MockCalled Invoke-ReleaseBuild -Times 0 -Exactly
        }
    }
    Context 'un repositorio hermano con el mismo prefijo de nombre no cuenta como dentro del repositorio' {
        It 'un repositorio hermano con el mismo prefijo de nombre no cuenta como dentro del repositorio' {
            Set-RepoGitMock
            Mock Get-ReleaseConflicts { @() }
            Mock Invoke-ReleaseBuild { }
            Mock Write-Host { }
            Invoke-ReleaseImagesMain @{ Commit = 'HEAD'; Build = $true; Manifest = 'C:\repo-evidencia\imagenes.json'; ImagePrefix = 'daubert-hub'; SaveDir = ''; ManufacturingUi = $false; Repo = 'C:\repo' } | Should Be 0
            Assert-MockCalled Invoke-ReleaseBuild -Times 1 -Exactly
        }
    }
    Context 'sin -Commit devuelve 1 sin tocar git' {
        It 'sin -Commit devuelve 1 sin tocar git' {
            Mock Invoke-RepoGit { }
            Mock Write-Host { }
            Invoke-ReleaseImagesMain @{ Commit = ''; Build = $false; Manifest = ''; ImagePrefix = 'daubert-hub'; SaveDir = ''; ManufacturingUi = $false; Repo = 'C:\repo' } | Should Be 1
            Assert-MockCalled Invoke-RepoGit -Times 0 -Exactly
        }
    }
}

Describe 'Invoke-ReleaseImagesMain: bloqueo de compilacion (hallazgo 7)' {
    Context 'bloqueo ocupado' {
        It 'no consulta conflictos ni construye' {
            Set-RepoGitMock
            Mock Enter-ReleaseBuildLock { throw 'DAUBERT_LOCK_OCUPADO: otra compilacion' }
            Mock Get-ReleaseConflicts { @() }; Mock Invoke-ReleaseBuild { }; Mock Write-Host { }
            Invoke-ReleaseImagesMain @{ Commit = 'HEAD'; Build = $true; Manifest = 'C:\fuera-del-repo\imagenes.json'; ImagePrefix = 'daubert-hub'; SaveDir = ''; ManufacturingUi = $true; Repo = 'C:\repo' } | Should Be 1
            Assert-MockCalled Invoke-ReleaseBuild -Times 0 -Exactly
            Assert-MockCalled Get-ReleaseConflicts -Times 0 -Exactly
        }
    }
    Context 'el bloqueo se libera tambien si la compilacion falla' {
        It 'llama a Exit-ReleaseBuildLock' {
            Set-RepoGitMock
            Mock Get-ReleaseConflicts { @() }; Mock Invoke-ReleaseBuild { throw 'docker build failed for api' }; Mock Write-Host { }
            { Invoke-ReleaseImagesMain @{ Commit = 'HEAD'; Build = $true; Manifest = 'C:\fuera-del-repo\imagenes.json'; ImagePrefix = 'daubert-hub'; SaveDir = ''; ManufacturingUi = $true; Repo = 'C:\repo' } } | Should Throw 'docker build failed'
            Assert-MockCalled Exit-ReleaseBuildLock -Times 1 -Exactly
        }
    }
}