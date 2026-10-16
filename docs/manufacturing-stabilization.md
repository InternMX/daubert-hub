# Estabilización del prototipo de manufactura

## Reproducción de las ocho hojas

`npm run build`, después:

```powershell
node apps/api/test/manufacturing-sheets/prototype/demostracion.cjs --salida "C:\Users\06\Documents\Daubert\Entregables\Estabilizacion_Prototipo_Manufactura\Capturas" --capturas
```

Sin `--capturas`, mantiene una demostración interactiva en `http://127.0.0.1:4199/automations/manufacturing-sheets`. Solo escucha en loopback, sirve el frontend compilado, usa fixtures simulados y el intérprete/compositor reales. No inicia Nest, no carga variables de entorno ni conecta a BIND, PostgreSQL o Dropbox. La sesión simulada no se instala en la aplicación. Detener con Ctrl+C.

Los ocho casos reutilizan `apps/api/test/manufacturing-sheets/prototype/casos.json`: Bolsa Plana 1, Hojas doblada, Bolsa Fuelle, Bolsa Natural, Rollo Continuo, Termoencogible y variantes Azul/Verde de COEX. Todos se identifican como fixtures; sus valores no prueban existencia actual en BIND.

La salida contiene capturas de formulario/hoja ampliada y `casos-demostracion.json`, con producto, interpretación, sugerencias, datos finales y resultado real de la vista previa. El caso Hojas Extendida y el texto largo permanecen en la regresión documental existente.

## Coherencia y revisión

`technical-coherence.ts` centraliza conciliación y compatibilidad sobre el intérprete y registro existentes. `POST /previews` admite contexto original acotado (`title`, `code`, `composicionSeleccionada`), devuelve avisos estructurados y no persiste reconocimientos. No recibe HTML del usuario. Los guards globales y el DTO estricto siguen aplicando.

La interfaz conserva datos originales y manuales. La revisión explícita solo vale para el borrador y se invalida ante cualquier edición o nueva búsqueda. Un resultado antiguo del servidor no confirma valores nuevos. Cliente vacío permite demostración; la aptitud futura sigue exigiendo cliente identificado y familia confirmada, además de revisión.

Para contradicciones de color se exige la declaración `COLOR AZUL`, `COLOR: VERDE`, etc. No se usan marcas, clientes ni colores sueltos como evidencia suficiente de una contradicción.

## Unidades

Reconoce pulgadas, MM, CM/centímetros y M/MT/MTS/metros, sin conversión. Dos medidas de bolsa/hoja conservan ancho × largo; tres medidas de bolsa sugieren ancho × fuelle total × largo. Rollo y Termoencogible no presuponen ese orden: solo ANCHO y LARGO explícitos con una unidad compatible se extraen; las demás cotas se capturan independientemente. Unidades mezcladas quedan pendientes. Calibre literal independiente.

## Verificación

- API: `npm run test:api`.
- Web: `npm run test --workspace=@daubert/web -- --maxWorkers=4` (concurrencia acotada; sin aumentar timeouts).
- Calidad: `npm run lint`, `npm run typecheck`, `npm run build`.
- Documental/PDF: los ocho scripts `test:sheets-*` existentes y `npm run test:sheets-prototype --workspace=@daubert/api`.
- Ninguna integración PostgreSQL forma parte de esta etapa.

Los entregables de revisión están en `C:\Users\06\Documents\Daubert\Entregables\Estabilizacion_Prototipo_Manufactura\`.

## Cierre de verificación · 16 de octubre de 2026

- API completa: **1921** pruebas; frontend completo: **1254** pruebas (cuatro workers, sin aumentar timeouts).
- Lint, typecheck y build: OK. Vite mantiene el aviso de chunk mayor a 500 kB.
- Ocho regresiones documentales, utilidades comunes e impresión integral: OK. Nueve documentos normales y texto largo en una página Carta; texto íntegro y SIN FIRMA.
- Capturas reales de formulario y hoja ampliada: 16 PNG, ocho casos simulados. Extras reproducibles: TARPPW3301 (papel) y DEMOFPMG001 (COLOR AZUL explícito para cambiar a Verde).
- Entradas nuevas: tests de contexto anidado estricto, longitudes/tipos, propiedades extra, escape de HTML e integración HTTP de coherencia. Se conserva la ruta autenticada.
- Plantillas, perfiles y referencias históricas: sin cambios respecto a `a9ae9af`. Sin cambios en automatizaciones Audi/Caterpillar/Pagos ni base de datos.
- Bloque D evaluado y diferido: ver `manufacturing-draft-pdf-proposal.md`. No hay descarga PDF ni emisión.
