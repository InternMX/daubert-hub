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
