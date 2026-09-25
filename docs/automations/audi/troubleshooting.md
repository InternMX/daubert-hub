# Audi — Troubleshooting

Formato: **síntoma → causa probable → qué revisar → acción segura → qué NO hacer**. Causas derivadas del export real. Diagnóstico SQL sólo con transacciones `READ ONLY`. Plataforma: [operations/troubleshooting](../../operations/troubleshooting.md).

## 1. El workflow no dispara

- **Síntoma:** no hay ejecuciones nuevas en n8n ni en el Hub.
- **Causa probable:** workflow inactivo; instancia n8n detenida; schedule sin ejecutar.
- **Qué revisar:** interruptor *Active* de `Remisiones AUDI PRODUCCION`; historial de ejecuciones; que el servicio n8n esté en marcha.
- **Acción segura:** activar/recuperar n8n y confirmar el siguiente ciclo (15 min).
- **Qué NO hacer:** no activar el workflow de PRUEBAS ni la versión con contadores JSON.

## 2. Falla al inicio: "Automatización inactiva" / "Serie inactiva" / "Serie incorrecta"

- **Síntoma:** error en `Validar configuración PostgreSQL`.
- **Causa probable:** ese nodo exige `REMISIONES_AUDI` y `REMISION_AUDI` en `ACTIVA`.
- **Qué revisar:** `ops.automatizaciones.estatus`, `operacion.series_documentales.estatus` (sólo lectura).
- **Acción segura:** decisión de negocio para reactivar; no cambiar por SQL sin registro.
- **Qué NO hacer:** no editar el código del nodo para saltar la validación.

## 3. No se procesa un archivo nuevo

- **Síntoma:** el Excel está en la carpeta pero no genera ejecución.
- **Causa probable (verificada en el detector):** nombre sin "programacion de entrega"/"audi"; no es `.xlsx` o es temporal; menos de 2 min de antigüedad o más de 60 días; carpeta de año fuera de la ventana (actual ±1); carpeta que no es de "información adicional" o subcarpeta *remisiones/facturas/recibida*; **más de 20 archivos completados más antiguos** por delante en la lista; ya `COMPLETADA`/`PROCESANDO` en PostgreSQL; archivo sobrescrito en una ruta ya procesada.
- **Qué revisar:** ruta y nombre; `ops.ejecuciones_automatizacion` del documento (por ruta en `core.documentos`).
- **Acción segura:** corregir nombre/ubicación; para archivos sobrescritos, usar un nombre/ruta nuevos acordado con el negocio.
- **Qué NO hacer:** no borrar ejecuciones ni documentos para "forzar" el reprocesamiento.

## 4. "Se encontró más de una empresa relacionada con Audi" / "No se encontró cliente Audi"

- **Síntoma:** error en `Validar cliente Audi PG`.
- **Causa probable:** la búsqueda `ILIKE '%AUDI%'` sobre todo el registro de `core.empresas` encuentra 0 o más de 1.
- **Qué revisar:** empresas nuevas cuyo registro contenga "AUDI".
- **Acción segura:** escalar; requiere ajustar el workflow (búsqueda exacta) o los datos.
- **Qué NO hacer:** no borrar empresas.

## 5. Una ejecución queda `PROCESANDO`

- **Síntoma:** ejecución `PROCESANDO` que no avanza; el archivo ya no se vuelve a procesar.
- **Causa probable:** fallo después de `Crear ejecución PG`. El manejador sólo escribe un log y **no** cambia el estado; el archivo queda excluido por `ya_procesando_pg`. También si n8n se reinició a mitad de ciclo.
- **Qué revisar:** `ERROR_*.json` en `04_ERRORES` (nodo y mensaje); `log_<run_name>.csv`; folios reservados y remisiones parciales de esa ejecución; PDFs generados.
- **Acción segura:** corregir la causa y decidir con el negocio cómo cerrar la ejecución (marcarla `ERROR`/`CANCELADA` para que el archivo vuelva a ser candidato). **El procedimiento formal está PENDIENTE**; sólo con aprobación y respaldo, sin reciclar folios ya emitidos.
- **Qué NO hacer:** no borrar la ejecución; no reutilizar folios reservados sin revisar los PDFs; no duplicar remisiones.

