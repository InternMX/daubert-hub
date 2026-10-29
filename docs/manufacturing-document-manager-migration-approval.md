# Informe de aprobación de migración · `manufactura` (TEST) — revisión 2

**Veredicto:** los cuatro scripts (más smoke e inventario) están **listos para su revisión y autorización**. **No se aplicó nada** a `daubert_hub_test` ni a ninguna base real. Toda la validación se hizo en instancias PostgreSQL 18 desechables (ya eliminadas).

## 1. Qué cambió respecto a la entrega `ea4e6f9` (y por qué)
| Cambio | Motivo |
|---|---|
| La huella de la revisión cubre **familia + especificación** (`fn_hash_revision`) | «Cualquier modificación técnica invalida la revisión»: antes un cambio de familia no cambiaba la huella. |
| **Revisión prevista** (`revision_prevista`) reservada al pasar a `FINALIZANDO`; el PDF imprime ese número y la base exige que el nombre del archivo sea `CODIGO[-VARIANTE]_REVNN.pdf` (`fn_nombre_pdf`) | El PDF debe saber su número antes de renderizarse. Es exacto porque solo existe **una** revisión abierta por documento; se revalida al finalizar. |
| **RLS** (11 políticas) + comprobaciones en triggers | Permisos aplicados también en la base: borradores visibles solo para creador, revisor asignado y ADMIN; finalizadas para todos; solo creador/ADMIN modifican, finalizan o asignan revisor; solo el creador del documento (o ADMIN) agrega revisiones. |
| **Autorrevisión con constancia** (`es_autorrevision`, `como_revisor_asignado`) y revisor = usuario ACTIVO | Decisión 3 y 6. |
| `elaboro_confirmado` obligatorio para finalizar (CHECK) | Decisión 1. |
| `entorno_emision = 'PRUEBA'` (CHECK) | Constancia permanente de que nada de este esquema es válido para producción. |
| DOWN **idempotente**, con **doble confirmación** si hay finalizadas/PDF, y que informa lo que se perdería | Seguridad con datos existentes. |
| **Defecto corregido:** el DOWN fallaba (`policy pol_documentos_sel … depends on revisiones`) | Lo detectó la validación; ahora retira primero esa política. |
| Chrome obligatorio para finalizar (componente `generarFinalizada`) | Decisión 6 (ver §6). |

