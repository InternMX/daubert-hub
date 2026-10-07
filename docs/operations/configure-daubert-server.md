# Configure-DaubertServer

Configuración **por fases** del **Daubert Hub Server V1**. Cada fase se puede ejecutar de forma independiente, tiene su propio `-WhatIf`, se detiene si falla y **no hace rollback automático**.

```powershell
.\scripts\server\Configure-DaubertServer.ps1 -WhatIf                    # plan completo (solo lectura)
.\scripts\server\Configure-DaubertServer.ps1 -WhatIf -Phase 2           # plan de una fase
.\scripts\server\Configure-DaubertServer.ps1 -Apply -Phase 1            # aplica SOLO la fase 1
.\scripts\server\Configure-DaubertServer.ps1 -Apply -Phase 1,2,3        # varias, en orden, se detiene al primer fallo
.\scripts\server\Configure-DaubertServer.ps1 -Apply -Phase All          # las cinco, en orden
```

`-Phase` acepta número o nombre (`1|Network`, `2|N8nNetwork`, `3|N8nSupervisor`, `4|Secrets`, `5|Verify`), uno o varios, o `All`; siempre se ejecutan en orden canónico.

**Reglas de `-Apply`**: exige `-Phase` explícita (sin fase es error de uso); las fases 1, 2 y 3 requieren una sesión **elevada**; pide escribir exactamente `CONFIGURE DAUBERT SERVER`; `-WhatIf` y `-Apply` son excluyentes. Exit codes: `0` ok · `1` bloqueado antes de cambiar nada (precondición, elevación, confirmación) · `3` error de uso · `5` una fase falló después de empezar (`CONFIGURATION FAILED`; las fases posteriores **no se ejecutan**).

## Validación actual

La configuración del servidor y el supervisor de n8n (fase 3, tarea `Daubert - n8n Supervisor`) ya fueron **implementados y validados** en el servidor. La fase 5 (`Verify`) permite repetir las comprobaciones locales cuando se quiera, y la verificación desde un cliente de la LAN sigue siendo externa (ver la limitación al final de las fases).

## Objetivo V1 (confirmado)

- Este PC es el servidor V1 provisional, por **Wi-Fi** (Ethernet no es requisito). IP `<SERVER_IP>`, gateway `<GATEWAY_IP>`, DHCP activo (los valores reales no se publican).
- **Reserva DHCP** (MAC del adaptador → `<SERVER_IP>`): pendiente de autorización; el script **no toca** el router, la IP, el DHCP ni el DNS. DNS interno: fuera de V1.
- Perfil de red de Windows: se **mantiene Public**.
- Web/API en Docker (AutoStart ya activo); PostgreSQL y n8n en Windows.
- Solo **TCP 8082** accesible desde la LAN; 3000, 5432 y 5678 no accesibles directamente por clientes LAN.

## Fases

### 1 · Network
Crea o corrige **únicamente** la regla `Daubert Hub - TCP 8082 (LAN)`: Inbound, Allow, TCP, LocalPort 8082, **RemoteAddress LocalSubnet**, **Profile Any**, Group `Daubert Hub`. Nada se abre hacia Internet. Después **verifica** que existe una sola regla con exactamente esos parámetros. No toca n8n, ACL, tareas, energía, router ni Docker. Si una regla del mismo nombre tiene otro grupo (no se puede cambiar) o hay duplicados, la fase se **bloquea** sin cambiar nada.

### 2 · N8nNetwork
Crea o corrige **únicamente** `Daubert Hub - Block LAN TCP 5678`: Inbound, **Block**, TCP, LocalPort 5678, **RemoteAddress LocalSubnet**, Profile Any. **Loopback nunca se bloquea**: la regla solo abarca `LocalSubnet`, y la fase comprueba que su alcance remoto sea exactamente ese. Las reglas existentes de `Node.js JavaScript Runtime` **no se modifican ni se eliminan**: la fase toma una instantánea antes y después y falla si cambia.
Secuencia: (1) debe haber algo escuchando en 5678; (2) **línea base** API Docker → n8n:5678 debe funcionar, si no, se bloquea sin cambiar nada; (3) aplica la regla y la verifica; (4) compara las reglas de Node.js; (5) repite API → n8n:5678: si falla ⇒ **CONFIGURATION FAILED**, se detiene y se indica el rollback manual (`Remove-NetFirewallRule -DisplayName "Daubert Hub - Block LAN TCP 5678"`), que **no** se ejecuta automáticamente.

