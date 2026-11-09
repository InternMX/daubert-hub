# Herramientas del ensayo de liberación de Manufactura

Solo para instancias **desechables** (réplica de producción, contenedores locales). Ninguna se conecta a `daubert_global`, a `daubert_hub_test` ni a servicios operativos. Procedimiento completo: `docs/hub/manufactura-ensayo-liberacion.md`.

| Archivo | Uso |
|---|---|
| `contar-filas.readonly.sql` | Conteo exacto de filas por tabla (solo lectura). Se ejecuta en el origen y en la réplica; las salidas deben coincidir |
| `smoke-http.cjs <url> disabled\|enabled` | Comprueba por HTTP, con ADMIN y GENERAL, que las rutas de Manufactura dan 404 (apagada) o responden (habilitada), que los módulos existentes siguen en 200 y los permisos ADMIN/GENERAL. Requiere `ENSAYO_PASSWORD` y los usuarios `admin1@example.invalid` y `g2@example.invalid` (sembrados en la réplica) |
| `flujo-documento.cjs <url> [salida.pdf]` | Borrador → cliente del catálogo (`empresaId` 1) → finalizar → PDF → entorno de emisión → inmutabilidad → alta de firma de 1.5 MB (útil frente a nginx) |
| `generar-ocho-formatos.cjs <dist/src> <chrome> <carpeta> [true]` | PDF finalizado de los ocho formatos con el código compilado y el Chrome indicado (el 4.º argumento `true` añade `--no-sandbox`, solo dentro del contenedor) |
| `comparar_pdfs.py <carpeta_host> <carpeta_contenedor>` | Compara palabra por palabra (PyMuPDF): páginas, texto, desviación de posición y fuentes |
| `formatos.datos.txt` | Datos de los ocho formatos (copia de `sheet-pdf-sin-leyendas.real.spec.ts`) |
| `datos-sinteticos-manufactura.cjs` | Genera datos SINTÉTICOS en Manufactura con la API real (se ejecuta dentro del contenedor de la API de la réplica): borradores, revisiones, PDF, firmas, responsables, revisor, descartado, abreviatura. `SOLO_REVISION=1` añade la revisión registrada |
| `probar-respaldo-rls.cjs` | Respaldo con `daubert_backup` (`--enable-row-security`) → restauración en otra instancia → comparación de filas, hashes, objetos y permisos; controles negativos (respaldo incompleto, escrituras, reversión de la 026) |
| `huellas-datos.readonly.sql` | MD5 por tabla de todo lo que no es `manufactura` (solo lectura) |
| `respaldar-daubert-global.ps1` | Respaldo completo de solo lectura de `daubert_global` (lo ejecuta una persona con su contraseña) |
| `respaldo-rls/enable-row-security.patch` | Parche (NO aplicado) de `scripts/backup`: `pg_dump --enable-row-security` + prueba Pester |
