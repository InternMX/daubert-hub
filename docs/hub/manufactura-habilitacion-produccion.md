# Manufactura · preparación técnica para producción y procedimiento de habilitación (Fase 5)

Estado: **código preparado, SIN desplegar y SIN habilitar.** Con la configuración por omisión, una API apuntada a `daubert_global` responde **404** a todas las rutas de Manufactura. No se aplicó ninguna migración en bases reales ni se tocó ningún servicio operativo.

> **Fase 6A:** la preparación del ensayo de liberación (decisiones D1/D3 con su documento de origen, configuración de TEST, reproducibilidad del PDF, réplica, riesgos y comandos) está en [`manufactura-ensayo-liberacion.md`](manufactura-ensayo-liberacion.md). Ojo: «D1» designa dos cosas distintas según el documento (PDF en PROD vs. clientes solo ADMIN); ver su §1.

## 1. Qué impedía ejecutarla en producción (diagnóstico verificado sobre el código integrado)

| # | Bloqueante | Estado antes | Estado ahora |
|---|---|---|---|
| B1 | `TestOnlyGuard` limitaba el gestor documental a la base `daubert_hub_test` **por nombre** | Imposible en PROD | Sustituido por habilitación explícita por entorno (§2) |
| B2 | Las rutas de BIND, familias y vista previa estaban abiertas en cualquier base, incluida PROD | Visibles sin migraciones (404/errores) | Protegidas por `ManufacturingSheetsEnabledGuard`: en `daubert_global` responden 404 mientras no se habilite |
| B3 | La imagen de la API **no tenía Chromium ni fuentes** (`resolveChromePath` no adivina en producción) | PDF = «no disponible» | Chromium + Carlito + DejaVu dentro de la imagen; la finalización de PDF funciona sin nada instalado en el host |
| B4 | nginx: límite por omisión de 1 MB; la API acepta firmas de 2 MB | Una firma legítima de 1–2 MB recibía 413 de nginx | `client_max_body_size 3m` **solo** en la ruta exacta de alta de firmas |
| B5 | Tipos/etiquetas fijaban `entorno_emision = 'PRUEBA'` (API y web) | Un documento de PROD se rotulaba «PRUEBA · NO VÁLIDO PARA PRODUCCIÓN» | El tipo admite `PRUEBA \| PRODUCCION`; la web toma el entorno de `GET …/documents/capabilities` |
| B6 | La web mostraba menú, tarjeta, rutas, abreviaturas y firmas de Manufactura aunque el backend respondiera 404 (D4–D6 del reporte de diferencias) | Pantallas rotas | `VITE_MANUFACTURING_UI=false` (valor de la imagen de PROD) las oculta y el código se elimina del bundle |
| B7 | `compose.pilot.yaml` no pasaba variables de Manufactura | — | Pasa `MANUFACTURING_ENABLED`, `MANUFACTURING_EMISSION_ENV`, `BIND_*` y los *build args* de la web, todos apagados/vacíos por omisión |

**No bloqueaba (comprobado):** `entorno_emision = 'PRODUCCION'` ya lo fija la migración 020 (DEFAULT, CHECK y trigger); `argon2` instala y verifica en Alpine/musl; `esbuild` solo interviene en la construcción de la web y su binario viene del paquete opcional (el aviso de `npm ci` sobre «install-scripts» no impidió ningún build); las plantillas/herramientas/perfiles se copian a `dist/` (`nest-cli.json`).

## 2. Habilitación explícita por entorno

`apps/api/src/config/environment.ts` → `resolveManufacturing(DB_NAME, env)`:

| Base configurada | Sin variables | `MANUFACTURING_ENABLED` | `MANUFACTURING_EMISSION_ENV` | Resultado |
|---|---|---|---|---|
| `daubert_hub_test` (TEST) | **Habilitado**, emisión `PRUEBA` | `false` lo apaga | `PRODUCCION` → **no arranca** | Comportamiento histórico conservado |
| `daubert_global` (PROD) | **Apagado**, emisión `PRODUCCION` | `true` exige también `EMISSION_ENV=PRODUCCION`; si no → **no arranca** | `PRUEBA` → **no arranca** | Dos declaraciones explícitas para encender |
| cualquier otra | Apagado | `true` → **no arranca** | — | No se adivina el entorno |

