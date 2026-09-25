# Backup y restauración de PostgreSQL (procedimiento recomendado)

> **No se ejecutó ningún backup ni restore para escribir este documento.** Es un procedimiento **recomendado y seguro** basado en el estado real de las bases (D3) y en las prácticas estándar de PostgreSQL. Lo que dependa de una decisión del responsable está marcado **PENDIENTE**. Ningún comando de este documento se ha probado en este entorno; **probar en un entorno de prueba antes de depender de él**. Complementa a [backup-restore](backup-restore.md) (requisitos conocidos, D2). Base de datos: [database](../database/README.md).

## Hechos del entorno (verificados en D3)

| Hecho | Valor |
| --- | --- |
| Versión del servidor | PostgreSQL 18.4 (x86_64-windows), en el host Windows, **fuera de Docker** |
| Bases | PROD `daubert_global`, TEST `daubert_hub_test`; mismo clúster |
| Roles | Globales al clúster (`postgres`, `daubert_hub_app`, `daubert_hub_test_user`, `n8n_app`, `n8n_cat_test`, `daubert_docs_ro`): **no** viajan en un dump de una sola base |
| Extensiones | Solo `plpgsql`; sin extensiones que requieran instalación previa en el destino |
| Tipos/objetos especiales | Sin enums, dominios ni tablas foráneas; no hay tablas de control de migraciones |
| Objetos por base | 6 schemas propios, 31 tablas, 10 vistas, 13 funciones, 26 sequences, 25 triggers |
| Privilegios en el dump | `daubert_docs_ro` **no** sirve para respaldar (no lee tablas). El backup requiere `postgres` u otro rol con lectura total, usado por una persona autorizada |

## Backup de PROD

Herramienta: `pg_dump` (cliente de la misma versión mayor o superior, 18.x) desde el host o una estación de administración con conectividad. Ejecutar con un rol administrativo; **no** guardar la contraseña en el comando (usar `PGPASSWORD` solo en la sesión del operador, `.pgpass` o el prompt).

1. **Formato personalizado (`-Fc`)**: comprimido, restaurable selectivamente con `pg_restore`, y permite `--list`.

```text
pg_dump -h <host> -p <puerto> -U postgres -d daubert_global -Fc -f <ruta>\daubert_global_<AAAAMMDD_HHMM>.dump
```

2. **Roles y permisos (globales)**: complementar con un volcado solo de globales para conservar los roles y sus atributos (sin ejecutarlo hacia terceros; el archivo contiene hashes de contraseña y debe protegerse como secreto):

```text
pg_dumpall -h <host> -p <puerto> -U postgres --globals-only -f <ruta>\globals_<AAAAMMDD_HHMM>.sql
```

3. **Consistencia**: `pg_dump` toma un snapshot transaccional coherente sin detener la base. No bloquea lecturas/escrituras normales; sí compite por I/O: elegir ventana de baja actividad. Preferir hacerlo **sin** n8n procesando (para no capturar una ejecución `PROCESANDO` a medias; ver "Verificación de folios" abajo).
4. **Registrar** (en `docs/deployments/` si es previo a una migración): fecha/hora, operador, nombre y tamaño del archivo, hash `sha256` del archivo, versión de `pg_dump` y del servidor.
5. **Ubicación y cifrado**: **PENDIENTE** (no hay política definida). Requisitos mínimos sugeridos: fuera del volumen de datos de PostgreSQL, fuera del repositorio, con acceso restringido, y cifrado en reposo si sale del host.
6. **Retención y calendario**: **PENDIENTE** (no se inventa política). Tampoco se define aquí si se adoptará archivado de WAL / recuperación a un punto en el tiempo (PITR); el paquete de despliegue de Caterpillar exige "backup fresco **o** PITR confirmado" antes de migrar PROD.

Antes de cualquier migración en PROD: backup fresco + validación (siguiente sección) + `precheck` ([migrations](../database/migrations.md)).

## Validación del backup (sin tocar PROD)

