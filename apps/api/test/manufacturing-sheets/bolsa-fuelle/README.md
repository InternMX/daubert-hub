# Verificación BOLSA_FUELLE · BF-1

Comprueba la estructura general de BOLSA_FUELLE (encabezado, datos generales con Resina VCI, Composición, Presentación,
Cantidad, Medidas con fuelles y Peso lb). **No hay línea base validada**: no se compara píxel a píxel.

```
python verificar_bf1.py [--datos RUTA.json]      # o: npm run test:sheets-bolsa-fuelle
```

Requiere Node, Google Chrome (`CHROME_PATH` si no está en la ruta por defecto), PyMuPDF y numpy. Salida en `test-results/`
(ignorada por Git): HTML, PDF y PNG. Código de salida 0 = OK, 1 = falla.

## Qué verifica

1. El formato es `BOLSA_FUELLE` (explícito en perfil y datos, no depende del color).
2. Placeholders de la plantilla = placeholders del perfil = datos de entrada; ninguno pendiente tras sustituir.
   Los textos se escapan y los colores deben ser `#RRGGBB`.
3. 1 página carta.
4. Están todas las etiquetas del machote y todos los valores de entrada.
5. Sin texto superpuesto ni fuera del área imprimible.
6. Se imprimen los colores corporativos (amarillo, azul oscuro y azul claro).
7. Informa la posición de cada sección (informativo).

`datos/bf1-ejemplo.datos.json` son datos de prueba realistas, no un pedido real.

## Pendiente de medición

Dimensiones definitivas frente a un PDF exportado del Excel original (área de impresión A1:J43, márgenes de 0.25 in).
BF-2 (Dibujo Bolsa, Etiqueta, dibujo técnico, nota y firmas) no está implementado.
