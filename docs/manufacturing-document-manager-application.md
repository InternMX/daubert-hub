# Gestor documental de Hojas de Instrucción · capa de aplicación (TEST)

**Estado:** implementada y validada **solo contra instancias PostgreSQL desechables**. **No** está registrada en `AppModule`, **no** se ejecutó nada contra `daubert_hub_test` ni `daubert_global`, y no hay frontend todavía. Nada de esto es válido para producción.

Código: `apps/api/src/manufacturing-documents/` (módulo separado de `manufacturing-sheets`).

## Separación de responsabilidades
| Capa | Archivos | Qué hace |
|---|---|---|
| Documental | `documents.service.ts`, `documents.repository.ts`, `documents.controller.ts`, `documents.dto.ts`, `documents.spec-model.ts` | Borradores, versiones, responsables, revisiones, finalización, historial, nuevas revisiones. No compone hojas. |
| Puerto | `sheet-engine.port.ts` (`SheetEngine`) | **Único** contacto con la generación de hojas: `evaluar(...)` y `generarFinalizada(...)`. `SheetEngineAdapter` lo implementa con `SheetPreviewService`/`SheetPdfService` (que `ManufacturingSheetsModule` ahora **exporta**; es el único cambio en esa carpeta). Una prueba verifica que ningún otro archivo del módulo importa servicios de composición. |
| Generación | `manufacturing-sheets/**` | Sin cambios de lógica. |

## Identidad
`actorDeSolicitud(request)` construye el actor **solo** con `request.user` (puesto por `AuthGuard` desde una sesión activa) y el `requestId` generado por el servidor. Los DTO no tienen campos de actor, estado, revisión, huella ni fechas (el `ValidationPipe` global los rechaza con 400). El repositorio fija `app.user_id`, `app.user_email`, `app.request_id` y `app.origin` en cada transacción; los triggers de la base toman el actor de ahí e ignoran lo que llegue en columnas. Sin identidad la base no escribe (`42501`).

## Rutas (`/api/manufacturing-sheets/documents/…`, autenticadas; CSRF de origen en escrituras)
| Paso | Ruta | Notas |
|---|---|---|
| 1 | `POST drafts` · `GET open` · `GET revisions/:id` · `GET history?codigo=` | 201 / 409 `DOCUMENT_EXISTS` (con `borradorId` solo si es visible para quien consulta). Los borradores ajenos no se ven (404 / ausentes de las listas). |
| 2 | `PATCH revisions/:id` `{version, …}` · `POST revisions/:id/discard` | Bloqueo optimista: 409 `VERSION_CONFLICT` con `versionActual`. Cada sección enviada reemplaza a la guardada. |
| 3 | `elaboroNombre`, `elaboroConfirmado` en el `PATCH` | «Elaboró» nace sugerido (`displayName` de la sesión) y sin confirmar; cambiar el nombre retira la confirmación salvo que la misma petición confirme. |
| 4 | todas | Registrado/Modificado/Finalizado por = sesión (auditoría con usuario, correo y solicitud reales). |
| 5 | `GET reviewers` · `PUT revisions/:id/reviewer` · `POST revisions/:id/review` | La revisión la registra la **cuenta de la sesión** sobre la versión vista; la base fija usuario/nombre/huella. Vigente solo mientras no cambie lo técnico. Autorrevisión permitida con constancia. Se exige hoja completa, sin bloqueo ni contradicciones sin reconocer (huella recalculada en el servidor). |
| 6 | `POST revisions/:id/finalize` · `POST revisions/:id/cancel-finalization` | Protocolo A / render / B (abajo). |
| 7 | `GET history?codigo=` · `GET revisions/:id/pdf` | PDF verificado contra su SHA-256 antes de entregarse (si no coincide: 500 `PDF_INTEGRITY`, sin contenido). |
| 8 | `POST :documentId/revisions` | Borrador nuevo desde la última versión FINALIZADA; las anteriores no se tocan; una sola abierta por documento (409 `OPEN_DRAFT_EXISTS`); solo creador del documento o ADMIN (403). |

## Finalización
1. Sin escribir: permiso, versión, **Chrome disponible** (si no: 501 `PDF_NOT_AVAILABLE`, estado intacto), requisitos (`FINALIZACION_NO_LISTA` con motivos: Elaboró sin confirmar, cliente, hoja incompleta/bloqueada, incidencias sin reconocer).
2. Transacción A corta: `BORRADOR → FINALIZANDO` (la base reserva el número, congela el contenido y emite el token). Una segunda petición simultánea recibe 409.
3. Render fuera de transacción, **desde la copia guardada** (no desde datos del cliente).
4. Transacción B corta: PDF + contenido + `FINALIZANDO → FINALIZADA` con token y versión como predicados; la base verifica hash, tamaño, nombre y revisión.
5. Si falla el render o el registro: vuelve a `BORRADOR` (solo si el token sigue siendo el propio) y no queda ningún PDF. Una finalización abandonada se reclama pasados 10 minutos.

## Pruebas
| Comando | Qué ejecuta |
|---|---|
| `npm test` | Suite normal (incluye `manufacturing-documents.controller.spec.ts`, sin base de datos). Excluye `test/desechable/**`. |
| `npm run test:desechable` | Requiere Docker. Levanta un contenedor **temporal** `postgres:18-alpine` en `127.0.0.1:55434`, crea la réplica mínima, aplica el **UP real** de la migración y ejecuta 5 archivos (61 casos: borradores, versiones/Elaboró/actor, revisión y finalización, historial y nuevas revisiones, motor real con Chrome). Host, puerto y credenciales están fijos en `test/desechable/*`: no lee `DATABASE_*` ni `TEST_DATABASE_URL`, así que no puede conectarse a TEST ni a PROD. Elimina el contenedor al terminar. |

## Para activarlo (cuando se autorice la migración en `daubert_hub_test`)
1. El operador aplica `manufactura` (ver `database/migrations/daubert_hub_test/README.md`).
2. Registrar `ManufacturingDocumentsModule` en `AppModule`.
3. Verificar en TEST con el smoke de la migración y una prueba funcional acordada.
4. Construir el frontend (guardar/abrir/finalizar/historial) sobre estas rutas.

## Límites conocidos
- Ver «Riesgos residuales» del informe de aprobación (identidad por variables de sesión, FK hacia `security.users`/`core.empresas`, sin retención de PDF).
- `409 DOCUMENT_EXISTS` revela que existe un documento con ese código y variante aunque su borrador sea ajeno (sin identificarlo).
- La fecha impresa en el PDF usa la zona `America/Mexico_City`; la base guarda el instante.
- Un cliente “manual” es solo de TEST y queda marcado como no verificado.
