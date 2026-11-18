# Preparación para aplicar la migración `manufactura` en TEST — diagnóstico y lista de verificación

**Estado: NO aplicada.** Nada de lo de abajo se ejecutó contra `daubert_hub_test` ni `daubert_global`. Esta sección separa lo **verificado en el repositorio / instancia desechable** de lo que **solo puede comprobar el operador en TEST** (por eso existe el precheck).

## 1. Relación histórica con clientes (decisión aprobada)
| Punto | Diagnóstico |
|---|---|
| Operaciones actuales de `core.empresas` | Búsqueda en `apps/api` y `database/`: **no existe ningún `DELETE` de empresas**; el Hub activa/desactiva con `estatus` (empresa y rol `CLIENTE`) y renombra. Las FK (`ON DELETE RESTRICT`) no afectan esas operaciones. |
| Prueba (`06-clientes.desechable.spec.ts`, instancia desechable) | Una empresa referenciada no se puede borrar (FK); una no referenciada sí; **desactivar** la empresa o su rol y **renombrarla** siguen funcionando. |
| Historia conservada | Cada revisión guarda `cliente_nombre`, `cliente_empresa_id` y `cliente_verificado` (inmutables al finalizar) y el nombre impreso en la copia (`datos.cliente`). Renombrar o desactivar la empresa después no cambia la revisión finalizada, su huella ni su PDF. |
| Antes de finalizar | Si el cliente vinculado ya no está activo → 422 `CLIENTE_NO_VALIDO`; si su nombre cambió en el catálogo → 409 `CLIENTE_ACTUALIZADO` (con `nombreActual`) y se corrige reseleccionándolo. Así el PDF nunca imprime un nombre distinto del catálogo vigente ni un cliente inactivo. |
| `core.empresas` | **Sin cambios.** El UP solo añade FK desde `manufactura.revisiones.cliente_empresa_id` (triggers internos de integridad y un bloqueo breve durante el UP, con `lock_timeout` de 10 s). |

## 2. Privacidad de `409 DOCUMENT_EXISTS`
**Problema:** la respuesta traía `documentoId`/`borradorId` solo cuando el borrador era visible, de modo que la diferencia entre respuestas permitía inferir qué había detrás del choque.

**Solución aplicada (sin tocar la unicidad ni la RLS):**
- Toda colisión de (código, variante) responde **exactamente el mismo cuerpo** `{code, message}`, sin identificadores: un borrador ajeno invisible, uno propio y una versión finalizada son indistinguibles, incluso en carreras entre dos altas simultáneas (la restricción única de la base).
- Para continuar el trabajo propio se usan `GET open` y `GET history?codigo=`, que la base filtra por permisos (RLS).
- La unicidad `(codigo_clave, variante_clave)` y las políticas siguen igual: no se permiten duplicados y no se amplía ninguna lectura.

**Residual aceptado:** quien intente crear un código en uso sabe que *está en uso* (es inherente a una restricción única). No sabe de quién, en qué estado ni si hay borrador. Un 409 de `POST :documentId/revisions` (`OPEN_DRAFT_EXISTS`) incluye el id del borrador abierto solo si la base lo deja ver a quien consulta.

## 3. Verificación de los scripts rev3
| Verificación | Resultado |
|---|---|
| Scripts definitivos | 6 archivos en `database/migrations/daubert_hub_test/`; copia en `Entregables\Fase5_Gestor_Documental\Migracion_TEST_rev3\`. |
| Hashes SHA-256 (LF) | up `de2a55e6…4d63` · down `4400b324…435f` · postcheck `2b9f86e4…8cf8` · smoke `1078c985…3fa` · **precheck `d8335a2d…4387` (cambió)** · inventario `435a3c55…32e2`. Valores completos en el informe de aprobación. |
| Arnés en instancia desechable | **42/42** (respaldo `pg_dump -F c` verificable, precheck, UP, postcheck, smoke de 55 pruebas sin residuos, DOWN idempotente, ciclo UP→DOWN→UP, restauración en base nueva, concurrencia, crecimiento). |
| Pruebas de aplicación contra el UP real | 64 casos (`npm run test:desechable`) + 24 del controlador. |
| Dependencias del esquema real | **Verificadas por lectura del código del Hub y de la réplica**, no contra TEST: el Hub usa `security.users(user_id, display_name, email, role, status)`, `core.empresas(empresa_id, nombre_comercial, estatus)`, `core.empresa_roles(empresa_id, rol, estatus)` y `audit.cambios`/`audit.fn_registrar_cambio` (ya existentes y usadas por otros módulos). El **precheck** comprueba en TEST, solo con lectura, que existen, que la app puede leerlas sin RLS y que están las 11 columnas. |
| Cuentas y permisos | Lo comprueba el precheck: rol `daubert_hub_test_user` existe, sin superusuario/CREATE/BYPASSRLS, sin `CREATE` en ninguna base ni esquema, ≥ 1 usuario activo. El smoke exige ≥ 1 ADMIN y ≥ 2 GENERAL activos (el inventario de TEST reportado antes: 2 ADMIN y 45 GENERAL). **Estado actual de cuentas en TEST: no consultado en esta fase.** |
| Respaldo previo verificable | Paso 1 del README: `pg_dump -F c` + `pg_restore --list` + sha256 + ensayo de restauración en base nueva. Ensayado en la instancia desechable. |
| Plan de recuperación | Tabla del README (falla del UP = rollback automático; DOWN con doble confirmación; restauración en base nueva; corrección hacia adelante si ya hay finalizadas). |
| Credenciales | Ningún script ni documento contiene contraseñas; no se usó ni se buscó ningún rol administrativo. La aplicación no ejecuta DDL. |

## 4. Orden de activación (cuando se autorice)
1. Operador: respaldo verificable → precheck (`all_prechecks_pass = t`, anotar las 11 líneas base) → UP → postcheck → smoke opcional.
2. Registrar `ManufacturingDocumentsModule` en `AppModule` y (en el frontend) habilitar `VITE_MANUFACTURING_DOCUMENTS=true` solo en TEST.
3. Prueba funcional acordada con cuentas de TEST.
