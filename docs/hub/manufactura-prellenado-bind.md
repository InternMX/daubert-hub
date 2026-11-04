# Prellenado inteligente de Hojas de Manufactura desde BIND

Documento de trabajo (diagnóstico → matriz → reglas → medición). Solo TEST.

## 1. Diagnóstico del uso actual de BIND

**Flujo existente (se extiende, no se reemplaza):** `GET /manufacturing-sheets/bind-products` → `interpretarProductoBind()` (backend, `bind-product-interpreter/`) → `sugerirEspecificacion()` → el navegador arma el formulario con `buildInitialForm()` (`specificationForm.ts`). El formulario **ya se prellena solo**: no hay botones «Aplicar sugerencia»; cada campo guarda su procedencia (`BIND`, `SUGERIDO`, `PENDIENTE`, `fuente`) y el usuario puede editarlo. La revisión del borrador (`validateSpecification` + `incidencias.ts`) y el reconocimiento de contradicciones ya existen; el servidor revalida todo al guardar y finalizar.

| Entrada de BIND | Uso actual |
|---|---|
| `Code` | Se conserva como código DCMX. Interpretación **secundaria** (`code-parser`, `code-reconciliation`): prefijo de cliente + F/P + clave de resina; solo sugiere cuando el Title omite el dato. |
| `Title` | **Única fuente técnica**: tipo, resina, medidas, calibre, presentación y cantidad (`title-parser`). También etiqueta, color explícito, denominación y familia sugerida. |
| `Description` | **Se conserva pero NO se interpreta** (`informacionAdicional`). No es que falten patrones: el texto nunca entra a ningún analizador. |
| `Weight` | Libras; 0, negativo o no numérico → pendiente. Alimenta `pesoLb` (y el cálculo de capas COEX). |
| `CreationDate` | Solo informativo (no es la fecha de emisión). |

**Qué ocurre con DANFPMGOC04 hoy**
- *Title* trae **dos expresiones de medidas** (`69 x 43 x 66 cm` y `27 x 17 x 26.4"`) → `MEDIDAS_MULTIPLES`: ancho, largo, unidad y fuelles quedan vacíos.
- *Title* no trae calibre, presentación ni cantidad; *Description* sí (`CAL. 200`, `PAQUETE 200/B`, `27 x 17 x 26.4"`) pero nunca se lee → calibre, presentación, cantidad y unidad de cantidad quedan vacíos. Son los **9 faltantes**: 9 de 9 estaban escritos en BIND.
- El Code y el Weight sí se aprovechan (composición PMG, peso 0.155 lb).

**Confirmaciones que ya existen** (se reutilizan): familia sugerida → «Confirmar familia»; contradicciones → reconocimiento por incidencia; pesos COEX → revisión; «Elaboró» → confirmación expresa antes de finalizar; cada cambio técnico invalida las confirmaciones vigentes de la revisión. El formulario solo precarga al buscar el producto: un borrador guardado se reabre desde su copia, nunca vuelve a leer BIND.

**Persistencia:** la especificación guarda `datos` + `procedencia` por campo + copia de BIND. Las procedencias nuevas (p. ej. «Description») caben en `procedencia` (texto): **no requieren migración**.

## 2. Matriz de campos por formato

Leyenda — qué puede aportar BIND:
**S** recuperable con seguridad (dato explícito y consistente → se prellena como sugerencia provisional) ·
**A** ambiguo / requiere una decisión localizada (se prellena si hay una lectura razonable, con aviso, o se deja pendiente) ·
**N** no recuperable desde BIND (captura manual o cálculo del sistema).
`R` = campo obligatorio de la familia. Un campo sin `R` es opcional/visible.

