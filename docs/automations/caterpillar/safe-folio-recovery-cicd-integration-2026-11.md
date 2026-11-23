# Recuperación de folios Caterpillar: integración preparatoria y próximo release

## Estado local verificado — 2026-11-13

PR #25, Draft, rama `feat/cat-safe-folio-recovery`. Consulta nueva de GitHub y
`git fetch origin`: HEAD publicado `3ed338d0654164ecb3148d409c09b64e6aea0690`,
`origin/main` `ccfe5a5690b0f5b25c99deb648fdf73e189aad43`.
Merge-base previo: `16153a8a7dda7c5845eae32be5a696f92c71c631`.
Merge local conservador: `9eb6575`; merge-base posterior: `ccfe5a5`.
Los nueve commits originales permanecen como ancestros, sin reescritura.

No había cambios versionados pendientes ni commits locales sin publicar. Los
30 archivos locales sin seguimiento no colisionaban con main: las propuestas de
PR anteriores, documento de fase 3 y herramientas phase3/phase4 se conservaron.
No se incorporan al PR; tampoco expedientes, esquemas privados ni convertidores.

Se incorporaron los diez commits de main desde la base: CI/release candidate,
planificador y deployment supervisado (Fases 1/2A/2B), documentación 3A–3E,
protección de main, pruebas de rollback manual y cambios de AppShell/copia de texto.
Las rutas modificadas por ambas ramas eran disjuntas: merge sin conflictos,
sin correcciones funcionales. El aviso de línea vacía al final de un expediente
importado ya existe en main; se conserva el archivo original.

## Qué se puede fusionar sin habilitar recuperación

El PR completo es integrable como **etapa preparatoria**, con API/Web, SQL,
contrato n8n y ensayos existentes. No incluye coordinador operativo ni un workflow
instalable. Los archivos SQL/n8n y el código Caterpillar quedan idénticos a
`3ed338d`; no se han vuelto a instalar ni activado.

- API: `CATERPILLAR_FOLIO_RECOVERY_TEST_ENABLED` ausente/false; solo admite
  recuperación en `daubert_hub_test`. Assessment apagado y POST rechazado antes
  de consultar SQL. La consulta ADMIN de recibos es TEST-only, de solo lectura y
  exige `canEmit=false`; sin 025 falla cerrada con 503.
- Web: `VITE_CAT_FOLIO_RECOVERY_TEST_ENABLED` ausente/false en el **build** oculta
  el panel; la API sigue siendo la frontera de autorización. Ningún cambio de
  variables se requiere para esta integración. No basta editar una variable
  runtime para cambiar un flag Vite compilado.
- PostgreSQL: `cat_recovery_test.settings.enabled=false`. 025 está instalada en
  TEST según el expediente previo; 026 pendiente. No se consultó el servidor
  compartido para actualizar ese estado en esta sesión. No hay migración al arrancar.
- n8n: parámetros de borrador con `CAT_RECOVERY_LIVE_E2E_NOT_APPROVED`; la
  recuperación bloquea antes de SQL, y conserva las ramas convencionales.

## Efecto real sobre CI/CD y decisión de alcance

`validate` y `release-plan` pueden aprobar el código preparatorio. Eso no elimina
el gate operativo. El clasificador vigente devuelve
**`REQUIERE_COORDINACION_MANUAL`**, `hubRequiresBuild=true`: antes de este documento
el delta contra main contiene 12 archivos Hub, 8 database, 2 n8n, 2 docs y 11
tools (grupo `other`, que también exige revisión). La documentación adicional no
cambia la decisión. El delta de un release real se calcula desde el SHA leído de
PROD, no desde `origin/main`: puede incluir más cambios y debe revisarse completo.

**Bloqueo previsto del deployment con un comando:**
`Invoke-DaubertRelease.ps1 -Plan/-Deploy` delega al gate que rechaza database/n8n,
sin opciones para exceptuarlos. No es un defecto del CI ni justifica modificarlo.
Los reconocimientos del script inferior significan *ya aplicado y verificado en
PROD*. No sirven para declarar «no aplica»: 025/026 son TEST-only y el JSON es
un borrador, no un workflow aplicado. No instalarlos en PROD ni reconocerlos
falsamente para pasar el gate. El bloqueo permanece en cada release cuyo delta
desde PROD todavía incluya esas rutas.

**Recomendación:** conservar #25 completo como evidencia preparatoria coherente;
antes de fusionar, el responsable del próximo release debe aceptar expresamente
el impacto en el gate y acordar el procedimiento manual del
[checklist vigente](../../operations/deployment-checklist.md), con inventario
explícito de los archivos TEST-only/draft que no se aplicarán en PROD. Esta nota
no autoriza ese deployment. Si el siguiente release debe usar exclusivamente el
orquestador de un comando, diferir la fusión completa y preparar, con autorización,
un cambio separado API/Web apagado. Tal separación exige revisar su delta y
dependencias; no se ha hecho ni reescrito el PR para producirla.

No basta separar el PR **después** de fusionarlo: el delta de PROD conservaría las
rutas bloqueantes. Tampoco pasar CI significa estar listo para activar recuperación.
Rollback automático sigue fuera del alcance.

