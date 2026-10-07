# Diagnose-DaubertServer

Diagnóstico formal, **de solo lectura**, del PC que actúa (o actuará) como **Daubert Hub Server**. Complementa el deployment (`scripts/deploy/`), pero su objetivo es el **host**, no una release.

> Este script **no configura nada**: es solo de lectura. No existen `-Configure`, `-Repair` ni `-Uninstall`; pasarlos es un error de uso (exit 3). La configuración del servidor es un paso separado, con su propio script: [configure-daubert-server.md](configure-daubert-server.md).

## Validación actual

La configuración del servidor (firewall 8082, bloqueo LAN de 5678, ACL de secretos) y el supervisor de n8n (tarea `Daubert - n8n Supervisor`) ya fueron implementados y validados en el servidor. Este diagnóstico sirve para **re-verificar** el estado del host en cualquier momento. Los ejemplos de hallazgos `FAIL` de n8n/arranque descritos abajo corresponden a un host que aún no tiene el supervisor. Lo que no puede comprobarse desde el propio servidor (acceso desde otro equipo de la LAN) sigue siendo una verificación externa.

## Red objetivo de V1: Wi-Fi

Para V1, este PC es provisionalmente el host del Hub y funciona **solo por Wi-Fi** (router de la LAN). Por tanto:

- **Wi-Fi es válido**: se exige que el adaptador esté activo y conectado, con IPv4 válida, gateway y DHCP.
- **Ethernet es solo una recomendación de disponibilidad**: aparece como `INFO` y nunca como `WARN` ni `FAIL`.
- **Conectividad local** al gateway sin depender de ICMP: se usa un intento TCP a 80/443 del router (una respuesta o un rechazo prueban que está alcanzable) y la tabla de vecinos ARP. Un `ping` sin respuesta no es evidencia de fallo; el Firewall de Windows bloquea el eco entrante por defecto, igual que bloquea TCP 8082/5432/5678 mientras no exista una regla.
- **Ahorro de energía del Wi-Fi**: se lee si Windows puede apagar el adaptador (`Permitir que el equipo apague este dispositivo`, requiere sesión elevada; si no se puede leer sale `INFO`) y el modo de ahorro del adaptador inalámbrico del plan de energía activo.
- **Perfil de red**: se mantiene **Public** (decisión de V1); es `INFO`, no advertencia. La regla del Hub debe cubrir Public (`Profile Any`).
- **Arranque desatendido**: sin auto-logon, tras un reinicio solo arranca lo que es servicio (PostgreSQL); Docker Desktop, la tarea del supervisor de n8n y Dropbox dependen del logon de un usuario. Se reporta como `WARN` (decisión de inicio de sesión de Windows pendiente; no se habilita AutoAdminLogon y no se lee ninguna credencial).
- **DNS interno**: fuera de V1.
- **Reserva DHCP**: se reporta siempre como `INFO` **PENDIENTE**. Requiere administrar el router y todavía no hay autorización; el diagnóstico solo informa la MAC y la IP actuales (la MAC del adaptador y `<SERVER_IP>`). Hasta que exista, la IP puede cambiar.

La corrección de lo que el diagnóstico encuentra está en [configure-daubert-server.md](configure-daubert-server.md) (`-WhatIf` para planear, `-Apply` por fases para aplicar).

Siguen siendo **bloqueantes (`FAIL`)** la ausencia de regla de entrada LAN para TCP 8082 y la ausencia de arranque automático/supervisor de n8n. Para n8n, en V1 (una persona enciende el equipo e inicia sesión en horario de oficina) cuenta como `PASS` un servicio automático, o una tarea programada habilitada con disparador *Al iniciar sesión* para el usuario con que se ejecuta (`Daubert - n8n Supervisor`); no se exige AutoAdminLogon ni un servicio de Windows. Que el arranque no sea totalmente desatendido hasta que alguien inicie sesión se informa aparte como `WARN` (`Sesion interactiva`, `Arranque desatendido`). El resto de hallazgos (Docker AutoStart, secretos, Dropbox, rutas fijas…) se mantienen como `WARN`/`INFO`; el configurador ([configure-daubert-server.md](configure-daubert-server.md)) atiende los que son corregibles desde el host. Cuando se necesite una prueba de alcanzabilidad real (por ejemplo desde un teléfono de la LAN), es una verificación externa: el script no puede hacerla desde el propio servidor.