- Variables vacías (compose las pasa sin valor) equivalen a no declaradas; valores distintos de `true`/`false` (o de `PRUEBA`/`PRODUCCION`) detienen el arranque.
- Los guards se evalúan **después** de sesión, CSRF y roles: habilitar el módulo no sustituye autenticación ni autorización. Las reglas ADMIN/GENERAL, RLS y confirmaciones por función de la base no cambian.
- El entorno de emisión real lo escribe la **base** (trigger + CHECK); la configuración solo lo contrasta. TEST y PROD no pueden mezclarse: PROD exige migraciones 020–024 (`PRODUCCION`), TEST las 101–105 (`PRUEBA`).
- Guard de arranque preexistente (`production-database-guard`): un proceso que no sea el contenedor de PRODUCCIÓN no puede conectarse a `daubert_global`.

## 3. Variables

### API (contenedor)
| Variable | TEST | PROD (apagado) | PROD (habilitado) |
|---|---|---|---|
| `DB_NAME` / `DB_USER` | `daubert_hub_test` / `daubert_hub_test_user` | `daubert_global` / `daubert_hub_app` | igual |
| `MANUFACTURING_ENABLED` | vacío o `true` | vacío o `false` | **`true`** |
| `MANUFACTURING_EMISSION_ENV` | vacío o `PRUEBA` | vacío | **`PRODUCCION`** |
| `BIND_API_KEY`, `BIND_SUBSCRIPTION_KEY` | de TEST (opcionales) | vacías | de PROD (opcionales; sin ellas la consulta responde 503 `NOT_CONFIGURED`) |
| `BIND_API_BASE_URL` | vacía | vacía | vacía (solo `https://*.bind.com.mx`, sin puerto ni credenciales) |
| `MANUFACTURING_PDF_CHROME_PATH` | lo define la imagen | lo define la imagen | lo define la imagen (`/usr/bin/chromium`) |
| `MANUFACTURING_PDF_CHROME_NO_SANDBOX` | lo define la imagen (`true`) | ídem | ídem. **Solo** para el usuario `node` sin privilegios del contenedor; no activar en procesos del host |

### Web (variables de COMPILACIÓN de Vite, *build args*)
| Variable | TEST | PROD (apagado, por omisión) | PROD (habilitado) |
|---|---|---|---|
| `VITE_MANUFACTURING_UI` | `true` | `false` | `true` |
| `VITE_MANUFACTURING_DOCUMENTS` | `true` | `false` | `true` |

> **Atención TEST:** el `deploy/pilot.test.env` real (sin versionar) debe añadir `VITE_MANUFACTURING_UI=true` y `VITE_MANUFACTURING_DOCUMENTS=true`; si no, la próxima reconstrucción de la imagen web de TEST ocultará Manufactura. La plantilla `deploy/pilot.test.env.example` ya los incluye.

## 4. Docker, Chromium y fuentes
- `docker/api.Dockerfile` (etapa *runtime*): `apk add chromium font-carlito fontconfig ttf-dejavu`; `ENV MANUFACTURING_PDF_CHROME_PATH=/usr/bin/chromium` y `MANUFACTURING_PDF_CHROME_NO_SANDBOX=true`. Calibri se resuelve a **Carlito** (métricas compatibles), que es la fuente de respaldo de las plantillas.
- El renderer agrega `--no-sandbox --disable-dev-shm-usage` solo con `…NO_SANDBOX=true` (sin él, Chromium falla como usuario `node` dentro de Docker: comprobado, resultado `ERROR`). El HTML es generado por el sistema, sin red (`--host-resolver-rules=MAP * ~NOTFOUND`), sin extensiones y con perfil temporal por solicitud.
- La imagen crece: ≈406 MB de contenido (≈1.48 GB de uso en disco en Docker Desktop), con Chromium. Los paquetes `apk` no están fijados a versión: la reconstrucción puede traer otra versión de Chromium (medida: 156.0.8078.79) → repetir la regresión de PDF (`sheet-pdf-sin-leyendas.real.spec.ts`, `sheets-regression`) en cada reconstrucción.

