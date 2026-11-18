# Verificación BOLSA_FUELLE · BF-2

Comprueba la hoja completa de BOLSA_FUELLE. **No hay línea base validada**: no se compara píxel a píxel.

```
python verificar_bolsa_fuelle.py [--datos RUTA.json ...]      # o: npm run test:sheets-bolsa-fuelle
```

Sin argumentos ejecuta todos los `datos/*.datos.json`. Requiere Node, Google Chrome (`CHROME_PATH` si no está en la ruta por
defecto), PyMuPDF y numpy. Salida en `test-results/<caso>/` (ignorada por Git): HTML, PDF y PNG. Código de salida 0 = OK, 1 = falla.

## Casos (`datos/`)

| Caso | Qué prueba |
|---|---|
| `azul-ejemplo` | Medidas del ejemplo (61", 70.9", fuelles de 24") y producto azul `#538DD5`. |
| `verde-medidas-distintas` | Producto verde `#00B050` y otras medidas: el SVG es dinámico. |
| `rojo-otro-color` | Otro color de producto (rojo, solo de prueba; no es un código confirmado). |
| `descripcion-extensa` | Descripción y cliente muy largos: las filas crecen sin superponerse. |
| `etiqueta-extensa` | Etiqueta larga de producto industrial. |

Son datos de prueba, no pedidos reales. Los bloques de firma son marcadores `SIN FIRMA`; nunca firmas reales.

## Qué verifica en cada caso

1. Formato `BOLSA_FUELLE` explícito; placeholders de la plantilla = perfil = datos; ninguno pendiente. Los textos se escapan, los colores
   deben ser `#RRGGBB` y los bloques de firma solo pueden ser el marcador `SIN FIRMA`.
2. 1 página carta.
3. Todas las etiquetas del machote, todos los valores, el título y la nota de manufactura.
4. Los dos contenedores de firma existen y contienen su marcador.
5. Las secciones respetan el orden, no se solapan y no salen del área imprimible; ningún texto se superpone ni sale de la página.
6. La etiqueta cabe completa en su celda.
7. Las cotas (ancho, largo, fuelles) aparecen dentro del dibujo.
8. Colores impresos: relleno de la bolsa = `color_bolsa_hex`, sello inferior más claro integrado dentro del contorno (sin barra ni base por fuera), cotas internas con su color, nota amarilla
   y Etiqueta rosa (tolerancia de 2 niveles por canal por el rasterizado).

## Pendiente de medición

Dimensiones definitivas frente a un PDF exportado del Excel original (área de impresión A1:J43, márgenes de 0.25 in).

## Casos de descripción y límites de impresión (VT-1 a VT-4)
Casos: descripcion-1-renglon, descripcion-2-renglones (producción) y descripcion-extensa / descripcion-desborde (estrés). Las descripciones reales ocupan uno o dos renglones: los casos de producción exigen una página carta, al menos 20 pt libres,
sin placeholders pendientes y con el texto íntegro (`renglones_descripcion` verifica cuántos renglones ocupa la descripción). Los casos
`estres` se ejecutan igual, pero si exceden la página o la holgura se informan como `LÍMITE DETECTADO` (páginas generadas y excedente), sin
truncar ni reducir la escala, y el caso queda marcado con `NO_APTO_PARA_EMISION.txt` en su carpeta de resultados. El PDF se imprime en un
archivo temporal nuevo y validado (`../common/hoja_pruebas.py`): si Chrome falla, no genera el archivo o el PDF está bloqueado, la prueba
falla indicando la ruta y nunca analiza un PDF anterior. Uso: `python verificar_bolsa_fuelle.py [--datos ...] [--salida CARPETA]`.
