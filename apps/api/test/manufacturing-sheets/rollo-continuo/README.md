# Verificación ROLLO_CONTINUO

Familia independiente de HOJA_PAQ (pestaña «Rollo Continuo» del Excel). **No tiene la fila «Cantidad Por Rollo o Paquete».** No hay línea
base validada: no se compara píxel a píxel.

```
python verificar_rollo_continuo.py [--datos RUTA.json ...]      # o: npm run test:sheets-rollo-continuo
```

Requiere Node, Google Chrome (`CHROME_PATH`), PyMuPDF y numpy. Salida en `test-results/<caso>/` (ignorada por Git). La etapa verificada
(RC-1 hasta Peso, RC-2 hoja completa con Etiqueta, Dibujo de hoja, Dibujo de rollo doblado y firmas) se toma del perfil.

## Contrato
`modalidad` (`DOBLADA` | `EXTENDIDA`) explícita, validada contra `hoja_doblada`/`hoja_extendida`; `ancho_rollo` obligatorio e independiente de
`ancho`; EXTENDIDA no tiene variante gráfica confirmada y el validador (`tools/validate-rollo-continuo-data.mjs`) la rechaza.

| Caso | esperado | Qué prueba |
|---|---|---|
| `doblada-2x230` | valido | Referencia del Excel: ROLLO VCI, Rollo = X, Doblada = X, METROS (MTS), 2 mts x 230 mts, 2.5 MIL, rollo de 1 metro. |
| `doblada-pulgadas` | valido | Otras medidas y color de producto; ancho de rollo distinto de la mitad del ancho. |
| `doblada-azul-paquete` | valido | Producto azul, paquete y CP5000. |
| `descripcion-extensa` | valido | Textos muy largos. |
| `seleccion-extendida-tecnico` | tecnico | Extendida = X: se imprime para probar la fila de selección, pero el validador lo rechaza. |
| `invalido-*` | invalido | Indicadores inconsistentes, ambas X, EXTENDIDA no soportada, modalidad desconocida, sin `ancho_rollo`. |