## Propósito

Responder, con evidencia y sin tocar el equipo: ¿este PC está preparado para ser el servidor del Hub? Reúne los datos de red (MAC, IP actual, gateway, DHCP), por ejemplo para una futura reserva DHCP, y marca lo que falta respecto al **estado objetivo** (sección final del informe).

## Comandos

```powershell
# Tabla legible + resumen + conclusión + estado objetivo
.\scripts\server\Diagnose-DaubertServer.ps1

# Un único documento JSON (sin tabla), para automatizar su lectura
.\scripts\server\Diagnose-DaubertServer.ps1 -Json

# Otro repositorio / comprobar si un nombre ya resuelve
.\scripts\server\Diagnose-DaubertServer.ps1 -RepoPath D:\daubert-hub -DaubertHubHostname hub.example.internal
```

Se recomienda ejecutarlo también **elevado (administrador)**: sin elevación no se puede leer BitLocker y puede no leerse `pg_hba.conf`; esas filas salen como `INFO` (nunca como `PASS`).

Pruebas: `Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\server\tests`.

## Qué comprueba

| Área | Comprobaciones |
| --- | --- |
| Host | Windows (edición/build), arquitectura, RAM, CPU, espacio libre, hostname, usuario, elevación, dominio/workgroup, firmware, BitLocker, Windows Update, reinicio pendiente |
| Network | Wi-Fi activo y conectado (red de V1), Ethernet (solo recomendación), ruta por defecto, IPv4/IPv6, gateway, DNS, DHCP, MAC, conectividad local al gateway sin ICMP, ahorro de energía del adaptador Wi-Fi, reserva DHCP (INFO/PENDIENTE), perfil de red |
| Firewall | Perfiles habilitados; regla específica **TCP 8082 con `RemoteAddress=LocalSubnet`** (y que cubra el perfil activo); puertos **3000, 5432, 5678** prohibidos en la LAN; **listener separado de regla**; reglas por programa (p. ej. `node.exe` en cualquier puerto) |
| Docker | Instalado, versión, daemon, backend WSL2, proyectos Compose, contenedores PROD (api `healthy`, web), puertos publicados, redes |
| PostgreSQL | Servicio, versión, listener 5432, `listen_addresses`/`port` (leídos de `postgresql.conf`, sin SQL), `pg_hba.conf` (reglas, `trust`, includes) |
| n8n | Proceso, versión, listener 5678, carpeta/config/SQLite, servicio o supervisor, dependencia de sesión interactiva, número de referencias a la ruta del perfil de usuario (solo el conteo) |
| Dropbox | Instalado, proceso, ruta, carpeta de backups |
| Energy | Plan, suspensión e hibernación con corriente (recomendado: nunca), pantalla, modo de ahorro del Wi-Fi del plan |
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

Las filas que dependen de algo externo se marcan como tales: por ejemplo, la **DHCP reservation** vive en el router y se reporta como `INFO` pendiente; que un puerto sea alcanzable desde otra máquina no se prueba desde el propio servidor (solo se compara listener y reglas).

## Uso del JSON

`-Json` imprime un único documento (UTF-8) con `schemaVersion`, `generatedAt`, `hostname`, `readOnly`, `summary`, `conclusion`, `exitCode`, `network`, `checks[]` y `target[]`:

```powershell
$d = .\scripts\server\Diagnose-DaubertServer.ps1 -Json | ConvertFrom-Json
$d.network      # Adapter, Mac, IPv4, Gateway, Dhcp, Dns, Profile  -> datos para la reserva DHCP del router
$d.checks | Where-Object status -eq 'FAIL'
```

`network` es `null` si no hay un adaptador conectado con IPv4 válida. El exit code del proceso coincide con `exitCode`.

## Estado objetivo (informativo)

Al final del informe se lista el estado objetivo del Daubert Hub Server (Wi-Fi requerido en V1, conectividad local, DHCP, DHCP reservation pendiente, Ethernet recomendado, TCP 8082 en LAN, 3000/5432/5678 prohibidos en LAN, Docker, PostgreSQL y n8n en el host, sin suspensión, arranque automático, BitLocker, Cloudflare/Tailscale futuros) con el estado actual de cada punto. **No se aplica nada.**
