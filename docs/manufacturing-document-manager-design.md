# Gestor documental de Hojas de Manufactura · diseño revisado (Etapa B, TEST)

Estado: **diseño + scripts de migración entregados; migración NO aplicada.** Sustituye y completa la Etapa A. Decisiones del responsable incorporadas (1–10). Scripts: `database/migrations/daubert_hub_test/` (ver su `README.md`: procedimiento, alcance de escrituras y recuperación).

## 1. Un código DCMX puede tener varias hojas (análisis y regla)
Hechos del prototipo: el mismo código `HOJA48` se usa para **Hojas doblada** y **Hojas extendida**; un producto puede requerir otra etiqueta, otro cliente o una variante gráfica; COEX Azul/Verde son códigos distintos. Imponer «una hoja por código» obligaría a sobrescribir o a mezclar variantes en una sola línea de revisiones.

**Regla adoptada:** `manufactura.documentos` es una *línea de revisiones* con identificador interno estable (`documento_id`, `public_id` UUID para la API) y es única por **(código DCMX sin distinguir mayúsculas, variante)**. `variante` es opcional (≤ 40 caracteres; vacía = hoja principal). Un código puede tener tantas variantes como se necesite; dentro de cada variante las revisiones son correlativas (REV01, REV02…). La interfaz avisa si ya existe una hoja para ese código antes de crear otra variante.
Integridad: FK `(documento_id, basada_en_revision_id)` → una revisión solo puede basarse en una versión **finalizada del mismo documento**; `UNIQUE (documento_id, revision)`; un solo borrador/finalización abierta por documento (índice único parcial).

## 2. Modelo de datos (esquema `manufactura`)
| Tabla | Contenido | Mutabilidad |
|---|---|---|
| `documentos` | `documento_id`, `public_id`, `codigo_dcmx`, `variante`, creador | inmutable (solo INSERT) |
| `revisiones` | estado (`BORRADOR`/`FINALIZANDO`/`FINALIZADA`/`DESCARTADA`), `version` (bloqueo optimista), `revision` (se asigna al finalizar), `familia`, **copia de la especificación** (`jsonb` ≤ 64 KB) + `especificacion_sha256` (calculado por la base), `elaboro_nombre` + `elaboro_confirmado`, `autorizo_nombre`, `revisor_usuario_id`, cliente (`cliente_empresa_id` opcional, `cliente_nombre`, `cliente_verificado`), `basada_en_revision_id`, actores y fechas (creó, modificó, inició y completó la finalización) | borrador editable; `FINALIZADA`/`DESCARTADA` inmutables (trigger) |
| `pdfs` | metadatos del PDF finalizado: `pdf_sha256`, bytes, `especificacion_sha256` de la que procede, nombre de archivo, actor | inmutable |
| `pdf_contenidos` | los bytes (`bytea`, ≤ 5 MB) en tabla aparte para no copiarlos a `audit.cambios` | inmutable; la base verifica `sha256(contenido) = pdf_sha256` al insertar |
| `confirmaciones_revision` | acción autenticada «Revisó»: usuario, `display_name` en ese momento, **versión y hash revisados** | solo INSERT |

- **Copia de la especificación:** campos del formulario, procedencia por campo (BIND/sugerido/calculado/usuario, manual/confirmado), color personalizado (nombre + HEX), incidencias reconocidas (id + huella) y **solo 6 campos de BIND** (`Code, Title, Description, Weight, CreationDate`; sin ID, costos ni credenciales). La base rechaza (CHECK) cualquier copia que contenga `authorization`, `bearer`, `api key`, `password`, `secret` o `token`.
- **Cliente:** en TEST puede vincularse a `core.empresas` (cliente activo) → `cliente_verificado = true`, o capturarse manualmente → `cliente_verificado = false`. Un cliente no verificado **no** habilitará emisión productiva (la etapa futura deberá exigir `cliente_verificado`).
- **Elaboró / Revisó / Autorizó:** *Elaboró* = nombre impreso sugerido desde `display_name` de la sesión, editable, `elaboro_confirmado = false` hasta que el usuario lo confirme (finalizar exige confirmado). *Revisó* **no es un campo de texto**: existe solo si hay una fila en `confirmaciones_revision` vinculada a la versión y hash vigentes (cualquier edición posterior la deja desactualizada); el nombre impreso es el `display_name` de quien la registró. *Autorizó* = texto opcional sin flujo.
- **Actores:** `creado_por`, `actualizado_por`, `finalizando_por`, `finalizado_por`, `generado_por` los fija un trigger desde `app.user_id` / `app.user_email` (los mismos valores que la API toma de la sesión autenticada y que ya usa `audit.fn_registrar_cambio`). Lo que envíe el cliente en esas columnas se **ignora**; sin identidad de sesión no se escribe (probado en el smoke).

