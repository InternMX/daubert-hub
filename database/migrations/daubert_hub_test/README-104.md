# Migración 104 · Abreviaturas de cliente (adicional a la 101, 102 y 103)

**Estado: PROPUESTA, NO APLICADA a `daubert_hub_test`.** Solo TEST. Requiere autorización expresa y el rol administrativo (psql interactivo con `-W` del operador). Nace **vacía**: no inserta empresas ni abreviaturas.

Archivos: `20261106_104_manufactura_cliente_abreviaturas_test.{precheck,up,postcheck,smoke,down}.sql` · validador: `tools/validar-104-en-instancia-desechable.cjs` · pruebas de integración: `apps/api/test/desechable/13-cliente-abreviaturas.desechable.spec.ts`.

## Qué crea (1 tabla, 2 funciones, 4 triggers, 3 políticas)
`manufactura.cliente_abreviaturas`: abreviatura (2–5 caracteres A–Z/0–9) → cliente (`core.empresas` con rol `CLIENTE` activo, validado al crear y al confirmar).

| Concepto | Regla |
|---|---|
| Abreviaturas compartidas | **No hay unicidad global.** La misma abreviatura puede asociarse a varios clientes (ANC, CAT, CIE, DAI, FIL). Solo se impide el **duplicado exacto vigente** (abreviatura + cliente + alcance + patrón; índice único parcial sobre CANDIDATA/PROPUESTA/CONFIRMADA). |
| Alcance | `GENERAL` (la abreviatura sola) · `CONTEXTO` (prefijo más largo validado que empieza con la abreviatura, p. ej. `DAID`/`DAIM`) · `CODIGO_COMPLETO` (excepción por código; **no** se asume que identifica a un único cliente: puede haber dos clientes para el mismo código, como ITESFCP003). |
| Estado | `CANDIDATA` (hallazgo de extracción, sin confirmar) · `PROPUESTA` (usuario GENERAL) · `CONFIRMADA` (única que el motor trata como validada) · `RECHAZADA` (terminal; exige motivo) · `INACTIVA` (reactivable por ADMIN). |
| Procedencia y evidencia | `origen` (EXTRACCION_HISTORICA, OCR_HISTORICO, MANUAL_ADMIN, PROPUESTA_USUARIO), documentos y **códigos distintos** que la respaldan, resumen y fuente; quién propuso y quién resolvió (lo fija la sesión, no el cliente de la API). |
| Quién puede qué | GENERAL: solo **propone** (estado PROPUESTA) y retira **su** propuesta; no declara evidencia. ADMIN: crea candidatas/confirmadas, confirma, rechaza, inactiva y reactiva. Nadie borra ni cambia abreviatura, cliente, alcance, patrón u origen. |
| Visibilidad (RLS) | Todos ven las CONFIRMADAS; cada cuenta ve sus propias propuestas; ADMIN ve todo. |
| Auditoría | `fn_auditar_manufactura` → `audit.cambios` (altas y resoluciones). |

## Motor de sugerencias: `manufactura.fn_sugerir_cliente(codigo, incluir_no_confirmadas = false)`
Solo lectura, `SECURITY INVOKER` (respeta RLS), `search_path` fijo. **Nunca asigna ni deriva abreviaturas de los primeros caracteres del código**: solo compara con las abreviaturas registradas (los primeros 4–5 caracteres pueden incluir el identificador del producto).

Prioridad: **1 código completo confirmado · 2 contexto confirmado · 3 asociación general confirmada.** Decide el primer nivel con coincidencias; si ese nivel apunta a **varios clientes** (ambigüedad o contradicción) todas las filas llevan `requiere_eleccion = true` y la interfaz debe mostrar las alternativas y exigir elección humana. Las coincidencias de otros niveles se devuelven como información (`decisivo = false`). Las no confirmadas (solo si se piden) tienen nivel 9, nunca son decisivas y siempre exigen elección. **Toda sugerencia, incluso la exacta, requiere la confirmación del usuario en la interfaz**; sin coincidencias el usuario selecciona o escribe el cliente manualmente.

## Lo que NO hace
No modifica ninguna tabla, función, trigger, política ni privilegio existente; no toca `core.alias_empresa`, `core.empresas`, `daubert_global`, n8n ni roles. No concede privilegios nuevos sobre `core` (exige que la app ya pueda leer `core.empresas` y `core.empresa_roles`; el precheck lo verifica).

## Procedimiento (operador autorizado)
1. Verificar sha256 de los archivos (abajo). 2. Respaldo verificable (`pg_dump -F c`, ver README de la 101). 3. `precheck` (esperado `all_prechecks_pass = t`; anotar `huella_manufactura`). 4. `up`. 5. `postcheck -v huella_manufactura=<valor>` (esperado `all_postchecks_pass = t`). 6. (opcional) `smoke` con el rol de la app: 18 pruebas, termina en ROLLBACK, requiere 1 ADMIN, 2 GENERAL activos y 2 clientes; verifica que no quedan filas ni auditoría. 7. `down` (idempotente; con datos exige `-v confirmar_borrado=SI_BORRAR_ABREVIATURAS`).

## Validación (solo instancias PostgreSQL 18 desechables, ya eliminadas)
- `node tools/validar-104-en-instancia-desechable.cjs`: 101 → 102 → precheck ✔ → UP ✔ → postcheck ✔ (16 comprobaciones, huella de lo existente sin cambios) → smoke 18/18 ✔ (0 residuos tras ROLLBACK) → DOWN con datos rechazado sin confirmación ✔ → DOWN confirmado ✔ → DOWN idempotente ✔ → UP tras DOWN ✔ → postcheck ✔ → no se reaplica ✔.
- `pnpm test:desechable` (101+102+103+104): 13 archivos, 121 pruebas ✔ (14 nuevas de la 104: prefijos compartidos, contexto DAID/DAIM, contradicción por código completo, candidatas no decisivas, cliente dado de baja, roles GENERAL/ADMIN, duplicados, inmutabilidad, formato, auditoría).
- El smoke detectó un defecto real (`decisivo` nulo cuando solo hay candidatas) antes de entregar; corregido.

## sha256
```
201aa4bde0dab56e7fb2fa209504ef625979eae7c28b2a6bbbb77e3c292cd5eb  …_104_…cliente_abreviaturas_test.down.sql
854ffaf6da5a6204970657c51eaaac4b5ddfdddd8d8e87e4bc43a264b24a10d4  …_104_…cliente_abreviaturas_test.postcheck.sql
b6dff033b21bc563fb1b5d6e5f0f41a72920db8595d88c54de69f171cd392545  …_104_…cliente_abreviaturas_test.precheck.sql
44cb939557766d998574bbc7b485dd0de89564a124362884745014770d4759e2  …_104_…cliente_abreviaturas_test.smoke.sql
6a31f8d4251800eb243f1f0f08fe357788b5ca300ea0b62c92c835b5ac8e5230  …_104_…cliente_abreviaturas_test.up.sql
```
