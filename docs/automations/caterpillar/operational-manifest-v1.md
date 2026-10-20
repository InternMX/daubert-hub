# Manifest operativo Caterpillar V1 — contrato provisional verificable

Estado: utilidad pura implementada y probada, **sin integración, claims ni bloqueo automático**.
TEST vivo es fuente de verdad. No hubo acceso de lectura a ese workflow; evidencia provisional:
`n8n/workflows/remisiones-caterpillar/test/workflow.json`, nodo `Normalizar datos CAT` (nombre en línea 122).
No se modificó ningún workflow. NUEVOS/ULTIMO_GLOBAL no aparecen en los exports inspeccionados:
es obligatorio verificar selección/versionado de ambos antes de activar protección.

## Punto exacto y procedencia de campos

Implementación: `apps/api/src/automations/remisiones-caterpillar/caterpillar-operational-manifest.ts`.
Entrada: array de `item.json` de la variable **salida**, antes de `agruparTorreonPorOC(salida)`.
En el código embebido del nodo: lecturas F4/A/D/I/J/K en líneas 1020–1029; construcción de salida en
1381–1440; agrupación en 1450–1453. Normal utiliza esa misma salida como resultado final.

- Contexto: `cliente_grupo`, `planta_codigo`, `subplanta_codigo` del detector.
- Cliente: `cliente`, `rfc` del catálogo resuelto. Identificación descriptiva, no ID de obligación.
- `fecha_entrega`: F4; nunca `fecha_archivo_iso`, last_write_time ni timestamp de procesamiento.
- `codigo`: A normalizada, `numero_parte`: catálogo, `orden_compra`: K con trim y sin quitar ceros.
- `cantidad_numerica`: número JS positivo ya seleccionado de I/J según unidad del catálogo;
  no se vuelve a interpretar el texto regional. No se introducen sumas ni redondeos.
- `unidad_remision`: unidad canónica emitida por el pipeline: BOLSAS/HOJAS/ROLLOS/PAQUETES/PIEZAS.
- Normal: un documento por ocurrencia de artículo. Torreón: un documento por OC con varias ocurrencias.

**No** usar el resultado Torreón ya agrupado: reemplaza código/parte por OC y reduce cada artículo a
código, cantidad_torreon formateada a cuatro decimales, unidad_torreon, descripción y finanzas. Se pierde
la parte y cantidad numérica original de cada renglón. La utilidad rechaza explícitamente ese input.
Requerirá transportar un manifest/snapshot preagrupación antes de conectar el control previo a reserva.

## Algoritmo normativo

1. Exigir al menos una línea y un único ámbito/cliente/fecha por manifest. Campos incompletos o fechas
   ambiguas fallan; no se adivina. Subplanta/RFC/número de parte pueden ser vacíos tal como en salida.
2. Trim de textos; código mayúsculas y sin espacios (misma regla comprobada del normalizador).
   OC, parte y nombres conservan caso, acentos, ceros y puntuación. Son diferencias conservadoras.
3. Fecha DD/MM/YYYY válida → YYYY-MM-DD (calendario explícito, sin Date ni zona horaria).
4. Cantidad es el Number de salida, finito >0. No convertir strings, formatos regionales ni otros tipos.
   La precisión perdida antes por el pipeline no puede recuperarse aquí; revisar ese límite con TEST.
5. Línea canónica: tupla `[codigo, numero_parte, orden_compra, cantidad_numerica, unidad_remision]`.
6. Agrupar solo Torreón (`cliente_grupo === CAT_TORREON`) por OC exacta; normal conserva un documento por
   línea. No sumar ni eliminar repeticiones. Ordenar líneas/documentos por comparación lexicográfica de
   JSON (operadores `<`/`>`, unidades UTF-16), nunca localeCompare.
7. Construir claves exactamente en este orden:
   `{version, scope, deliveryDate, grouping, documents}`.
   scope: `[cliente_grupo, planta_codigo, subplanta_codigo, cliente, rfc]`.
   documents: `[{purchaseOrder, lines}]`. version: CAT_OPERATIONAL_CONTENT_V1.
8. Serializar con JSON.stringify sin espacios. Esa cadena es el vector canónico; no mutar input.
   Un hash futuro se calculará SHA-256 sobre UTF-8 de esa cadena, sin BOM ni salto de línea.

Ruta, nombre, hash físico, folio, PDF, execution ID y orden original de filas no entran al manifest.
Descripción, empaque y finanzas requieren snapshot separado de renderizado; esta equivalencia es de
**contenido operativo seleccionado**, no equivalencia visual/financiera de todos los documentos.
No cambiar de versión silenciosamente si cambia el contrato.

## Equivalencia no es identidad

`compareCaterpillarOperationalContent(a,b)` devuelve:
`{contentEquivalent: boolean, deliveryIdentity: 'UNCONFIRMED'}`.

Ni dos manifests idénticos, ni misma OC/fecha/producto/cantidad demuestran una obligación única.
Otra entrega legítima puede tener contenido igual. No se acepta nombre/ruta ni un flag de cliente como
prueba autorizada. Falta clave/ocurrencia de entrega confiable, reglas de revisiones, significado de modos
y autorización durable vinculada al manifest para distinguir entregas, correcciones y sustituciones.
Cambiar modo no debe constituir otro namespace que permita eludir deduplicación.

## Vectores y portabilidad a n8n

`apps/api/test/fixtures/caterpillar-manifest-v1.json` incluye base sintética, cadena canónica exacta y
parches con resultado esperado: renombrado/ruta, hash/fecha física, cantidad, OC, F4, planta/subplanta,
cliente, parte y unidad. Las pruebas añaden orden inverso, repetición, corrección parcial, entrega igual,
agrupación Torreón, fechas inválidas y números no operativos.

Para implementar en n8n: portar este único algoritmo sin tipos TS, ejecutar los mismos vectores y exigir
igualdad byte a byte con canonicalJson. No crear otra normalización independiente de Excel. Verificar
también el manifest de un ejemplo real autorizado contra la salida TEST viva, antes de activar cambios.

## Integración futura, no conectada

Construir antes de agrupar; validar después de normalizar y **antes de Preparar reserva folios PG**,
que reduce el contexto a ejecución/serie/cantidad. Resolver IDs cliente/ruta en servidor.
Registro lógico de versiones/decisiones + claim transaccional único y reserva autorizada, no SELECT
seguido de reserva sin exclusión. Manifest igual sin obligación confiable = sospecha para revisión,
no duplicado confirmado ni permiso automático. Revisiones parciales requieren diff y tratamiento de
efectos ya emitidos, no reprocesar todo ni inferir un delta a ciegas. Reproceso y regeneración autorizados
deben acreditar linaje/selección, nunca un bypass permanente. Esta fase no crea tabla de claims.