## 3. Permisos (aplicados en el backend; React solo refleja)
| Acción | ADMIN | GENERAL |
|---|---|---|
| Crear borrador | sí | sí |
| Ver borradores | todos | los propios y aquellos donde es revisor asignado |
| Editar borrador | cualquiera | solo los propios |
| Asignar revisor / descartar borrador | cualquiera | solo los propios |
| Registrar su revisión («Revisó») | sí | si es el revisor asignado o el creador (no se exige otra persona); **no modifica datos técnicos** |
| Finalizar | cualquiera | solo los propios |
| Nueva revisión desde una finalizada | cualquiera | solo de documentos propios (creador del documento) |
| Consultar/descargar finalizadas e historial | sí | sí (todos los autenticados) |

«Propio» = creador de la revisión/documento (de la sesión). Los borradores ajenos devuelven 404 (no se revela su existencia). El rol de BD solo tiene `SELECT/INSERT/UPDATE` (sin `DELETE`) y el trigger limita el UPDATE a borradores.

## 4. Finalización sin bloqueos largos y atómica
Protocolo (el renderizado de Chrome **no** ocurre dentro de una transacción ni con bloqueos):
1. **Tx corta A:** validar en servidor (familia, datos técnicos completos con el mismo `SheetPreviewService`, `elaboro` confirmado, cliente identificado, contradicciones reconocidas por huella, confirmación expresa, versión esperada) → `UPDATE … SET estado='FINALIZANDO' WHERE estado='BORRADOR' AND version=$v`. La base genera `finalizando_token` y congela el contenido. Un segundo intento concurrente no actualiza ninguna fila → **409**.
2. **Sin transacción:** regenerar el PDF **desde la copia guardada** (no desde datos del cliente) con el modo «finalizada de TEST» y calcular su SHA-256.
3. **Tx corta B:** `INSERT pdfs` → `INSERT pdf_contenidos` (la base verifica hash y tamaño) → `UPDATE … SET estado='FINALIZADA' WHERE estado='FINALIZANDO' AND finalizando_token=$t AND version=$v`. El trigger verifica de nuevo estado, versión, que el PDF procede del mismo `especificacion_sha256` y que está íntegro, asigna `revision = máx + 1` (serializado por documento) y estampa quién y cuándo. Revisión, PDF y hash se confirman **en la misma transacción**: nunca queda una revisión finalizada sin documento.
4. **Si el renderizado falla:** se devuelve la revisión a `BORRADOR` (token anulado) y se informa; si el proceso cae a mitad, la revisión queda en `FINALIZANDO` y otra petición puede **reclamarla pasados 10 minutos**; mientras tanto el contenido está congelado.

PDF finalizado (modo TEST): franja «**PRUEBA · NO VÁLIDO PARA PRODUCCIÓN**» (sin «BORRADOR · SIN APROBAR», sin «APROBADA»), pie con «Revisión NN · Finalizada en TEST», hash de la especificación y, como texto, Elaboró y —si existe— Revisó y Autorizó; firmas siguen «SIN FIRMA» (sin escaneos). La capa va en el mecanismo de composición existente, sin tocar plantillas. **Nombres:** borrador `<CODIGO>.pdf`; finalizada `<CODIGO>_REV01.pdf`, `_REV02.pdf`… (con variante: `<CODIGO>-<VARIANTE>_REV01.pdf`, para que dos variantes no choquen). **Título de metadatos:** el código DCMX (sin necesidad técnica que lo impida; la revisión se distingue en el nombre).

## 5. Auditoría
Se reutiliza `audit.fn_registrar_cambio` (usuario y `request_id` de la sesión, antes/después en JSONB) con triggers en `documentos`, `revisiones`, `pdfs` y `confirmaciones_revision`. El contenido binario **no** se audita (tabla aparte; el INSERT de `pdfs` ya registra hash, tamaño y actor). Verificado en la instancia desechable: filas en `audit.cambios` con el usuario y request reales y ausencia de bytes de PDF. El catálogo de la pantalla de Auditoría (`audit-catalog.ts`) es una lista blanca: las entidades nuevas no aparecerán allí hasta que se agreguen deliberadamente.

