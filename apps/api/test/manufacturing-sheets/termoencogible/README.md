# Verificación TERMOENCOGIBLE

Familia independiente (no es Rollo Continuo: sus dibujos representan otros elementos). **Sin** fila «Cantidad Por Rollo o Paquete»,
fuelles, capas ni nota amarilla de sello. No hay línea base validada: no se compara píxel a píxel.

```
python verificar_termoencogible.py [--datos RUTA.json ...] [--salida CARPETA]      # o: npm run test:sheets-termoencogible
```

Requiere Node, Google Chrome (`CHROME_PATH`), PyMuPDF y numpy. Salida en `test-results*/<caso>/` (ignorada por Git). La etapa verificada
(TE-1 hasta Peso lb; TE-2 hoja completa) se toma del perfil. La prueba falla si un PDF no se regeneró (por ejemplo, abierto en un visor).

## Contrato
`modalidad` (`DOBLADA` | `EXTENDIDA`) explícita, validada contra `hoja_doblada`/`hoja_extendida`; EXTENDIDA no tiene variante gráfica y el
validador (`tools/validate-termoencogible-data.mjs`) la rechaza. Cotas técnicas obligatorias e independientes de `ancho`/`largo`:
`ancho_doblado`, `medida_pliegue`, `largo_presentacion_final`, `ancho_presentacion_final`. Cliente, fecha, color, código, descripción, peso y
etiqueta son opcionales: pueden venir vacíos y no se inventan.

| Caso | esperado | Qué prueba |
|---|---|---|
| `ejemplo-original` | valido | Valores del Excel: ROLLO VCI + UV TERMOENCOGIBLE, Resina NA, 6 x 30 metros, 8 MIL, cotas 1.60 y 0.70 mts; opcionales vacíos. |
| `datos-completos` | valido | Mismo producto con todos los opcionales llenos. |
| `medidas-distintas` | valido | Otras medidas y cotas, CP5000 y paquete. |
| `descripcion-extensa` / `etiqueta-extensa` | valido | Textos largos. |
| `seleccion-extendida-tecnico` | tecnico | Extendida = X: se imprime, pero el validador lo rechaza. |
| `invalido-*` | invalido | EXTENDIDA no soportada, indicadores inconsistentes, ambas X, modalidad desconocida y cada cota técnica faltante. |
