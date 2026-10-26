# Manifest Caterpillar — smoke sintético independiente para 5678

**Preparado offline en 3F; validación manual 3G en n8n Windows comunicada por el operador: PASS.**
No es el workflow operativo completo. El archivo versionado permanece inactivo.
El candidato de 3E conserva todos sus bloqueos y no debe utilizarse para este diagnóstico.

## Contenido

- `caterpillar-manifest-smoke-5678.INACTIVE.json`: exactamente Manual Trigger → Code; inactivo.
- `expected-results.json`: valores canónicos completos y SHA-256 esperados, obtenidos de las fuentes V1.
- `prepare-smoke.cjs`: generador offline; rechaza sobrescribir los artefactos.
- `validate-smoke.cjs`: validación offline de estructura, pureza, valores y detección de discrepancias.

El Code contiene únicamente el factory portable V1 generado en 3E, SHA-256 puro JavaScript y dos
muestras incorporadas de forma literal. No usa input, módulos, NestJS/TypeScript, filesystem, PostgreSQL,
webhooks, schedules, comandos, HTTP, correo o llamadas a otros workflows. Ningún dato es empresarial real.

Casos: planta estándar P5 y Torreón `TORREON`/`PLANTA_2`. Cada caso representa un lote sintético de
tres partidas en un mismo ámbito/fecha/OC, incluida una repetición exacta, cantidades decimales y
OC textual `000042`. Se calculan por separado: V1 no mezcla entregas/ámbitos en un mismo manifest.
Los tres documentos de contenido estándar y el documento agrupado de Torreón son SOLO estructuras
del manifest: no se generan documentos ni se reservan folios.

## Oráculo y comparación

El generador compila los DOS módulos TypeScript originales por separado en memoria y calcula sus
resultados. Esos JSON canónicos y hashes (Node crypto, SHA-256 UTF-8) se fijan como constantes dentro
del Code y en `expected-results.json`. No se recalcula el esperado en n8n con el mismo factory que
se está examinando. El cálculo ejecutado por el Code usa el JavaScript portable de 3E.

Cada caso devuelve solo diagnóstico: versión, cantidad de partidas/documentos de contenido, hash
calculado/esperado, comparación de JSON canónico y hash, identidad `UNCONFIRMED` y `status: PASS/FAIL`.
No devuelve rutas ni payloads de remisiones. Cualquier discrepancia marca FAIL; un error del sandbox
que impida ejecutar el Code es un fallo de compatibilidad, no una validación aprobada.

SHA-256 se implementa sin módulos para no requerir habilitar `crypto` en la instancia compartida.
Se contrasta offline con Node crypto usando cadena vacía, ASCII, múltiples bloques y Unicode, además
de ambos manifests. También se altera una cantidad en memoria para comprobar que produce FAIL.
La huella no demuestra identidad de entrega ni implementa deduplicación.

Validación local (no conecta con n8n):

```powershell
node n8n/workflows/remisiones-caterpillar/diagnostics-5678/validate-smoke.cjs
```

## Evidencia manual de 3G recibida al cerrar 4A

El operador informó ejecución del diagnóstico independiente de dos nodos en n8n Windows,
`localhost:5678`, con estos resultados:

| Caso | Resultado | Comparación | Identidad |
|---|---|---|---|
| STANDARD_SYNTHETIC | PASS | JSON canónico y SHA-256 exactos | UNCONFIRMED |
| TORREON_SYNTHETIC | PASS | JSON canónico y SHA-256 exactos | UNCONFIRMED |

Versión confirmada: `CAT_OPERATIONAL_CONTENT_V1`. Según esa evidencia no se realizaron operaciones
sobre PostgreSQL, Dropbox ni remisiones. Los valores esperados completos siguen en `expected-results.json`.
No se aportó execution ID, export de ejecución ni fecha/hora exacta; esta sección registra el resultado
comunicado, no una comprobación independiente del runtime por el agente en 4A. No se vuelve a ejecutar n8n.

El validador local conserva `liveRuntimeTested:false`: ese script solo verifica offline y no pretende
consultar n8n. La evidencia manual acredita cálculo sintético, NO el workflow completo, sus credenciales,
rutas, scripts, folios, aislamiento TEST/PROD o identidad inequívoca de entrega. El candidato de 3E
continúa bloqueado; no hay autorización implícita para habilitarlo ni para deduplicar por coincidencia.

## Procedimiento de importación/prueba registrado en 3F (solo referencia)

1. Confirmar URL `http://localhost:5678/` e importar **solo** el JSON smoke como workflow nuevo,
   independiente; no sobrescribir Caterpillar TEST/PROD, Pagos o el candidato completo.
2. Comprobar dos nodos, una conexión, ninguna credencial y estado inactivo. No conectar a otros flujos.
3. Mantenerlo inactivo: el Manual Trigger permite una prueba deliberada sin activar schedules/webhooks.
4. Solo con autorización posterior, ejecutar manualmente el smoke y revisar DOS items: ambos PASS,
   comparación canónica y hash verdaderos, tres partidas por caso e identidad UNCONFIRMED. Comparar
   los hashes también con el archivo esperado, sin editar las constantes para superar discrepancias.
5. No habilitar operaciones del candidato completo como consecuencia automática de este resultado:
   este smoke acredita únicamente compatibilidad de cálculo, no credenciales, rutas, scripts o folios.