## 6. Hallazgo de aislamiento: `CONNECT` sobre `daubert_global` (confirmado) y recomendación
**Confirmado (solo catálogo; no me conecté a `daubert_global`):**
| Base | ACL | Lectura |
|---|---|---|
| `daubert_global` | `{=Tc/postgres, postgres=CTc/postgres, daubert_docs_ro=c, daubert_backup=c}` | **`PUBLIC` tiene `CONNECT` y `TEMP`** → `daubert_hub_test_user` entra por ahí. `daubert_hub_app`, `n8n_app` y `n8n_cat_prod` no tienen concesión explícita: **también dependen de `PUBLIC`**. |
| `daubert_hub_test` | `{=Tc, postgres, daubert_hub_test_user=c, daubert_docs_ro=c, n8n_app_test=c}` | `PUBLIC` tiene `CONNECT`; `n8n_cat_test` (usado por `TEST_DATABASE_URL_N8N_CAT_TEST`) depende de `PUBLIC`; los roles de producción también pueden entrar a TEST. |
| `daubert_global_restore_test` | ACL por defecto (`PUBLIC`) | igual |

Consecuencias: (1) un `REVOKE CONNECT … FROM daubert_hub_test_user` **no sirve** (el acceso viene de `PUBLIC`); (2) un `REVOKE … FROM PUBLIC` **sin concesiones previas cortaría a producción** (`daubert_hub_app`, `n8n_app`, `n8n_cat_prod`) y a `n8n_cat_test`. Lo que el rol de TEST puede hacer *dentro* de `daubert_global` (privilegios de tablas) **no se verificó**: requiere conectarse y no lo hago.

**Recomendación (NO ejecutada; requiere autorización del operador y ventana):**
1. *Inventario previo* (operador): confirmar con `pg_stat_activity`/registros de conexión qué roles y herramientas se conectan a cada base (los roles de `postgres`/superusuario no se ven afectados).
2. *Concesiones explícitas:* `GRANT CONNECT ON DATABASE daubert_global TO daubert_hub_app, n8n_app, n8n_cat_prod;` y `GRANT CONNECT ON DATABASE daubert_hub_test TO n8n_cat_test;` (más cualquier rol que el inventario revele). Verificar que cada servicio sigue conectando.
3. *Endurecimiento:* `REVOKE CONNECT, TEMPORARY ON DATABASE daubert_global FROM PUBLIC;` y, como aislamiento inverso, lo mismo sobre `daubert_hub_test`.
4. *Verificación:* `daubert_hub_test_user` → `daubert_global` debe fallar (`permission denied for database`); la API de producción, n8n y los respaldos siguen operando; `/api/health` correcto en ambos entornos. Las conexiones abiertas no se cierran con un REVOKE.
5. *Reversión inmediata:* `GRANT CONNECT, TEMPORARY ON DATABASE … TO PUBLIC;`.
6. *Defensa adicional opcional:* regla `reject` en `pg_hba.conf` para `daubert_hub_test_user` → `daubert_global`.

## 7. Plan de implementación tras la autorización
1. Aplicación de la migración por el operador y confirmación del postcheck.
2. Repositorio/servicio de borradores (+ pruebas de integración contra TEST con `assertTestDatabaseUrl`).
3. Responsables, revisor y confirmación de revisión.
4. Finalización (protocolo de la sección 4) y PDF de TEST.
5. Revisiones e historial; descarga con verificación de hash.
6. Interfaz (guardar/abrir/finalizar/historial/descargar/nueva revisión).
7. Pruebas finales, regresiones de las 8 hojas, capturas y PDF de ejemplo.

## 8. Confirmaciones que necesito
1. Finalizar exige *Elaboró* confirmado (el CHECK de la base lo impone): ¿correcto?
2. «Revisó» solo se registra sobre **borradores** y queda desactualizado si se edita después: ¿correcto?
3. ¿Qué cuentas pueden **asignar** revisor (creador y ADMIN)?
4. Variantes: ¿etiqueta libre corta (≤ 40) y nombre `<CODIGO>-<VARIANTE>_REV01.pdf`?
5. La finalización en TEST requiere Chrome disponible en el equipo del API: si no lo hay, falla de forma controlada (501) y el borrador sigue siendo borrador.
6. ¿Autoriza al operador a ejecutar el inventario previo del endurecimiento de `CONNECT` (sección 6)?
