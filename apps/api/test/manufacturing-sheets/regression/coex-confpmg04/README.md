# Regresión COEX Verde · CONFPMG04

Línea base de regresión de la plantilla COEX
(`apps/api/src/manufacturing-sheets/templates/coex/`), validada contra el PDF original CONFPMG04.

## Contenido

| Archivo / carpeta | Qué es |
|---|---|
| `entrada/confpmg04.datos.json` | Datos de entrada completos, agrupados en `datos`, `visual` y `firmas`. Los bloques de firma son marcadores `SIN FIRMA`: no hay firmas reales. |
| `referencia/confpmg04.html` / `.pdf` / `.png` | HTML renderizado, PDF y rasterizado (150 dpi) validados. |
| `referencia/coordenadas.json` | Posiciones y dimensiones validadas (pt): secciones, filas, logo, título y bloques de firma. |
| `referencia/texto_posiciones.json` | Cada palabra del PDF con su caja (pt). |
| `referencia/entorno.json` | Motor, versión, fuente y parámetros de impresión de la línea base. |
| `fuente/SHA256SUMS.txt` | Huellas SHA-256 de la plantilla y sus recursos. |
| `comparar_regresion.py` | Ejecuta la prueba. |
| `test-results/` | Salida temporal de cada ejecución (ignorada por Git). |

## Ejecución

```
python comparar_regresion.py                          # compara la plantilla actual contra la referencia
python comparar_regresion.py --plantilla RUTA.html    # compara otra versión
python comparar_regresion.py --generar-linea-base     # SOLO con aprobación: reemplaza la referencia
```

Requiere Google Chrome (`CHROME_PATH` si no está en la ruta por defecto), PyMuPDF y numpy.
Código de salida 0 = OK, 1 = falla. **Si falla, no se regenera la referencia para ocultar la diferencia.**

## Qué verifica

1. Los placeholders de la plantilla (sin contar comentarios) coinciden con los datos de entrada: ninguno falta ni sobra, y ninguno queda pendiente tras renderizar.
2. El PDF tiene 1 página carta.
3. Coordenadas del HTML y de cada palabra del PDF dentro de ±0.15 pt de la línea base.
4. Imagen idéntica píxel a píxel, **solo si el entorno coincide** con `referencia/entorno.json` (Chrome, sistema operativo, MuPDF, parámetros, dpi). Si cambia, la prueba lo avisa y no compara píxeles.

## Entorno de referencia

Windows 11, Google Chrome 155.0.8059.40 (headless, `--print-to-pdf`, `--no-pdf-header-footer`), fuente Calibri. No se asume
todavía el sistema operativo de producción: con otra fuente (Carlito, Arial) cambian saltos de línea y alturas, y habrá
que generar otra línea base con aprobación.

## Reglas de sustitución del arnés (a respetar por el backend)

- Los campos de texto se escapan (`html.escape`).
- Los colores deben ser `#RRGGBB`; cualquier otro valor se rechaza.
- Los bloques de firma son HTML de confianza generado por el backend. En esta prueba solo se admite el marcador `SIN FIRMA`.

## Notas

- Finales de línea: `.gitattributes` fija LF en plantillas y pruebas. La plantilla original en Dropbox usaba CRLF; la copia en LF
  produce el mismo PDF (comprobado con esta prueba).
- Las coordenadas del HTML se miden con el diseño de pantalla (no con `@media print`); el PDF y la imagen son la medida definitiva.
- La prueba valida COEX Verde. No cubre COEX Azul (cambia solo datos y paleta), Bolsa Fuelle ni Hoja Paq.
- El proyecto original en Dropbox no se modifica ni se elimina.
