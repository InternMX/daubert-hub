# Estado de preparación para la liberación de Manufactura (Fase 6E)

Fecha: 2026-11-10. Rama `feat/manufacturing-sheets-coex-baseline`. **Nada publicado ni desplegado.**

## 1. Estado real del desarrollo
| Área | Estado |
|---|---|
| Funcionalidad (BIND, prellenado, ocho formatos, borradores, responsables y firmas, finalización, revisiones, clientes y abreviaturas) | Desarrollada y probada con datos sintéticos y simulador |
| Migraciones 020–024 y 026 | Preparadas; ensayadas en copias desechables; **no aplicadas en producción** |
| Despliegue y reversión | Ensayados en entorno aislado; procedimiento y compuertas listos |
| Respaldos | Parche preparado **sin aplicar**; comprobación del artefacto cifrado final lista |
| Política de cierre de Manufactura | Artefacto independiente; la operativa sigue siendo la de siempre por omisión |
| Versión candidata 1.2.0 e imágenes definitivas | **No existen**; a propósito, hasta después de la junta |
| Ambiente de TEST | **Detenido** desde hace cinco semanas, con imágenes anteriores a la candidata |

## 2. Pendientes que requieren a una persona o una autorización
| # | Pendiente | Quién | Material |
|---|---|---|---|
| H1 | Revisar y firmar la ficha de cada uno de los **ocho PDF** | Manufactura | `03-revision-ocho-formatos.md`, `Revision_Ocho_Formatos.pdf` |
| H2 | Confirmar que el Excel usado como «original» es la versión vigente | Manufactura | ídem |
| H3 | Autorizar la actualización de **TEST** y preparar la sesión (cuentas, firmas, clientes, códigos) | Responsable del Hub / Operación | `02-guia-demostracion.md` §0 |
| H4 | Demostración y **lista de aceptación** del flujo; definir quién es Generó / Revisó / Aprobó | Usuarios de Manufactura | `02`, `03` (sección final) |
| H5 | Catálogo inicial de **clientes y abreviaturas** y su administrador | Manufactura / Administración | `02` §10 |
| H6 | Autorizar y ejecutar la comprobación de **BIND real**; entrega segura de credenciales | Administrador de BIND / Sistemas | `04-bind-real.md` |
| H7 | Decidir sobre los **runners** pendientes (corregir `recent-activity`; aceptar el resto por escrito) | Responsables de Caterpillar, Pagos, Audi y del Hub | `05-regresiones-operativas.md` |
| H8 | Designar **custodio** de la clave de respaldos y estación de recuperación para la ventana | Dirección / Sistemas | `manufactura-preparacion-junta-6d.md` §3.3 |
| H9 | Decidir si se aplica la tercera corrección (que `Prepare` se niegue sin `-KeepClosure` con un cierre activo); las dos primeras ya están aplicadas (`1edcbe9`) | Responsable del Hub | este documento §3 |
| H10 | Fecha de la ventana de mantenimiento y **autorización formal** de despliegue, con los hashes del §5 | Junta | `01-informe-ejecutivo.md` §10 |
Después de la autorización (trabajo técnico, no decisión): cambios pedidos, versión 1.2.0, imágenes definitivas y sus manifiestos, parche de respaldos como commit de la candidata.

## 3. Ventana cerrada y `-KeepClosure`: revisión del procedimiento
**Lo que exige hoy el procedimiento** (`manufactura-preparacion-junta-6d.md` §1.2): `Close -Policy Manufactura` → `Prepare -KeepClosure` → `Close` → `Deploy … -RequireClosedWindow -ClosurePolicy Manufactura` → `Reload` → `Open`. Con esa secuencia la ventana permanece cerrada y la compuerta del despliegue lo comprueba por hash.

**Huecos encontrados** (por lectura del código y de los procedimientos; no se tocó el entorno operativo):
| # | Hueco | Efecto | Estado |
|---|---|---|---|
| K1 | El documento de 6C.3 (§1.2) y el de 6C.2 describían `Prepare` **sin** `-KeepClosure` y afirmaban que no reabría. Desde 6D eso ya no es cierto: sin `-KeepClosure`, `Prepare` escribe el archivo **abierto** en `default.conf` | Quien siguiera esos documentos dejaría el archivo abierto en disco durante la ventana | **Corregido en esta fase** (solo documentación) |
| K2 | `-RequireClosedWindow` es **opcional**. Con `-ClosurePolicy Manufactura` pero sin ese interruptor, la compuerta comprueba el hash de la política versionada y **no** que el `default.conf` externo siga cerrado | Si además se omitió `-KeepClosure`, el despliegue recrea el contenedor web y este arranca **abierto** en plena ventana, sin aviso | **Cerrado** en `1edcbe9`: `-ClosurePolicy Manufactura` implica la exigencia de ventana cerrada |
| K3 | `Reload` verifica el estado que encuentra, no el que se espera: si el archivo en disco es el abierto, comprueba «abierto» y termina bien | Un `Reload` posterior al despliegue no delata una ventana reabierta | **Cerrado** en `1edcbe9`: `Reload -ExpectState Closed` se niega antes de recargar |
| K4 | `Prepare` sin `-KeepClosure` no avisa de que hay un cierre activo | Es el origen de K2 | Abierto (comportamiento operativo anterior, conservado a propósito en 6D) |

