# Reserva recuperada Caterpillar — borrador TEST, no importado

Fuente viva inspeccionada en lectura: workflow `AgWvTRatRujP9VfW`,
`Caterpillar TEST 015 — FULL (INACTIVE, staged)`, 63 nodos, inactivo y sin versión publicada.
Se conservan sus bloqueos `CAT_TEST_IO_HOLD` y su credencial TEST. No se cambió el workflow vivo.

`recovery-reservation-node.paste.json` es **solo un borrador de parámetros**,
no un workflow instalable. Su rama de recuperación lanza un bloqueo explícito.
No contiene credenciales, IDs de conexiones ni cambios de rutas.

Después de revisar y aprobar el E2E, el nodo de reserva para la rama explícita de
recuperación debe ejecutar únicamente:

```sql
SELECT * FROM cat_recovery_test.worker_admission($1::uuid,$2::text,$3::bigint);
```

Parámetros: `[recovery_request_id, String($execution.id), reproceso_de_id]`.
La función devuelve las mismas diez columnas del contrato de admisión actual,
verifica que la solicitud corresponde al padre del archivo en curso y llama al
gate existente. Un duplicado devuelve `BLOCK`, `ALREADY_REPROCESSED`, `can_emit=false`.
Nunca reemplazar un error de recuperación por la consulta convencional.

Prerrequisitos antes de preparar una copia ejecutable:

1. Migración 025 aplicada por operador autorizado en TEST, inicialmente deshabilitada.
2. Coordinador confiable, separado del Hub/n8n, con custodia de generación y diario de
   entrega verificables; atestación de cuarentena completa con el rol dedicado.
3. Transportar `recovery_request_id` desde una entrada autenticada, sin perderlo en
   los nodos de normalización/snapshot/reserva. Comprobar que padre, SHA-256 del Excel,
   snapshot y manifiesto normalizado son los mismos en toda la cadena.
4. Conservar sin cambios las validaciones de `Propagar admisión CAT`, `¿Puede emitir CAT?`,
   ownership y finalización. No convertir cuando `can_emit=false`.
5. Usar un directorio nuevo de staging por ejecución hija. El convertidor TEST borra
   homónimos: no debe recibir una salida operativa compartida ni una carpeta reutilizada.
6. Probar fallos de transporte después de COMMIT: el retry no concede otra emisión;
   requiere reconciliar el estado del worker y sus archivos, no asumir que puede volver a generar.
7. Ejecutar el E2E real en n8n TEST sin entradas automáticas ni rutas productivas.

El convertidor TEST fue ejecutado sin cambios con HTML sintético y cuatro PDFs en
el PostgreSQL/archivo aislado. Esto **no** acredita el E2E del workflow n8n vivo.