## 2. Revisión final por tema
| Tema | Cómo se garantiza | Evidencia |
|---|---|---|
| **Base TEST inequívoca** | Cada script (UP, precheck, postcheck, DOWN, smoke) aborta si `current_database() <> 'daubert_hub_test'`; imprime `base_actual`; el UP exige administrador y que el rol de la app no sea superusuario/`BYPASSRLS`. | UP, precheck, DOWN y smoke abortan en una base de otro nombre y esa base no recibe ningún objeto. |
| **Privilegios y propiedad** | Esquema y objetos del administrador; `REVOKE ALL … FROM PUBLIC` en esquema, tablas, secuencias y funciones; la app: `SELECT/INSERT` (+ `UPDATE` solo en `revisiones`), sin `DELETE/TRUNCATE`, sin `CREATE`; `sin SECURITY DEFINER`. | Postcheck: 33 comprobaciones (matriz exacta, `PUBLIC` sin privilegios, otros roles sin acceso, mismo dueño, 12 funciones, RLS en 5 tablas). |
| **Auditoría e identidad** | Actor tomado de `app.user_id/app.user_email` por triggers (se ignora lo que envíe el cliente; sin identidad no se escribe); `audit.fn_registrar_cambio` reutilizada en 4 tablas; los bytes del PDF van en tabla aparte, no auditada. | Smoke: actor = sesión aunque se envíe otro, ≥ 10 filas en `audit.cambios` con usuario y request reales, finalización auditada, sin bytes en `audit.cambios`. |
| **Inmutabilidad** | Trigger `BEFORE UPDATE/DELETE` (revisiones FINALIZADA/DESCARTADA, `pdfs`, `pdf_contenidos`, confirmaciones, documentos) + sin privilegio de `DELETE`; PDF solo en `FINALIZANDO`, con huella de la especificación y hash/tamaño verificados **por la base**; una revisión no puede finalizarse sin PDF íntegro. | Smoke: UPDATE/DELETE rechazados, contenido adulterado rechazado, PDF de otra especificación rechazado, sin PDF huérfano tras un intento fallido. |
| **Aislamiento de permisos** | RLS + triggers. | Smoke con 3 identidades: GENERAL no ve borradores ajenos ni el documento; el revisor asignado ve pero no modifica (0 filas); un tercero no se asigna como revisor; GENERAL no crea revisiones de documentos ajenos; ADMIN sí; finalizadas visibles para todos. Harness: consulta directa sin identidad no devuelve borradores. |
| **Numeración concurrente** | Un solo borrador/`FINALIZANDO` por documento (índice único parcial); candado `pg_advisory_xact_lock` por documento; `UNIQUE (documento_id, revision)` como red de seguridad. | Doble «nueva revisión» simultánea: solo una nace (23505); dos variantes del mismo código finalizadas a la vez reciben cada una REV01; la segunda finalización recibe REV02. |
| **`FINALIZANDO` abandonada** | Reclamable pasados 10 min (token nuevo; contenido congelado; misma revisión prevista); el proceso original con token viejo ya no finaliza; cancelar es idempotente; no se vuelve a borrador con PDF registrado. | Harness: reclamo < 10 min rechazado (55P03), reclamo de un ADMIN tras 11 min OK, original 0 filas, carrera por el mismo PDF sin duplicado (un solo PDF por revisión), segunda cancelación = 0 filas. |
| **DOWN con datos** | `confirmar_borrado`; con finalizadas/PDF además `confirmar_finalizadas`; imprime filas y bytes; `audit.cambios` se conserva; sin `CASCADE`. | Harness: sin confirmación aborta e informa («6 documentos, 304 FINALIZADAS, 304 PDF, 30 720 086 bytes»); con una sola confirmación aborta; con ambas elimina. |
| **Idempotencia de recuperación** | DOWN con `IF EXISTS` y no-op si el esquema no existe; UP aborta si existe y es transaccional. | DOWN repetido sin error; UP repetido aborta; ciclo UP→DOWN→UP y DOWN sin datos funcionan. |
| **Pruebas negativas** | — | Otra base (4 scripts), UP con rol de la aplicación, UP repetido: abortan sin escribir. |
| **Crecimiento y respaldo de PDF** | `bytea` con `STORAGE EXTERNAL` (sin recompresión), tope 5 MB, tabla aparte. | Medición con 300 PDF **incompresibles** de 100 KB (peor caso, 29 MB): tabla de contenidos 30.9 MB (1.055×), revisiones 296 KB, metadatos 120 KB, `pg_dump -n manufactura` 33.5 MB. Los PDF reales de las hojas pesan ~100 KB (97–107 KB): 1 000 finalizaciones/año ≈ 100 MB/año. |