| Campo | Fuente en BIND | Clasif. | Bolsa Plana 1 | Hojas | Bolsa Fuelle | Bolsa Natural | Rollo Continuo | Termoenc. | COEX Azul / Verde |
|---|---|---|---|---|---|---|---|---|---|
| Código DCMX | Code | **S** | R | R | R | R | R | R | R |
| Descripción | Title | **S** | R | R | R | R | R | R | R |
| Etiqueta | Title completo | **S** | | | | | | | |
| Producto (denominación) | Title (denominación explícita) / tipo | **A** (sugerido; editable) | | | | | | | |
| Cliente | abreviatura del Code (catálogo) | **A** (sugiere; no asigna) | | | | | | | |
| Fecha de emisión | sistema (no BIND) | **N** | | | | | | | |
| Composición | Title + Description + Code (PMG / CP5000 / NAT) | **S**; ESD/XOW **A** (sin casilla) | R | R | R | fija NAT | R | R | fija PMG |
| Resina VCI | regla validada 3 % para PMG/CP5000 | **A** (sugerida) | | | | | | | |
| Color (preset/nombre/hex) | color explícito AZUL/VERDE; por defecto Azul 2 % para PMG/CP5000 | **S** explícito · **A** por defecto/otros | R | R | R | R | R | — | nombre R (variante) |
| Variante COEX | color AZUL/VERDE en Title/Description | **S** explícito / **A** | — | — | — | — | — | — | R |
| Presentación | Title / **Description** (PAQUETE, ROLLO) | **S** | R | R | R | R | R | R | R |
| Cantidad | `C/200`, `PAQUETE 200/B`, `200 BOLSAS`… (Title / **Description**) | **S** (número) | R | R | R | R | no aplica | no aplica | R |
| Unidad de cantidad | palabra explícita; `/B` y `C/n` sin palabra → según el tipo | **S** explícita · **A** `/B` | R | R | R | R | no aplica | no aplica | R |
| Ancho / Largo | 2 dimensiones con una misma unidad (Title / **Description**) | **S** | R | R | R (tres medidas) | R (tres medidas) | R (solo etiquetas ANCHO/LARGO) | R (idem) | R (tres medidas) |
| Unidad de medidas | unidad explícita (`"`, IN, MM, CM) | **S**; dos sistemas a la vez **A** | R | R | R | R | R | R | R |
| Fuelle total / derecho / izquierdo | tercera medida de una bolsa = Ancho × **Fuelle total** × Largo, repartida en dos mitades | **A** (convención de bolsa; siempre «sugerido») | — | — | R (der./izq.) | R (der./izq.) | — | — | R (der./izq.) |
| Calibre | `CAL. 3 MIL`, `CAL. 200`… (Title / **Description**), **literal, sin convertir** | **S** (valor) · unidad pendiente si no se indica | R | R | R | R | R | R | R |
| Peso (lb) | Weight | **S** | R | R | R | R | R | R | R |
| Modalidad (doblada/extendida) | palabra explícita en Title/Description, si existe | **A** / **N** | — | R | — | — | R | R | — |
| Ancho del rollo | no existe en BIND | **N** | — | — | — | — | R | — | — |
| Ancho doblado, medida de pliegue, largo y ancho de presentación final | no existen en BIND (cotas del dibujo) | **N** | — | — | — | — | — | R (4) | — |
| Peso por capa / lb VCI por capa | cálculo desde el peso total (regla validada) | **A** (calculado, se revisa) | — | — | — | — | — | — | R (6) |

**Reglas de no-inferencia (se mantienen):** `CAL. 200` nunca se convierte a MIL; `/B` no se asume «bolsas» (la unidad sugerida sale del tipo de producto y se marca como sugerida); nada de porcentajes de VCI ni composiciones sin evidencia explícita o regla validada; las dimensiones nunca se convierten entre sistemas; la tercera medida de una bolsa solo se interpreta como fuelle total en familias con fuelle y siempre como **sugerida**; no se aplican interpretaciones de bolsas a rollos u hojas; Title y Description contradictorios → incidencia, no se elige una fuente.

## 3. Reglas nuevas (implementación)
Ver sección «Reglas implementadas» al final de este documento (se completa conforme se entregan los commits).
