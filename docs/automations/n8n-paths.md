# n8n — Rutas y archivos

Fuente: código de los nodos de los exports reales (Fase D2). Se listan **rutas y estructura**, nunca contenido. Todas cuelgan de `C:\Users\06\Documents\Dropbox\` (equipo servidor de n8n; los exports asumen Windows).

Tipos: **INPUT** · **PROCESADOS/COPIA** · **SALIDAS** · **LOGS** · **ERRORES** · **AUXILIARES** · **TEMP** · **LEGACY**.

## Caterpillar

| Tipo | PROD | TEST |
| --- | --- | --- |
| INPUT (real) | `CLIENTES\CATERPILLAR MEXICO - P2\SOLICITUD DE MATERIAL` · `CLIENTES\CAT NUEVO LAREDO\MAS INFORMACION\SOLICITUD DE MATERIAL\<año>` · `CLIENTES\CATERPILLAR INDUSTRIAS MEXICO - P3 P4 P5 P6\MAS INFORMACION\SOLICITUD DE MATERIAL\<año>` · `CLIENTES\CAT TORREON\MAS INFORMACION\SOLICITUD DE MATERIAL` · `CLIENTES\CATERPILLAR\MAS INFORMACION\SOLICITUD DE MATERIAL` (**Legacy**: se detecta pero nunca se procesa) | **No se escanean** (`ACTIVAR_RUTAS_REALES=false`) |
| INPUT (pruebas) | `HERRAMIENTAS AUTOMATIZACION\REMISIONES CAT\00_ARCHIVOS A PROCESAR` (definida, **no** escaneada) | `Pruebas\REMISIONES CAT\00_ARCHIVOS A PROCESAR` (escaneada; el aislamiento exige además "PRUEBA" en el nombre) |
| COPIA | `…\REMISIONES CAT\01_ENTRADA` | `Pruebas\REMISIONES CAT\01_ENTRADA` |
| SALIDAS | `…\02_SALIDAS\<cliente_grupo>[\<planta>|\<subplanta>]` (`CATERPILLAR_P2`, `CAT_P3_P4_P5_P6\<P3..P6>`, `CAT_NUEVO_LAREDO\<FINSA_n>`, `CAT_TORREON[\PLANTA_n]`) | ídem bajo `Pruebas\` |
| LOGS | `…\03_LOGS` (en el workflow PG ya no se escribe log de éxito; los `.json` que hay son del workflow legado) | ídem |
| ERRORES | `…\04_ERRORES` (`error_<run_name>` JSON/TXT) | ídem |
| AUXILIARES | `…\05_ARCHIVOS AUXILIARES\{TEMPLATES,SCRIPTS,CATALOGO}` | ídem |
| TEMP | `…\06_ARCHIVOS TEMPORALES\html` | ídem |
| LEGACY | `…\05_ARCHIVOS AUXILIARES\ESTADO\{archivos_procesados_cat.json, contador_cat_<grupo>_<planta>.json ×7}` y `…\LEGACY` | `…\LEGACY (DESUSO)\ESTADO\…` |

Diferencia estructural: TEST renombró las carpetas legadas (`LEGACY (DESUSO)`); PROD conserva `ESTADO` y `LEGACY` sin renombrar. En PROD la carpeta de salida `02_SALIDAS` no contiene subcarpetas de Nuevo Laredo (proceso no habilitado).

## Audi

| Tipo | PROD | TEST |
| --- | --- | --- |
| INPUT | `CLIENTES\AUDI\<año actual ±1>\<carpeta "información adicional">\…` (**recursivo**; excluye subcarpetas cuyo nombre contenga *remisiones*, *facturas*, *recibida(s)*; ventana de 60 días; mínimo 2 min de antigüedad) | `Pruebas\REMISIONES AUDI\00_ARCHIVOS A PROCESAR` |
| COPIA | `HERRAMIENTAS AUTOMATIZACION\REMISIONES AUDI\01_ENTRADA` | `Pruebas\REMISIONES AUDI\01_ENTRADA` |
| SALIDAS | `02_SALIDAS\REMISIONES` (PDF) · `02_SALIDAS\HOJAS_IDENTIFICACION` (PDF) | ídem bajo `Pruebas\` |
| LOGS | `03_LOGS\log_<run_name>.csv` | ídem |
| ERRORES | `04_ERRORES\error_<run_name>.txt` y `ERROR_<workflow>_<nodo>_<ts>.json` del manejador (**ruta fija de PROD**, también para TEST) | ídem (los del manejador van a PROD) |
| AUXILIARES | `05_ARCHIVOS AUXILIARES\{TEMPLATES,SCRIPTS,CATALOGO}` | ídem |
| TEMP | `06_ARCHIVOS TEMPORALES\{html, html_hojas_identificacion}` | ídem |
| LEGACY | `05_ARCHIVOS AUXILIARES\ESTADO\{contador_remisiones_audi.json, archivos_procesados_audi.json (+ .bak), migrar_archivos_procesados_audi_a_pg.sql}` | `ESTADO (EN DESUSO)\…` (TEST **aún lee** `archivos_procesados_audi.json`) |

## Notificaciones de pago

Definidas en el nodo `Configurar entorno` (según `MODO`):

| Tipo | PROD (`PRODUCCION`) | TEST (`PRUEBAS`) |
| --- | --- | --- |
| Raíz de archivos (`root_archivos`) | `Dropbox\` completa (los destinos por proveedor salen de la vista `core.vw_catalogo_notificacion_pago_n8n`, con contención en la raíz: `RUTA_PROVEEDOR_FUERA_DE_ROOT`) | `Pruebas\NOTIFICACIONES DE PAGO` (subcarpetas `FLETES`, `PROVEEDORES`, `PROVEEDOR DE SERVICIOS`, `00_ARCHIVOS A PROCESAR`, `01_ARCHIVOS PROCESADOS`, `02_SALIDAS`) |
| Raíz de sistema (`root_sistema`) | `HERRAMIENTAS AUTOMATIZACION\NOTIFICACIONES DE PAGO` | `Pruebas\NOTIFICACIONES DE PAGO` |
| LOGS | `03_LOGS\<año>` | ídem |
| ERRORES | `04_ERRORES\PDF` · `04_ERRORES\OUTLOOK` | ídem |
| AUXILIARES | `05_ARCHIVOS AUXILIARES` (incluye `archivos_procesados.json`, **en uso**) | ídem |
| FIRMA | `HERRAMIENTAS AUTOMATIZACION\NOTIFICACIONES DE PAGO\05_ARCHIVOS AUXILIARES\FIRMA` | **La misma (de PROD)** |
| Programación semanal (INPUT) | `Dropbox\CXP\CXP\PROGRAMACIÓN SEMANAL` (Excel) | **La misma (real)** |

## Hallazgos

- Las carpetas base numeradas (`00_…06_`) siguen el mismo esquema en las tres automatizaciones, salvo `00_ARCHIVOS A PROCESAR` que en PROD no se usa.
- **Inconsistencia TEST/PROD de estructura:** nombres de carpetas legadas distintos (`ESTADO` vs `ESTADO (EN DESUSO)` / `LEGACY (DESUSO)`); Notificaciones TEST comparte firma y programación semanal con PROD.
- Las rutas son **absolutas y con el usuario de Windows en la ruta**: mover el servicio a otro equipo/usuario exige editar nodos Code (varias copias por workflow).
