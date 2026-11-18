# Verificación BOLSA_PLANA_1

Pestaña «Bolsa Plana 1» del Excel. **Sin** Doblada/Extendida, fuelles, capas de coextrusión ni dibujo de rollo. No hay línea base validada:
no se compara píxel a píxel.

```
python verificar_bolsa_plana_1.py [--datos RUTA.json ...]      # o: npm run test:sheets-bolsa-plana-1
```

Requiere Node, Google Chrome (`CHROME_PATH`), PyMuPDF y numpy. Salida en `test-results/<caso>/` (ignorada por Git). La etapa verificada
(BP-1 hasta Peso lb; BP-2 hoja completa) se toma del perfil.

| Caso | Qué prueba |
|---|---|
| `ejemplo-original` | Valores de la captura: 19.68" x 19.68", calibre 300, 0.077 lb, paquete de 250. Código DCMX ficticio (el real no es legible); hex azul provisional. |
| `verde-medidas-distintas` | Color verde confirmado y otras medidas. |
| `rojo-rollo-cp5000` | Presentación en rollo, CP5000 y otra cantidad (rojo solo de prueba). |
| `descripcion-extensa` | Textos muy largos: peor caso de altura. |
| `etiqueta-extensa` | Etiqueta larga. |

## Casos de descripción y límites de impresión (VT-1 a VT-4)
Casos: descripcion-1-renglon, descripcion-2-renglones (producción) y descripcion-extensa / descripcion-desborde (estrés). Las descripciones reales ocupan uno o dos renglones: los casos de producción exigen una página carta, al menos 20 pt libres,
sin placeholders pendientes y con el texto íntegro (`renglones_descripcion` verifica cuántos renglones ocupa la descripción). Los casos
`estres` se ejecutan igual, pero si exceden la página o la holgura se informan como `LÍMITE DETECTADO` (páginas generadas y excedente), sin
truncar ni reducir la escala, y el caso queda marcado con `NO_APTO_PARA_EMISION.txt` en su carpeta de resultados. El PDF se imprime en un
archivo temporal nuevo y validado (`../common/hoja_pruebas.py`): si Chrome falla, no genera el archivo o el PDF está bloqueado, la prueba
falla indicando la ruta y nunca analiza un PDF anterior. Uso: `python verificar_bolsa_plana_1.py [--datos ...] [--salida CARPETA]`.
