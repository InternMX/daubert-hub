# Bloque D · Descarga PDF de borrador: pendiente de revisión

## Decisión en esta etapa

**No se implementó descarga PDF desde la interfaz.** Se activa la condición de parada solicitada: el mecanismo existente requiere cambios de infraestructura para exponerse desde la API con garantías equivalentes a la vista previa.

## Evidencia del repositorio

- `apps/api/test/manufacturing-sheets/common/hoja_pruebas.py`, función `imprimir_pdf`: ejecuta Chrome externo sobre un archivo local, produce un temporal, verifica firma `%PDF`, abre con PyMuPDF y publica el resultado. Es una utilidad de regresión, no un servicio HTTP.
- `apps/api/test/manufacturing-sheets/prototype/verificar_prototipo.py`: imprime el HTML generado por el **mismo** `SheetPreviewService` compilado. Las comprobaciones Carta, texto, páginas y firmas funcionan localmente.
- `docker/api.Dockerfile`: runtime `node:24-alpine`, usuario `node`, dependencias de producción y `dist`. No instala Chrome/Chromium, Python ni PyMuPDF; no copia los tests.
- `apps/api/package.json`: no hay dependencia de ejecución Puppeteer/Playwright ni servicio de impresión para manufactura.
- `SheetPreviewPanel.tsx`: la marca actual de borrador es una superposición de React. Imprimir el HTML actual directamente **no** incorpora esa marca al PDF.

No basta con añadir un botón o llamar a `window.print`: no garantiza descarga directa, nombre seguro, tamaño Carta ni marca real en todas las páginas. Tampoco se debe exponer como endpoint una utilidad de pruebas que acepta rutas locales y lanza procesos sin límites por solicitud.

## Propuesta para autorización posterior

1. Elegir un renderer aislado (Chromium en contenedor dedicado o runtime controlado) con sandbox operativo, sin red ni acceso al host, límites de CPU/memoria, concurrencia acotada, timeout y limpieza de temporales. Revisar impacto de imagen y despliegue antes de modificar infraestructura.
2. Recibir **el mismo DTO** que `POST /manufacturing-sheets/previews`, nunca HTML ni URLs arbitrarios. Reutilizar `SheetPreviewService`, compositor, escape de valores, CSP y registro central. Aplicar los mismos guards de autenticación, CSRF/origen, límites de cuerpo y listas permitidas. No aceptar una bandera «emitido/aprobado».
3. Inyectar en una copia del HTML compuesto una marca fija visible, también en impresión: **BORRADOR · SIN APROBAR** en todas las páginas; si falta información, **BORRADOR INCOMPLETO · SIN APROBAR**. Firmas siempre SIN FIRMA. La marca debe formar parte del archivo, con comprobación textual y visual posterior. No modificar plantillas aprobadas ni geometrías.
4. Fijar Carta, preservar escala de dibujos y detectar desbordamiento por documento. No recortar texto ni reducir todos los dibujos para forzar una página. Bloquear Extendida de Rollo/Termo y no usar resultados de vista previa obsoletos.
5. Responder bytes PDF con `Content-Type: application/pdf`, `Cache-Control: no-store`, disposición attachment y nombre `BORRADOR_<codigo-seguro>.pdf`, lista permitida de caracteres, longitud acotada y sustituto fijo si falta código. Sin rutas elegibles por el usuario.
6. Sin persistencia ni cargas a PostgreSQL/Dropbox. Logs solo técnicos sin cuerpos, títulos, credenciales o datos sensibles. Pruebas de autenticación y CSRF, inyección/SSRF/rutas, límites/concurrencia/cancelación, recursos bloqueados, temporales, marcas en todas las páginas, calibre literal e integridad de datos actuales.

## Estado de entrega

La infraestructura de regresión PDF sigue probada. **No existe endpoint nuevo ni botón de descarga y no se entrega un PDF de ejemplo como funcionalidad del bloque D.** Las impresiones de prueba permanecen en directorios de test ignorados; no equivalen a documentos emitidos.

Revisar esta propuesta junto con los bloques A–C antes de autorizar el bloque D.
