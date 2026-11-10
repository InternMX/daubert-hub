# Regresiones operativas pendientes · matriz para decisión

No se modificó ninguna automatización ni ninguna prueba en esta fase, y no se volvieron a ejecutar los runners. Fuente: corridas de la Fase 3/6B en una instancia **desechable** de TEST (27 runners: 16 pasan, 11 no) y comparación del código contra `main` (v1.1.1, `16153a8`).

## 1. Qué cambió esta rama fuera de Manufactura (medido contra `main`)
| Zona | Cambio | Consecuencia |
|---|---|---|
| Caterpillar, Pagos, Audi (API) | **Ningún archivo de código** | Su comportamiento no depende de esta rama |
| `n8n/` (flujos) | **0 archivos** | Las automatizaciones en n8n no cambian |
| **Actividad reciente** (`recent-activity`: controlador, módulo, servicio + repositorio nuevo de actividad de manufactura) | **Sí cambió** (~140 líneas): ahora incluye las hojas de manufactura y filtra por la cuenta que consulta | Módulo compartido **modificado**: su fallo de runner no puede darse por inocuo |
| **Clientes** (`clients.controller.ts`) | Alta/edición solo ADMIN | Cambio de permisos deliberado; su runner se ajustó y **pasa** |
| Arranque de la API (`main.ts`, `app.module.ts`, `validation-pipe.ts`, `environment.ts`) | Registro de los módulos nuevos; la validación global se movió a una función con **los mismos tres parámetros** | Afecta a toda la API; cubierto por las pruebas unitarias y por los ensayos de arranque |
| Web compartida (`App`, `AppShell`, `AutomationsPage`, `RecentActivity`, Clientes, Usuarios, Perfil) | Menú, tarjeta «Hojas de manufactura», firmas en usuarios, abreviaturas en clientes | Visible solo con la interfaz de Manufactura compilada, salvo los cambios de Clientes |

