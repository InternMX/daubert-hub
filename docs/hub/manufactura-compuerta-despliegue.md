# Manufactura · compuerta de despliegue y procedimiento autorizado de migraciones (Fase 6C.1)

Estado: **preparado y ensayado en instancias y clones desechables; nada desplegado, nada aplicado en `daubert_global`, `scripts/backup/` y la configuración de producción intactos.**

## 1. Causa exacta del bloqueo
`scripts/deploy/Deploy-DaubertHub.ps1` **no aplica SQL**: toma el delta `git diff --name-only <commit en PROD> HEAD`, y si algún archivo está bajo `database/` bloquea el despliegue salvo que se confirme con `-AcknowledgeMigrationsAlreadyApplied` + `-ExpectedMigrations` + evidencia reciente + `-EvidenceMarkers`. El problema: `-ExpectedMigrations` son **prefijos de nombre bajo `database/migrations/daubert_global/`** (ruta fijada en `Test-DeployGate`) y la compuerta **no mira contenidos**. El delta de esta rama contra `main` (16153a8) toca **77 archivos** y 41 de ellos están fuera de esa ruta ⇒ ningún valor de `-ExpectedMigrations` los cubre y la rama quedaría siempre bloqueada.

## 2. Los 77 archivos
| Grupo | Archivos | Categoría del manifiesto | ¿Se ejecutan en PROD? |
|---|---:|---|---|
| `daubert_global`: precheck / up / postcheck de 020, 021, 022, 023, 024 y 026 | 18 | `produccion_aplicar` | **Sí**, en este orden, por `Invoke-ManufacturaMigrations.ps1` |
| `daubert_global`: down de esas seis | 6 | `produccion_reversion` | Solo para revertir, a mano, con confirmaciones |
| `daubert_global`: verificación transversal y humo de solo lectura (`…_000_…readonly.sql`) | 2 | `produccion_lectura` | Sí (solo lectura) |
| `daubert_global`: `replica_only/` (humos con escrituras), `tools/` (3), README y resultado de validación | 5 + 3 + 2 | `inerte_nunca_en_prod` | **No** (los humos se niegan a correr sin el esquema `replica_desechable`) |
| `migrations/daubert_hub_test` (101–105, README, herramientas) | 35 | `inerte_nunca_en_prod` | **No**: todas abortan fuera de `daubert_hub_test` |
| `maintenance/daubert_global` (inventarios de solo lectura) | 2 | `inerte_nunca_en_prod` | No forman parte de la liberación |
| `maintenance/daubert_hub_test` (limpieza de documentos de TEST) | 4 | `inerte_nunca_en_prod` | **No** (abortan fuera de `daubert_hub_test`) |
| **Total** | **77** | | |
Fuera de este conjunto queda la **025** (recuperación de folios de Caterpillar, otra rama): ni se lista ni se acepta.

## 3. Soluciones consideradas y la elegida
| Opción | Veredicto |
|---|---|
| A. Usar `-ExpectedMigrations` con una lista explícita | **No sirve**: el prefijo está fijado a `database/migrations/daubert_global/`; los 41 archivos restantes quedan fuera |
| B. Quitar los archivos de TEST y mantenimiento del delta (rama aparte, o sacarlos de la rama) | Pierde las migraciones históricas de TEST y los scripts de mantenimiento, que deben conservarse; obliga a mantener dos historias |
| C. Relajar la compuerta (aceptar cualquier `database/…`) | Debilita la protección: aceptaría migraciones imprevistas |
| **D. Manifiesto con hashes (elegida)** | La compuerta sigue igual de estricta y se **fortalece**: exige que el delta sea **exactamente** el conjunto aprobado, con el mismo contenido (id de blob de git por archivo), y que el manifiesto mismo coincida con un SHA-256 entregado fuera del repositorio. Cambio mínimo: un parámetro opcional; sin él, el comportamiento anterior no cambia |

## 4. Qué se implementó
- `scripts/deploy/generar-manifiesto-database.cjs`: genera/verifica `deploy/release-manifests/manufactura-database-release.json` (77 archivos con ruta, categoría, blob y SHA-256, orden de migraciones y patrones prohibidos). Falla si el delta incluye algo prohibido (la 025) o si falta algún archivo de las migraciones autorizadas.
- `Deploy-DaubertHub.ps1`: nuevos `-DatabaseManifest` y `-DatabaseManifestSha256` (solo se honran junto con `-AcknowledgeMigrationsAlreadyApplied`, `-ExpectedMigrations`, evidencia y marcadores). La compuerta bloquea si: falta el manifiesto o su SHA-256 no coincide; un archivo del delta **no está** en el manifiesto, **cambió** (blob distinto) o fue **eliminado**; un archivo de producción autorizado **falta o difiere en HEAD** aunque no esté en el delta; algún archivo contiene `_025_` o `caterpillar_folio_recovery` (patrón **fijo en el código**, independiente del manifiesto); un archivo `produccion_*` no está cubierto por `-ExpectedMigrations` (que sigue siendo obligatorio). La evidencia reciente con marcadores sigue exigiéndose. Pruebas Pester: 13 nuevas (68 en total, todas pasan; las 55 anteriores sin cambios).
- `scripts/deploy/Invoke-ManufacturaMigrations.ps1`: aplica **020 → 021 → 022 → 023 → 024 → 026** (orden fijo, no el de la carpeta). Antes de cualquier SQL verifica el SHA-256 del manifiesto, que los pasos del manifiesto sean exactamente esos seis (jamás la 025) y que cada archivo coincida con el manifiesto **tanto en HEAD como en el árbol de trabajo**. Exige `PGDATABASE=daubert_global` y rol administrador; por paso: precheck → UP (una transacción) → postcheck con las huellas del precheck → verificación transversal (14 huellas de línea base). Se detiene en el primer fallo, no reintenta y no ejecuta ningún DOWN. Sin `-Apply` solo imprime el plan. `-UntilStep`/`-FromStep` permiten ventanas por etapas. Escribe la evidencia (fuera del repositorio) con los marcadores `POSTCHECK_0NN_PASS`, `VERIFY_0NN_PASS`, `SMOKE_READONLY_PASS`, `MANUFACTURA_SQL_COMPLETE`.

