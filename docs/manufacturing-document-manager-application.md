# Gestor documental de Hojas de Instrucción · capa de aplicación (TEST)

**Estado:** implementada y validada **solo contra instancias PostgreSQL desechables**; el frontend está integrado y probado con servicios simulados (apagado por defecto). **No** está registrada en `AppModule`, **no** se ejecutó nada contra `daubert_hub_test` ni `daubert_global`. Nada de esto es válido para producción.

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

## Resultados de validación (2026-10-30; apertura sin BIND verificada, sin tocar TEST ni producción)
| Verificación | Resultado |
|---|---|
| Typecheck, lint, build (API y Web) | Sin errores |
| Web completa | 96 archivos / 1 494 pruebas en verde (incluye las del gestor: apertura sin BIND, BIND caído, valores históricos, solo lectura, respuestas tardías, permisos) |
| API completa, `--no-file-parallelism` | 141 archivos / 2 089 pruebas en verde |
| `npm run test:desechable` (contenedor temporal) | 65 pruebas en verde, 1 omitida |
| Regresiones documentales (`test:sheets-*`) | Todas OK **salvo** `test:sheets-regression` (CONFPMG04), que falla por desplazamientos verticales de ~2 pt en las palabras del encabezado; se reporta aparte y no se tocó. `test:sheets-common` informa el caso de estrés de 2 páginas como límite detectado (no es fallo) |
| `ECONNRESET` intermitente (`read ECONNRESET` en el primer `supertest` de un archivo, p. ej. `sheet-preview.spec.ts` o `families-preview.spec.ts`) | Aparece solo al ejecutar los archivos **en paralelo** (3 de 3 corridas completas, y con 4 trabajadores) y en un archivo distinto cada vez; con `--no-file-parallelism` la suite pasa completa y cada archivo aislado pasa. Se atribuye a la carga de conexiones locales en paralelo (Node 24 / Windows), no a este cambio (los archivos afectados no importan el gestor documental). No se modificaron timeouts ni infraestructura; queda pendiente de análisis |
| Web: tiempos de 5 s en `ProviderForm*` | Dos pruebas de proveedores agotaron el tiempo por defecto en una corrida completa con otra carga concurrente; pasan al repetir la suite web sola |

## Para activarlo (cuando se autorice la migración en `daubert_hub_test`)
1. El operador aplica `manufactura` (ver `database/migrations/daubert_hub_test/README.md`).
2. Registrar `ManufacturingDocumentsModule` en `AppModule`.
3. Verificar en TEST con el smoke de la migración y una prueba funcional acordada.
4. Encender el panel en el build web con `VITE_MANUFACTURING_DOCUMENTS=true` (apagado por defecto; sin esa variable la página de especificación conserva su comportamiento anterior, solo en memoria).

## Frontend (integrado en la página de especificación)
Archivos: `services/manufacturingDocuments.ts` (cliente HTTP y errores), `manufacturing/documentSpec.ts` (empaquetar el formulario y reabrir un guardado), `DocumentPanel.tsx`, `DocumentHistoryDialog.tsx`, `documentLabels.ts`, `downloadFile.ts`; la página los usa solo cuando `DOCUMENTOS_ACTIVOS` (o la prop `documentos`) es verdadero.

- **Abrir un documento NO consulta BIND.** El formulario se reconstruye con el motor de especificaciones (`buildInitialForm`) sobre una copia de BIND tomada del propio documento (`especificacion.bind`: Code, Title, Description, Weight, CreationDate) y encima se colocan los valores **guardados**, que mandan: familia, dimensiones, unidades, calibre literal, composición, cantidades, peso y cálculos COEX no se recalculan ni se sobrescriben con sugerencias. Cada campo recupera su procedencia guardada (BIND, sugerido, calculado, usuario). Un color personalizado se recupera del propio documento (nombre y HEX), **sin depender de `localStorage`**. Abrir no llama a ningún endpoint de escritura: la versión documental solo cambia cuando el usuario guarda, y «Elaboró» no se confirma automáticamente.
- **Consulta opcional a BIND:** el botón «Consultar BIND ahora (solo lectura)» consulta los datos actuales y muestra Title/Weight y si difieren de la copia guardada. No modifica el formulario ni el borrador, no marca la hoja como modificada y, si BIND no responde, solo muestra el error. Un **comparador completo** (diferencias campo por campo y aplicación selectiva) queda como **pendiente**.
- **Solo lectura:** una revisión finalizada, un documento en finalización o un borrador que esta cuenta no puede editar (según los `permisos` del servidor) se abre con el formulario deshabilitado (`fieldset disabled`); el servidor sigue siendo la autoridad.
- **Sin reinterpretación al abrir:** como no hay interpretación de BIND, las incidencias que dependen de ella (contradicciones título↔código) no se recalculan en el navegador al abrir sin BIND; los reconocimientos guardados (`{id, huella}`) se conservan tal cual y nunca se reconocen contradicciones nuevas automáticamente. El servidor recalcula la huella al revisar y al finalizar.
- **Respuestas tardías:** solo la solicitud más reciente del panel puede reemplazar el documento abierto; la lectura de BIND anterior se aborta al abrir otro documento.
- **Permisos:** los botones se habilitan según los `permisos` que devuelve el backend, pero ocultar o deshabilitar un control **no es autorización**: la base y el servicio vuelven a validar cada acción.
- **Errores:** conflicto de versión (409) ofrece recargar la versión vigente; los requisitos de finalización se listan; ningún cuerpo crudo de respuesta se muestra.

## Límites conocidos
- **Abrir sin BIND (resuelto):** los borradores se abren desde la copia guardada en PostgreSQL aunque BIND no responda. Para crear un borrador **nuevo** sigue haciendo falta consultar BIND por el código. Si el documento se guardó sin `bind`, se abre con el Code del documento y Title vacío.
- Tras descartar el único borrador de un documento, su creador (o un ADMIN) puede abrir otro en el **mismo** documento; otra cuenta sigue recibiendo el 409 uniforme.
- Ver «Riesgos residuales» del informe de aprobación (identidad por variables de sesión, FK hacia `security.users`/`core.empresas`, sin retención de PDF).
- `409 DOCUMENT_EXISTS` revela que existe un documento con ese código y variante aunque su borrador sea ajeno (sin identificarlo).
- La fecha impresa en el PDF usa la zona `America/Mexico_City`; la base guarda el instante.
- Un cliente “manual” es solo de TEST y queda marcado como no verificado.
