# Daubert Hub — arquitectura self-hosted V1

Documentación elaborada el **2026-10-05** mediante Archify, después de inspeccionar `apps/`, `docker/`, los Compose, `database/`, `n8n/`, `scripts/`, `docs/` y los manifests. Alcance: servidor Windows provisional dentro de la LAN; uso interno mediante navegador.

> **Estado de los diagramas:** los tres diagramas (HTML, SVG y JSON) se regeneraron para reflejar que la configuración del servidor y el supervisor de n8n (tarea `Daubert - n8n Supervisor`) ya están implementados y validados. Los datos de red reales del servidor (IP, MAC, modelo de router) se omiten a propósito en esta documentación pública.

## Vista resumida

```text
LAN (navegador)
    |  TCP 8082
    v
Daubert Hub Web :8082  (Docker, Nginx)
    |
    v
Daubert Hub API  (Docker, sin puerto publicado)
    |
    +--> PostgreSQL  (servicio de Windows, :5432)
    |
    +--> n8n  (Windows, :5678, supervisado por Task Scheduler)
```

n8n **no** está expuesto directamente a la LAN: solo la API lo invoca (webhook server-to-server, condicional al reproceso). Tampoco se exponen 3000 ni 5432. En V1 no hay acceso desde Internet.

## Diagramas y formatos

| Diagrama | HTML interactivo | SVG estático | Qué representa |
| --- | --- | --- | --- |
| Arquitectura general | [Abrir](daubert-hub-v1-architecture.html) | [SVG](daubert-hub-v1-architecture.svg) | LAN, router, Windows, firewall, Docker, servicios del host y persistencia; estados y opciones futuras en tarjetas separadas. |
| Request / data flow | [Abrir](daubert-hub-v1-dataflow.html) | [SVG](daubert-hub-v1-dataflow.svg) | Petición LAN hacia Web, proxy hacia API, SQL hacia PostgreSQL y webhook condicional hacia n8n; acceso directo prohibido. |
| Deployment / recuperación | [Abrir](daubert-hub-deployment.html) | [SVG](daubert-hub-deployment.svg) | Candidato Git, runner local, preflight, anclas, build, Web/API, verificaciones y rollback manual; backup/restore de PostgreSQL separado. |

Los dos primeros usan el modo Archify `architecture` (el segundo es un mapa de conexiones, no una secuencia temporal). El tercero usa `workflow`. Los `.json` homónimos son las especificaciones editables. Los HTML son autónomos y conservan fuentes, navegación y temas claro/oscuro; el menú **Export** permite exportar el diagrama completo a SVG/PNG/JPEG/WebP. La interfaz fija del visor usa inglés; el contenido explicativo está en español.

Los SVG entregados se extraen del SVG inline y sus estilos del HTML comprobado: son derivados estáticos, no nuevos artefactos interactivos. Las capturas PNG de viewport de versiones anteriores se retiraron porque mostraban contenido ya superado; no se regeneraron.

## Lectura de estados

| Estado | Interpretación |
| --- | --- |
| **Existe** | Implementación inspeccionada o ejecución histórica documentada. No equivale a nueva comprobación del host hoy. |
| **Implementado y validado** | Configuración del servidor (`Configure-DaubertServer.ps1`) y supervisor de n8n (tarea `Daubert - n8n Supervisor`). |
| **Pendiente de validación externa** | Acceso a 8082 y bloqueo de 3000/5432/5678 desde un cliente de la LAN (no comprobable desde el propio servidor), y recuperación completa tras un reinicio, que depende del inicio de sesión de un usuario. |
| **Objetivo V1** | Exponer exclusivamente 8082 a la LAN. La reserva DHCP requiere autorización del router. |
| **Futuro / opcional** | Cloudflare Tunnel + Access, Tailscale y DNS interno/hostname. Fuera de la ruta normal LAN. |

Las conexiones con texto **pendiente** u **objetivo** no afirman acceso disponible hoy. Una línea discontinua también puede representar una operación condicional (reproceso) o backup; el texto y las tarjetas definen su significado.

## Arquitectura detectada

Clientes LAN → router de la LAN → Wi-Fi → host Windows 11 Pro → Windows Firewall → Web/Nginx → API/NestJS.

**Windows:** PostgreSQL 18 como servicio (PROD `daubert_global`), n8n (Node.js, puerto 5678, iniciado y supervisado por la tarea `Daubert - n8n Supervisor`), Dropbox y Docker Desktop. **Docker:** solo Web y API del Hub; red bridge `pilot`, política `restart: unless-stopped`. Web contiene Nginx, sirve React compilado y hace proxy de `/api` hacia `api:3000`. No hay un reverse proxy Nginx independiente.

