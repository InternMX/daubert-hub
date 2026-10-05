# Daubert Hub — arquitectura self-hosted V1

Documentación elaborada el **2026-10-05** mediante Archify, después de inspeccionar `apps/`, `docker/`, los Compose, `database/`, `n8n/`, `scripts/`, `docs/` y los manifests. Alcance: servidor Windows provisional dentro de la LAN; uso interno mediante navegador.

## Diagramas y formatos

| Diagrama | HTML interactivo | SVG estático | Qué representa |
| --- | --- | --- | --- |
| Arquitectura general | [Abrir](daubert-hub-v1-architecture.html) | [SVG](daubert-hub-v1-architecture.svg) | LAN, router, Windows, firewall, Docker, servicios del host y persistencia; estados y opciones futuras en tarjetas separadas. |
| Request / data flow | [Abrir](daubert-hub-v1-dataflow.html) | [SVG](daubert-hub-v1-dataflow.svg) | Petición LAN hacia Web, proxy hacia API, SQL hacia PostgreSQL y webhook condicional hacia n8n; acceso directo prohibido. |
| Deployment / recuperación | [Abrir](daubert-hub-deployment.html) | [SVG](daubert-hub-deployment.svg) | Candidato Git, runner local, preflight, anclas, build, Web/API, verificaciones y rollback manual; backup/restore de PostgreSQL separado. |

Los dos primeros usan el modo Archify `architecture` (el segundo es un mapa de conexiones, no una secuencia temporal). El tercero usa `workflow`. Los `.json` homónimos son las especificaciones editables. Los HTML son autónomos y conservan fuentes, navegación y temas claro/oscuro; el menú **Export** permite exportar el diagrama completo a SVG/PNG/JPEG/WebP. La interfaz fija del visor usa inglés; el contenido explicativo está en español.

Los SVG entregados se extraen del SVG inline y sus estilos del HTML comprobado: son derivados estáticos, no nuevos artefactos interactivos. Las carpetas `visual-architecture/`, `visual-dataflow/` y `visual-deployment/` contienen **capturas PNG de viewport**, en dos tamaños y temas, junto con sus recibos y hojas de contacto. Esas capturas no son exportaciones del diagrama completo ni incluyen todas las tarjetas inferiores.

## Lectura de estados

| Estado | Interpretación |
| --- | --- |
| **Existe** | Implementación inspeccionada o ejecución histórica documentada. No equivale a nueva comprobación del host hoy. |
| **Configurado / pendiente de validación** | AutoStart de Docker habilitado según la auditoría aportada; falta demostrar recuperación completa después de reinicio y acceso desde otro cliente. |
| **Objetivo V1** | Abrir exclusivamente 8082 a LAN, implementar supervisor n8n y comprobar disponibilidad del servidor. La reserva DHCP requiere autorización del router. |
| **Futuro / opcional** | Cloudflare Tunnel + Access, Tailscale y DNS interno/hostname. Fuera de la ruta normal LAN. |

Las conexiones con texto **pendiente** u **objetivo** no afirman acceso disponible hoy. Una línea discontinua también puede representar una operación condicional (reproceso) o backup; el texto y las tarjetas definen su significado.

## Arquitectura detectada

Clientes LAN → ZTE F689 → Wi-Fi → host Windows 11 Pro → Windows Firewall → Web/Nginx → API/NestJS.

**Windows:** PostgreSQL 18 (PROD `daubert_global`), n8n, Dropbox y Docker Desktop. **Docker:** solo Web y API del Hub; red bridge `pilot`, política `restart: unless-stopped`. Web contiene Nginx, sirve React compilado y hace proxy de `/api` hacia `api:3000`. No hay un reverse proxy Nginx independiente.

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

El host usa actualmente **192.168.1.11**, gateway **192.168.1.1**, DHCP activo y Wi-Fi **B0-19-21-04-D8-6F**. La reserva MAC → IP **no está configurada**: esa dirección aún puede cambiar. Router ZTE F689; Ethernet no es requisito V1. No se ha definido un DNS interno ni un dominio. Primero debe funcionar `http://192.168.1.11:8082`.

Prueba aportada: Android **192.168.1.16** accede al panel del router; TCP 8082/5432/5678 al servidor dan timeout y ping 100% packet loss. Esto es consistente con firewall y **no demuestra aislamiento de clientes por el router**. ICMP fallido tampoco equivale por sí solo a HTTP fallido.

