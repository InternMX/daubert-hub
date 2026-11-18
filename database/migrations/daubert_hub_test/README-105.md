# Migración 105 · Consulta compartida de borradores (adicional a la 101–104)

**Estado: PROPUESTA, NO APLICADA a `daubert_hub_test`.** Solo TEST. Requiere autorización expresa y el rol administrativo (psql interactivo con `-W` del operador). No inserta, modifica ni borra datos.

Archivos: `20261107_105_manufactura_consulta_compartida_borradores_test.{precheck,up,postcheck,smoke,down}.sql` · validador: `tools/validar-105-en-instancia-desechable.cjs` · pruebas: `apps/api/test/desechable/18-consulta-compartida.desechable.spec.ts` (más los ajustes de 01–04 y 15).

## Qué cambia (3 políticas de LECTURA; `ALTER POLICY`, sin recrear tablas)
| Política | Antes (101) | Ahora (105) |
|---|---|---|
| `manufactura.revisiones · pol_revisiones_sel` | FINALIZADA, o creador, o revisor asignado, o ADMIN | FINALIZADA (igual) · **BORRADOR y FINALIZANDO** para cualquier cuenta con identidad de sesión (nuevo, solo lectura) · cualquier estado para creador, revisor asignado y ADMIN (igual). **DESCARTADA** sigue limitada a creador, revisor asignado y ADMIN. Sin identidad no se ve ningún borrador. |
| `manufactura.pdfs · pol_pdfs_sel` | la revisión es visible | la revisión es visible **y** (FINALIZADA, o creador, revisor asignado o ADMIN) → el PDF de una revisión no finalizada **no** se expone a más cuentas |
| `manufactura.pdf_contenidos · pol_pdf_contenidos_sel` | ídem | ídem (bytes del PDF) |

Cada política queda marcada con `COMMENT ON POLICY … '105: …'` (la marca evita reaplicar y permite verificar).

## Efectos indirectos verificados
- `documentos`, `confirmaciones_revision`, `revision_responsables`: derivan de «la revisión es visible»; un borrador ajeno muestra su código, responsables (nombres) y confirmaciones. **Sin cambio de política.**
- **Firmas:** la imagen sigue protegida por `firmas` / `firma_autorizaciones` (propietaria, quien la subió o autorización vigente). Probado: al consultar un borrador ajeno con firma, la API devuelve el nombre y `firma: null`, y ningún `data:image` en la respuesta; con autorización vigente sí aparece.
- **PDF:** el PDF de una finalización en curso lo ve solo creador/ADMIN (SQL directo probado); `GET revisions/:id/pdf` exige estado FINALIZADA.
- **Escritura:** `INSERT/UPDATE/DELETE`, triggers (solo creador/ADMIN modifican; contenido congelado en FINALIZANDO; inmutabilidad de FINALIZADA/DESCARTADA) y privilegios **no cambian**. Un GENERAL ajeno ve la fila, pero `UPDATE` afecta 0 filas, `DELETE` da `permission denied` e insertar un responsable lo rechaza el trigger.
- Respuesta uniforme al crear un borrador sobre un código existente: **sin cambio** (409 sin ids).

## Lo que NO hace
No deshabilita RLS, no crea tablas/funciones/triggers, no amplía privilegios, no toca datos, PDF ni revisiones históricas, `core`, `daubert_global`, n8n, roles ni las migraciones 101–104.

## Procedimiento (operador autorizado)
1. Verificar sha256 (abajo). 2. Respaldo verificable (`pg_dump -F c`, ver README de la 101). 3. `precheck` (esperado `all_prechecks_pass = t`; anotar `huella_resto`). 4. `up`. 5. `postcheck -v huella_resto=<valor>` (esperado `all_postchecks_pass = t`). 6. `smoke` opcional con el rol de la app (`daubert_hub_test_user`; requiere 1 ADMIN y 2 GENERAL activos; 15 pruebas, termina en ROLLBACK y comprueba que no deja residuos). 7. Desplegar la API/web de esta rama **después** de la 105 (la API nueva también funciona sin ella: sin la 105 la base sigue ocultando los borradores ajenos y «Borradores del equipo» solo muestra lo que la base permita).
- **Reversa:** `down` restaura las 3 políticas con su redacción de la 101 (idempotente, no toca datos).

## Validación (solo instancia PostgreSQL 18 desechable, ya eliminada)
- `node tools/validar-105-en-instancia-desechable.cjs`: 101 → 102 → 103 → 104 → precheck ✔ → UP ✔ → postcheck ✔ (huella de lo no tocado sin cambios) → smoke 15/15 ✔ (0 residuos) → DOWN ✔ (política de la 101 restaurada) → DOWN idempotente ✔ → UP ✔ → postcheck ✔ → no se reaplica ✔.
- `npm run test:desechable` (101–105): 18 archivos, 161 pruebas ✔.

## sha256 (blobs de git)
```
00cd8af8edf4758478b94e936d65482b3414706c89ac8920c01eb1af95eafae6  …_105_…consulta_compartida_borradores_test.down.sql
e9dfb409ed13c553339caecdd9dd52c8813ad715b3032f7e5a37d33065a09635  …_105_…consulta_compartida_borradores_test.postcheck.sql
3f855ce4da2aa2bd225919850cbb01c7020e2a2578e0853de822746142b948e2  …_105_…consulta_compartida_borradores_test.precheck.sql
897109800be151522f59591223f95d8ad9dddce18f69b201daa19c1ccca39049  …_105_…consulta_compartida_borradores_test.smoke.sql
1b0c62216a44850c190ffa665e5b11d62147dc4d02535cba38ebd10e9ea773b1  …_105_…consulta_compartida_borradores_test.up.sql
```