### 3 · N8nSupervisor
Crea `C:\ProgramData\DaubertHub\Server\logs`, copia `scripts\server\Start-DaubertN8nSupervisor.ps1` a `C:\ProgramData\DaubertHub\Server\` y registra la tarea `Daubert - n8n Supervisor` (Task Scheduler; sin NSSM/WinSW):

- Trigger: **al iniciar sesión** del usuario, con **retraso de 1 min** (Docker/Dropbox).
- `MultipleInstances=IgnoreNew`, sin límite de duración, reintentos de la tarea (999, cada 1 min), `RunLevel Limited`, **`LogonType Interactive`** (no guarda ninguna contraseña de Windows). **No se habilita AutoAdminLogon.**
- El script: mutex global (sin duplicados); si ya hay un n8n lo **adopta** (nunca arranca una segunda instancia); si 5678 está ocupado por otro programa no inicia nada; espera con límite a Docker y Dropbox; arranca n8n (node + n8n global) y espera a 5678 (máx. 120 s); vigila el proceso y lo reinicia con espera creciente (15 s … 300 s); solo detiene un proceso que él mismo arrancó; **registra** en `n8n-supervisor.log` (rotado a 5 MB, sin secretos).

Después inicia la tarea una vez y verifica: la tarea es `Interactive`; el log registra el arranque; **una sola** instancia principal de n8n; n8n escucha en 5678; API → n8n:5678; AutoAdminLogon sin cambios. No se detiene ni se reinicia la instancia manual actual y no se tocan workflows ni credenciales.

### 4 · Secrets
Restringe la ACL de `deploy\pilot.prod.env`, `deploy\pilot.test.env`, `.env.prod-temp` y `.n8n\config` a: usuario actual, `NT AUTHORITY\SYSTEM` y `BUILTIN\Administrators` (FullControl), con la herencia desactivada. Se quitan `CodexSandboxUsers` y cualquier otra identidad (incluidos SID huérfanos). **No se borra ni se mueve ningún archivo** (`.env.prod-temp` queda donde está). Antes de modificar cada archivo se **muestra su estado y su destino**. Después verifica: solo esas tres identidades, ACL protegida, el usuario puede leer cada archivo, las tareas `Daubert - …` corren como el usuario y n8n corre como el usuario (conservan acceso). Ningún valor se lee ni se imprime.

### 5 · Verify (solo lectura)
Diagnóstico completo + comprobaciones: 8082 responde en el servidor; 3000/5432/5678 sin regla de entrada LAN; API → PostgreSQL (`/api/health` con `database=connected`); API → n8n; Docker api `healthy` y web `running`; n8n activo (una instancia); PostgreSQL activo; Wi-Fi conectado. La fase falla si falla alguna comprobación o si el diagnóstico completo aún reporta `FAIL`.

> **Limitación honesta**: desde el propio servidor no se puede probar su firewall (el tráfico a su propia IP no pasa por el filtrado de entrada). Por eso "8082 accesible desde la LAN" y "3000/5432/5678 no accesibles desde la LAN" se reportan como **`EXTERNAL` — pendiente de verificación desde un cliente de la LAN** (p. ej. un teléfono Android de la LAN: 8082 debe abrir; 3000, 5432 y 5678 deben dar timeout). No se dan por verificados.

## Auditoría 5678 / regla Node.js (solo lectura, 2026-10-05)

> Auditoría **histórica**, previa a la instalación del supervisor: el listener descrito como "n8n manual" se iniciaba a mano; hoy n8n lo inicia y supervisa la tarea `Daubert - n8n Supervisor`. Las conclusiones sobre la regla de Node.js y el tráfico loopback de Docker siguen vigentes.

**Regla existente** (TCP y UDP, creadas por el aviso de Windows al lanzar `node.exe`): `Node.js JavaScript Runtime`, Enabled, Inbound, **Allow**, **Profile Private**, program `C:\program files\nodejs\node.exe`, LocalPort **Any**, RemoteAddress **Any**, Service Any, EdgeTraversal DeferToUser. Hoy la red es **Public**, así que no aplica; si el perfil pasara a Private expondría a la LAN cualquier puerto en el que escuche `node.exe` (incluido 5678). La fase 2 añade un bloqueo (Block gana a Allow) sin tocarla.

**Listener**: `::` puerto 5678, proceso `node` (n8n manual). No hay `N8N_HOST`/`N8N_PORT`/`N8N_LISTEN_ADDRESS`; el binding de producción **no se cambia** a 127.0.0.1. El API usa `http://host.docker.internal:5678`.

