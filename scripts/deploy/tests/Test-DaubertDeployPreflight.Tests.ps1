# Pester 3.4 tests for the Config section of scripts\deploy\Test-DaubertDeployPreflight.ps1
#
# Run with:  Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\deploy\tests
#
# The preflight is a standalone read-only script (no seams to mock), so these tests run it as a
# subprocess against a throw-away env file made of FAKE values and inspect the Config row only.
# It makes no deployment, no `docker compose up/down` and no call to n8n (it only reads local
# state, as in a normal -Preflight run). The temp env file is removed afterwards.

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:PreflightPath = [System.IO.Path]::GetFullPath((Join-Path $here '..\Test-DaubertDeployPreflight.ps1'))
$script:RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $here '..\..\..'))
$script:ConfigRow = 'variables de compose.prod-temp.yaml'
$script:FakeToken = 'FAKE-n8n-health-token-9f3a1c'

function Invoke-PreflightWithEnv {
    param([string[]]$Lines)
    $rel = 'deploy\pilot.pester-' + [guid]::NewGuid().ToString('N') + '.env'
    $full = Join-Path $script:RepoRoot $rel
    try {
        Set-Content -LiteralPath $full -Value $Lines -Encoding ASCII
        $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $script:PreflightPath -EnvFile $rel 2>&1 | Out-String -Width 400
        return $out
    }
    finally {
        Remove-Item -LiteralPath $full -Force -ErrorAction SilentlyContinue
    }
}

$base = @(
    'HUB_PORT=8082', 'DB_HOST=host.docker.internal', 'DB_PORT=5432', 'DB_NAME=daubert_global', 'DB_USER=daubert_hub_app',
    'DB_PASSWORD=FAKE-db-password', 'API_PORT=3000',
    'CATERPILLAR_REPROCESS_WEBHOOK_URL=http://fake/cat', 'CATERPILLAR_REPROCESS_WEBHOOK_TOKEN=FAKE-cat-token',
    'AUTH_COOKIE_SECURE=false',
    'PAYMENT_NOTIFICATIONS_REPROCESS_WEBHOOK_URL=http://fake/pay', 'PAYMENT_NOTIFICATIONS_WEBHOOK_TOKEN=FAKE-pay-token'
)
$n8nHealth = @('N8N_HEALTH_WEBHOOK_URL=http://fake:5678/webhook/daubert-hub/health', ('N8N_HEALTH_WEBHOOK_TOKEN=' + $script:FakeToken))

$script:WithN8n = Invoke-PreflightWithEnv ($base + $n8nHealth)
$script:WithoutN8n = Invoke-PreflightWithEnv $base

Describe 'Preflight: variables de health de n8n (recomendadas)' {
    It 'PASS cuando N8N_HEALTH_WEBHOOK_URL y N8N_HEALTH_WEBHOOK_TOKEN tienen valor' {
        $script:WithN8n | Should Match ('(?m)Config\s+' + [regex]::Escape($script:ConfigRow) + '\s+PASS')
    }

    It 'WARN (no FAIL) y nombra ambas variables cuando faltan' {
        $script:WithoutN8n | Should Match ('(?m)Config\s+' + [regex]::Escape($script:ConfigRow) + '\s+WARN')
        $script:WithoutN8n | Should Match 'N8N_HEALTH_WEBHOOK_URL'
        $script:WithoutN8n | Should Match 'N8N_HEALTH_WEBHOOK_TOKEN'
        $script:WithoutN8n | Should Not Match ('(?m)Config\s+' + [regex]::Escape($script:ConfigRow) + '\s+FAIL')
        $script:WithoutN8n | Should Not Match 'variables obligatorias con valor\s+FAIL'
    }

    It 'nunca imprime el valor del token' {
        $script:WithN8n | Should Not Match ([regex]::Escape($script:FakeToken))
        $script:WithoutN8n | Should Not Match ([regex]::Escape($script:FakeToken))
    }
}