**Corrección mínima propuesta (no aplicada; cada una con su prueba, sin tocar producción):**
1. **Aplicada (`1edcbe9`).** `Deploy-DaubertHub.ps1`: `-ClosurePolicy Manufactura` implica la exigencia de ventana cerrada. 4 pruebas Pester nuevas (124 en total).
2. **Aplicada (`1edcbe9`).** `Set-EntryClosure.ps1 -Action Reload -ExpectState Closed|Open` (opcional; sin él, igual que siempre). Ensayado en un proyecto Compose aislado: niega sin recargar en los dos sentidos, y tras un `Prepare` sin `-KeepClosure` dentro de la ventana el `Reload -ExpectState Closed` se negó y las escrituras de Manufactura siguieron en 503. Salida por omisión idéntica a la del script operativo anterior.
3. `Set-EntryClosure.ps1 -Action Prepare`: si hay un cierre activo y no se pasó `-KeepClosure`, **negarse** salvo `-AllowReopen`. Cierra K4, pero **cambia el comportamiento por omisión** en ese caso: requiere decisión expresa.
Pendiente solo la tercera (cambia el comportamiento por omisión). El procedimiento de la ventana sigue exigiendo `-KeepClosure`, `Status` antes y después y `Reload -ExpectState Closed`.

## 4. Confirmaciones (comprobadas en solo lectura el 2026-11-10)
| Confirmación | Evidencia |
|---|---|
| Manufactura no está desplegada | `/api/health` de producción: versión `1.1.1`, commit `16153a8`; contenedores `daubert-hub-web-1` y `daubert-hub-api-1` con las imágenes de siempre |
| Producción sigue en v1.1.1 | ídem; `main` = `16153a8`; `package.json` = `1.1.1` |
| El parche de respaldos sigue sin aplicarse | `scripts/backup/`: 0 diferencias contra `main`, 0 cambios sin confirmar |
| Las migraciones productivas no se han ejecutado | En ninguna fase se ejecutó SQL contra `daubert_global`; la API en producción es v1.1.1. **No se consultó la base para comprobarlo** (no se usan sus credenciales): la comprobación directa es `Test-ManufacturaReleaseReadiness.ps1` (solo lectura) por el operador, que debe informar «el esquema no existe» |
| Scripts operativos y tareas programadas sin cambios | Tareas `Daubert - PostgreSQL Frequent/Daily/Monthly` en `Ready`, último resultado 0; política de cierre operativa `e86f4749…` igual a la copia instalada; `default.conf` de producción `4d9dfea5…` |
| Hashes de los manifiestos vigentes | `MANIFIESTO COINCIDE con HEAD (77 archivos, base 16153a8)`; 0 cambios en `database/` desde la Fase 6C.1 |
| Sin commits ni archivos ajenos de Caterpillar | 0 archivos Caterpillar/025 en el delta contra `main`; 0 archivos en `n8n/`; 0 commits exclusivos de las ramas de Caterpillar |
| Sin imágenes definitivas ni versión 1.2.0 | Ninguna imagen `daubert-hub-*:release-*` en el equipo; versión `1.1.1` |

## 5. Hashes para el acta
| Elemento | SHA-256 |
|---|---|
| Manifiesto de `database/` (81 archivos, base `16153a8`; regenerado tras responsables opcionales: 020 actualizada y 106 de TEST como inerte) | `0163bb19a1233119f903aa34168322cf6e0d4d7652ee226959333cdf6c2a3ef8` (sustituye a `dc6d1133…`) |
| Política de cierre operativa (por omisión) | `e86f47494d87222122938c6b580cec465cecdf3835c037ce947f60f9e340068f` |
| Política de cierre de Manufactura | `dcadb58dc1cd8d124b383462e1390160155e3012d053b1e0fd021ef2f147bdd9` |
| `default.conf` actual de producción | `4d9dfea5f58cc2c0069f15b91e5406d62832806ff3e5a045fed48960499c0495` |
El manifiesto de imágenes y el `default.conf` nuevo se registran cuando se construyan las imágenes definitivas.

## 6. Documentos de esta carpeta
`01-informe-ejecutivo.md` · `02-guia-demostracion.md` · `03-revision-ocho-formatos.md` · `04-bind-real.md` · `05-regresiones-operativas.md` · `06-estado-de-liberacion.md`
