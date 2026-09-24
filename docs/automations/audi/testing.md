# Audi — Pruebas

## Qué hay en el repositorio

| Capa | Archivos | Cubre |
| --- | --- | --- |
| API (unitarias) | `audi-executions.controller.spec.ts`, `audi-executions.repository.spec.ts`, `audi-executions.service.spec.ts`, `audi-processing-status.spec.ts`, `remisiones-audi-activity.repository.spec.ts` | Historial de Audi del Hub y su mapeo de estados |
| API (integración con BD de TEST) | `automations.integration.runner.cjs`, `document-series-folio-adjustment.integration.runner.cjs` | Series y ajuste de folio (compartido con Caterpillar) |
| Frontend | `AudiRemissionsPage.test.tsx`, `audiExecutions.test.ts` | Página de historial |
| **Workflow n8n** | **Ninguna prueba automatizada** | El workflow sólo se prueba manualmente en TEST |

## Prueba manual en TEST (checklist)

> ⚠️ **TEST está detrás de PROD**: no contiene la selección de candidatos con PostgreSQL ni cubre esa lógica. Además usa el manejador de errores y los subworkflows **de PROD**: probar en TEST puede escribir logs de error en la carpeta de PROD. Tenerlo presente antes de correr pruebas destructivas.

Prerrequisitos: activar/ejecutar manualmente `Remisiones AUDI PRUEBAS`; credencial `Postgres pruebas`; Excel de ejemplo en `Pruebas\REMISIONES AUDI\00_ARCHIVOS A PROCESAR`.

| Caso | Esperado |
| --- | --- |
| Excel válido con 1–6 artículos | Documento, ejecución `COMPLETADA`, N remisiones `GENERADA` con folios consecutivos, N PDFs de remisión, un PDF de hojas de identificación con N hojas, log en `03_LOGS` |
| Mismo archivo otra vez | No genera nada (idempotencia) |
| Artículos de cantidad cero | Se excluyen; si todos son cero → error |
| Artículo en catálogo con formato tubos / bolsas / sin formato | Plantilla `Tubos` / `Bolsas` / fallback (`A15MEAW`, `A15MEAV` ⇒ tubos; resto ⇒ bolsas) |
| Catálogo vacío o ausente | Error antes de reservar folios |
| Empresa Audi ambigua | Error en `Validar cliente Audi PG` |
| Falla forzada tras crear ejecución | Log del manejador; ejecución `PROCESANDO` (ver [troubleshooting](troubleshooting.md#5-una-ejecución-queda-procesando)) |

## Validación de PDFs (manual)

1. Cada folio reservado tiene su PDF en `02_SALIDAS\REMISIONES` y su fila `GENERADA`.
2. Contenido acorde a la programación (cantidades, presentación "per roll/pack/bag").
3. Plantilla correcta (tubos vs bolsas).
4. Hojas de identificación: una por artículo, cantidad correcta.
5. Sin folios saltados o duplicados en la serie `REMISION_AUDI`.

## Promoción TEST → PROD

- [ ] Cambio probado en TEST **y reflejado en TEST y en PROD** (hoy no hay proceso que garantice paridad: ver [drift](../n8n-test-prod-drift.md#audi)).
- [ ] Constantes de entorno correctas (`BASE_HERRAMIENTA`, `BASE_CLIENTE_AUDI`, credencial PG).
- [ ] Subworkflows/manejador: el cambio afecta a **ambos** entornos; coordinar.
- [ ] Un solo workflow de Audi activo.
- [ ] Exportar, sanitizar y versionar ([n8n/README](../../../n8n/README.md)); actualizar esta documentación.
