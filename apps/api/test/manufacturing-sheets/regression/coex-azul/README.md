# Verificación COEX Azul

Prueba **independiente** de la regresión histórica CONFPMG04 (COEX Verde). Usa la plantilla COEX existente (no hay HTML duplicado) con los datos de
`entrada/coex-azul.datos.json`, que contienen solo valores comprobados en la pestaña «COEX Azul» del Excel original. Cliente, fecha, código DCMX,
descripción y etiqueta quedan vacíos (el Excel no los da); las firmas son `SIN FIRMA`.

```
python verificar_coex_azul.py [--salida CARPETA]      # o: npm run test:sheets-coex-azul
```

**No hay línea base de píxeles**: no existe un PDF oficial de COEX Azul y no se crea una «referencia» a partir del propio borrador. La validación es
estructural, de contenido y visual. Al terminar se comprueba por huella que `../coex-confpmg04/entrada` y `referencia/` no cambiaron.

## Qué verifica
Una página carta y al menos 20 pt libres; sin placeholders pendientes; todos los valores y rótulos impresos (incluida «Etiqueta:» sin valor); X/NA de
Composición y Presentación; sin textos recortados ni superpuestos; firmas `SIN FIRMA` en sus contenedores; colores impresos del cuerpo, de las tres capas y
de las cotas internas; barra inferior `#244062` que sobresale por ambos lados del cuerpo; y que los colores del dato no se desvíen de los aprobados.
El PDF se genera de forma segura con `../../common/hoja_pruebas.py` (temporal nuevo y validado; nunca se analiza un PDF antiguo).

## Colores aprobados y procedencia (Excel original)
| Elemento | Valor | Procedencia |
|---|---|---|
| Cuerpo | `#558ED5` | celdas D29:H40: tema `dk2` (#1F497D) con tint +0.4 |
| Capa interior | `#376092` | forma con `accent1` al 75 % |
| Capa intermedia | `#95B3D7` | `accent1` al 60 % + 40 % |
| Capa exterior | `#C6D9F1` | `tx2` al 20 % + 80 % |
| Cotas internas | `#4A7EBB` | estilo de conector `accent1` por defecto (el mismo de COEX Verde) |
| Barra inferior | `#244062` | `accent1` al 50 % más oscuro; parte de la geometría COEX |

Criterio de conversión: HLS en coma flotante (`lumMod/lumOff`: L' = L·mod + off; tint > 0: L' = L·(1 − tint) + tint); reproduce el exterior de COEX Verde
(`#D7E4BD`). Puede diferir ±1-2 niveles RGB de la paleta de Office (`#538DD5`, `#366092`, `#C5D9F1`), que se conservan como referencia visual.

## Diferencias aceptadas provisionalmente respecto al Excel
- El cuerpo del Excel Azul ocupa una fila más (≈ 13.6 pt en el PDF): se conserva la geometría de COEX Verde (holgura y diseño uniforme).
- «Etiqueta:» se imprime sin valor (la franja rosa del Excel está vacía).
- **Legibilidad:** las cotas internas `#4A7EBB` sobre `#558ED5` tienen contraste 1.24:1; es el color original y no se cambió. Alternativas por confirmar
  con Manufactura: blanco (3.4:1), `#1F497D` (2.7:1) o contorno blanco.