## 5. Procedimiento autorizado (no ejecutado)
1. En el commit candidato final: `node scripts/deploy/generar-manifiesto-database.cjs --base <commit que corre en PROD> ` y `--verificar …`. **El SHA-256 del manifiesto se registra en el acta de la junta** (se entrega fuera del repositorio). Si se cambia cualquier archivo de `database/`, se regenera y se vuelve a autorizar.
2. (Ventana, con autorización) conexión por variables `PG*` del operador y: `powershell -File scripts\deploy\Invoke-ManufacturaMigrations.ps1 -DatabaseManifestSha256 <sha> -Apply -EvidenceFile <fuera del repo>\manufactura-migraciones.txt`. Antes, el parche de respaldos (`respaldo-rls/enable-row-security.patch`) y el respaldo completo previo.
3. Despliegue de api y web: `Deploy-DaubertHub.ps1 -Deploy -AcknowledgeMigrationsAlreadyApplied -ExpectedMigrations 20261108_0,20261109_026 -DatabaseManifest deploy/release-manifests/manufactura-database-release.json -DatabaseManifestSha256 <sha> -MigrationsEvidence <archivo> -EvidenceMarkers POSTCHECK_020_PASS,POSTCHECK_021_PASS,POSTCHECK_022_PASS,POSTCHECK_023_PASS,POSTCHECK_024_PASS,POSTCHECK_026_PASS,MANUFACTURA_SQL_COMPLETE`.
4. Habilitación de Manufactura (`MANUFACTURING_ENABLED` / `MANUFACTURING_EMISSION_ENV`) según `manufactura-habilitacion-produccion.md`.
**Supuesto:** el manifiesto se genera contra el commit que **realmente corre en PROD** (`/api/health`). Si PROD corre otro commit, el delta incluirá archivos que el manifiesto no lista y la compuerta bloqueará (seguro); hay que regenerarlo con ese `--base`.

## 6. Ensayo (todo en instancias y clones desechables)
- **Compuerta con git real y el manifiesto real** (`tools/ensayo-liberacion/ensayo-compuerta-real.ps1`, clon aislado): 13 escenarios correctos — el conjunto legítimo se acepta (dos veces); se bloquean: migración de producción inesperada, migración conocida (024 UP) modificada, postcheck de la 026 modificado, archivo TEST modificado, archivo TEST nuevo, script de mantenimiento nuevo, **025 de Caterpillar presente**, archivo autorizado eliminado, manifiesto alterado, SHA-256 de autorización incorrecto, `-ExpectedMigrations` insuficiente. El ensayo **detectó una carencia** (un archivo autorizado que desaparece de HEAD no figuraba en el delta y pasaba) y se corrigió.
- **Procedimiento de migraciones** (`ensayo-migraciones-manufactura.ps1`, PostgreSQL 18 desechable con la copia completa de PROD y un clon): plan sin tocar la base · SHA-256 incorrecto, archivo editado sin commit, manifiesto con otro orden o con la 025 (aun entregando su SHA-256), base equivocada, contraseña incorrecta: **se niega/detiene sin aplicar nada** · ventana por etapas hasta la 021 + un privilegio indebido provocado: la reanudación **se detiene en la verificación transversal de la 022 y no llega a la 023** · instancia nueva: **020, 021, 022, 023, 024 y 026 aplicadas en ese orden** con todos los marcadores, 33 políticas, 9 tablas, **sin esquema de la 025**, evidencia sin contraseñas · repetir sobre la base migrada: se detiene en el precheck de la 020 sin cambiar nada.
Los hallazgos del ensayo también corrigieron `Invoke-ManufacturaMigrations.ps1` (lectura de las salidas de los prechecks y compatibilidad con StrictMode).
Evidencia (fuera del repositorio): `C:\Users\06\Documents\Daubert\Evidencia_6B_20261109\fase6c1\`.

## 7. Riesgos que quedan
- La compuerta depende de que el SHA-256 del manifiesto se conserve **fuera del repositorio**; quien cambie archivos y manifiesto a la vez sin ese registro solo será detenido por el SHA-256 de autorización.
- El manifiesto debe regenerarse si la junta pide cambios en `database/` o si el commit de PROD no es 16153a8.
- `Deploy-DaubertHub.ps1` y `Invoke-ManufacturaMigrations.ps1` no se ejecutaron contra PROD ni contra Docker real: la parte de Compose/anclas de reversión de la compuerta se probó con Pester (simulada), y las migraciones solo contra copias desechables.
- Siguen abiertos: parche de respaldos sin aplicar, aprobación visual de los PDF, BIND real, runners desfasados y la versión 1.2.0.