## 3. Riesgos residuales (honestos)
1. **La identidad de la base depende de que la API fije `app.user_id`/`app.user_email` desde la sesión.** El rol de la app puede ejecutar `set_config`; un código malicioso o con errores en la API podría fijar otro id. Mitigaciones: ningún dato de identidad viene del frontend (DTO estricto), la identidad es la de la sesión validada en cada petición, todo queda en auditoría y el diseño falla **cerrado** (sin identidad: sin filas y sin escrituras). No hay forma de eliminarlo sin un rol por usuario.
2. **No se probó contra la base TEST real** (por instrucción): se usó una réplica mínima. Riesgo de diferencias con restricciones, triggers o datos reales de `security.users`/`core.empresas`. El precheck/postcheck/smoke existen precisamente para comprobarlo en TEST; el smoke exige ≥ 1 ADMIN y ≥ 2 GENERAL activos (TEST tiene 2 y 45).
3. **PUBLIC conserva `CONNECT`** sobre `daubert_global` y `daubert_hub_test` (inventario hecho; ningún cambio aplicado). Un `REVOKE` aislado cortaría a producción y a `n8n_cat_test`: hay que conceder antes (ver §5).
4. **CHECK de credenciales por expresión regular**: rechaza textos que contengan `token`, `password`, `secret`, `authorization`, `bearer`, `api key`… aunque sean legítimos. Es deliberado (defensa en profundidad); la API debe validar antes y mostrar el error. Se puede relajar con una migración.
5. **Huella con `jsonb::text`**: estable dentro de una versión mayor de PostgreSQL; tras una actualización mayor podría cambiar el formato. La integridad del PDF no depende de ella (usa el SHA-256 de los bytes), y la huella solo se recalcula al editar un borrador.
6. **Constantes fijas en las funciones**: 10 minutos de reclamo, 64 KB de especificación, 5 MB de PDF, 20 caracteres de formato. Cambiarlas exige migración.
7. **Crecimiento sin política de retención**: los PDF no se purgan (`DESCARTADA` y finalizadas permanecen). Para producción conviene decidir almacenamiento de objetos o archivado; para TEST el volumen es pequeño.
8. **Validación en PostgreSQL 18 alpine desechable**; TEST es 18.4. Mismas versiones mayores, pero la instancia real puede tener otra configuración regional (el `lower()` de las claves de código/variante es insensible a ella para ASCII).
9. **Numeración `101` y ubicación** de scripts provisionales: las migraciones TEST viven fuera del repo; el operador debe ubicarlas en su serie.
10. **Chrome no es parte de la base**: finalizar requiere Chrome en el equipo de la API (obligatorio por decisión); sin él, la API no inicia la finalización.

## 4. Pruebas ejecutadas
| Prueba | Resultado |
|---|---|
| `tools/validar-en-instancia-desechable.cjs` (PG 18 desechable) | **36/36** |
| …de ellas: postcheck | 33 comprobaciones en `t` |
| …de ellas: smoke con el rol de la app (3 identidades) | **49/49** |
| Inventario `CONNECT` (`inventario_connect.readonly.sql`) validado en instancia desechable | sintaxis y secciones correctas (sin cambios) |
| API: capa y PDF finalizados (`sheet-pdf-finalizada.spec.ts`) + borrador (`sheet-pdf.spec.ts`) | 37/37 (3 corridas seguidas; incluye Chrome real) |
| Contenedores desechables | eliminados (0 restantes); contenedores productivos y n8n intactos |

