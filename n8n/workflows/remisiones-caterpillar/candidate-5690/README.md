# Caterpillar TEST para 5690 — candidato bloqueado (fase 3C)

**NO APTO PARA EJECUCIÓN.** Preparación offline; no importado ni conectado a n8n, PostgreSQL o Dropbox.

## Archivos y procedencia

- `caterpillar-test-5690.BLOCKED.json`: copia candidata, no sustituye el export ni el workflow vivo.
- `prepare-candidate.cjs`: transformación reproducible del export TEST descargado el 21/10/2026;
  comprueba SHA-256 y rechaza sobrescritura. Solo escribe el JSON en esta carpeta del worktree.
- `runtime-path-guard.cjs`: política pura de filesystem, embebida en nodos Code protegidos.
- `validate-candidate.cjs`: verifica el artefacto y prueba la política sobre un filesystem ficticio.
  Compila JavaScript para comprobar sintaxis, pero no ejecuta ningún nodo, SQL ni comando del workflow.

Fuente: `MANUAL TEST REMISIONES CAT.json`, workflow `0hUrQ64tpD2yI2MZ`, versión
`044243a1-e1fe-4d32-849b-e56670535322`.
SHA-256 del export: `273dbd1b94e36be1a698a38558469fd72f60c73489de9b4ee8d115e48a70b517`.
El generador requiere el export original en Descargas, no lo modifica ni lo incluye en Git.

## Perímetro único

Directorio operativo autorizado:

```text
C:\Users\06\Documents\Dropbox\Pruebas\REMISIONES CAT
```

Todas sus subcarpetas operativas quedan bajo esa raíz: entrada, copias, salidas PDF, errores, logs,
auxiliares y temporales. Se elimina la tabla de rutas reales del detector y el fallback productivo
comentado. Se conserva `ACTIVAR_RUTAS_REALES=false`. No se agregan rutas externas de herramientas.

La política exige rutas absolutas de unidad Windows, normalizadas, con raíz real idéntica a la
autorizada, existentes y verificables por `realpathSync`/`lstatSync`. Rechaza `..`, directorios hermanos,
otra unidad, UNC/device paths, ADS, patrones, enlaces/junctions en el recorrido, resoluciones fuera
de la raíz y errores de verificación. Un runtime POSIX/montaje distinto falla cerrado.

**No se ha consultado la existencia de ninguna ruta de Dropbox.** Las comprobaciones locales usan
solo un filesystem ficticio. La política es deliberadamente estricta: tampoco autoriza un archivo
o directorio nuevo solo porque su padre sea válido. La creación segura de nuevos archivos, el control
de carreras de symlinks y la semántica de montajes siguen pendientes; los holds no deben retirarse
sin resolverlos. La guarda no es un sandbox de sistema operativo ni una garantía frente a cambios
concurrentes del filesystem.

## Bloqueos independientes de los triggers

- Workflow inactivo; schedule, trigger manual y webhook deshabilitados. La ruta del webhook es propia
  del candidato y está marcada NOT-APPROVED. No hay credencial de autenticación asignada.
- Se eliminan todas las referencias de credenciales, IDs/metadatos del workflow de origen y pinData.
- Cada nodo PostgreSQL conserva su SQL como literal inaccesible tras una expresión que siempre lanza
  `CAT5690_NOT_APPROVED`. Los argumentos/bindings no cambian. Esto también bloquea el diagnóstico SQL
  desconectado. No se presupone que el nombre de una credencial acredite la identidad de la base.
- Cada nodo nativo de lectura/escritura de archivos y cada Execute Command tiene una expresión de
  bloqueo incondicional. No se permite ejecutar scripts externos sin revisar su contenido.
- Los ocho nodos Code de detección, filtro, preparación, renderizado, limpieza, logs y reproceso tienen
  un hold incondicional antes de cualquier import/acceso. Además, usan una fachada fs con la política
  de rutas. Los nodos de acción NO están deshabilitados: en n8n eso podría saltar la guarda.
- Ejecutar manualmente una rama no elude los holds. Asignar accidentalmente una credencial no retira
  las expresiones de bloqueo. No basta con activar el workflow para convertirlo en ejecutable.

La copia conserva los 60 nodos y todas las conexiones. No incorpora vínculos a otras automatizaciones.
No se ejecutó n8n para acreditar su comportamiento en esta versión; sigue siendo NO APTO hasta la
verificación de importación/runtime y las dependencias siguientes.

