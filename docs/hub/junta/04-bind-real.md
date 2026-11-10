# BIND real · procedimiento de comprobación de solo lectura

**Estado: NO ejecutado.** En esta fase no se hizo ninguna conexión a BIND real ni se buscó, leyó, imprimió o compartió credencial alguna. La conexión real requiere autorización y que las credenciales las cargue, de forma segura, quien las custodia.

## 1. Qué está aprobado con simulador y qué falta
| | Simulador (hecho) | BIND real (pendiente) |
|---|---|---|
| Producto encontrado, inexistente, incompleto, ambiguo, duplicado | 11 escenarios en el recorrido funcional (82 comprobaciones PASS en la Fase 6B) | Sin evidencia formal |
| Errores del servicio: 401, 429, 500, respuesta inválida, lentitud, caída | Sí: el Hub responde 502/504 con mensaje genérico, sin exponer claves | No se provocan contra el servicio real |
| Novedades del catálogo ordenadas por fecha | Sí | Pendiente |
| Interpretación de productos **reales** de Daubert (título, descripción, peso) | Con respuestas reales guardadas como muestras de prueba | Pendiente con el catálogo vivo |
| Credenciales, cuotas y tiempos de respuesta reales | No aplica | Pendiente |
En los ensayos 6C y 6D las rutas de BIND respondieron «no configurado» (503) porque el entorno aislado no tiene credenciales: es el comportamiento esperado, no una validación. Los comentarios del código indican que la sintaxis de consulta se probó contra la API real durante el desarrollo; **no existe evidencia archivada de esa prueba**, por lo que no se cuenta como validación.

## 2. Por qué la prueba no puede modificar información externa (verificado en el código)
- El cliente de BIND (`apps/api/src/manufacturing-sheets/bind/bind-erp.client.ts`) tiene **una sola** llamada de red y es `method: 'GET'`, con `redirect: 'error'`. No existe POST, PUT, PATCH ni DELETE hacia BIND en todo el módulo.
- Único recurso consultado: `/api/Products`, con `$filter` por código o por ID, o `$orderby=CreationDate desc&$top&$skip` (máximo 100 por página).
- El código DCMX se valida contra una lista cerrada de caracteres antes de formar la consulta; las ligas de paginación solo se siguen si permanecen en el mismo servidor, por HTTPS y en `/api/Products`.
- El Hub expone solo tres rutas, todas GET: `recent`, `by-code/:code`, `by-id/:id`.
- Límites: 10 s por intento, 30 s en total, dos reintentos en errores transitorios.
- El script de comprobación (`tools/ensayo-liberacion/comprobar-bind-real.cjs`) no habla con BIND: llama a esas rutas GET **del Hub**; no contiene ni imprime claves, tokens ni cabeceras.
Lo único que se escribe es del lado del Hub de pruebas: la sesión de la cuenta de prueba y su auditoría de inicio de sesión.

## 3. Procedimiento (cuando se autorice)
1. **Autorización** escrita de quien administra BIND: comprobación de solo lectura, fecha y responsable.
2. **Ambiente:** el Hub de **TEST** (o una réplica desechable). Nunca producción.
3. **Credenciales:** quien las custodia escribe `BIND_API_KEY` y `BIND_SUBSCRIPTION_KEY` directamente en el archivo de entorno de ese ambiente (sin versionar) y reinicia su API. No se envían por correo o chat, no se pegan en una terminal compartida y no se guardan en el repositorio ni en las evidencias. `BIND_API_BASE_URL` se deja vacía salvo indicación.
4. **Comprobación automática** (por cada código de la sección 4):
   ```
   ENSAYO_PASSWORD=<contraseña de la cuenta de prueba> node tools/ensayo-liberacion/comprobar-bind-real.cjs <URL del Hub de TEST> <correo de la cuenta de prueba> <código DCMX> <carpeta de evidencia fuera del repositorio>
   ```
   Hace: novedades, búsqueda del código existente, código inexistente y código con caracteres no permitidos.
5. **Comprobación manual** con Manufactura: abrir cada producto en la pantalla de Hojas de manufactura y llenar la tabla de la sección 5 junto a la ficha del producto en BIND.
6. **Cierre:** retirar las credenciales del ambiente si no deben quedarse; archivar la evidencia (sin claves); registrar el resultado en el acta.
Criterio de paro: tres respuestas de error seguidas de BIND (401/429/5xx) → detener y avisar a quien administra BIND; no insistir.

## 4. Productos representativos
Códigos que ya aparecen en las pruebas y demostraciones anteriores; **hay que confirmar que siguen existiendo en BIND** y completar con los que proponga Manufactura (idealmente uno por formato):
| Código | Formato esperado | Por qué es representativo |
|---|---|---|
| `SCHFPMG001` | Bolsa Plana 1 | Caso base: 13 × 16 in, calibre «3 MIL», paquete con 200 |
| `DANFPMGOC04` | Bolsa Fuelle | Tres medidas; antes dejaba 9 campos vacíos, ahora 0 |
| `CONFPMG04` (confirmar código) | COEX | Hoja COEX de referencia usada para validar la plantilla |
| Por definir | Hojas | Datos solo en la descripción; modalidad doblada/extendida |
| Por definir | Bolsa Natural | Composición natural, sin resina VCI |
| Por definir | Rollo Continuo | Medidas con etiquetas ANCHO/LARGO; ancho del rollo no existe en BIND |
| Por definir | Termoencogible | Unidades en metros; cotas del dibujo no existen en BIND |
| Por definir | COEX Verde | Variante por color en título o descripción |
| Uno con título y descripción contradictorios | cualquiera | Debe **pedir** el dato, no elegirlo |
| Uno dado de alta esta semana | — | Debe aparecer primero en Novedades |

## 5. Campos a comparar entre BIND y Manufactura
| Dato en BIND | Dato en la hoja | Qué comprobar |
|---|---|---|
| `Code` | Código DCMX | Idéntico, carácter por carácter |
| `Title` | Descripción y etiqueta | Texto íntegro, sin recortes; se muestra el título original en solo lectura |
| `Title` / `Description` | Producto, composición (PMG / CP5000 / Natural), presentación (rollo / paquete), cantidad y su unidad | Coinciden con lo que Manufactura lee en la ficha; lo interpretado aparece como «sugerido» |
| `Title` / `Description` | Ancho, largo, fuelle, unidad de medida | Mismos números y la misma unidad; sin conversiones |
| `Title` / `Description` | Calibre | **Literal** (p. ej. «3 MIL», «300»), sin convertir |
| `Weight` | Peso (lb) | Mismo valor; cero o vacío → queda pendiente, no se inventa |
| `CreationDate` | Orden de Novedades | Solo informativo; **no** es la fecha de la hoja |
| Prefijo del `Code` | Cliente sugerido | Solo sugiere si hay abreviatura confirmada; nunca asigna solo |
| — | Datos que BIND no tiene (ancho del rollo, cotas del dibujo, modalidad) | Quedan vacíos para captura; no se rellenan con supuestos |
Por cada producto, anotar: ☐ coincide ☐ difiere (qué campo) ☐ el sistema pidió confirmación donde debía.

## 6. Resultado esperado para autorizar
Todos los códigos elegidos se encuentran; ningún campo «listo» difiere de BIND; los casos ambiguos piden confirmación; el inexistente responde «no se encontró»; sin errores 401/429/5xx. Si BIND real no puede comprobarse antes de la liberación, la junta puede autorizar iniciar con captura manual (el módulo funciona sin BIND), dejándolo asentado.
