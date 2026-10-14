# Verificación HOJA_PAQ · HP-1

Comprueba la parte superior de HOJA_PAQ (encabezado, datos generales, tipo de hoja, Medidas sin fuelles y peso). **No hay línea base
validada**: no se compara píxel a píxel. Dibujos, Etiqueta y firmas son de HP-2.

```
python verificar_hoja_paq.py [--datos RUTA.json ...]      # o: npm run test:sheets-hoja-paq
```

Requiere Node, Google Chrome (`CHROME_PATH`), PyMuPDF y numpy. Salida en `test-results/<caso>/` (ignorada por Git): HTML, PDF y PNG.

| Caso | Qué prueba |
|---|---|
| `ejemplo-doblada` | Medidas del machote (58", 43", 2 MIL), hoja doblada, rollo. |
| `extendida-paquete` | Selecciones opuestas (extendida, paquete, CP5000) y otras medidas. |
| `seleccion-multiple` | Doblada y Extendida ambas en X: las marcas son independientes. |
| `descripcion-extensa` | Cliente, producto y descripción muy largos; peor caso de altura. |

Verifica por caso: composición, placeholders plantilla = perfil = datos (sin fuelles ni capas, ninguno pendiente), 1 página carta,
etiquetas y valores impresos, título sin COEXTRUSIÓN, nada de HP-2, sin solapes ni salidas de página, tablas de 400.4 pt con márgenes
iguales (DOM y píxeles del PDF), `X` en amarillo y `NA` sin color según los datos, y presupuesto vertical para HP-2
(≥ 340 pt libres; ≥ 280 pt en el peor caso).