## Cambios acotados

- `Detectar archivos CAT1`: sin tabla productiva ni fallback comentado; hold y fs protegido.
- `Filtrar solo pruebas locales1`: comprobación real de ruta antes del filtro; hold.
- `Preparar archivo CAT`: temporales exclusivos por `$execution.id` bajo
  `06_ARCHIVOS TEMPORALES/cat-5690/<execution-id>`; hold y fs protegido.
- `Renderizar HTML`: se retira el barrido que borraba todos los HTML de temp; hold y fs protegido.
- `Limpiar HTML temporal por error CAT`, `Registrar log error CAT`, `Validar elegibilidad reproceso CAT`
  y `Detectar archivo REPROCESS CAT1`: hold y fs protegido; clasificación/elegibilidad conservadas.
- Nodos PostgreSQL, nativos de archivos y comandos: holds; triggers: deshabilitados; notas: sustituidas
  por indicaciones del candidato para no arrastrar configuración histórica.

`Normalizar datos CAT`, preparación/asignación de folios, lógica de ejecución, validación de entrada
y mapeo del reproceso permanecen iguales. Las consultas SQL y comandos originales se conservan tras
el bloqueo, no se ejecutan. No se integra el manifest ni deduplicación en esta preparación.

## Dependencias pendientes antes de habilitar operaciones

1. Comprobar cómo corre 5690 (Windows, contenedor, task runner) y sus montajes/identidad de proceso.
   No traducir silenciosamente rutas host a rutas de contenedor. Verificar permisos y confinamiento
   de filesystem sin dar acceso de escritura a otras automatizaciones o a producción.
2. Comprobar disponibilidad autorizada de los built-ins `fs`, `path`, `crypto`, nodos nativos y ejecución
   de PowerShell. No se añade ningún paquete externo al código n8n. La validación offline usa TypeScript
   ya presente en el repositorio, no una dependencia requerida en 5690.
3. Verificar en 5690 una credencial nueva/exclusiva Caterpillar: base real **daubert_hub_test**, usuario,
   servidor/puerto y permisos. Comprobar empresa fija del nodo de origen, catálogo Caterpillar, series,
   reservas y privilegios de las funciones existentes. No conectar ahora ni heredar credenciales PROD.
4. Proveer catálogos/plantillas de TEST bajo la raíz autorizada. Herramientas externas de solo lectura:
   todavía **ninguna autorizada**. Si se requieren PowerShell, navegador PDF, fuentes o ejecutables
   externos, inventariar sus rutas reales exactas y efectos antes de permitirlos por separado.
5. Revisar `convertir-cat-pdf.ps1` y `limpiar-temp-cat.ps1` (y los fallbacks del normalizador), sus procesos
   hijos, rutas/salidas, efectos y acceso externo. El JSON no contiene esos scripts. No asumir que sean
   seguros porque sus rutas se encuentren bajo TEST. Controlar también el temporal del propio conversor.
6. Preparar directorios por ejecución y creación segura de nuevos archivos. No reintroducir el barrido
   global HTML. Acreditar aislamiento frente a ejecuciones Caterpillar concurrentes y Pagos/Dropbox.
7. Revisión explícita de cada hold, tratamiento de errores y credencial de webhook exclusiva. Conservar
   inicialmente schedule/webhook deshabilitados. No eliminar masivamente los holds ni usar un flag de
   cliente para habilitar operaciones.

## Importación posterior (requiere otra fase/autorización)

1. Verificar por URL/identidad que el editor es 5690, nunca 5678, y trabajar en una copia nueva propia.
2. Importar únicamente el JSON BLOCKED; confirmar workflow inactivo, triggers deshabilitados,
   credenciales sin asignar y holds presentes. No publicar, activar ni probar el flujo completo.
3. Resolver las dependencias anteriores con lecturas/preflight separados, sin modificar workflows de
   Notificaciones de Pago o diagnóstico de Dropbox.
4. Preparar una nueva revisión con cambios autorizados y validación del perímetro antes de retirar holds.
   Cualquier prueba con reserva/documentos/SQL mutante requiere autorización explícita posterior.

Validación local offline:

```powershell
node n8n/workflows/remisiones-caterpillar/candidate-5690/validate-candidate.cjs
```
