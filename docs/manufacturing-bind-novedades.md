# Novedades del catálogo de BIND · Hojas de Manufactura (Fase 2)

Sección desplegable «Novedades del catálogo de BIND» junto a la búsqueda por código DCMX. Muestra productos creados recientemente en BIND como candidatos para preparar una hoja. **No** indica si un producto ya tiene hoja o está pendiente de producción: no existe persistencia que lo permita saber, y la interfaz nunca lo afirma.

## 1. Verificación real de la API de BIND (2026-10-29, solo lectura)

Consultas GET con las credenciales del servidor (sin imprimirlas ni guardar cuerpos de negocio). Resultado comprobado:

| Pregunta | Resultado |
|---|---|
| ¿`GET /api/Products` lista productos? | Sí. Sin parámetros entrega 100 productos y `nextLink` con `$skip`; **el orden por defecto no es por fecha** (el primer elemento era de septiembre y los siguientes de años distintos). |
| Paginación | `$top` (máximo **100**; 500 responde 500 «The limit of '100' for Top query has been exceeded») y `$skip` funcionan. Con `$top` explícito la respuesta no trae `nextLink`. |
| ¿Ordena por `CreationDate` descendente? | **Sí**: `$orderby=CreationDate desc` (con `$top` y `$skip`) devolvió páginas contiguas, sin repetidos, estrictamente descendentes y estables entre dos consultas. `asc` también funciona. |
| ¿`CreationDate` es el alta del producto? | Es la fecha de creación del registro en BIND (ISO sin zona horaria, p. ej. `2026-10-22T16:07:00.883`). Coincide con altas conocidas (SCHFPMG001 → 2026-10-13). Los productos migrados originalmente comparten la fecha de importación (2017-07-18): para ellos no representa un alta real. La hora no se interpreta; solo se muestra el día. |
| Campos del producto | `ID, Code, Title, Description, CreationDate, Cost, SKU, Comments, CostType(Text), Category1-3ID, CurrentInventory, ChargeVAT, Number, PricingType(Text), ImageUrl, Unit, CurrencyID/Code, PurchaseType(Text), IEPSRate, Type, TypeText, ProductionAuto, Volume, Weight`. El Hub conserva solo seis (`ID, Code, Title, Description, Weight, CreationDate`); costos e inventarios se descartan. `Weight` es numérico. |
| Total del catálogo | El campo `count` del cuerpo es el número de elementos de la página, **no** el total: no hay forma de conocer el total sin recorrerlo. |
| Filtros | `$filter=Type eq 0` funciona (todos los recientes son «Producto Terminado»), también combinado con `$orderby`. `startswith(Code,'SCH')` funciona. `CreationDate ge datetime'2026-10-01T00:00:00'` funciona; sin `datetime'…'` falla (500 «Syntax error»). `TypeText eq '…'` y `$select` fallan (500). |
| Rendimiento | 100 productos ≈ 70 KB, 0.6–1.2 s por consulta. |

Conclusión: **sí se pueden obtener los productos recientes de forma confiable** con `$orderby=CreationDate desc&$top=N&$skip=M`. No se asumió: se comprobó la sintaxis, el límite, la continuidad entre páginas y la estabilidad.

Humo del servicio real de NestJS contra BIND (30 productos, 2026-03-25 → 2026-10-22, 1.0 s): fechas descendentes; 20 compatibles, 1 por confirmar, 5 sin plantilla, 4 sin familia; segunda consulta de la misma página desde caché (0 ms); página 2 continúa en orden.

## 2. Diseño e implementación

**Backend (NestJS; el navegador nunca habla con BIND)**
- `GET /api/manufacturing-sheets/bind-products/recent?skip=0&limit=30[&refresh=1]` (autenticada por los guards globales, como el resto de la ruta de BIND).
- `BindErpClient.listRecent(skip, top)`: una sola página con `$orderby=CreationDate desc&$top&$skip`; no sigue `nextLink`; reutiliza reintentos, timeouts y sanitización existentes; **verifica el orden**: si la página no viene descendente por fecha (o trae más productos de los pedidos) devuelve `INVALID_RESPONSE` y no se muestran «recientes». Límites: `$top` ≤ 100 (el endpoint del Hub acepta límites de 1 a 50 por página), `$skip` ≤ 500.
- `clasificarNovedad` (`bind/recent-products.ts`) reutiliza `interpretarProductoBind` y `sugerirEspecificacion`; no duplica reglas:
  - **COMPATIBLE**: familia sugerida y sin contradicción Title/Code.
  - **POR_CONFIRMAR**: familia sugerida con contradicción.
  - **SIN_PLANTILLA**: papel o tubo (`sugerencias.familia.sinPlantilla`, indicador agregado al intérprete).
  - **SIN_FAMILIA**: la interpretación no permite identificar una familia.
  - La fecha de alta se muestra solo si es ISO válida y no futura.
- Respuesta mínima por producto: `code, title, fechaAlta, familiaSugerida, motivo, compatibilidad`. No se expone `ID`, costos ni credenciales.
- Caché en memoria, temporal y acotada: 60 s de vida, 8 entradas, solicitudes simultáneas iguales comparten una consulta, y la actualización manual (`refresh=1`) no consulta a BIND antes de 10 s. Los errores no se cachean. No se escribe en PostgreSQL ni se guarda el catálogo.

**Frontend**
- `NovedadesCatalogo.tsx` (MUI `Accordion`, contraído por defecto): no consulta nada hasta desplegarse; muestra los primeros **tres** candidatos con familia sugerida (consulta hasta 3 ventanas de 30 para completarlos); «Ver más» abre la vista ampliada, donde una casilla permite incluir los productos sin familia o sin plantilla y «Consultar más novedades» pide la página siguiente; «Actualizar» fuerza la consulta; estados de carga, error con «Reintentar», lista vacía comprensible y respuesta con orden no comprobable.
- «Preparar hoja» llama a la **misma** búsqueda por Code (`search(code)` de la página): backend → intérpretes → sugerencias → validaciones. Familia sugerida provisional, edición manual y BORRADOR · SIN APROBAR · SIN FIRMA se conservan. Cada búsqueda anula la anterior: una respuesta tardía de otro producto no sobrescribe al seleccionado.
- La búsqueda manual no cambia.

## 3. Limitaciones conocidas
- `CreationDate` no es la fecha de modificación: un producto antiguo cuyo Title se editó hoy no aparece como novedad. Los productos migrados comparten la fecha de importación.
- La zona horaria de `CreationDate` no está documentada; por eso solo se muestra el día.
- No hay total del catálogo ni contador de páginas; la exploración se limita a `skip ≤ 500`.
- «Compatible» es una sugerencia de los intérpretes (Title/Code), no una confirmación técnica; la familia siempre se confirma en el formulario.
- No existe filtro por tipo en la interfaz (`Type eq 0` queda como mejora posible; hoy todos los recientes observados son «Producto Terminado»).
- No hay limitador de solicitudes por usuario en el Hub; las consultas a BIND se acotan con la caché, el intervalo mínimo de actualización y los límites de página.