## 5. nginx
`docker/nginx.conf`: `location = /api/manufacturing-sheets/documents/signatures { client_max_body_size 3m; … }`. Resto de rutas con el límite por omisión (1 MB). El API limita el archivo a 2 MB (413 con `File too large`) y reduce la imagen a ≤256 KB. Comprobado: nginx anterior → 413 con una firma de 1.5 MB; nginx nuevo → 201; 2.5 MB → 413 del API; 3.5 MB → 413 de nginx. Los tiempos de espera por omisión (60 s) cubren el tope de Chromium (25 s).

## 6. Procedimiento de habilitación (NO ejecutado; requiere autorización expresa)
1. **Respaldo** de `daubert_global` (`pg_dump -F c` completo) y del `.env`/imágenes vigentes; verificar restauración en una instancia desechable.
2. **Ensayo en réplica**: `validar-manufactura-020-024-en-replica-prod.cjs` con un `--schema-only` reciente → 0 FAIL; luego el ensayo de liberación con la imagen candidata y el smoke de §7.
3. Construir las imágenes: API (con Chromium) y web con `--build-arg VITE_MANUFACTURING_UI=true --build-arg VITE_MANUFACTURING_DOCUMENTS=true`.
4. Desplegar **primero** con Manufactura apagada (código nuevo, `MANUFACTURING_ENABLED` vacío): verificar que los módulos existentes no cambian y que las rutas de Manufactura dan 404.
5. Aplicar 020 → 024 (precheck → up → postcheck cada una, con `…_000_manufactura_prod_verificar_fuera_de_manufactura.readonly.sql` entre ellas).
6. Definir los datos de negocio pendientes (D3 cliente manual, clientes con rol CLIENTE, firmas, abreviaturas).
7. Habilitar: `MANUFACTURING_ENABLED=true` + `MANUFACTURING_EMISSION_ENV=PRODUCCION` y reiniciar **solo** la API; la web ya compilada con las banderas. Verificar `GET /api/manufacturing-sheets/documents/capabilities` → `entorno: PRODUCCION`.
8. **Reversión**: (a) apagar `MANUFACTURING_ENABLED` y reiniciar la API (instantáneo, sin tocar la base); (b) si hay que quitar el código, desplegar la imagen anterior (Manufactura no altera objetos existentes); (c) los `.down.sql` 024→020 con las confirmaciones explícitas de producción **solo** si no hay datos o con respaldo previo (los documentos finalizados son inmutables).

## 7. Pruebas ejecutadas en esta fase (instancias desechables únicamente)
Detalle y resultados en el informe de la fase. Resumen: unitarias API 180+ archivos y web 118 archivos; imagen API construida; Chromium del contenedor generó un PDF real; API en modo producción (contenedor, `NODE_ENV=production`, `daubert_global` desechable con la estructura real de PROD) probada **apagada sin migraciones**, **apagada con migraciones 020–024**, **habilitada** (ADMIN/GENERAL, borrador → finalización → PDF `PRODUCCION` → inmutabilidad → firma por nginx) y con **configuraciones contradictorias** (no arranca).

## 8. Riesgos que todavía impiden desplegar
1. Migraciones 020–024 sin aplicar y sin ensayo de liberación completo (respaldo, restauración, reversión).
2. **D3** sin decidir: la identificación manual de cliente (sin verificar) **sigue permitida** en cualquier entorno; la leyenda del código dice «solo en TEST». PROD tiene 2 clientes con rol CLIENTE.
3. Tras habilitar: sin usuarios GENERAL en PROD hoy (4 ADMIN); decisión D1 (clientes solo ADMIN) por confirmar.
4. BIND no probado contra el servicio real (sin credenciales en esta fase): solo se verificó `NOT_CONFIGURED`.
5. Imagen API ~1.5 GB y paquetes `apk` sin fijar (§4); falta fijar/ensayar la versión de Chromium y revisar auditoría de dependencias.
6. nginx/Docker de TEST y PROD **no** se reconstruyeron ni reiniciaron: el `pilot.test.env` real debe actualizarse (§3).
7. Pendientes de la Fase 3 (runners de Caterpillar/Pagos bloqueados por entorno, `reprocessBlockedCorreoIds`, contrato E2E de Actividad reciente, E2E de cancelación, intermitencia de pruebas HTTP, fuentes en `sheets-regression`, validación manual en navegador, pruebas de Audi) siguen abiertos.