El diagnóstico aportado reportó **62 PASS / 13 WARN / 2 FAIL**. FAIL: falta la regla LAN 8082 y n8n no arranca automáticamente. WARN incluyen Public, reglas Node.js demasiado amplias, dependencia de sesión/rutas `C:\Users\06\...`, Dropbox sin inicio detectado, nombre Compose, ACL de secretos y copias env sensibles. Estos datos se atribuyen al contexto/auditoría aportados, no a un diagnóstico ejecutado durante esta tarea.

## Arranque y primer servidor LAN

Objetivo: Windows → PostgreSQL → Docker Desktop → Web/API → n8n con supervisor/tarea → Hub disponible en LAN. Es un orden conceptual de disponibilidad, **no una cadena de dependencias impuesta por Compose**: la API también requiere PostgreSQL disponible; Web espera la salud de API.

Docker AutoStart habilitado no garantiza arranque desatendido tras reinicio. La documentación local del configurador indica que Docker Desktop, Dropbox y el supervisor propuesto (al iniciar sesión) dependen de sesión interactiva. La instalación/activación del supervisor n8n y su validación operativa siguen pendientes según el contexto aportado. Durante la revisión final apareció `scripts/server/Start-DaubertN8nSupervisor.ps1` como archivo nuevo ajeno a esta tarea: contiene un supervisor local en desarrollo, pero su presencia no demuestra instalación, tarea registrada ni ejecución validada. No se ejecutó. La decisión sobre inicio de sesión y la prueba completa tras reinicio siguen pendientes. No se afirma que n8n pueda limitarse a loopback sin verificar la ruta Docker/host.

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
| Se solicita preparar el primer deployment, pero existe [release PROD 01-10](../deployments/2026-10-01-hub-v1-prod.md). | **Actual documentado**: release `0.9.0-pilot.2`, commit `fbda7c6`. Se interpreta el objetivo pendiente como habilitar el **primer servidor LAN con arranque validado**, sin borrar el historial. No se verificó el commit vivo hoy. |
| Ejemplos genéricos usan 8080 y `daubert-hub-prod`; release real usa 8082 y `daubert-hub`. | **Ejemplos no representativos del host**. El diagrama sigue release/contexto. El nombre compartido con Compose de desarrollo es un WARN real. |
| `compose.yaml` contiene `postgres-test` PostgreSQL 16 en Docker, publicado en 5433. | **Entorno de desarrollo**, no PostgreSQL 18 del host PROD. No se incluye en V1; tampoco se asume que está ejecutándose hoy. |
| `compose.prod-temp.yaml` existe localmente pero no está versionado. | **Configuración local documentada**; pasa cookies/webhooks adicionales. No se cita como evidencia de bytes en HEAD. `compose.pilot.yaml` solo no representa toda la configuración real. |
| Arquitectura anterior y comentarios muestran Cloudflare Quick Tunnel. | **Historia TEST**, no ruta V1 ni Tunnel + Access implementado. Cloudflare/Tailscale permanecen opcionales y separados. |
| `database-backup-restore.md` aún dice que age/tareas/primera ejecución están pendientes; nota release cita solapamiento Daily/Monthly. | **Documentación anterior desactualizada** frente a `postgresql-backup-automation.md`: ejecuciones 29-09, re-registro/reintento y restore 01-10 posteriores documentados. Se conservan las salvedades de DR. |
| Configure-DaubertServer ya existe en el working tree; apareció un script supervisor durante la tarea. | **Implementación parcial local / trabajo concurrente**: configurador plan `-WhatIf`, sin `-Apply` ni mutación implementada; supervisor como código local nuevo sin evidencia de instalación/validación. No se representa como servicio activo. |
| AutoStart y propuesta supervisor al inicio de sesión vs disponibilidad tras reinicio. | **Objetivo incompleto**: sesión interactiva y validación tras reinicio pendientes; no se promete disponibilidad desatendida. |
| IP/MAC/router, reglas efectivas, listeners y diagnóstico 62/13/2. | **Auditoría/contexto aportados**, parcialmente respaldados por documentación local. No se obtuvo una nueva auditoría del host/router ni acceso LAN. |
| Backup n8n Weekly, sincronización Dropbox actual, ACL, router sin forwarding, reserva DHCP, DNS. | No se confirma estado operativo nuevo desde código. Se preservan estados aportados y pendientes, sin inventar implementación. |