## Validación local nueva del merge

Node `24.21.0`, npm `12.0.2`, Windows PowerShell `5.1.26100.9818`, Pester `3.4.0`.
Dependencias locales existentes; package/lock sin cambios. No se repitió `npm ci`.

| Comprobación | Resultado |
| --- | --- |
| `npm run typecheck` | API y Web PASS |
| `npm run lint` | API y Web PASS |
| `npm run build` | API y Web PASS; aviso Vite por chunk >500 kB |
| `npm run test:dev-guard` | 19/19 |
| Tests Node de `scripts/release/plan-release*.test.cjs` | 8/8 |
| `npm run test:api` | 2441/2441, 151 archivos; recuperación 15/15 |
| `npm run test:web` | 1270/1270, 90 archivos; AppShell 102, diálogo convencional 19, panel 8, transporte 6 |
| Pester `scripts/deploy/tests`, solo mocks | 238/238, cero omitidas; equivale al job `release-plan` |
| Cuarentena + rechazo de convertidor no aislado | 10/10 |
| Assert del borrador n8n | JSON válido; recuperación bloqueada; ambas ramas convencionales correctas |
| SQL/n8n frente a HEAD publicado | Diez archivos byte-idénticos, SHA-256 calculados |
| Código API/Caterpillar/Web, SQL, tools y lock frente a HEAD publicado | Sin cambios en las rutas de la funcionalidad |

API/Web se ejecutaron secuencialmente con `CI=true` y los DB_* ficticios del CI;
no se invocó el `npm run validate` raíz, que incluye runners de integración de BD.
El XML Pester queda fuera del repositorio, en
`%TEMP%\opencode\cat-integration-release-plan-tests.xml`.
Son equivalentes locales de las suites, no nuevas ejecuciones GitHub Actions.
El CI remoto anterior corresponde a `3ed338d`; el nuevo HEAD necesita los checks
remotos tras una publicación futura autorizada, incluida la instalación limpia Linux.

Se reutilizan como **evidencia histórica**, no pruebas ejecutadas en esta sesión,
los nueve escenarios PostgreSQL privados (025, defecto READY, 026 up/down/up,
ACL, concurrencia, fence y conservación de originales/contador) y los E2E privados
descritos en la propuesta auditada del PR. El merge no modifica ese SQL ni su
código consumidor. Revisión de 026: exige 025/fingerprint, propietario postgres,
base TEST, flag false y ausencia de PROCESANDO; preserva ACL e historial.
No se repitieron E2E ni se abrió PostgreSQL/n8n compartido.

## Secuencia posterior, con autorizaciones independientes

1. **Release API/Web apagado:** decidir antes de fusionar la ruta de deployment
   anterior; fijar versión/SHA, CI remoto verde, inventario desde el commit real de
   PROD y expediente GO/NO-GO. En la ventana futura, validar main limpio/sincronizado,
   anclas y postchecks con el procedimiento aprobado. Solo API/Web; no ejecutar
   025/026 ni importar el borrador. Verificar rechazo de recuperación en PROD y
   reproceso convencional. Recuperación por imágenes manual según el checklist;
   no revierte SQL ni libera solicitudes.
2. **PostgreSQL TEST:** revisar ticket/hashes de 025 instalada, estado disabled,
   permisos/fingerprints, ausencia de workers y solicitudes pendientes. No
   reinstalar 025. Para 026: autorización específica, respaldo inmediato, precheck,
   up, postcheck y evidencia; mantener false. Down de 026 restaura el cuerpo de 025,
   no borra historia ni resuelve custodia vencida. No es rollback de aplicación.
3. **Coordinador y n8n TEST:** trabajo futuro separado. Revisar identidad dedicada,
   diario durable, custodia física y no entrega; cada renovación exige reverificar
   archivos/hashes/inventario/salida vacía, no replay del hash antiguo. Preparar copia
   inactiva con transporte autenticado UUID/padre/SHA/snapshot;
   `worker_admission(uuid,text,bigint)` mantiene sus diez columnas, ownership,
   finalización, `can_emit=false` sin fallback y recibos tras respuesta perdida.
   Staging nuevo por hija; probar el workflow candidato exacto en sesión autorizada
   antes de cualquier activación. Las pruebas privadas no acreditan el cutover vivo.
4. **Activación futura en TEST:** solo tras coordinador/contrato/custodia aprobados,
   026 verificada, conciliación de solicitudes y plan de operación revisado. Un
   fence PREPARING/READY persiste aunque se apaguen flags; no borrar solicitudes
   ni prometer cancelación automática. Esta integración no activa ningún flag.
5. **Preparar producción de recuperación:** diseño y migraciones PROD separados,
   revisión PostgreSQL/permisos/contadores, custodia y entrega verificables,
   contrato n8n ejecutable y ensayos del candidato aprobado. Las guardas actuales
   rechazan PROD: cambiar solo flags nunca habilita recuperación productiva.

**Conclusión:** preparación local compatible y deshabilitada. La decisión de release
manual frente a diferir/separar alcance queda explícita antes de fusionar; la
habilitación operativa y la promoción productiva siguen pendientes.
