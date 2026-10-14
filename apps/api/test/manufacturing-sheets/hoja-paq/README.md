# Verificación HOJA_PAQ · HP-C

Comprueba la hoja completa de HOJA_PAQ: encabezado, datos generales, tipo de hoja, Medidas sin fuelles, peso, Etiqueta, Dibujo Hoja y
firmas. **No imprime «Dibujo de rollo»**: en la pestaña `Hoja Paq` del Excel las filas 41-47 están ocultas y no hay una regla confirmada
de visibilidad. **No hay línea base validada**: no se compara píxel a píxel.

```
python verificar_hoja_paq.py [--datos RUTA.json ...]      # o: npm run test:sheets-hoja-paq
```

Requiere Node, Google Chrome (`CHROME_PATH`), PyMuPDF y numpy. Salida en `test-results/<caso>/` (ignorada por Git): HTML, PDF y PNG.

## Contrato
Cada caso declara `modalidad` (`DOBLADA` | `EXTENDIDA`) y `esperado`. El validador `src/manufacturing-sheets/tools/validate-hoja-paq-data.mjs`
exige que la modalidad coincida con los indicadores `hoja_doblada`/`hoja_extendida` (uno `X`, el otro `NA`). La modalidad no elige ningún
dibujo y es independiente de la presentación (`pres_rollo`/`pres_paquete`).

| Caso | esperado | Qué prueba |
|---|---|---|
| `bolsa-plana-paquete-extendida` | valido | Referencia visible de la pestaña: Bolsa Plana, Paquete = X, Extendida = X, 58" x 43", 2 MIL, 100 Hojas; un solo dibujo. |
| `extendida-58x43` | valido | Hoja extendida en rollo, 58" x 43". |
| `doblada-pulgadas` | valido | Modalidad Doblada: solo Dibujo Hoja. |
| `extendida-paquete` | valido | Selecciones opuestas (paquete, CP5000) y otras medidas. |
| `descripcion-extensa-doblada` / `-extendida` | valido | Textos muy largos. |
| `seleccion-multiple` | tecnico | Ambas opciones en X: se imprime, pero el validador lo rechaza (no válido en producción). |
| `invalido-*` | invalido | Ambas NA, modalidad contradicha, modalidad desconocida: el validador los rechaza y no se imprime. |

Los casos que pertenecen a ROLLO_CONTINUO (`doblada-2x230`, `invalido-sin-ancho-rollo`) se movieron a
`../rollo-continuo/datos-pendientes/` sin borrarlos; no se ejecutan hasta que exista esa familia.

## Qué verifica en cada caso impreso
Composición y placeholders (plantilla = perfil = datos, sin fuelles, capas ni `ancho_rollo`), 1 página carta, etiquetas y valores impresos,
ausencia de «Dibujo de rollo», orden vertical, sin solapes ni salidas del bloque, tablas y dibujo de 400.4 pt centrados (DOM y píxeles),
`X`/`NA` dinámicos, Etiqueta rosa y completa, cotas `ancho`/`largo` dentro del Dibujo Hoja, relleno con `color_bolsa_hex`, dos zonas de firma
de 105 x 70 pt con `SIN FIRMA`, y holgura vertical mínima de 20 pt.