**Prueba controlada** (solo TCP connect desde `daubert-hub-api-1`, 7 s, sin enviar HTTP, mientras se leía la tabla de conexiones de Windows):

```text
contenedor API            172.20.0.2:34380
host.docker.internal      192.168.65.254:5678         -> conecta
Windows (conexiones TCP)  127.0.0.1:51919 -> 127.0.0.1:5678, cliente PID 2528 = com.docker.backend
```

Windows **ve la conexión del API como `127.0.0.1` originada por `com.docker.backend`**: tráfico loopback que no coincide con `RemoteAddress LocalSubnet` y no depende de la regla Node.js. La sonda que usa la fase 2 es esa misma conexión (`docker exec daubert-hub-api-1 node -e …` con un script fijo que solo abre y cierra el socket; solo se acepta `host.docker.internal` en 5678/5432).

## Garantías

- **Una sola función puede cambiar el equipo**: `Invoke-ConfigMutation`. Se niega a ejecutarse fuera de `-Apply`, acepta únicamente operaciones con nombre de una lista corta (`Firewall.Hub8082.Upsert`, `Firewall.N8nBlock.Upsert`, `Dir.Create`, `File.CopySupervisor`, `Task.N8nSupervisor.Register|Start`, `Acl.Secret.Apply`) y valida sus objetivos (nombres de regla fijos, carpeta `…\DaubertHub\Server`, archivos de secretos conocidos). No hay operaciones de router, DHCP, DNS, Docker, PostgreSQL, registro/Winlogon, borrado ni edición de las reglas de Node.js.
- Cada fase solo llama a **sus** operaciones (comprobado por análisis del AST en las pruebas).
- No se usa `docker compose down` ni se reinicia PostgreSQL; docker solo se lee con `inspect` y la sonda fija.
- Pruebas Pester (`scripts/server/tests`): el plan y `-WhatIf` con todos los cmdlets mutantes simulados (ninguno se invoca); la selección de fases; la parada tras un fallo; las propiedades exactas de las reglas y la protección de loopback; que las reglas de Node.js no se modifiquen; la ACL propuesta y aplicada (incluida una prueba sobre un archivo temporal real); y la ausencia de AutoAdminLogon y de contraseñas almacenadas.

## Sin cambios en esta versión
Router/DHCP/DNS, energía (el ahorro del adaptador Wi-Fi solo se reporta), perfil de red (se mantiene Public), proyecto Compose (sigue `daubert-hub`), rutas `C:\Users\<WINDOWS_USER>\…` de n8n y workflows (solo se documentan), y el inicio de sesión de Windows: tras un reinicio solo PostgreSQL (servicio) arranca solo; Docker Desktop, la tarea del supervisor y Dropbox esperan a que un usuario inicie sesión. Eso depende de una decisión de inicio de sesión de Windows y **no se habilita AutoAdminLogon**.