El documento local `configure-daubert-server.md` reporta conexión TCP contenedor API → n8n vía backend Docker/loopback; no equivale a validar hoy un webhook funcional. Cualquier endurecimiento futuro debe preservar y volver a probar la conectividad API → servicios del host.

## Evidencia y validación

Identidad de repo: `https://github.com/InternMX/daubert-hub.git`, HEAD **`ac4575df870cc48d3db0b67b3daf8e0930bc8e50`**. Las fuentes incluidas en las especificaciones usan enlaces locales y fueron comprobadas contra ese commit por Archify. Las relaciones se trazaron leyendo Nginx, Compose, `main.ts`, `environment.ts`, `DatabaseService`, clientes webhook, deployment y pipeline de backup, además de documentación de database/n8n.

Fuentes principales: [Compose Hub](../../compose.pilot.yaml), [Nginx](../../docker/nginx.conf), [Docker Web](../../docker/web.Dockerfile), [Docker API](../../docker/api.Dockerfile), [arquitectura Hub](../hub/architecture.md), [mapa general previo](../00-overview/architecture.md), [rutas n8n](../automations/n8n-paths.md), [deployment](../../scripts/deploy/Deploy-DaubertHub.ps1), [preflight](../../scripts/deploy/Test-DaubertDeployPreflight.ps1), [backups PostgreSQL](../operations/postgresql-backup-automation.md), [backups n8n](../operations/n8n-backup-automation.md), [diagnóstico](../operations/diagnose-daubert-server.md), [plan local de configuración](../operations/configure-daubert-server.md).

El working tree ya tenía cambios ajenos en `docs/operations/README.md`, documentación/script/pruebas de diagnóstico y archivos nuevos del configurador. En la revisión final apareció además `scripts/server/Start-DaubertN8nSupervisor.ps1`; su encabezado se inspeccionó para distinguir código en desarrollo de servicio instalado. Se leyeron como **estado local no publicado** y se preservaron. No se presentan esos cambios como bytes confirmados en HEAD. No se leyeron ni publicaron valores de archivos env o claves/credenciales.

Para los tres diagramas: `finalize` pasó **validate → deliver → strict check → browser-check**, **9/9 checks showcase, 0 errores y 0 warnings**. Capturas `visual-check` pasaron en claro/oscuro a 1440×900 y 2048×1320. Se inspeccionaron visualmente las capturas claras a 1440×900: rutas, etiquetas y fronteras legibles; el general usa desplazamiento vertical por su altura. No se afirma revisión visual manual de cada tema/tamaño ni de las tarjetas fuera del viewport.

Recibos completos: `*.finalize.json`; resumen: `*.finalize-summary.json`; procedencia/hashes: `*.delivery.json`; navegador: `*.browser-check.json`; consolidado con hashes de especificación y HTML: [validation-summary.json](validation-summary.json). Los SVG son derivados y no reciben el recibo de browser-check del HTML como si fuera propio.

Reproducir desde la raíz (solo documentación):

```powershell
node docs/architecture/generate-diagrams.mjs
node C:/Users/06/.agents/skills/archify/bin/archify.mjs finalize architecture docs/architecture/daubert-hub-v1-architecture.json docs/architecture/daubert-hub-v1-architecture.html --repo-root . --quality showcase --json
node C:/Users/06/.agents/skills/archify/bin/archify.mjs finalize architecture docs/architecture/daubert-hub-v1-dataflow.json docs/architecture/daubert-hub-v1-dataflow.html --repo-root . --quality showcase --json
node C:/Users/06/.agents/skills/archify/bin/archify.mjs finalize workflow docs/architecture/daubert-hub-deployment.json docs/architecture/daubert-hub-deployment.html --repo-root . --quality showcase --json
node docs/architecture/export-svg.mjs
```

Para una nueva revisión de HTML que ya tenga evidencia de navegador, usar un `--out-dir` nuevo dentro de `docs/architecture/` y conservar la evidencia previa. Actualizar la revisión Git del generador y las fuentes solo tras inspeccionar la nueva versión. El estado de revisión visual del consolidado corresponde a las capturas inspeccionadas durante esta entrega; repetir la inspección si cambia el contenido.

Esta tarea creó exclusivamente documentación/artefactos en `docs/architecture/`. No ejecutó diagnóstico/configurador, backup, restore, deployment, commit ni push; no modificó aplicación, Compose/Docker ni configuración del servidor.
