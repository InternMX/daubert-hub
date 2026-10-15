# Utilidades comunes de las pruebas de impresión

`hoja_pruebas.py` centraliza lo que comparten los verificadores de COEX, Bolsa Fuelle, Hoja Paq, Rollo Continuo, Bolsa Plana 1 y Termoencogible:

- **Regeneración segura (`imprimir_pdf`, `medir_dom`, `guardar_png`)**: el PDF se imprime en un temporal nuevo, se valida y solo entonces
  reemplaza al anterior. Chrome que falla, PDF no generado, vacío o dañado, tiempo agotado o archivo bloqueado → `ErrorRegeneracion` con la
  ruta; nunca se analiza un resultado antiguo y no se borran resultados por adelantado.
- **Criterios (`fallos_de_limite`, `clasificar_limites`, `informar_limites`)**: una página carta, 20 pt de holgura, y para los casos
  `esperado = "estres"` el informe `LÍMITE DETECTADO` (páginas y excedente) con la marca `NO_APTO_PARA_EMISION.txt`. Los placeholders pendientes,
  errores de regeneración y textos faltantes nunca se convierten en límite.
- **Píxeles seguros (`pixel`, `pixel_o_none`)**: no leen fuera de la página (antes: `IndexError`).

`test_hoja_pruebas.py` (`npm run test:sheets-common`) demuestra cada comportamiento con un Chrome simulado y reproduce el desbordamiento de Bolsa Fuelle.
