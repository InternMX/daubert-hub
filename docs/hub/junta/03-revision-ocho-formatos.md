# Revisión visual de los ocho formatos PDF · material para Manufactura

**Estado de los ocho formatos: PENDIENTE.** Ninguno ha sido revisado ni aprobado por el área de Manufactura. Los controles automáticos (152, todos correctos) comprueban estructura —una página, tamaño Carta, fuentes incrustadas, firmas dentro de la página, sin leyendas de prueba—, **no** que el formato se vea como Manufactura lo necesita.

## Material
Carpeta (fuera del repositorio): `C:\Users\06\Documents\Daubert\Entregables\Fase6E_Junta_Manufactura\ocho_formatos\`
| Archivo | Contenido |
|---|---|
| `Revision_Ocho_Formatos.pdf` | Por formato: una lámina con el **original a la izquierda y el generado a la derecha**, y una **ficha de aprobación** para imprimir y firmar |
| `comparacion\<formato>_COMPARACION.png` | La misma lámina como imagen |
| `original\<formato>_ORIGINAL.pdf` | Pestaña del Excel exportada a PDF |
| `generado\<formato>_REV01.pdf` | PDF emitido por el Gestor en el ensayo (datos **sintéticos**) |
| `comparacion\metricas.json` | Mediciones (página, fuentes, márgenes, colores, rótulos) |

**Sobre el «original».** Es una **copia** del libro `1. Hoja de Instruccion de Manufactura.xlsx` tomada del escritorio de este equipo (fechada 2026-10-13, SHA-256 `b418bd505b1b33a6…`); no se leyó ni se tocó la carpeta de Dropbox. **Manufactura debe confirmar que esa es la versión vigente del formato.** Las pestañas COEX Azul y COEX Verde no tienen área de impresión definida en el Excel (se imprimen partidas en tres páginas): para la lámina se ajustaron a una página **solo en la copia en memoria**.

**Sobre el «generado».** Son los PDF del ensayo 6B (`Evidencia_6B_20261109\parte2B\ocho_formatos`), emitidos por la imagen candidata con Chromium y Carlito. Los datos son sintéticos (cliente, código, medidas y nombres de responsables de prueba): **las diferencias de datos no son diferencias de formato**.

## Diferencias comunes a revisar (medidas y vistas en las láminas)
1. **Tipo de letra.** El original usa Calibri; el generado usa **Carlito** (misma anchura de caracteres, trazo ligeramente distinto). Revisar legibilidad, negritas y acentos.
2. **Celdas de rótulo.** En los seis formatos que no son COEX, el original tiene los rótulos en **gris claro con texto negro alineado a la izquierda**; el generado los muestra en **azul marino con texto blanco alineado a la derecha** (el estilo que el Excel solo usa en COEX). Confirmado a la vista en Bolsa Plana 1 y Termoencogible, y por la medición de colores en los seis.
3. **Responsables.** El original tiene **dos** (Elaboró y Aprobó, con «DCMX» debajo); el generado tiene **tres** (Generó, Revisó, Aprobó) con imagen de firma. Confirmar nombres de las funciones y si debe aparecer «DCMX».
4. **Posición en la hoja.** En los seis formatos que no son COEX el formulario queda **desplazado a la derecha** (empieza a 1.47 in del borde izquierdo) y la fila de responsables es **más ancha que el formulario**, hasta 0.26 in del borde derecho. En COEX el contenido empieza a 0.26 in del borde izquierdo. **Imprimir en la impresora del área y comprobar que nada se corta.**
5. **Orden de los primeros renglones** (formatos simples). El original pone «Fecha» arriba y «Resina VCI» junto a Cliente; el generado pone Cliente y Fecha en el primer renglón y Resina VCI debajo.
6. **Unidades y textos.** El generado escribe `m` donde el original escribe `mts`/`metros`, y `Pulgadas (IN)` donde el original escribe `Pulgadas (")`.
7. **Tamaño de letra.** Parecido (±1 pt) en los seis formatos simples; en COEX el generado es más grande porque el Excel se reduce al imprimir.
Estas diferencias pueden ser decisiones de diseño ya tomadas durante el desarrollo; aquí solo se listan para que Manufactura las **acepte o pida cambiarlas**.

## Por formato

### Bolsa Plana 1
- **Original:** pestaña «Bolsa Plana 1» → `Bolsa_Plana_1_ORIGINAL.pdf`. **Generado:** `Bolsa_Plana_1_REV01.pdf` (SHA-256 `87b5247130e1…`). Corresponde al formato: **sí** (título y rasgos propios presentes).
- **Página:** original 612×792 pt, 1 pág.; generado 612×792 pt, 1 pág. (Carta = 612×792).
- **Fuentes:** original Calibri, Calibri-Bold; generado Carlito, Carlito-Bold. **Letra predominante:** original 10.4 pt; generado 10.2 pt.
- **Distancia del contenido a los bordes (pulgadas; izq / sup / der / inf):** original 1.06 / 0.90 / 2.47 / 0.97; generado 1.47 / 0.95 / 0.26 / 2.23.
- **Colores de relleno predominantes:** original #538DD5, #FFFF00, #D9D9D9, #244062; generado #244062, #FFFF00, #DA9694, #366092.
- Rótulos del original que no aparecen con el mismo texto en el generado: CARMONA, ELABORO, FLORES, PLANA. (nombres de ejemplo del Excel, «Elaboró» → «Generó», y unidades escritas de otra forma).
- **Resultado:** ☐ APROBADO ☐ CAMBIOS SOLICITADOS ☑ **PENDIENTE** (sin revisión de Manufactura). Ficha: `Revision_Ocho_Formatos.pdf`, lámina y ficha de «Bolsa Plana 1».

### Hojas
- **Original:** pestaña «Hoja Paq» → `Hojas_ORIGINAL.pdf`. **Generado:** `Hojas_REV01.pdf` (SHA-256 `9e52c29cc3d4…`). Corresponde al formato: **sí** (título y rasgos propios presentes).
- **Página:** original 612×792 pt, 1 pág.; generado 612×792 pt, 1 pág. (Carta = 612×792).
- **Fuentes:** original Calibri, Calibri-Bold; generado Carlito, Carlito-Bold. **Letra predominante:** original 10.8 pt; generado 10.2 pt.
- **Distancia del contenido a los bordes (pulgadas; izq / sup / der / inf):** original 1.32 / 1.03 / 1.83 / 0.99; generado 1.47 / 0.95 / 0.26 / 1.69.
- **Colores de relleno predominantes:** original #538DD5, #D9D9D9, #FFFF00, #244062; generado #244062, #538DD5, #FFFF00, #DA9694.
- Rótulos del original que no aparecen con el mismo texto en el generado: CARMONA, ELABORO, MIL, PLANA, SUAREZ. (nombres de ejemplo del Excel, «Elaboró» → «Generó», y unidades escritas de otra forma).
- **Resultado:** ☐ APROBADO ☐ CAMBIOS SOLICITADOS ☑ **PENDIENTE** (sin revisión de Manufactura). Ficha: `Revision_Ocho_Formatos.pdf`, lámina y ficha de «Hojas».

### Bolsa Fuelle
- **Original:** pestaña «Bolsa Fuelle» → `Bolsa_Fuelle_ORIGINAL.pdf`. **Generado:** `Bolsa_Fuelle_REV01.pdf` (SHA-256 `4462aeb68075…`). Corresponde al formato: **sí** (título y rasgos propios presentes).
- **Página:** original 612×792 pt, 1 pág.; generado 612×792 pt, 1 pág. (Carta = 612×792).
- **Fuentes:** original Calibri, Calibri-Bold; generado Carlito, Carlito-Bold. **Letra predominante:** original 11.0 pt; generado 10.2 pt.
- **Distancia del contenido a los bordes (pulgadas; izq / sup / der / inf):** original 0.62 / 0.94 / 2.39 / 1.12; generado 1.47 / 0.95 / 0.26 / 1.55.
- **Colores de relleno predominantes:** original #538DD5, #FFFF00, #D9D9D9, #244062; generado #538DD5, #244062, #FFFF00, #DA9694.
- Rótulos del original que no aparecen con el mismo texto en el generado: CARMONA, ELABORO, FLORES, MIL, PLANA. (nombres de ejemplo del Excel, «Elaboró» → «Generó», y unidades escritas de otra forma).
- **Resultado:** ☐ APROBADO ☐ CAMBIOS SOLICITADOS ☑ **PENDIENTE** (sin revisión de Manufactura). Ficha: `Revision_Ocho_Formatos.pdf`, lámina y ficha de «Bolsa Fuelle».

### Bolsa Natural
- **Original:** pestaña «Bolsa Natural» → `Bolsa_Natural_ORIGINAL.pdf`. **Generado:** `Bolsa_Natural_REV01.pdf` (SHA-256 `8fcb4b45480f…`). Corresponde al formato: **sí** (título y rasgos propios presentes).
- **Página:** original 612×792 pt, 1 pág.; generado 612×792 pt, 1 pág. (Carta = 612×792).
- **Fuentes:** original Calibri, Calibri-Bold; generado Carlito, Carlito-Bold. **Letra predominante:** original 11.0 pt; generado 10.2 pt.
- **Distancia del contenido a los bordes (pulgadas; izq / sup / der / inf):** original 0.62 / 0.94 / 2.39 / 1.28; generado 1.47 / 0.95 / 0.26 / 1.46.
- **Colores de relleno predominantes:** original #FAEE54, #D9D9D9, #FFFF00, #244062; generado #FFF2CC, #244062, #FFFF00, #DA9694.
- Rótulos del original que no aparecen con el mismo texto en el generado: CARMONA, CON, ELABORO, FLORES, MIL. (nombres de ejemplo del Excel, «Elaboró» → «Generó», y unidades escritas de otra forma).
- **Resultado:** ☐ APROBADO ☐ CAMBIOS SOLICITADOS ☑ **PENDIENTE** (sin revisión de Manufactura). Ficha: `Revision_Ocho_Formatos.pdf`, lámina y ficha de «Bolsa Natural».

### Rollo Continuo
- **Original:** pestaña «Rollo Continuo» → `Rollo_Continuo_ORIGINAL.pdf`. **Generado:** `Rollo_Continuo_REV01.pdf` (SHA-256 `fc41a499f025…`). Corresponde al formato: **sí** (título y rasgos propios presentes).
- **Página:** original 612×792 pt, 1 pág.; generado 612×792 pt, 1 pág. (Carta = 612×792).
- **Fuentes:** original Calibri, Calibri-Bold; generado Carlito, Carlito-Bold. **Letra predominante:** original 11.0 pt; generado 10.2 pt.
- **Distancia del contenido a los bordes (pulgadas; izq / sup / der / inf):** original 1.57 / 0.59 / 1.62 / 0.62; generado 1.47 / 0.95 / 0.26 / 2.23.
- **Colores de relleno predominantes:** original #D9D9D9, #538DD5, #FFFF00, #244062; generado #244062, #C0504D, #366092, #DA9694.
- Rótulos del original que no aparecen con el mismo texto en el generado: CARMONA, ELABORO, FLORES, METRO, METROS, MTS. (nombres de ejemplo del Excel, «Elaboró» → «Generó», y unidades escritas de otra forma).
- **Resultado:** ☐ APROBADO ☐ CAMBIOS SOLICITADOS ☑ **PENDIENTE** (sin revisión de Manufactura). Ficha: `Revision_Ocho_Formatos.pdf`, lámina y ficha de «Rollo Continuo».

### Termoencogible
- **Original:** pestaña «Termoencogible» → `Termoencogible_ORIGINAL.pdf`. **Generado:** `Termoencogible_REV01.pdf` (SHA-256 `28daebde1c3a…`). Corresponde al formato: **sí** (título y rasgos propios presentes).
- **Página:** original 612×792 pt, 1 pág.; generado 612×792 pt, 1 pág. (Carta = 612×792).
- **Fuentes:** original Calibri, Calibri-Bold; generado Carlito, Carlito-Bold. **Letra predominante:** original 10.0 pt; generado 10.2 pt.
- **Distancia del contenido a los bordes (pulgadas; izq / sup / der / inf):** original 1.81 / 0.54 / 1.86 / 0.57; generado 1.47 / 0.95 / 0.26 / 1.69.
- **Colores de relleno predominantes:** original #D9D9D9, #FFFF00, #244062, #000000; generado #244062, #366092, #DA9694, #FFFF00.
- Rótulos del original que no aparecen con el mismo texto en el generado: CARMONA, ELABORO, FLORES, MTS. (nombres de ejemplo del Excel, «Elaboró» → «Generó», y unidades escritas de otra forma).
- **Resultado:** ☐ APROBADO ☐ CAMBIOS SOLICITADOS ☑ **PENDIENTE** (sin revisión de Manufactura). Ficha: `Revision_Ocho_Formatos.pdf`, lámina y ficha de «Termoencogible».

### COEX Azul
- **Original:** pestaña «COEX Azul» → `COEX_Azul_ORIGINAL.pdf`. **Generado:** `COEX_Azul_REV01.pdf` (SHA-256 `1180e4f28fab…`). Corresponde al formato: **sí** (título y rasgos propios presentes).
- **Página:** original 612×792 pt, 1 pág.; generado 612×792 pt, 1 pág. (Carta = 612×792).
- **Fuentes:** original Calibri, Calibri-Bold; generado Carlito, Carlito-Bold. **Letra predominante:** original 7.7 pt; generado 10.2 pt.
- **Distancia del contenido a los bordes (pulgadas; izq / sup / der / inf):** original 1.05 / 0.90 / 1.01 / 2.96; generado 0.26 / 0.95 / 1.39 / 0.90.
- **Colores de relleno predominantes:** original #244062, #538DD5, #366092, #FFFF00; generado #244062, #558ED5, #366092, #FFFF00.
- Rótulos del original que no aparecen con el mismo texto en el generado: CARMONA, CENTÍMETROS, ELABORO, FLORES, MILIMETROS. (nombres de ejemplo del Excel, «Elaboró» → «Generó», y unidades escritas de otra forma).
- **Resultado:** ☐ APROBADO ☐ CAMBIOS SOLICITADOS ☑ **PENDIENTE** (sin revisión de Manufactura). Ficha: `Revision_Ocho_Formatos.pdf`, lámina y ficha de «COEX Azul».

### COEX Verde
- **Original:** pestaña «COEX Verde» → `COEX_Verde_ORIGINAL.pdf`. **Generado:** `COEX_Verde_REV01.pdf` (SHA-256 `78f099e6be44…`). Corresponde al formato: **sí** (título y rasgos propios presentes).
- **Página:** original 612×792 pt, 1 pág.; generado 612×792 pt, 1 pág. (Carta = 612×792).
- **Fuentes:** original Calibri, Calibri-Bold; generado Carlito, Carlito-Bold. **Letra predominante:** original 7.7 pt; generado 10.2 pt.
- **Distancia del contenido a los bordes (pulgadas; izq / sup / der / inf):** original 1.05 / 0.90 / 1.01 / 3.10; generado 0.26 / 0.95 / 1.39 / 0.90.
- **Colores de relleno predominantes:** original #244062, #00B050, #366092, #FFFF00; generado #244062, #00B050, #366092, #FFFF00.
- Rótulos del original que no aparecen con el mismo texto en el generado: CARMONA, CENTÍMETROS, ELABORO, FLORES, MILIMETROS, NORMAL. (nombres de ejemplo del Excel, «Elaboró» → «Generó», y unidades escritas de otra forma).
- **Resultado:** ☐ APROBADO ☐ CAMBIOS SOLICITADOS ☑ **PENDIENTE** (sin revisión de Manufactura). Ficha: `Revision_Ocho_Formatos.pdf`, lámina y ficha de «COEX Verde».

## Lista de aceptación para los responsables
### A. Los ocho PDF (uno por uno, con la hoja impresa)
| Formato | Encabezado y logotipo | Datos en su lugar | Dibujo y cotas | Tipo de letra | Colores | Responsables y firmas | Impresión sin cortes | Resultado |
|---|---|---|---|---|---|---|---|---|
| Bolsa Plana 1 | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | PENDIENTE |
| Hojas | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | PENDIENTE |
| Bolsa Fuelle | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | PENDIENTE |
| Bolsa Natural | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | PENDIENTE |
| Rollo Continuo | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | PENDIENTE |
| Termoencogible | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | PENDIENTE |
| COEX Azul | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | PENDIENTE |
| COEX Verde | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | PENDIENTE |
Resultado posible por formato: **APROBADO**, **CAMBIOS SOLICITADOS** (anotar cuáles) o **PENDIENTE**.

### B. Flujo de trabajo (después de la demostración)
| # | Punto | Aceptado | Cambios / comentarios |
|---|---|---|---|
| 1 | La consulta por código en BIND trae el producto correcto | ☐ | |
| 2 | El prellenado ahorra captura y lo «sugerido» se distingue de lo «listo» | ☐ | |
| 3 | Los datos técnicos (medidas, calibre, presentación, cantidad, peso) se interpretan como Manufactura espera | ☐ | |
| 4 | Borradores y autoguardado funcionan para el trabajo diario | ☐ | |
| 5 | Ver los borradores del equipo en solo lectura es suficiente | ☐ | |
| 6 | Los permisos de GENERAL y ADMIN corresponden a las personas reales | ☐ | |
| 7 | Las funciones Generó / Revisó / Aprobó y sus firmas reflejan el proceso real | ☐ | |
| 8 | La finalización y el PDF descargado sirven como documento oficial | ☐ | |
| 9 | Las revisiones (REV01, REV02…) y el historial cubren los cambios de una hoja | ☐ | |
| 10 | El catálogo de clientes y las abreviaturas son manejables; queda definido quién los administra | ☐ | |
| 11 | La captura manual de cliente (no verificado) es aceptable | ☐ | |

Nombre, puesto y firma de quien revisa: ______________________________  Fecha: ____________
