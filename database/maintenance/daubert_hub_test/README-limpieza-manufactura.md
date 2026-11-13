# Limpieza de documentos de Hojas de Manufactura (daubert_hub_test)

**Estado: PROPUESTA. NO EJECUTADA en `daubert_hub_test`.** Solo TEST. Requiere el rol administrativo (psql con `-W`) y un respaldo NUEVO con `pg_dump` posterior a las últimas pruebas (el anterior a la 105 no sirve).

Archivos: `limpieza_manufactura_documentos.{preview,delete,postcheck}.sql` · validación: `apps/api/test/desechable/19-limpieza-manufactura.desechable.spec.ts` (usa estos mismos scripts contra una instancia PostgreSQL desechable).

## Qué elimina y qué conserva
| Se ELIMINA (en este orden) | Se CONSERVA |
|---|---|
| `revision_responsables` → `pdf_contenidos` → `pdfs` → `confirmaciones_revision` → `revisiones` (de las más nuevas a las más antiguas por «basada en») → `documentos` | `manufactura.firmas`, `firma_autorizaciones`, `cliente_abreviaturas`; `security.users`; `core.empresas` / `empresa_roles`; configuración; `audit.cambios` (historial, se suman las bajas con origen `LIMPIEZA_TEST`); `daubert_global` y otras automatizaciones |

Sin `TRUNCATE`, sin `CASCADE`, sin `session_replication_role`. Las claves foráneas (RESTRICT) siguen activas: no puede quedar ninguna referencia colgando.

## Cómo se borra algo «inmutable» sin desactivar la seguridad
Las revisiones FINALIZADA/DESCARTADA, los PDF y los documentos están protegidos por 6 triggers que impiden `DELETE` (`trg_manufactura_documentos_inmutable`, `…revisiones_no_delete`, `…pdfs_inmutable`, `…pdf_contenidos_inmutable`, `…confirmaciones_inmutable`, `…responsables_guardia`). El script:
1. toma bloqueo exclusivo de las 6 tablas (máx. 15 s; si alguien escribe, no ejecuta);
2. comprueba que el estado es **idéntico** al del PREVIEW (conteos, huella de lo conservado, huella de triggers, ninguna dependencia nueva);
3. deshabilita **solo esos 6 triggers**, dentro de la misma transacción (DDL transaccional: si algo falla, vuelven solos);
4. borra y vuelve a habilitar los 6;
5. antes del `COMMIT` verifica: tablas vacías, triggers y políticas **idénticos** a antes, RLS activa, lo conservado con la misma huella. Cualquier diferencia revierte todo.
Siguen activos: auditoría (las bajas quedan en `audit.cambios`), claves foráneas, RLS y el resto de triggers. **Requiere su aprobación expresa** (es lo único que se deshabilita, y solo durante la transacción).

## Actividad reciente y enlaces
«Actividad reciente» se calcula en vivo sobre `manufactura.revisiones/documentos`; no guarda eventos propios. Al eliminar los documentos desaparecen sus eventos y no quedan enlaces dentro de la aplicación. Un enlace guardado fuera (favoritos) mostrará «Documento no encontrado». El historial de `audit.cambios` se conserva (referencia ids que ya no existen: es auditoría, no enlaces). Las secuencias de identificadores no se reinician (los ids nuevos no reutilizan los anteriores).

## Procedimiento en Windows (PowerShell o cmd; `psql` en `C:\Program Files\PostgreSQL\18\bin`)
```
cd C:\Users\06\Documents\Daubert\daubert-hub\database\maintenance\daubert_hub_test
set PATH=%PATH%;C:\Program Files\PostgreSQL\18\bin        (PowerShell:  $env:Path += ';C:\Program Files\PostgreSQL\18\bin')

:: 0. RESPALDO NUEVO (obligatorio) y verificación de que es legible
pg_dump -h localhost -p 5432 -U postgres -W -d daubert_hub_test -F c -f C:\respaldos\daubert_hub_test_antes_limpieza.dump
pg_restore -l C:\respaldos\daubert_hub_test_antes_limpieza.dump > NUL

:: 1. PREVIEW (solo lectura). Revise «Documentos afectados» y que preview_ok = t. Guarde la salida y copie «comando_delete».
psql -h localhost -p 5432 -d daubert_hub_test -U postgres -W -X -v ON_ERROR_STOP=1 -f limpieza_manufactura_documentos.preview.sql > preview.txt

:: 2. DELETE (solo tras autorización): pegue la línea «comando_delete» del PREVIEW. Forma:
psql -h localhost -p 5432 -d daubert_hub_test -U postgres -W -X -v ON_ERROR_STOP=1 -v confirmar=SI_ELIMINAR_TODOS_LOS_DOCUMENTOS_DE_MANUFACTURA_EN_TEST -v esperados_documentos=N -v esperados_revisiones=N -v esperados_pdfs=N -v huella_protegidos=<md5> -v huella_triggers=<md5> -f limpieza_manufactura_documentos.delete.sql

:: 3. POSTCHECK (solo lectura): all_postchecks_pass debe ser t. Use las tres huellas del PREVIEW.
psql -h localhost -p 5432 -d daubert_hub_test -U postgres -W -X -v ON_ERROR_STOP=1 -v huella_protegidos=<md5> -v huella_triggers=<md5> -v huella_politicas=<md5> -f limpieza_manufactura_documentos.postcheck.sql
```
El script se detiene con «ABORTO …» sin borrar nada si falta un parámetro, la frase no coincide, algo cambió desde el PREVIEW o hay dependencias inesperadas. Un `DELETE_OK` al final indica `COMMIT`.

**Marcha atrás:** solo restaurando el respaldo (`pg_restore`); esta limpieza no tiene `DOWN`. Por eso el respaldo nuevo es obligatorio.

## Riesgos identificados
1. **Irreversible sin respaldo** (incluye PDF finalizados): verifique el respaldo con `pg_restore -l` antes.
2. **Bloqueo breve** de 6 tablas: haga la limpieza sin usuarios trabajando (si la API escribe, el script espera 15 s y aborta sin cambios).
3. **Se deshabilitan 6 triggers durante la transacción** (requiere aprobación); están verificados antes del COMMIT.
4. **Las huellas dependen de la sesión**: ejecute PREVIEW, DELETE y POSTCHECK con el mismo rol (`postgres`); los scripts fijan `search_path` para que no dependan de la configuración del rol.
5. **`audit.cambios` crecerá** con una fila por cada fila eliminada (redactada como el resto de la auditoría de manufactura).
6. **Autoguardado abierto en navegadores**: una pestaña con un borrador abierto intentará guardar un documento que ya no existe y mostrará error; recargue antes de las pruebas finales.
7. La instancia real puede tener tablas o claves foráneas que la réplica no tiene: por eso el PREVIEW lista todas las FK hacia estas tablas y el DELETE aborta si hay una fuera de las 6 esperadas.

## sha256 (contenido en git, finales de línea LF; en Windows con `core.autocrlf` el archivo del disco puede tener CRLF y otro hash)
```
b97afab13a33010e4af49b6cb748af80861a74be1407b9274b4cda8a313f21c1  limpieza_manufactura_documentos.preview.sql
b00bf6430b54dd345859b41de51afbc5067c8ed1d8de26b57bf789b549263f4b  limpieza_manufactura_documentos.delete.sql
1f8dae0929276c4cfef03b0204f405b29fdbdd73613d3c2ab2391588f78d2e04  limpieza_manufactura_documentos.postcheck.sql
```
