# Caterpillar TEST Windows/5678 — fase 3E

**PROPOSED / BLOCKED — NO APTO PARA EJECUCIÓN.** No importar, publicar, activar ni ejecutar aún.
Preparación offline sobre el export TEST original; NO deriva funcionalmente del candidato 5690.
No se modifican n8n, PostgreSQL, Dropbox, scripts externos ni artefactos 5690.

## Artefactos y procedencia

- `caterpillar-test-5678.PROPOSED.BLOCKED.json`: 60 nodos y 59 conexiones originales, sin credenciales,
  sin pinData ni identidad del workflow original. Workflow inactivo y sus tres entradas deshabilitadas.
- `prepare-candidate.cjs`: genera el JSON y JavaScript; exige SHA-256 del export original
  `273dbd1b94e36be1a698a38558469fd72f60c73489de9b4ee8d115e48a70b517`.
- `manifest-v1.generated.cjs`: JavaScript ES2020 derivado por TypeScript de V1 y el adaptador existentes;
  incluye huellas de ambas fuentes. No cambiarlo a mano. El factory puro se embebe en el nodo Code:
  n8n no necesita importar NestJS, TypeScript, paquetes externos ni este archivo en disco.
- `manifest-transport.cjs`: invariantes puras de transporte; no decide duplicados ni autoriza reserva.
- `normalization-source.fixture.json`: cuerpos puros originales de los tres nodos de normalización/
  transporte y topología revisada, sin credenciales ni scripts de I/O. Permite unitarias sin Descargas.
- `runtime-test-safety.cjs`: guardas Windows y verificador puro de reporte/política PostgreSQL.
- `postgres-test-preflight.sql`: consulta READ ONLY preparada, **NO EJECUTADA**; no es migración.
- `validate-candidate.cjs`: inspección offline de grafo, código derivado, clasificación, folios,
  rutas, referencias de credenciales y bloqueos. No ejecuta workflows ni operaciones originales.

## Manifest: cálculo y transporte

`Normalizar datos CAT` conserva su lógica original salvo estas adiciones verificables:

1. Factory JavaScript derivado de las fuentes V1 sin cambiar su algoritmo.
2. Después de construir `salida` y comprobar `errores.length`, llama
   `adaptCaterpillarNormalizedItems(salida)` **antes de `const salidaFinal` y de agrupar Torreón**.
3. Adjunta `{ manifest, deliveryIdentity: 'UNCONFIRMED' }` como `json.cat_operational_content` a cada
   item final. No crea items, no ordena la salida y no modifica las partidas o cantidades originales.

El manifest contiene las ocurrencias preagrupación aunque el item Torreón muestre `OC_<oc>`.
Se prueban valores reales del detector: `TORREON` / `PLANTA_2`, OC textuales con ceros, decimales y
partidas repetidas. El rechazo de fechas inválidas de V1 es explícito y recorre la salida de error
existente del normalizador; no se relaja para aceptar datos incompletos.

`Preparar reserva folios PG` comprueba presencia, versión, identidad UNCONFIRMED, estructura,
consistencia entre items y cardinalidad de documentos, y conserva el envelope en su única salida.
Es el punto de control previo a reserva, **sin deduplicación**. No se agregan conexiones o nodos.

El nodo SQL de reserva sigue con su consulta original detrás del hold. Su respuesta no transporta
el envelope, pero `Asignar folios PG CAT` sigue leyendo nominalmente `Normalizar datos CAT` y
`Preparar reserva folios PG`; verifica que ambos envelopes coincidan y los conserva en `...data`.
La aritmética, orden, cantidad y asignación de folios no cambian. Ninguna prueba reserva folios reales.

## Seguridad de archivos y entradas

Raíz operativa única:

```text
C:\Users\06\Documents\Dropbox\Pruebas\REMISIONES CAT
```

No se comprueba ni modifica Dropbox en esta fase. La guarda exige Windows, ruta absoluta normalizada,
raíz real exacta y objetivos existentes/verificables. Rechaza escapes, `..`, hermanos de prefijo,
otras unidades, UNC/device paths, ADS, patrones, nombres reservados, componentes con punto/espacio final,
symlinks/junctions y destinos reales fuera de la raíz. Un fallo de verificación aborta.

Se retira la tabla productiva del detector y su fallback comentado. La clasificación se conserva.
El filtro normal añade comprobación real de ruta y el reproceso mantiene sus controles de ámbito con
filesystem protegido. No se admiten rutas o identidades del body como autorización.

Los ocho nodos Code con I/O tienen hold antes de acceder a fs/path; su fachada fs deniega además
**todos** los métodos mutantes, incluso si se retirase por error el hold inicial. Los nodos nativos
de archivos y los dos comandos PowerShell tienen expresiones que fallan incondicionalmente.
Los nodos de acción no están deshabilitados (n8n podría omitirlos): deben abortar, no ser saltados.