## 5. Instrucciones del operador (cuando se autorice)
**No incluya contraseñas**: use `pgpass`/`PGPASSWORD` de la sesión. Directorio de trabajo: la copia de `database/migrations/daubert_hub_test/` (o `Entregables\Fase5_Gestor_Documental\Migracion_TEST_rev2\`).

0. **Verifique la integridad** (sha256 de los archivos tal como se entregan):
   ```text
   6b3ccdd8e29ba15952ebb09ac5f3b6ff4ddbfb9808f1701e8a0d984cd74e36e2  20261030_101_manufactura_gestor_documental_test.down.sql
   be64c869a44fd41337b4954876f50895867b0a608b8f4fda2e326073185425b7  20261030_101_manufactura_gestor_documental_test.postcheck.sql
   3bec5e7e6ba1506d2e8d35f26cb6263a3a12fd8208beb782d1383f380b3f396c  20261030_101_manufactura_gestor_documental_test.precheck.sql
   2b38e19ead0ab47c5bc55c9d643f40194700a04253ebb50ea871fb20c61575b7  20261030_101_manufactura_gestor_documental_test.smoke.sql
   1e4bcf505e5820a60f72e14359327d6dd5bab0bdd341a24c68f4aced43fe9f79  20261030_101_manufactura_gestor_documental_test.up.sql
   435a3c550521deceb46a8ae70391640889b6f85d2ec75fa8f379c836943732e2  inventario_connect.readonly.sql
   ```
   (Calculados sobre los archivos con fin de línea LF. Si Git los convierte a CRLF al extraerlos, verifique con la copia de `Entregables`.)
1. **Respaldo:** `pg_dump -h localhost -p 5432 -U postgres -d daubert_hub_test -F c -f daubert_hub_test_antes_manufactura.dump` y confirme que el archivo existe y no está vacío.
2. **Precheck** (anote la línea base):
   `psql -h localhost -p 5432 -d daubert_hub_test -U postgres -X -w -v ON_ERROR_STOP=1 -f 20261030_101_manufactura_gestor_documental_test.precheck.sql`
   Esperado: `base_actual = daubert_hub_test`, `all_prechecks_pass = t`.
3. **UP:** `psql … -f 20261030_101_manufactura_gestor_documental_test.up.sql` → `UP_OK … COMMIT`.
4. **Postcheck:** `psql … -v baseline_users=<n> -v baseline_empresas=<n> -v baseline_audit_cambios=<n> -v baseline_tablas_fp=<md5> -v baseline_funciones_fp=<md5> -f …postcheck.sql` → todo `t`.
5. **Smoke (opcional, sin dejar datos):** `psql -h localhost -p 5432 -d daubert_hub_test -U daubert_hub_test_user -X -w -v ON_ERROR_STOP=1 -f …smoke.sql` → `smoke_all_pass = t`, 49 pruebas.
6. **Envíe** las salidas (sin contraseñas) para el cierre.
7. **Si debe revertir:** respaldo `pg_dump -n manufactura …`; después `…down.sql` (con las confirmaciones que pida).
8. **Inventario `CONNECT` (autorizado, lectura):** `psql -h localhost -p 5432 -d postgres -U postgres -X -w -v ON_ERROR_STOP=1 -f inventario_connect.readonly.sql > inventario_connect.txt`. **No** ejecute `GRANT`/`REVOKE` hasta nueva autorización; la recomendación de endurecimiento (conceder `CONNECT` explícito a `daubert_hub_app`, `n8n_app`, `n8n_cat_prod` y `n8n_cat_test`, y solo entonces revocar a `PUBLIC`) está en `docs/manufacturing-document-manager-design.md` §6.

## 6. Componentes preparados (aislados; **sin tocar la base real ni la aplicación en ejecución**)
| Componente | Estado |
|---|---|
| Capa del PDF finalizado `aplicarCapaFinalizada` («PRUEBA · NO VÁLIDO PARA PRODUCCIÓN», revisión, fecha, huella, Elaboró/Revisó/Autorizó escapados, «Firmas: SIN FIRMA»; sin «BORRADOR» ni «APROBADA») | Hecho + pruebas |
| `nombreArchivoFinalizado` (`CODIGO-VARIANTE_REVNN.pdf`), idéntico a `fn_nombre_pdf` | Hecho + pruebas (mismos ejemplos que el smoke) |
| `SheetPdfService.generarFinalizada`: **Chrome obligatorio** (501 sin Chrome, antes de componer ni renderizar), desde la copia registrada, 422 si incompleto/bloqueado, título = código DCMX | Hecho + pruebas (con Chrome real y simulado) |
| Evidencia: 3 PDF finalizados de ejemplo (Bolsa Plana REV01, COEX Verde REV03 con «Revisó», Hojas Extendida REV02) | `Entregables\Fase5_Gestor_Documental\PDF_finalizado_TEST\` — Carta, 1 página, título = código, «PRUEBA…» arriba, sin «BORRADOR»/«APROBADA», 3 × «SIN FIRMA» |
| Repositorio/servicio/endpoints de documentos, frontend (guardar/abrir/finalizar/historial) | **No iniciados**: dependen de las tablas; se construirán contra una instancia desechable una vez autorizada la migración |
