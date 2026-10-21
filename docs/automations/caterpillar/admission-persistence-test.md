# Fase 5A — persistencia mínima Caterpillar TEST

## Estado

**Migración preparada, NO aplicada. No se escribió ningún snapshot en Daubert TEST.**
La inspección real no pudo realizarse: `TEST_DATABASE_URL_MIGRATOR` y `TEST_DATABASE_URL` no estaban
disponibles en la sesión 5A. No se buscaron `.env`, credenciales alternativas o productivas.
No se afirma que el esquema vivo coincida con el documentado ni se inventan conteos de históricos.

La lógica de admisión previa se cerró en un commit separado antes de estos cambios de persistencia.
Esta fase añade código y pruebas offline; no conecta API/n8n, no habilita candidato ni reserva folios.

## Migración 014 (siguiente número local)

Archivos: `database/migrations/daubert_global/20261021_014_caterpillar_admission_test.*.sql`.
El directorio mantiene el nombre histórico; **los cuatro scripts solo permiten daubert_hub_test**
y rol postgres, nunca daubert_global. Antes de aplicar, confirmar numeración externa/ventana/backups.

La única operación de esquema es:

```sql
ALTER TABLE core.documentos ADD COLUMN caterpillar_admission JSONB NULL;
```

No agrega tablas, defaults, triggers, índices, grants, funciones ni backfill. Las demás tablas y
funciones existentes no se alteran. Reinstalación aborta: si ya existe, usar postcheck, no reemplazar.
Pre/postcheck comparan conteo y fingerprint de todos los campos originales de documentos, excluyendo
solo la columna agregada. Confirmar además baselines operativos y ausencia de actividad inesperada.
Down es manual, requiere definición conocida y rechaza cualquier valor no NULL, incluido JSON null.
No se descarta evidencia para permitir rollback.

Aplicación futura: requiere autorización expresa separada y respaldo recuperable satisfactorio;
precheck → up → postcheck con el mismo entorno, y revisión de resultados. No hay ejecución automática.

## Persistencia preparada en el repositorio

`CaterpillarExecutionsRepository.findAdmissionSnapshot(documentId, sourceCompanyId)`:

- Verifica TEST y disponibilidad JSONB antes de mencionar la columna en una consulta directa.
- Lee solo el documento/empresa/tipo de programación pedidos; rechaza documentos usados por otra
  automatización. Obtiene el nombre real del documento: no lo toma de un body editable.
- Distingue UNAVAILABLE, NOT_FOUND, EMPTY, FOUND e INVALID, incluido SQL NULL frente a JSON null.
- Usa V1 para comprobar versión, clave y manifest canónico; no reconstruye cantidades/OC históricas.

`storeAdmissionSnapshot(documentId, sourceCompanyId, normalizedItems)`:

1. Consulta el documento y construye `CAT_ADMISSION_V1` con V1/adaptador existentes y su nombre real.
2. Snapshot idéntico → ALREADY_STORED **sin UPDATE**; distinto o inválido → CONFLICT sin sobrescribir.
3. Histórico terminal, con remisiones o con reservas → HISTORICAL_LOCKED sin backfill.
4. Solo para captura temprana: UPDATE parametrizado si la columna sigue siendo SQL NULL, el documento
   conserva empresa/nombre/tipo y todavía no presenta antecedentes protegidos.
5. Si no pudo escribir, relee el resultado: nunca fuerza reemplazo ni reintenta con datos distintos.

El compare-and-set protege únicamente la inmutabilidad del snapshot. **No implementa el claim de
admisión, propiedad de worker ni concurrencia de reserva.** La captura futura debe secuenciarse antes
de reservar/emitir; no se sostiene que estas consultas resuelvan carreras de la automatización completa.
El primer UPDATE puede activar el trigger existente updated_at; un reintento idéntico no lo hace.

No hay endpoint de escritura nuevo ni llamada desde un workflow. El rol efectivo y sus permisos
de SELECT/UPDATE de columna deben revisarse en TEST antes de habilitarlo. No se añaden grants amplios
para forzar la persistencia. La empresa, ámbito e input provienen de configuración/normalización
autorizadas; tener un documento de tipo programación no constituye autorización de un usuario externo.

## Históricos: diagnóstico pendiente y arranque seguro

El esquema documentado permite recuperar nombre/hash/ruta, ejecuciones, estados y remisiones;
no acredita por sí mismo el ámbito completo ni cantidades/OC/unidad preagrupación de V1. Torreón
agrupado y cantidades de presentación no son evidencia suficiente para fabricar snapshots.
La falta de conexiones en 5A impide identificar cuáles documentos reales tienen información suficiente.

Inspección posterior explícitamente read-only (no aplica migración ni escribe en la base):

```powershell
node apps/api/scripts/caterpillar-admission-test-inspection.cjs
```

Valida ambas URLs/identidades exclusivamente TEST, exige mismo servidor y abre transacciones READ ONLY.
Reporta esquema, permisos y conteos/IDs técnicos; nunca imprime nombres de archivos, rutas, contenido,
URLs o contraseñas. Con conexiones válidas conserva evidencia sin secretos en el caché local ignorado.
No ejecutar el método de escritura para «probar» sobre históricos.

Propuesta de arranque sencillo y seguro, sin cambiar aún la decisión de admisión:

1. Obtener el inventario real y separar históricos completos, incompletos y ámbito desconocido.
2. Para un piloto automático, elegir una empresa TEST **confirmada sin antecedentes Caterpillar**;
   no basta una subplanta supuestamente nueva si hay históricos de ámbito desconocido en esa empresa.
   No crear empresa/datos en esta fase. Si no existe un ámbito limpio, hace falta autorización posterior
   para prepararlo o mantener revisión asistida. El piloto será sintético y autorizado: no cambiar la
   empresa de documentos reales para eludir sus antecedentes.
3. Capturar snapshots auténticos de todas las nuevas entradas del piloto, antes de cualquier folio.
   Esos documentos ya podrán compararse entre sí sin rellenar registros anteriores.
4. Incorporar ámbitos históricos solo tras conciliación con evidencia original. Si no se puede recuperar
   el contenido, mantener nuevas entradas de esos ámbitos en revisión o acordar un corte prospectivo
   explícito con aceptación empresarial de que **no** detecta todos los renombrados históricos.
   Un backfill requeriría autorización adicional y procedimiento propio: el writer preparado lo rechaza.

No se ignoran históricos automáticamente por fecha, no se marca historia completa por defecto y no
se inventan manifests vacíos para desbloquear. Con legado incompleto y sin otra evidencia es imposible
garantizar a la vez detección retrospectiva completa y admisión automática universal. La propuesta evita
paralizar el piloto limpio y deja el alcance de cada decisión visible, sin modificar datos históricos.

## Validación y conexión posterior

`caterpillar-admission-persistence.spec.ts` ejecuta fixtures sintéticos de las tablas existentes y SQL
en PGlite en memoria: no usa pools, credenciales TEST/PROD ni servicios. Solo adapta current_database
en las copias de prueba. Verifica migración/postcheck/down, lectura, escritura, repetición, conflictos,
documentos ajenos, históricos y ausencia de cambios en remisiones/reservas/ejecuciones.

Para conectar TEST faltan: inspección real, respaldo y autorización/aplicación 014, revisión de permisos,
captura temprana de snapshots, resolución de cobertura histórica y el control transaccional futuro.
El workflow crea ejecución antes de normalizar; no conectar ingenuamente la evaluación después de
crearla porque detectaría su propia PROCESANDO. No se implementa regeneración ni concurrencia en 5A.
