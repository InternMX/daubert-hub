# Verificación BOLSA_NATURAL

Familia independiente (pestaña «Bolsa Natural» del Excel): comparte la estructura de BOLSA_FUELLE pero su Composición es PMG / ESD / Natural
(sin CP5000, sin coextrusión de tres capas y sin Doblada/Extendida). **No hay línea base validada**: no se compara píxel a píxel.

```
python verificar_bolsa_natural.py [--datos RUTA.json ...] [--salida CARPETA]      # o: npm run test:sheets-bolsa-natural
```

Requiere Node, Google Chrome (`CHROME_PATH`), PyMuPDF y numpy. Salida en `test-results*/<caso>/` (ignorada por Git). La etapa verificada
(BN-1 hasta Peso lb; BN-2 hoja completa) se toma del perfil. Usa la infraestructura común (`../common/hoja_pruebas.py`): el PDF se imprime
en un temporal nuevo y validado, los casos de estrés reportan `LÍMITE DETECTADO` y nunca se analiza un PDF antiguo.

## Composición: restricción del formato
PMG = NA, ESD = NA y Natural = X, siempre (perfil, `restricciones.composicion`). `tools/validate-bolsa-natural-data.mjs` rechaza cualquier
otro valor, la omisión de un campo y la presencia de `comp_cp5000`. Solo cambiaría si Manufactura confirma una variante distinta. Al iniciar,
el verificador comprueba además que la fila Composición de las demás familias sigue siendo PMG / CP5000 / Natural, sin ESD.

## Casos (`datos/`)
| Caso | esperado | Qué prueba |
|---|---|---|
| `ejemplo-original` | valido | Valores del Excel: Bolsa Con Fuelle, 16" x 18", fuelles de 6.25", 3.3 mil, 0.1129 lb; opcionales vacíos. |
| `medidas-distintas` | valido | Otras medidas, fuelles distintos, presentación en Rollo con cantidad. |
| `otro-color` | valido | Producto verde (#00B050) y opcionales llenos con datos de prueba. |
| `descripcion-1-renglon` / `descripcion-2-renglones` | valido | Descripciones habituales: una página carta con 20 pt libres. |
| `etiqueta-extensa` | valido | Etiqueta larga. |
| `descripcion-extensa` / `descripcion-desborde` | estres | Textos extremos; si no caben se reporta `LÍMITE DETECTADO` (no apto para emisión). |
| `invalido-*` | invalido | Composición con PMG o ESD seleccionados, Natural en NA, `comp_cp5000`, omisión de `comp_esd`, Rollo y Paquete ambos en X. |

El relleno `#FFF2CC` de los casos es solo de prueba: **no** se asocia «Natural» con ningún color hasta que Manufactura lo confirme. Los bloques de
firma son marcadores `SIN FIRMA`.
