# Migración 107 · Nombre del PDF con revisión sin truncar (adicional a la 101–106)

**Estado: PROPUESTA, NO APLICADA a `daubert_hub_test`.** Solo TEST. Requiere autorización expresa y el rol administrativo (psql interactivo con `-W` del operador). No inserta, modifica ni borra datos. La 101 aplicada **no se modifica**.

Archivos: `20261113_107_manufactura_nombre_pdf_revision_test.{precheck,up,postcheck,down}.sql` · pruebas: `apps/api/test/manufactura-nombre-pdf.sql.spec.ts` (PGlite, PostgreSQL 18 en memoria: UP reales 101→106, después la 107 y el trigger real `fn_pdfs_before_insert`) · arnés Docker desechable: `apps/api/test/desechable/global-setup.ts` aplica la 107 tras la 106.

## Contrato del nombre del PDF finalizado
`CODIGO[-VARIANTE]_REVNN.pdf`, idéntico en `manufactura.fn_nombre_pdf` (que el trigger de `manufactura.pdfs` exige) y en `nombreArchivoFinalizado()` de la API:
- **Código**: el código documental tal cual (validado por `ck_manufactura_documentos_codigo`). No se antepone `_` a códigos como `CON`: `CON_REV01.pdf` no es un nombre reservado de Windows (lo es `CON.pdf`). El **borrador** (`<código>.pdf`) conserva su protección (`_CON.pdf`).
- **Variante** (opcional): mayúsculas, cada tramo de caracteres no alfanuméricos → `-`, sin guiones al inicio ni al final (`Doble cara.2` → `DOBLE-CARA-2`).
- **Revisión**: dos dígitos como **mínimo**, nunca truncada: 1 → `REV01`, 99 → `REV99`, 100 → `REV100`, 105 → `REV105`.

## Qué cambia (solo el cuerpo de `manufactura.fn_nombre_pdf(text, text, integer)`, `CREATE OR REPLACE`)
| | Antes (101) | Ahora (107) |
|---|---|---|
| revisión | `lpad(p_revision::text, 2, '0')` → 100 y 105 daban `REV10` | `lpad(p_revision::text, greatest(2, length(p_revision::text)), '0')` |

Para revisiones 1–99 el resultado es idéntico: los PDF ya registrados siguen coincidiendo con la función. Con la 101, una revisión ≥ 100 no podía finalizarse (el trigger rechazaba el nombre de la API); no pudo quedar ningún PDF con nombre inconsistente. Misma firma, `sql`, `IMMUTABLE`, `search_path = pg_catalog`, sin `SECURITY DEFINER`; propietario y privilegios se conservan (el UP lo comprueba antes del COMMIT). Es exactamente la definición de la 020 de PROD.

## Lo que NO hace
No toca tablas, columnas, datos, documentos, PDF, firmas, triggers, políticas RLS, privilegios, auditoría ni otras funciones (el postcheck lo demuestra con `huella_resto`). No toca `daubert_global`, n8n ni las migraciones 101–106.

## Procedimiento (operador autorizado)
1. Verificar sha256 (abajo). 2. Respaldo verificable (`pg_dump -F c`, ver README de la 101). 3. `precheck` (esperado `all_prechecks_pass = t`; anotar `huella_resto`; informa cuántas revisiones ≥ 100 hay). 4. `up` (rechaza otra base, rol no administrativo, 101 ausente, función con otro propietario/atributos o con una definición que no sea la de la 101; no se reaplica). 5. `postcheck -v huella_resto=<valor>` (esperado `all_postchecks_pass = t`). El orden respecto de la API es indiferente: con la API nueva y sin la 107, una revisión ≥ 100 sigue sin poder finalizarse (falla segura); `CON` ya coincide en ambos casos.

## Reversa y su restricción
`down` restaura el cuerpo de la 101 (idempotente; conserva propietario y privilegios) **solo si** no existe ninguna revisión con número o número reservado ≥ 100 y todos los PDF registrados coinciden con el nombre de la 101; bloquea `revisiones` y `pdfs` mientras lo comprueba. Si existe alguna, **aborta sin cambiar nada**: esos PDF finalizados son inmutables y la función restaurada declararía otro nombre (`REV10` en lugar de `REV100`). En ese caso no se revierte: se corrige hacia adelante. Cualquier otra definición de la función es un estado desconocido: aborta.

## SHA-256 (contenido en git, LF)
```
2acaa409a190f6a8f747cfb2b7a5a6348437fa2f0874b5ce2b4e738ba6c5b3ec  20261113_107_manufactura_nombre_pdf_revision_test.precheck.sql
6ec1ad1ebcf0c486eac1d067a0fe261dcca67bf3ba1043b06e5bb7d86a1c47f5  20261113_107_manufactura_nombre_pdf_revision_test.up.sql
82268505d15e800925ee5c4eae51dde1c0cfd32b276bb3088d3b7f7505c78aed  20261113_107_manufactura_nombre_pdf_revision_test.postcheck.sql
099dfa55159441fb08ab2bb9926cae60dbdc051691f38d1cd681b50ddcf296dd  20261113_107_manufactura_nombre_pdf_revision_test.down.sql
```
