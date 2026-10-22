# Caterpillar TEST 015 — fase 5F

**PROPOSED / BLOCKED — NO IMPORTAR, ACTIVAR NI EJECUTAR.** Copia local derivada del candidato `candidate-5678`
(que a su vez deriva del export TEST, no de PROD). Sin credenciales, `active=false`, disparadores deshabilitados y todos los
nodos PostgreSQL/archivo/comando con su hold incondicional `CAT_TEST_5678_NOT_APPROVED`. No hay schedules, webhooks públicos,
correo ni rutas PROD nuevos. `prepare-candidate.cjs` regenera el JSON (`node prepare-candidate.cjs`); no editar a mano.

## Flujo candidato

```
Preparar archivo CAT → Resolver documento origen PG → Propagar documento origen PG        (sin crear ejecución)
→ catálogos → Leer/Guardar/Leer copia → Excel → Normalizar datos CAT                       (manifest V1 antes de agrupar Torreón)
→ Preparar snapshot admisión CAT → Guardar snapshot admisión CAT (SQL protegido) → Verificar snapshot CAT
   (solo STORED/ALREADY_STORED continúan, con los items normalizados originales; cualquier otro resultado aborta ANTES de existir ejecución)
→ Preparar reserva folios PG        (documento, serie, cantidad, modo/padre; sin ejecucion_id)
→ Reservar folios PG                (gate 015: fn_admitir_… o, con padre, fn_reprocesar_…; worker = $execution.id)
→ Propagar admisión CAT             (valida el derecho a emitir; BLOCK/REVIEW => puede_emitir=false)
→ ¿Es reproceso? → Mapear resultado → ¿Estado reconocido? → Responder aceptado ┐
                  └───────────────────────────────────────────────────────────┴→ ¿Puede emitir CAT?
      true  → Asignar folios PG CAT → … → Registrar remisión PG (wrapper) → Finalizar ejecución PG (wrapper)
      false → Loop Over Items (sin folios, sin ejecución propia)
Errores: Preparar error CAT → ¿Ejecución propia confirmada? → sí: Registrar fallo PG (wrapper) → log ; no: solo log
```

Eliminados del candidato: `Crear o recuperar ejecución PG`, `Propagar ejecución PG` (la ejecución nace en el gate) y el nodo
suelto `Execute a SQL query` (leía la definición de una función legado). Conservados sin cambio: algoritmo de folios y orden de
asignación, lectura nominal del normalizador, cardinalidad y partidas repetidas de Torreón, rutas Windows de pruebas y holds.

## Bloqueos explícitos (no hay bypass)

1. **Snapshot (5G-A)**: n8n no puede llamar métodos NestJS y no existe ninguna entrada autenticada n8n→Hub (solo Hub→n8n), por lo que un
   endpoint exigiría un mecanismo de autenticación nuevo. Se reutiliza en cambio el rol y la credencial existentes con una entrada SQL
   protegida de 015, `ops.fn_guardar_snapshot_caterpillar_test(documento, manifest_canonico)`: mismo compare-and-set inmutable que
   `storeAdmissionSnapshot`, empresa y nombre salen del documento almacenado y la clave se valida con el mismo validador del gate. Pendiente:
   aplicar 015 y validar contra PostgreSQL real.
2. **Reproceso**: la respuesta al Hub ahora ocurre tras leer el Excel y el gate (antes era inmediata); el Hub espera 10 s.
   Medir antes de habilitar. Las razones de rechazo del gate sin código conocido por el Hub fallan cerrado como
   `UNEXPECTED_EXECUTION_STATE` (→ 502 en Hub); añadir códigos al Hub es trabajo posterior.
3. **Credencial `cat_test`**: exclusividad entre workflows sin verificar; el workflow PROD comparte la instancia 5678.
4. Un fallo del propio nodo PostgreSQL del gate (error SQL) no tiene salida de error: el workflow aborta. Si el gate ya hizo
   COMMIT puede existir ejecución PROCESANDO; se concilia con el procedimiento de recuperación manual del runbook.
5. Un cambio de nodo en vivo exige repetir la revisión; este JSON no reemplaza una revisión runtime en n8n.