1. `pg_restore --list <archivo>.dump` debe listar los 6 schemas, las tablas y los datos (`TABLE DATA`) sin errores. Comparar el conteo de entradas contra el catálogo de [data-dictionary](../database/data-dictionary.md) (31 tablas, 10 vistas, 13 funciones, 26 sequences).
2. Verificar `sha256` del archivo contra el registrado.
3. **Restaurar a una base nueva** (siguiente sección) y ejecutar las verificaciones allí. Un backup que nunca se restauró no está validado.

## Restauración: siempre a una base nueva primero

**Nunca** restaurar encima de `daubert_global` ni de `daubert_hub_test` como primer paso. Regla: `pg_restore` → base nueva vacía → verificar → decidir.

1. Crear una base nueva con nombre inequívoco (por ejemplo `daubert_restore_<AAAAMMDD>`), propietario `postgres`. Los roles del proyecto deben existir en el clúster destino (restaurar `globals` **solo** en un clúster de prueba distinto; en el clúster productivo los roles ya existen).
2. Restaurar sin cambiar propietarios ni privilegios inesperadamente:

```text
pg_restore -h <host> -p <puerto> -U postgres -d daubert_restore_<AAAAMMDD> --exit-on-error <archivo>.dump
```

3. Si se usa un clúster de prueba, aislar la red y **desactivar toda credencial de n8n/Hub** que apunte a él (una restauración no debe activar automatizaciones ni correos).

## Pruebas después de restaurar (sobre la base nueva, solo lectura)

Ejecutar en `BEGIN TRANSACTION READ ONLY; … ROLLBACK;`:

1. Conteo por `relkind` y esquema igual al esperado (ver [data-dictionary](../database/data-dictionary.md)).
2. `sha256(pg_get_functiondef())` de las 13 funciones y de las 10 vistas contra [test-prod-drift](../database/test-prod-drift.md); en particular `md5` del cuerpo de `ops.fn_crear_ejecucion_automatizacion` = `929939dcc7cd3ef0e09b7b2a868b9616` (CR ignorado).
3. Permisos: repetir las consultas de grants de [permissions-matrix](../database/permissions-matrix.md) para los roles del proyecto (los privilegios se restauran con el dump; los **roles** no).
4. Postcheck de la 009 y de las migraciones que apliquen.
5. **Verificación de folios** (crítica; ver [folios](../database/folios.md), [backup-restore](backup-restore.md)): para cada serie, `siguiente_folio` ≥ mayor folio emitido en `remisiones` y ≥ mayor `folio_final` de `reservas_folios`; y ninguna ejecución `PROCESANDO` huérfana en la base restaurada.
6. Prueba funcional: la API del Hub contra la base restaurada (en un entorno aislado), sin n8n.

## Rollback (si la restauración o una migración salen mal)

- **Antes de promover**: nada que revertir en PROD; se descarta la base nueva.
- **Migración fallida en PROD**: las migraciones versionadas son transaccionales; si el `up` falló hizo `ROLLBACK`. Si terminó y el `postcheck` falla, usar el `down` **solo** si sus guards lo permiten; si ya hay datos nuevos, corrección hacia adelante. Restaurar el dump sobre PROD es el último recurso: exige ventana de mantenimiento, n8n y Hub detenidos, base nueva primero y confirmación explícita del responsable.
- **Renombrado como mecanismo de cambio de base**: si se decide sustituir una base por su restauración, hacerlo por renombrado tras cortar conexiones, conservando la original hasta validar. **PENDIENTE**: decidir si este procedimiento es aceptable en este entorno.

## PENDIENTE (decisiones no definidas)

| Decisión | Estado |
| --- | --- |
| Ubicación y cifrado de los backups | PENDIENTE |
| Frecuencia, retención y rotación | PENDIENTE |
| PITR / archivado de WAL | PENDIENTE |
| Responsable y ventana de mantenimiento | PENDIENTE |
| Backup de TEST (¿o se reconstruye desde migraciones?) | PENDIENTE |
| Cómo se protegen y guardan los `globals` (contienen hashes) | PENDIENTE |
| Prueba periódica de restauración | PENDIENTE |

Fuera de PostgreSQL (no cubierto aquí): workflows y credenciales de n8n, archivos origen/PDFs en Dropbox, archivos de entorno ([backup-restore](backup-restore.md)).