La API usa `pg.Pool` para SQL parametrizado. Los webhooks a n8n se ejecutan server-to-server únicamente cuando la operación solicita reproceso, con token privado de la API; una lectura normal no necesita llamar a n8n. n8n lee/escribe PostgreSQL y los archivos de Dropbox. La API no accede directamente al filesystem de Dropbox.

Web/API son esencialmente stateless: las sesiones están en PostgreSQL. La persistencia queda **fuera de esos contenedores**: datos PostgreSQL, SQLite/configuración/storage/nodes de n8n, documentos/PDFs de Dropbox y backups PostgreSQL. Reemplazar imágenes del Hub no constituye backup ni restore de esos datos. Dropbox representa el cliente y los archivos locales; la sincronización externa no pertenece a la ruta de entrada de usuarios LAN.

## Red y seguridad

| Ruta | Estado actual / objetivo V1 |
| --- | --- |
| LAN → host TCP **8082** → Web TCP 80 | Publicación Docker documentada; falta regla de entrada LAN. **Objetivo permitido**. |
| Web → API TCP **3000** | Interno de Docker, `expose`, sin `ports` al host. |
| API → PostgreSQL TCP **5432** | Servicio Windows vía `host.docker.internal`, conexión interna/host. |
| API → n8n TCP **5678** | Servicio Windows vía `host.docker.internal`, reproceso condicional. |
| LAN → 3000 / 5432 / 5678 | **Objetivo no expuesto**; 5432/5678 dieron timeout en la prueba aportada. 3000 no fue probado desde el teléfono. |
| Internet → Hub | **Sin exposición en V1**: no túnel, ni forwarding público previsto. No se realizó auditoría administrativa del router. |

Regla objetivo: **Inbound / TCP / LocalPort 8082 / RemoteAddress LocalSubnet / Action Allow**, cubriendo el perfil activo **Public**. No se cambia automáticamente a Private. Una conexión host/Docker no es un permiso de entrada LAN. No se confunde un listener con una regla de firewall: n8n puede escuchar en todas las interfaces y seguir inaccesible a clientes LAN.

El servidor usa Wi-Fi con DHCP activo; su IP se denota `<SERVER_IP>` y el gateway `<GATEWAY_IP>`. La reserva DHCP (MAC → IP) **no está configurada**: esa dirección aún puede cambiar y requiere autorización en el router (mejora posterior). Ethernet no es requisito de V1. No se ha definido un DNS interno ni un dominio. Primero debe funcionar `http://<SERVER_IP>:8082`.

Una prueba externa previa desde un teléfono Android de la LAN mostró timeout en TCP 8082/5432/5678 y ping sin respuesta, antes de crear la regla de entrada de 8082. Era consistente con el firewall y **no demostraba aislamiento de clientes por el router**; ICMP fallido tampoco equivale por sí solo a HTTP fallido. La comprobación desde un cliente de la LAN sigue siendo externa al servidor.

El diagnóstico aportado **antes de configurar el servidor** reportó **62 PASS / 13 WARN / 2 FAIL** (resultado histórico). Esos FAIL eran la falta de la regla LAN 8082 y que n8n no arrancaba automáticamente; el segundo se resolvió con el supervisor y el primero corresponde a la fase 1 del configurador. WARN incluyen Public, reglas Node.js demasiado amplias, dependencia de sesión/rutas `C:\Users\<WINDOWS_USER>\...`, Dropbox sin inicio detectado, nombre Compose, ACL de secretos y copias env sensibles. Estos datos se atribuyen al contexto/auditoría aportados, no a un diagnóstico ejecutado durante esta tarea.

## Arranque y primer servidor LAN

Orden conceptual de disponibilidad: Windows → PostgreSQL → Docker Desktop → Web/API → n8n con supervisor/tarea → Hub disponible en LAN. Es un orden conceptual de disponibilidad, **no una cadena de dependencias impuesta por Compose**: la API también requiere PostgreSQL disponible; Web espera la salud de API.