## 6. Folios saltados

- **Síntoma:** huecos en la serie `REMISION_AUDI`.
- **Causa probable:** `reservar_folios` consumió folios y el flujo falló antes de registrar remisiones.
- **Qué revisar:** remisiones y PDFs de la ejecución afectada.
- **Acción segura:** documentar el hueco; ajustar `siguiente_folio` sólo con el ajuste seguro del Hub ([document-series](../../database/document-series.md)) y sólo si corresponde.
- **Qué NO hacer:** no editar `siguiente_folio` por SQL.

## 7. Duplicado de remisiones o PDFs

- **Síntoma:** dos remisiones/PDFs para el mismo archivo.
- **Causa probable:** dos workflows activos (versión anterior con contadores JSON, o PRUEBAS) sobre los mismos archivos/serie; o intervención manual.
- **Qué revisar:** workflows activos; folios repetidos en `operacion.remisiones`; carpeta de salida.
- **Acción segura:** desactivar el que sobra y auditar con el negocio. PostgreSQL impide repetir (serie+folio no cancelado) pero no protege de folios distintos para el mismo archivo.
- **Qué NO hacer:** no borrar PDFs ni filas sin revisión.

## 8. PDF no generado / error en conversión

- **Síntoma:** falla en `Convertir PDF` o `Convertir PDF HI`.
- **Causa probable:** script `convertir-audi-pdf.ps1` ausente o con error; plantilla HTML ausente; carpeta temporal sin permisos; Dropbox bloqueando archivos.
- **Qué revisar:** log de la ejecución del subworkflow; existencia de plantillas y scripts en `05_ARCHIVOS AUXILIARES`; `06_ARCHIVOS TEMPORALES\html`.
- **Acción segura:** restaurar scripts/plantillas y tratar la ejecución `PROCESANDO` como en el caso 5.
- **Qué NO hacer:** no editar plantillas de PROD sin probar (los subworkflows los usa también TEST).

## 9. "El catálogo de productos está vacío" / artículo no catalogado

- **Síntoma:** error en `Normalizar datos` / `Preparar catalogo productos`.
- **Causa probable:** `Catalogo_Productos_Audi.xlsx` ausente, hoja `Catalogo_Productos` renombrada o vacía. Un número de parte no catalogado no falla: usa el fallback y por defecto **bolsas**.
- **Acción segura:** restaurar el catálogo; verificar formatos (tubos/bolsas) antes de emitir.
- **Qué NO hacer:** no editar el catálogo mientras corre un ciclo.

## 10. "No se encontraron productos válidos con cantidad mayor a cero"

- **Causa probable:** filas 8–13 con cantidad cero o columnas faltantes; o artículos fuera de esas filas.
- **Qué revisar:** el Excel con el negocio.
- **Acción segura:** corregir el archivo; el error ocurre antes de reservar folios.

## 11. Falla el manejador de errores

- **Causa probable:** la ruta fija `…\REMISIONES AUDI\04_ERRORES` (de PROD) no existe o no es escribible.
- **Qué revisar:** que la carpeta exista y tenga permisos.
- **Acción segura:** crearla; el manejador no reintenta nada.

## 12. TEST funciona y PROD no (o al revés)

- **Causa probable:** **no son equivalentes**: PROD tiene la selección de candidatos con PostgreSQL que TEST no tiene; TEST usa otra carpeta de entrada y aún lee un JSON de estado; credencial PG distinta.
- **Qué revisar:** [n8n-test-prod-drift](../n8n-test-prod-drift.md#audi).
- **Acción segura:** validar el cambio en ambos; no asumir paridad.

## 13. PostgreSQL sin conexión / credencial incorrecta

- **Síntoma:** errores en nodos `postgres`.
- **Causa probable:** PostgreSQL caído o inalcanzable; credencial equivocada (p. ej. `Postgres pruebas` en PROD).
- **Qué revisar:** que los nodos tengan `Postgres produccion`; el nodo suelto `Execute a SQL query` puede ejecutarse manualmente para ver `current_database()` y `current_user`.
- **Acción segura:** restablecer PostgreSQL; reasignar la credencial correcta.
- **Qué NO hacer:** no apuntar PROD a la base de pruebas "temporalmente".
