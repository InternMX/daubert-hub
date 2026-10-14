# Verificación HOJA_PAQ · HP-2

Comprueba la hoja completa de HOJA_PAQ (encabezado, datos generales, tipo de hoja, Medidas sin fuelles, peso, Etiqueta, Dibujo Hoja,
dibujo de rollo y firmas). **No hay línea base validada**: no se compara píxel a píxel.

```
python verificar_hoja_paq.py [--datos RUTA.json ...]      # o: npm run test:sheets-hoja-paq
```

Requiere Node, Google Chrome (`CHROME_PATH`), PyMuPDF y numpy. Salida en `test-results/<caso>/` (ignorada por Git): HTML, PDF y PNG.

## Contrato y modalidad
Cada caso declara `modalidad` (`DOBLADA` | `EXTENDIDA`) y `esperado`. El validador `src/manufacturing-sheets/tools/validate-hoja-paq-data.mjs`
exige que la modalidad coincida con los indicadores `hoja_doblada`/`hoja_extendida` (uno `X`, el otro `NA`) y que exista `ancho_rollo`.
El perfil (`modalidades`) elige la variante del dibujo de rollo y su título; la plantilla no decide nada.

| Caso | esperado | Qué prueba |
|---|---|---|
| `extendida-58x43` | valido | Referencia del Excel: 58" x 43", rollo de 58", dibujo de rollo extendido. |
| `doblada-2x230` | valido | Referencia de la captura: 2 mts x 230 mts, rollo doblado de 1 metro. |
| `doblada-pulgadas` | valido | Doblada con ancho de rollo distinto de la mitad del ancho de la hoja; color de prueba. |
| `extendida-paquete` | valido | Selecciones opuestas (paquete, CP5000) y rollo de otra medida. |
| `descripcion-extensa-doblada` / `-extendida` | valido | Textos muy largos: peor caso de altura en cada modalidad. |
| `seleccion-multiple` | tecnico | Ambas opciones en X: se imprime para probar el componente, pero el validador lo rechaza (no válido en producción). |
| `invalido-*` | invalido | Ambas NA, modalidad contradicha, sin ancho de rollo, modalidad desconocida: el validador los rechaza y no se imprime. |

## Qué verifica en cada caso impreso
Composición y placeholders (plantilla = perfil = datos, sin fuelles ni capas, ninguno pendiente), variante gráfica correcta (círculos para
doblado, elipses para extendido) y título del rollo, 1 página carta, etiquetas y valores impresos, orden vertical de las secciones, sin
solapes ni salidas del bloque, tablas y dibujos de 400.4 pt centrados (DOM y píxeles), `X`/`NA` dinámicos, Etiqueta rosa y completa, cotas
`ancho`/`largo` dentro del Dibujo Hoja y `ancho_rollo` dentro del dibujo de rollo, relleno de la hoja con `color_bolsa_hex`, y dos zonas de
firma de 105 x 70 pt con su marcador `SIN FIRMA`, simétricas y sin tocarse.