**Supervisor de n8n (implementado y validado).** n8n lo inicia y vigila la tarea de Task Scheduler `Daubert - n8n Supervisor`, que ejecuta `scripts/server/Start-DaubertN8nSupervisor.ps1` (copiado a `%ProgramData%\DaubertHub\Server\` por la fase 3 del configurador). Se dispara **al iniciar sesión** del usuario con 1 minuto de retraso; evita instancias duplicadas (mutex); si n8n ya está en ejecución lo **adopta**; si n8n termina lo reinicia con espera creciente; y registra en `n8n-supervisor.log`. Detalle en [configure-daubert-server.md](../operations/configure-daubert-server.md). Por tanto n8n **no** requiere arranque manual.

**Límite vigente:** el supervisor, Docker Desktop y Dropbox arrancan al iniciar sesión un usuario; tras un reinicio, sin sesión, solo PostgreSQL (servicio) arranca solo. Es una decisión de inicio de sesión de Windows (no se habilita AutoAdminLogon), no una falla del supervisor. Docker AutoStart habilitado tampoco garantiza arranque desatendido. No se afirma que n8n pueda limitarse a loopback sin verificar la ruta Docker/host.

## Deployment y recuperación

`scripts/deploy/Deploy-DaubertHub.ps1` trabaja con candidato **ya presente localmente, igual a HEAD**. GitHub es el origen, no un runner CI alojado. El script no hace `fetch`, `pull` ni checkout automático. Ejecuta preflight y gates, preserva imágenes actuales con tags rollback antes de construir y usa `docker compose up -d --build api web`. Build/up son pasos conceptuales de esa misma invocación.

Después comprueba API healthy, respuesta Web, `/api/health` (`status`, conexión BD, entorno PROD, commit y versión) y contenedores en ejecución. Estos checks son locales: no sustituyen una prueba desde teléfono/PC LAN.

Si falla, muestra un **procedimiento manual**: preservar la imagen fallida, recuperar etiquetas desde rollback anchors, recrear Web/API con imágenes anteriores (`--no-build`) y comprobar la release anterior. No ejecuta rollback automático ni restaura PostgreSQL/n8n. Tampoco instala ni configura el servidor completo.

PostgreSQL tiene automatización propia en `scripts/backup/`: Task Scheduler → `Start-DaubertPostgresBackup.ps1` → `pg_dump`, empaquetado cuando aplica, cifrado asimétrico age, SHA-256, publicación y retención en destino externo configurable (Dropbox documentado). El productor usa clave pública; la identidad privada requiere custodia independiente.

| Tier PostgreSQL | Frecuencia por defecto | Retención | Contenido |
| --- | --- | --- | --- |
| Frequent | Cada 4 h desde 00:30 | 7 días | Dump completo |
| Daily | Diario desde 02:00, `OnlyIfDue` | 30 días | Dump + schema-only |
| Monthly | Día 1 desde 03:00, `OnlyIfDue` | 12 meses | Dump + schema-only + globals sanitizados |

La documentación más reciente registra ejecuciones reales, tareas registradas y corrección de solapamientos el 01-10. Restore Daily probado ese día **en una base temporal del mismo clúster**; no fue bare-metal ni una restauración validada de roles/globals en clúster independiente. Restore primero a una base nueva y verificar; promoverla requiere una decisión operativa independiente.

n8n tiene su propio motor de backup SQLite/config/storage/nodes: Weekly programable y OnChange manual. Restore manual; drill histórico del 28-09 documentado. La instalación efectiva de la tarea Weekly en el host hoy no se confirma con el repositorio. Backup n8n y supervisor de arranque son mecanismos distintos.

## Discrepancias y límites de confirmación

| Hallazgo | Clasificación y tratamiento |
| --- | --- |
| Se solicitó preparar el primer deployment, pero existe [release PROD 01-10](../deployments/2026-10-01-hub-v1-prod.md). | **Actual documentado**: release `0.9.0-pilot.2`, commit `fbda7c6`. El objetivo se interpretó como habilitar el **primer servidor LAN con arranque validado**, sin borrar el historial. No se verificó el commit vivo en esta revisión. |
| Ejemplos genéricos usan 8080 y `daubert-hub-prod`; release real usa 8082 y `daubert-hub`. | **Ejemplos no representativos del host**. El diagrama sigue release/contexto. El nombre compartido con Compose de desarrollo es un WARN real. |
| `compose.yaml` contiene `postgres-test` PostgreSQL 16 en Docker, publicado en 5433. | **Entorno de desarrollo**, no PostgreSQL 18 del host PROD. No se incluye en V1; tampoco se asume que está ejecutándose hoy. |
| `compose.prod-temp.yaml` existe localmente pero no está versionado. | **Configuración local documentada**; pasa cookies/webhooks adicionales. No se cita como evidencia de bytes en HEAD. `compose.pilot.yaml` solo no representa toda la configuración real. |
| Arquitectura anterior y comentarios muestran Cloudflare Quick Tunnel. | **Historia TEST**, no ruta V1 ni Tunnel + Access implementado. Cloudflare/Tailscale permanecen opcionales y separados. |
| `database-backup-restore.md` aún dice que age/tareas/primera ejecución están pendientes; nota release cita solapamiento Daily/Monthly. | **Documentación anterior desactualizada** frente a `postgresql-backup-automation.md`: ejecuciones 29-09, re-registro/reintento y restore 01-10 posteriores documentados. Se conservan las salvedades de DR. |
| Versión anterior de este documento: configurador solo `-WhatIf`, supervisor "sin evidencia de instalación". | **Superado**: `Configure-DaubertServer.ps1` ya soporta `-Apply` por fases y el supervisor de n8n está implementado y validado. El texto se corrigió; los diagramas generados aún no. |
| Supervisor al inicio de sesión vs disponibilidad tras reinicio. | **Límite conocido, no defecto**: depende de que un usuario inicie sesión; no se promete disponibilidad desatendida ni se habilita AutoAdminLogon. |
| IP/MAC/router, reglas efectivas, listeners y diagnóstico 62/13/2. | **Auditoría/contexto aportados**, parcialmente respaldados por documentación local. No se obtuvo una nueva auditoría del host/router ni acceso LAN. |
| Backup n8n Weekly, sincronización Dropbox actual, ACL, router sin forwarding, reserva DHCP, DNS. | No se confirma estado operativo nuevo desde código. Se preservan estados aportados y pendientes, sin inventar implementación. |

El documento local `configure-daubert-server.md` reporta conexión TCP contenedor API → n8n vía backend Docker/loopback; no equivale a validar hoy un webhook funcional. Cualquier endurecimiento futuro debe preservar y volver a probar la conectividad API → servicios del host.

## Evidencia y validación

Identidad de repo: `https://github.com/InternMX/daubert-hub.git`, HEAD **`ac4575df870cc48d3db0b67b3daf8e0930bc8e50`**. Las fuentes incluidas en las especificaciones usan enlaces locales y fueron comprobadas contra ese commit por Archify. Las relaciones se trazaron leyendo Nginx, Compose, `main.ts`, `environment.ts`, `DatabaseService`, clientes webhook, deployment y pipeline de backup, además de documentación de database/n8n.

Fuentes principales: [Compose Hub](../../compose.pilot.yaml), [Nginx](../../docker/nginx.conf), [Docker Web](../../docker/web.Dockerfile), [Docker API](../../docker/api.Dockerfile), [arquitectura Hub](../hub/architecture.md), [mapa general previo](../00-overview/architecture.md), [rutas n8n](../automations/n8n-paths.md), [deployment](../../scripts/deploy/Deploy-DaubertHub.ps1), [preflight](../../scripts/deploy/Test-DaubertDeployPreflight.ps1), [backups PostgreSQL](../operations/postgresql-backup-automation.md), [backups n8n](../operations/n8n-backup-automation.md), [diagnóstico](../operations/diagnose-daubert-server.md), [plan local de configuración](../operations/configure-daubert-server.md).

Los diagramas se regeneraron después de implementar el configurador y el supervisor de n8n (ambos versionados en `scripts/server/`); las fuentes citadas en las especificaciones siguen apuntando al HEAD indicado, cuyos archivos fuente no cambiaron. No se leyeron ni publicaron valores de archivos env o claves/credenciales.

Para los tres diagramas, `finalize` pasó **validate → deliver → check → browser-check** (recibos `*.finalize-summary.json`). No se realizó inspección visual manual ni se generaron capturas en esta regeneración.

Recibos completos: `*.finalize.json`; resumen: `*.finalize-summary.json`; procedencia/hashes: `*.delivery.json`; navegador: `*.browser-check.json`; consolidado con hashes de especificación y HTML: [validation-summary.json](validation-summary.json). Las rutas absolutas de los recibos se sustituyeron por rutas relativas o `<ARCHIFY_HOME>`. Los SVG son derivados y no reciben el recibo de browser-check del HTML como si fuera propio.

Reproducir desde la raíz (solo documentación):

```powershell
node docs/architecture/generate-diagrams.mjs
node <ARCHIFY_HOME>/bin/archify.mjs finalize architecture docs/architecture/daubert-hub-v1-architecture.json docs/architecture/daubert-hub-v1-architecture.html --repo-root . --quality showcase --json
node <ARCHIFY_HOME>/bin/archify.mjs finalize architecture docs/architecture/daubert-hub-v1-dataflow.json docs/architecture/daubert-hub-v1-dataflow.html --repo-root . --quality showcase --json
node <ARCHIFY_HOME>/bin/archify.mjs finalize workflow docs/architecture/daubert-hub-deployment.json docs/architecture/daubert-hub-deployment.html --repo-root . --quality showcase --json
node docs/architecture/export-svg.mjs
```

Archify no sobrescribe evidencia existente de otro propietario: si `browser-check` reporta `evidence-path-conflict`, mover aparte los `*.browser-check.json` anteriores o usar un `--out-dir` nuevo. Actualizar la revisión Git del generador y las fuentes solo tras inspeccionar la nueva versión.

Esta documentación vive en `docs/architecture/`; generarla no ejecuta diagnóstico/configurador, backup, restore ni deployment, ni modifica aplicación, Compose/Docker o la configuración del servidor.