Los temporales se planifican bajo `06_ARCHIVOS TEMPORALES/cat-test-5678/<execution-id>`.
Se elimina el barrido global de HTML. **No se crean directorios ni se autorizan destinos inexistentes**:
falta verificar creación exclusiva, permisos, pertenencia al lote y carreras entre validación y uso.
Una guarda JavaScript no es aislamiento físico dentro del proceso compartido TEST/PROD de 5678.

Los scripts previstos son las copias TEST `convertir-cat-pdf.ps1` y `limpiar-temp-cat.ps1`; el normalizador
conserva sus fallbacks originales `html-to-pdf-cat.ps1` y `limpiar-html-temporal-cat.ps1`.
Todos siguen inaccesibles por los holds. Falta revisar contenido, intérprete PowerShell, conversor PDF,
procesos hijos, temporales y efectos. Catálogos, plantillas y fuentes deben quedar bajo la raíz TEST.
No hay rutas externas de herramientas/plantillas autorizadas: cualquier dependencia externa de lectura
o ejecución requiere inventario exacto separado, sin permiso de escritura sobre ella.

Schedule, webhook y disparador manual permanecen deshabilitados; webhook nuevo marcado BLOCKED,
sin credencial. Ejecutar manualmente un nodo o activar una entrada no elimina los holds siguientes.

## PostgreSQL: identidad preparada, ninguna conexión realizada

**Todos los nodos PostgreSQL siguen bloqueados**, incluyendo resolver/crear documento, crear ejecución,
reproceso, registro de fallos, registro de remisiones y finalización: detenerse antes de reservar no
implica que esas etapas previas fueran de solo lectura. También se bloquea el diagnóstico desconectado.
Consultas y bindings originales se conservan sin ejecutar; no hay credenciales asignadas.

El preflight preparado exige `current_database()='daubert_hub_test'`, opera en transacción READ ONLY
y solo inspecciona identidad/catálogos/permisos; nunca invoca funciones de negocio. Requiere parámetros
de sesión de empresa y series aprobadas, que no se configuran aquí. Reporta usuario, servidor, puerto,
empresa activa, series activas, coherencia básica de rangos/cantidad de reservas, funciones disponibles
y ejecutables, y una huella de roles/membresías efectivas, esquemas, tablas, columnas, secuencias y
definiciones de funciones. Las consultas pueden fallar por permisos insuficientes: no se elevarán
privilegios para forzar un resultado.

`verifyIdentity(report, approved)` exige una política operativa revisada externamente con usuario,
servidor, puerto, empresa, series y huella de permisos esperados. No existe política aprobada por defecto;
rechaza roles administrativos, CREATE en esquemas, escritura directa de tablas de negocio,
funciones ausentes y cualquier discrepancia.
Confirmar un reporte **no retira ningún hold** ni prueba por sí solo la procedencia de ese reporte.

Antes de habilitar cada mutación, una revisión posterior debe añadir/revisar la guarda de identidad
en la MISMA conexión/transacción que la operación, junto con la credencial exclusiva y privilegios
mínimos de TEST. Un reporte anterior, un nombre de credencial, un GUC o un flag de cliente no bastan.
La empresa fija y códigos de series del export no son aprobación de su uso en la base real.
No se certifica el esquema vivo ni se modifica SQL de reserva/asignación en esta fase.

## Validación offline y siguiente revisión

```powershell
node n8n/workflows/remisiones-caterpillar/candidate-5678/prepare-candidate.cjs
node n8n/workflows/remisiones-caterpillar/candidate-5678/validate-candidate.cjs
npm exec --workspace=@daubert/api -- vitest run test/caterpillar-operational-manifest.spec.ts test/caterpillar-operational-manifest.adapter.spec.ts test/caterpillar-windows-candidate.spec.ts
```

Las unitarias simulan únicamente los cuerpos Code con filas Excel/catálogos sintéticos y filesystem
ficticio. Comparan el normalizador original contra la propuesta; comprueban equivalencia del JS derivado,
orden/cardinalidad, transporte, rechazos y holds. No arrancan n8n, no ejecutan una automatización ni
acceden a archivos operativos, SQL o PowerShell. El preflight SQL no se ha probado contra PostgreSQL.

Para una futura prueba autorizada en 5678: verificar versión/runtime/permisos, credencial TEST y
servidor real; revisar filesystem y scripts; preparar captura sintética de solo cálculo que no atraviese
los nodos mutantes previos; mantener desconectados de la prueba reserva, PDFs, envíos y registros.
Después se podrá revisar cada bloqueo por separado. No activar el flujo completo ni schedules.
No implementar rechazo por contenido igual: continúa `deliveryIdentity: UNCONFIRMED`.