## 2. Matriz
| Runner | Funcionalidad | Causa conocida del fallo | ¿También falla en `main` v1.1.1? | Evidencia alternativa | Riesgo real para la liberación | Decisión requerida |
|---|---|---|---|---|---|---|
| `recent-activity` | Actividad reciente del tablero | El runner se detiene en un paso previo de ajuste de folios (envía un cuerpo que la API actual rechaza) y por datos de prueba | **Sí, en el mismo paso** (según las bitácoras de la Fase 3, con el código de la rama y con el de referencia: misma salida). Pero el módulo **sí fue modificado** por esta rama | 3 archivos de pruebas unitarias del módulo; `GET /recent-activity` 200 con ADMIN y GENERAL sobre copia de datos reales, con Manufactura apagada y encendida, y también en v1.1.1 sobre la base migrada | **Medio.** La parte modificada nunca llegó a ejecutarse en el runner | **Corregir el runner y ejecutarlo antes de liberar** (recomendado), o aceptar por escrito con una revisión manual de Actividad reciente en la ventana |
| `automations` | Tablero de automatizaciones y ajuste de folios | La sesión de prueba es GENERAL y la ruta exige ADMIN | Sí (runner y código idénticos a `main`) | 5 pruebas unitarias; `GET /automations/overview` 200 en todos los ensayos | **Bajo** para la API (sin cambios). La página web de Automatizaciones sí recibió una tarjeta nueva, visible solo con la interfaz de Manufactura | Aceptación documentada; corrección después |
| `security-phase6` | Permisos por rol | Igual que el anterior | Sí | Runners de seguridad 2, 3, 4, 8a y 8b pasan; pruebas de permisos de Manufactura | **Bajo–medio**: es una prueba de seguridad que no corre en ninguna versión | Aceptación documentada **con fecha de corrección** |
| `payment-notifications-reprocess-eligibility` | Pagos: qué correos pueden reprocesarse | `reprocessBlockedCorreoIds` indefinido; **sin diagnosticar** | Sí (código idéntico) | 20 archivos de pruebas unitarias de Pagos sin cambios; runner `payment-notifications` pasa | **Bajo por esta liberación, desconocido en sí mismo**: puede ser un defecto real de v1.1.1 | **Diagnosticar** (puede hacerse aparte); para liberar, aceptación documentada |
| `payment-file-assignments` | Pagos: asignación por archivo | Los datos de prueba ya se usaron; necesita una base recién restaurada | Sí | Pruebas unitarias; función apagada por omisión (bandera) | **Bajo** | Repetir con base limpia o aceptar |
| `payment-file-recovery` | Pagos: recuperación de archivos | Requiere un n8n de pruebas real | Sí | Runner de guarda de producción pasa | **Bajo** | Aceptación documentada |
| `caterpillar-model` | Caterpillar: modelo y folios | Espera datos de una fase anterior | Sí (código idéntico; 0 archivos de Caterpillar cambiados) | 26 archivos de pruebas unitarias de Caterpillar sin cambios | **Bajo por esta liberación** | Aceptación documentada |
| `caterpillar-execution-finalization` | Caterpillar: cierre de ejecución | Espera un permiso que la migración 015 revocó (runner obsoleto) | Sí | Igual; runners efímeros de cancelación pasan | **Bajo por esta liberación** | Aceptación documentada; actualizar el runner después |
| `caterpillar-remision-persistence` | Caterpillar: guardado de remisiones | Igual | Sí | Igual | **Bajo por esta liberación** | Igual |
| `caterpillar-completion-integrity` | Caterpillar: integridad al completar | Igual | Sí | Igual | **Bajo por esta liberación** | Igual |
| `caterpillar-admission` | Caterpillar: admisión atómica | Falta la empresa aprobada y una bandera en el entorno de prueba | Sí | Igual | **Bajo por esta liberación** | Igual |
| `caterpillar-cancellation.test-e2e` | Caterpillar: cancelación de extremo a extremo | **No ejecutado** (puede requerir n8n real) | No evaluado | Dos runners efímeros de cancelación pasan | **Desconocido** | Decidir si se ejecuta en un entorno con n8n de pruebas |
| *(no existe)* **Audi** | Remisiones Audi | **No hay runner de integración** | Tampoco existe en `main` | 12 archivos de pruebas unitarias de Audi sin cambios; 0 archivos de Audi modificados; lecturas de Audi disponibles durante el cierre | **Bajo por esta liberación; carencia permanente de cobertura** | Aceptación documentada; crear el runner después |

## 3. Lectura de la matriz
- «También falla en `main`» significa que **esta liberación no lo empeora**, no que la función esté validada. Cuatro de estos runners (los de Caterpillar obsoletos) y los de Pagos dejan sin prueba de integración vigente funciones que ya operan en producción hoy.
- El único caso en que la rama **sí tocó** el módulo cuyo runner no pasa es **Actividad reciente**. Es el que conviene corregir antes de liberar.
- La migración de base de datos no toca los esquemas de Caterpillar, Pagos ni Audi: en los ensayos, las huellas de todos los datos ajenos a Manufactura fueron idénticas antes y después de migrar.
- La 025 de recuperación de folios de Caterpillar no forma parte de esta liberación.

## 4. Decisión que se pide
| Opción | Implica |
|---|---|
| **A. Corregir `recent-activity` y aceptar el resto por escrito** (recomendada) | Trabajo pequeño y acotado al runner; el resto queda con responsable y fecha |
| B. Aceptar todo por escrito | Liberar con una revisión manual de Actividad reciente, Caterpillar, Pagos y Audi inmediatamente después del despliegue apagado |
| C. Corregir todos antes de liberar | Retrasa la liberación; exige tocar pruebas de Caterpillar y Pagos (otra línea de trabajo) |
Responsables que deben firmar la aceptación: Caterpillar, Pagos, Audi y el responsable del Hub.
