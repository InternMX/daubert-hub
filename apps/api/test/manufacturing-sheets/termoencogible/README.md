# Verificación TERMOENCOGIBLE

Familia independiente (no es Rollo Continuo: sus dibujos representan otros elementos). **Sin** fila «Cantidad Por Rollo o Paquete»,
fuelles, capas ni nota amarilla de sello. No hay línea base validada: no se compara píxel a píxel.

```
python verificar_termoencogible.py [--datos RUTA.json ...] [--salida CARPETA]      # o: npm run test:sheets-termoencogible
```

Requiere Node, Google Chrome (`CHROME_PATH`), PyMuPDF y numpy. Salida en `test-results*/<caso>/` (ignorada por Git). La etapa verificada
(TE-1 hasta Peso lb; TE-2 hoja completa) se toma del perfil. La prueba falla si un PDF no se regeneró (por ejemplo, abierto en un visor).

## Casos de estrés
Las descripciones reales ocupan normalmente uno o dos renglones. Un caso `estres` usa datos válidos pero extremos: se verifica igual que los demás,
pero si excede la página o la holgura mínima el verificador lo informa explícitamente en lugar de aprobar un PDF incompleto o fallar como regresión.

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
| `descripcion-1-renglon` / `descripcion-2-renglones` | valido | Descripciones habituales de uno y dos renglones: deben dar una página carta completa con al menos 20 pt libres. |
| `etiqueta-extensa` | valido | Etiqueta larga. |
| `descripcion-extensa` | estres | Descripción de seis renglones (no es un caso real). Con el dibujo de presentación final de 93 pt excede la página carta: el verificador lo reporta como «LÍMITE DETECTADO» (sin truncar ni reducir escala) y no cuenta como regresión. |
| `seleccion-extendida-tecnico` | tecnico | Extendida = X: se imprime, pero el validador lo rechaza. |
| `invalido-*` | invalido | EXTENDIDA no soportada, indicadores inconsistentes, ambas X, modalidad desconocida y cada cota técnica faltante. |
