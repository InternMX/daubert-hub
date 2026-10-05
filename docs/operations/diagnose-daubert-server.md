# Diagnose-DaubertServer

Diagnóstico formal, **de solo lectura**, del PC que actúa (o actuará) como **Daubert Hub Server**. Complementa el deployment (`scripts/deploy/`), pero su objetivo es el **host**, no una release.

> Este script **todavía no configura nada**. No existen `-Configure`, `-Repair` ni `-Uninstall`; pasarlos es un error de uso (exit 3). Configurar el servidor será un paso posterior y separado.

## Propósito

Responder, con evidencia y sin tocar el equipo: ¿este PC está preparado para ser el servidor del Hub? Reúne los datos que después necesitará el instalador (MAC, IP actual, gateway, DHCP) y marca lo que falta respecto al **estado objetivo** (sección final del informe).

## Comandos

```powershell
# Tabla legible + resumen + conclusión + estado objetivo
.\scripts\server\Diagnose-DaubertServer.ps1

# Un único documento JSON (sin tabla), para el futuro instalador
.\scripts\server\Diagnose-DaubertServer.ps1 -Json

# Otro repositorio / comprobar si un nombre ya resuelve
.\scripts\server\Diagnose-DaubertServer.ps1 -RepoPath D:\daubert-hub -DaubertHubHostname hub.dauberthub.app
```

Se recomienda ejecutarlo también **elevado (administrador)**: sin elevación no se puede leer BitLocker y puede no leerse `pg_hba.conf`; esas filas salen como `INFO` (nunca como `PASS`).

Pruebas: `Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\server\tests`.

## Qué comprueba

| Área | Comprobaciones |
| --- | --- |
| Host | Windows (edición/build), arquitectura, RAM, CPU, espacio libre, hostname, usuario, elevación, dominio/workgroup, firmware, BitLocker, Windows Update, reinicio pendiente |
| Network | Ethernet/Wi-Fi (disponible/conectado), ruta por defecto, IPv4/IPv6, gateway, DNS, DHCP, MAC, perfil de red |
| Firewall | Perfiles habilitados; regla específica **TCP 8082 con `RemoteAddress=LocalSubnet`** (y que cubra el perfil activo); puertos **3000, 5432, 5678** prohibidos en la LAN; **listener separado de regla**; reglas por programa (p. ej. `node.exe` en cualquier puerto) |
| Docker | Instalado, versión, daemon, backend WSL2, proyectos Compose, contenedores PROD (api `healthy`, web), puertos publicados, redes |
| PostgreSQL | Servicio, versión, listener 5432, `listen_addresses`/`port` (leídos de `postgresql.conf`, sin SQL), `pg_hba.conf` (reglas, `trust`, includes) |
| n8n | Proceso, versión, listener 5678, carpeta/config/SQLite, servicio o supervisor, dependencia de sesión interactiva, número de referencias a la ruta del perfil de usuario (solo el conteo) |
| Dropbox | Instalado, proceso, ruta, carpeta de backups |
| Energy | Plan, suspensión e hibernación con corriente (recomendado: nunca), pantalla |
| Startup | Docker Desktop, `restart` de los contenedores PROD, servicio PostgreSQL, n8n, Dropbox, Programador de tareas y tareas `Daubert - …` |
| Hub | Rama, working tree, HEAD, origin, compose PROD/TEST, versión, `scripts/deploy`, `/api/health` |
| TEST/PROD | `COMPOSE_PROJECT_NAME`, nombre del proyecto, puertos/BD/usuario distintos (solo claves no secretas de los env), redes |
| Secrets | Existencia, ACL, ubicación y estado Git (tracked / ignorado) de los archivos sensibles; número de copias de env |
| Backups | Directorio raíz, tiers FREQUENT/DAILY/MONTHLY/N8N y antigüedad del último backup |
| DNS | Hostname, servidores DNS, IP; con `-DaubertHubHostname`, si el nombre resuelve |

Arquitectura reconocida como **válida** (no es error): `API Docker → host.docker.internal → proxy de Docker Desktop → 127.0.0.1 → PostgreSQL`. El diagnóstico no pide reglas para `172.20.0.0/16` ni `192.168.65.0/24`.

## Qué NO modifica

Nada. Cada comando nativo pasa por una única función (`Invoke-DiagRead`) con lista blanca de lecturas (`docker ps/inspect/info/version/network ls|inspect`, `git rev-parse/status/branch/remote get-url/ls-files/check-ignore`, `powercfg /query`, `schtasks /query`, `manage-bde -status`) y rechaza el resto **antes** de ejecutarlo. No escribe archivos, no cambia firewall, servicios, tareas, energía, DNS/IP, PostgreSQL, Docker, WSL, n8n, Dropbox, usuarios ni ACL, y no ejecuta `compose up/down/restart/build/pull`. Una prueba automática verifica que el código no contiene cmdlets que cambien estado.

No imprime secretos: de los env solo se leen `HUB_PORT`, `DB_HOST`, `DB_PORT`, `DB_NAME` y `DB_USER`; de los archivos sensibles solo existencia/ACL/Git; y toda salida pasa por un filtro que oculta contraseñas, tokens y credenciales en URLs.

## Interpretación

| Estado | Significado |
| --- | --- |
| `PASS` | Cumple lo esperado |
| `WARN` | Funciona pero se aparta de la recomendación o no se pudo asegurar; requiere revisión |
| `FAIL` | Falta algo requerido o hay un riesgo claro |
| `INFO` | Dato informativo (IP, MAC, versión…) o no comprobable con esta sesión |

Conclusión y exit code (un diagnóstico exitoso **no** significa servidor preparado):

| Conclusión | Exit |
| --- | --- |
| `SERVIDOR PREPARADO` | 0 |
| `SERVIDOR NO PREPARADO` (algún `FAIL`) | 1 |
| `SERVIDOR PREPARADO CON ADVERTENCIAS` (`WARN` sin `FAIL`) | 2 |
| Error de uso (argumento no soportado, `-RepoPath` inexistente, nombre inválido) | 3 |

Las filas que dependen de algo externo se marcan como tales: por ejemplo, la **DHCP reservation** vive en el router y se reporta como "reserva NO COMPROBABLE"; que un puerto sea alcanzable desde otra máquina no se prueba desde el propio servidor (solo se compara listener y reglas).

## Uso del JSON

`-Json` imprime un único documento (UTF-8) con `schemaVersion`, `generatedAt`, `hostname`, `readOnly`, `summary`, `conclusion`, `exitCode`, `network`, `checks[]` y `target[]`:

```powershell
$d = .\scripts\server\Diagnose-DaubertServer.ps1 -Json | ConvertFrom-Json
$d.network      # Adapter, Mac, IPv4, Gateway, Dhcp, Dns, Profile  -> datos para la reserva DHCP del router
$d.checks | Where-Object status -eq 'FAIL'
```

`network` es `null` si no hay un adaptador conectado con IPv4 válida. El exit code del proceso coincide con `exitCode`.

## Estado objetivo (informativo)

Al final del informe se lista el estado objetivo del Daubert Hub Server (Ethernet, DHCP reservation, TCP 8082 en LAN, 3000/5432/5678 prohibidos en LAN, Docker, PostgreSQL y n8n en el host, sin suspensión, arranque automático, BitLocker, Cloudflare/Tailscale futuros) con el estado actual de cada punto. **No se aplica nada.**
