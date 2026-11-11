# Manufactura · aislamiento operativo e informe de preparación para la junta (Fase 6D)

Estado: **Manufactura preparada para una futura liberación; nada publicado, desplegado ni habilitado.** PROD sigue en v1.1.1 (`16153a8`). No se modificaron `daubert_global`, `daubert_hub_test`, el nginx de producción ni su `default.conf`, `scripts/backup/` operativo, las tareas programadas, n8n, Dropbox ni los contenedores de producción. No se ejecutó `Close`, `Prepare`, `Reload` ni `Open` sobre producción. Sin push, PR, merge ni imágenes definitivas; versión 1.1.1.
Evidencia (fuera del repositorio): `C:\Users\06\Documents\Daubert\Evidencia_6D_20261110\` (`politica\`, `limites\`, `cifrado\`).

## 1. Aislamiento de la política de cierre
### 1.1 Cómo se resolvía y qué se cambió
- `Set-EntryClosure.ps1` resuelve la política con una ruta **fija relativa al propio script**: `<repo>\deploy\closure\entry-closure-policy.conf`. `Close` instala ese archivo byte a byte como `default.conf`. Como el árbol de trabajo es el árbol operativo, lo que haya en esa ruta es lo que un cierre instala en PROD. En 6C.3 esa ruta contenía la política nueva: **ese riesgo queda eliminado**.
- **Política operativa anterior**: blob de git `a49024e7…`, la misma en `main` (`16153a8`). SHA-256 del archivo instalado (CRLF) **`e86f47494d87222122938c6b580cec465cecdf3835c037ce947f60f9e340068f`**, idéntico a la copia que producción tiene en `…\maintenance-window\entry-closure-policy.conf` (leída, no modificada).
- Ahora:
  | Artefacto | Contenido | SHA-256 del archivo |
  |---|---|---|
  | `deploy/closure/entry-closure-policy.conf` | **Restaurada** a la política operativa anterior, byte a byte | `e86f4749…068f` |
  | `deploy/closure/entry-closure-policy.manufactura.conf` (nuevo) | La operativa + una línea de ruta (`~*^/api/manufacturing-sheets(?:/|$) 1;`) y dos de comentario | `dcadb58dc1cd8d124b383462e1390160155e3012d053b1e0fd021ef2f147bdd9` |
  `.gitattributes` fija `deploy/closure/*.conf` a CRLF para que el hash no dependa de la configuración de git de quien extraiga el árbol.
- `Set-EntryClosure.ps1` se **restauró a la versión operativa anterior** y solo se le **añadió** (43 líneas, ninguna alterada salvo la lista de parámetros):
  - `-Policy Operativa|Manufactura` (por omisión `Operativa`). `Manufactura` **exige** `-ExpectedPolicySha256`; si falta o el archivo no coincide, el script se detiene **antes de tocar nada**.
  - `-ExpectedPolicySha256` (opcional con la operativa).
  - Las sondas de Manufactura solo se usan con `-Policy Manufactura`. `Reload` y `Status` reconocen por hash qué política está instalada.
  - `-KeepClosure` (solo `Prepare`): renueva la línea base de nginx sin reabrir una ventana cerrada. Sin él, `Prepare` se comporta como siempre. (En 6C.3 este comportamiento era incondicional; ahora es explícito.)
- `Deploy-DaubertHub.ps1`: `-ClosurePolicy Manufactura -ClosurePolicySha256 <sha>`. La compuerta bloquea si falta el hash, si el archivo versionado no coincide, si con `-RequireClosedWindow` el `default.conf` externo no es **esa** política, o si la configuración habilita Manufactura dentro de una ventana cerrada con la política operativa. Por omisión, sin cambios.
- `Test-ManufacturaReleaseReadiness.ps1 -ClosurePolicyFile … -ClosurePolicySha256 …`: comprueba hash autorizado, que la política bloquea `/api/manufacturing-sheets` y que conserva Pagos/Caterpillar.

### 1.2 Uso en la futura ventana (no ejecutado)
```
Set-EntryClosure.ps1 -Action Close -Policy Manufactura -ExpectedPolicySha256 <sha del acta>
Set-EntryClosure.ps1 -Action Prepare -KeepClosure -WebImage daubert-hub-web:release-<commit> -ExpectedOpenSha256 <nginxConfSha256 del manifiesto de imágenes>
Set-EntryClosure.ps1 -Action Close -Policy Manufactura -ExpectedPolicySha256 <sha del acta>
Set-EntryClosure.ps1 -Action Status       # debe decir CLOSED y "policy: MANUFACTURA"
Deploy-DaubertHub.ps1 -Deploy … -RequireClosedWindow -ClosurePolicy Manufactura -ClosurePolicySha256 <sha del acta>   # -ClosurePolicy Manufactura ya implica -RequireClosedWindow (desde 1edcbe9)
Set-EntryClosure.ps1 -Action Reload -ExpectState Closed   # se niega sin recargar si el archivo en disco no está cerrado (desde 1edcbe9)
Set-EntryClosure.ps1 -Action Open
```
Tras la liberación autorizada habrá que **promover** la política de Manufactura a política por omisión (commit aparte), o los cierres posteriores sin `-Policy` no bloquearán Manufactura.

### 1.3 Ensayo (clones aislados, proyecto Compose `daubert-hub-rbtest64`, carpeta de cierre de ensayo)
| Prueba | Resultado |
|---|---|
| `Close` sin `-Policy`, script nuevo | instala `e86f4749…` (operativa); 12 sondas + 5 escrituras (las de siempre) |
| `Close` con el script operativo anterior (`db7f6ba`) | instala `e86f4749…`; **salida idéntica** a la del script nuevo por omisión |
| Con la política operativa | escritura de Manufactura → 401 (llega al API, como antes); Pagos → 503 |
| `-Policy Manufactura` sin hash · hash incorrecto · hash de la operativa · valor no admitido | se niega en los cuatro; `default.conf` sin cambios |
| Política de Manufactura alterada (una línea) con el hash autorizado | se niega; sin cambios |
| `-Policy Manufactura` con el hash autorizado | instala `dcadb58d…`; 18 sondas + 8 escrituras; Manufactura → 503, Pagos → 503, lectura 200 |
| `Reload` / `Status` sin `-Policy` | reconocen `MANUFACTURA`, estado `CLOSED` verificado |
| `Prepare -KeepClosure` cerrado · abierto | conserva el cierre · se niega |
| Readiness: Manufactura + hash · operativa · hash incorrecto | PASS · FAIL · FAIL |
Pruebas automatizadas: `scripts/deploy/tests` **120** (114 + 6 nuevas de readiness; 5 nuevas de la compuerta incluidas en las 114), todas pasan. Una fija que la política operativa versionada es exactamente `e86f4749…` y otra que la de Manufactura difiere en una sola línea de ruta.

## 2. Límites de firmas (contenedores desechables, `tools/ensayo-liberacion/limites-firmas.cjs`)
| Caso | Resultado |
|---|---|
| Firma PNG válida de 0,20 / 1,00 / 1,90 MB | nginx y API la aceptan: **201** y una fila nueva en `manufactura.firmas` cada vez |
| Firma de 2,80 MB | atraviesa nginx; **la rechaza la API** con `413 {"message":"File too large"}` (JSON); ninguna fila |
| Firma de 2,05 MB | la rechaza la API (413 JSON); ninguna fila |
| Solicitud de 3,20 y 5,00 MB | **la rechaza nginx** (413 HTML); no llega a la API; ninguna fila |
| Ventana cerrada (política de Manufactura): firmas de 0,2 / 1,9 / 2,8 / 3,5 MB y 5 escrituras con sesión | **503** con `X-Hub-Window: closed-v1`; lectura 200; **ninguna de las 9 tablas de manufactura cambió** (mismas filas y misma última transacción) |
| Otras rutas con 1,5 MB (`/signatures/`, `/signatures/0/authorize`, `/drafts`, `/client-abbreviations`, `/previews`, `/api/clients`, `/api/companies/0/aliases`, `/api/auth/login`, `/api/automations/payment-notifications/0/reprocess`) | nginx 413 en las nueve (límite anterior de 1 MB); 0,5 MB en `/drafts` llega a la API |
Observación menor: el rechazo de la API a una firma de 2–3 MB es el genérico «File too large» en inglés (lo emite el interceptor de carga, antes del mensaje propio «máximo 2 MB»).

## 3. Respaldos cifrados con age
### 3.1 Procedimiento revisado
El trabajo de respaldo cifra con la **clave pública** (`age -R age-recipients.txt`), publica `<db>_<TIER>_<fecha>.age` + `.age.sha256` y **no puede descifrar**: su validación del artefacto es solo estructural. La clave privada está en custodia fuera del host. Por tanto un resultado 0 de la tarea demuestra que se publicó un archivo cifrado bien formado, **no** que su contenido sea completo.

### 3.2 Ensayo con claves desechables (`ensayo-respaldo-cifrado.ps1`)
Pipeline **real** (`Start-DaubertPostgresBackup.ps1` de un clon con el parche), con todas las rutas en un directorio de ensayo, sin `-ConfigPath` (no lee la configuración operativa), sin tocar el destino, el lock ni los logs reales, contra PostgreSQL desechable migrado y con datos (1 hoja finalizada con PDF, 4 firmas). Par de claves generado con `age-keygen` para el ensayo y **eliminado al terminar**. No se buscó ni usó ninguna clave operativa ni se descifró ningún respaldo real.
| Caso | Resultado |
|---|---|
| Frequent / Daily / Monthly | pipeline exit 0, artefacto publicado, sin texto plano en staging; comprobación del artefacto final: sidecar, cabecera, descifrado, contenido (dump · dump + schema-only · + globals sin contraseñas), **restauración en instancia sin red** → `ARTEFACTO_CIFRADO_INTEGRO` en los tres |
| Clave equivocada | rechazado (age no descifra) |
| Un byte alterado, sidecar original | rechazado (SHA-256 ≠ sidecar) |
| Un byte alterado o truncado, sidecar recalculado | rechazado (age autentica el contenido) |
| Sin sidecar | rechazado |
| Módulo **sin** parche tras la 026 | pipeline exit 4, **no publica nada** |
| Módulo con parche y **sin** políticas de respaldo (026 revertida en la base desechable) | **pipeline exit 0 y artefacto publicado** de 507 KB en lugar de 1,28 MB (faltan las firmas y el PDF); la comprobación del artefacto final lo **rechaza** |
En todos los negativos no quedó texto plano. El último caso es la razón de este control: el trabajo terminó «bien» con un respaldo incompleto.

### 3.3 Cómo debe comprobar el artefacto real el custodio autorizado (durante la liberación)
1. En una **estación de recuperación** (no el host productor), con `age.exe`, 7-Zip, herramientas cliente de PostgreSQL 18, Docker y una copia del repositorio en el commit candidato.
2. Copiar desde el destino de respaldos el `.age` **posterior a las migraciones** y su `.age.sha256`. Traer `age-identity.txt` desde la custodia; no copiarlo al host productor ni al repositorio.
3. En el host de base de datos, justo antes del respaldo, generar los conteos de referencia (`tools/ensayo-liberacion/contar-filas.readonly.sql`, solo lectura) y llevarlos a la estación.
4. Ejecutar:
   ```
   powershell -File tools\ensayo-liberacion\verificar-artefacto-cifrado.ps1 -Artifact <archivo>.age -IdentityFile <custodia>\age-identity.txt `
       -WorkDir <carpeta vacía fuera del repo> -RolesFile <globals.sql> -FilasOrigen <conteos.txt>
   ```
   (`-Previo` para el respaldo anterior a las migraciones.) Debe terminar en `ARTEFACTO_CIFRADO_INTEGRO`. El script borra el texto plano al terminar, también si falla.
5. Retirar `age-identity.txt` de la estación y devolverlo a la custodia. Registrar en el acta: nombre del artefacto, su SHA-256 y el resultado.
6. Si el resultado es `ARTEFACTO_CIFRADO_RECHAZADO`: Manufactura sigue apagada y las tareas en pausa; no se continúa (ver el plan de reversión de `manufactura-cierre-bloqueantes-6c3.md`).
Sin `-FilasOrigen` la comparación de conteos no se hace: con Manufactura recién migrada y sin documentos, un respaldo con las tablas vacías solo se detecta por las políticas ausentes del catálogo. Con documentos, los conteos son la comprobación directa.

## 4. Pendientes consolidados
### A. Bloqueantes técnicos de liberación
| # | Pendiente | Estado |
|---|---|---|
| A1 | Versión candidata final: commit congelado tras la junta, versión 1.2.0, parche de respaldos como commit de la candidata no extraído en el árbol operativo | Pendiente a propósito |
| A2 | Imágenes definitivas (api, web sin interfaz, web con interfaz) construidas del commit final, validadas en entorno aislado, con manifiestos y SHA-256 (incluido `nginxConfSha256`) | Pendiente a propósito |
| A3 | Manifiesto de `database/`: vigente (`dc6d1133…971a2`, 77 archivos, base `16153a8`); regenerar solo si la junta pide cambios en `database/` o si PROD deja de correr `16153a8` | Listo, condicionado |
| A4 | Comprobación del artefacto cifrado real por el custodio (§3.3): requiere su disponibilidad y una estación de recuperación durante la ventana | Procedimiento listo; falta designar custodio y estación |
| A5 | Control real de las tareas programadas (`Disable/Enable-ScheduledTask`, corrida de comprobación): solo simulado | Pendiente de ejecutar en la ventana |
| A6 | Renovación del `default.conf` externo de nginx en la ventana (sin ella la firma de 1–2 MB da 413) | Procedimiento ensayado |
| A7 | SHA-256 de la política de cierre de Manufactura en el acta (`dcadb58d…bdd9`) y su promoción a política por omisión después de liberar | Pendiente de autorización |
| A8 | Autorización formal para desplegar (C8) | Pendiente |
| A9 | Runners de módulos existentes sobre el código integrado: resolver o aceptar por escrito (B5) | Decisión pendiente |
| A10 | `compose.prod-temp.yaml` sin versionar: lo usa el despliegue real; confirmar su contenido el día de la ventana | Pendiente |
### B. Validaciones de negocio
| # | Validación | Quién | Estado |
|---|---|---|---|
| B1 | Aprobación visual de los **ocho PDF** con Carlito (sustituto métrico de Calibri) | Manufactura | Sin aprobar. Validación automática: 152 controles PASS; la fidelidad visual no está aprobada |
| B2 | **BIND real** mediante lectura autorizada (`comprobar-bind-real.cjs`, solo lectura, no ejecutado) | Sistemas + responsable de BIND | Sin ejecutar; hasta ahora solo simulador |
| B3 | Proceso **Generó / Revisó / Aprobó** con usuarios reales de Manufactura (roles ADMIN/GENERAL, firmas y autorizaciones) | Manufactura | Sin ejecutar con usuarios reales; validado con usuarios sintéticos |
| B4 | **Catálogo de clientes y abreviaturas**: clientes solo ADMIN; captura manual de cliente permitida (riesgo de calidad de datos aceptado y documentado) | Manufactura / Administración | Pendiente de revisar con datos reales |
| B5 | Runners pendientes (16 de 27 pasan; 11 no, por causas ajenas a la integración): `automations`, `security-phase6` (sesión GENERAL en ruta ADMIN, preexistente en `main`); `recent-activity` (fixture y cuerpo desfasado); `payment-notifications-reprocess-eligibility` (sin diagnosticar, preexistente); `payment-file-assignments` (fixtures ya usados); `payment-file-recovery` (requiere n8n de pruebas); `caterpillar-model`, `-execution-finalization`, `-remision-persistence`, `-completion-integrity` (obsoletos frente a la migración 015); `caterpillar-admission` (falta empresa de TEST). `caterpillar-cancellation.test-e2e` no ejecutado. **Audi no tiene runner propio.** | Responsables de Caterpillar, Pagos, Audi | **Resolver o aceptar por escrito**: no se afirma que esas funciones estén validadas por runner; el ensayo sí comprobó que v1.1.1 y la candidata apagada responden igual en los módulos existentes |
| B6 | Respaldos cifrados y procedimiento de tareas: ventana, custodio, estación | Operación | Ver A4, A5 |
### C. Puede esperar hasta después de producción
| # | Mejora |
|---|---|
| C1 | Corregir/actualizar los 11 runners desfasados y crear un runner de Audi |
| C2 | Mensaje en español para el rechazo de firmas de 2–3 MB («File too large») |
| C3 | Mensaje específico cuando falla la generación del PDF (hoy «Error interno del servidor») y señal de salud de Chromium |
| C4 | Que el trabajo de respaldo detecte por sí mismo la incoherencia bandera/política (hoy lo detectan readiness y la comprobación del custodio) |
| C5 | Promover la política de cierre de Manufactura a política por omisión y retirar la selección explícita |
| C6 | Permitir que `Deploy-DaubertHub.ps1` se ensaye de extremo a extremo fuera de PROD (constantes fijas) |
| C7 | Versionar `compose.prod-temp.yaml` o absorberlo en el compose principal |
| C8 | Calidad de datos del cliente capturado a mano (reporte de documentos con cliente no verificado) |

## 5. Control de cambios
- **Caterpillar**: 0 archivos con nombre de Caterpillar/025 en el delta contra `main`; 0 archivos bajo `n8n/`; 0 commits exclusivos de `feat/cat-safe-folio-recovery`, `fix/caterpillar-error-display`, `feat/caterpillar-remission-controls`, `release/hub-caterpillar-b2`, `release/hub-conjunto-pagos-caterpillar` o `ensayo/integracion-conjunta-pagos-caterpillar` en la rama.
- **Sin seguimiento y respaldos conservados**: `.opencode/`, los dos documentos de Caterpillar (SHA `71a8a956…`, `a824ee6e…`), el stash `payment-alias-pendiente`, la rama `backup/pre-merge-main-20261105`, el bundle, los 6 worktrees y los respaldos de PostgreSQL.
- **`scripts/backup/`**: 0 diferencias contra `main`, 0 cambios sin confirmar. Tareas programadas `Ready`, último resultado 0.
- **Migraciones y manifiesto**: 0 cambios en `database/` desde 6C.1; `MANIFIESTO COINCIDE con HEAD (77 archivos, base 16153a8)`; SHA-256 `dc6d1133a4be2d6bbeff4440d02053c28ee2b0e62a3096ed114433524f0971a2`.
- **Producción (solo lectura)**: `default.conf` `4d9dfea5…`, copia de la política `e86f4749…`, `/api/health` v1.1.1 `16153a8`. Los tres contenedores operativos muestran inicio 2026-11-10 19:10:55Z, 20 s después del arranque de Docker Desktop (19:10:35Z), con las mismas imágenes y 0 reinicios: reinicio de Docker en el equipo, no una acción de este trabajo.
- Versión `1.1.1`; `main` = `16153a8`; sin imágenes definitivas.

## 6. Hashes para el acta
| Elemento | SHA-256 |
|---|---|
| Manifiesto de `database/` | `dc6d1133a4be2d6bbeff4440d02053c28ee2b0e62a3096ed114433524f0971a2` |
| Política de cierre operativa (por omisión) | `e86f47494d87222122938c6b580cec465cecdf3835c037ce947f60f9e340068f` |
| Política de cierre de Manufactura | `dcadb58dc1cd8d124b383462e1390160155e3012d053b1e0fd021ef2f147bdd9` |
| `default.conf` original de PROD | `4d9dfea5f58cc2c0069f15b91e5406d62832806ff3e5a045fed48960499c0495` |
| `default.conf` nuevo (imagen de ensayo; el definitivo se toma del manifiesto de imágenes final) | `27c5b07cfbbf3ac3be7c25b65938dc7a22b756ab3dc615a595b778e80f427746` |
