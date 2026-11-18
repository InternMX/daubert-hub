#!/usr/bin/env node
// GENERADOR de la migración PRODUCTIVA 026 de Manufactura: políticas de LECTURA para el rol de respaldos (daubert_backup).
//   node database/migrations/daubert_global/tools/generar-manufactura-026.cjs
// Es una migración SOLO de producción (sin contraparte 106 en TEST: el respaldo automático solo cubre daubert_global). Se genera con un script para reutilizar EXACTAMENTE el predicado de «lector de
// respaldos autorizado» que ya usan los postchecks 020/021 y la verificación transversal (una sola fuente: se extrae del postcheck 020 generado). No hay colisión con la 025: esa numeración la usa otra rama
// (feat/cat-safe-folio-recovery, `20261106_025_caterpillar_folio_recovery_test`, también bajo database/migrations/daubert_global/).
const fs = require('node:fs');
const path = require('node:path');

const PROD = path.resolve(__dirname, '..');
const BASE = '20261109_026_manufactura_respaldo_rls_prod';
const TABLAS = ['cliente_abreviaturas', 'confirmaciones_revision', 'documentos', 'firma_autorizaciones', 'firmas', 'pdf_contenidos', 'pdfs', 'revision_responsables', 'revisiones'];
const LISTA = TABLAS.map((t) => `'${t}'`).join(', ');

const pc = fs.readFileSync(path.join(PROD, '20261108_020_manufactura_gestor_documental_prod.postcheck.sql'), 'utf8').replace(/\r\n/g, '\n');
const i0 = pc.indexOf('    COALESCE((SELECT bool_and('); const i1 = pc.indexOf(' AS backup_solo_lectura,');
if (i0 < 0 || i1 < 0) throw new Error('no se encontró el predicado de lector de respaldos en el postcheck 020 (¿se ejecutó generar-manufactura-prod.cjs?)');
const LECTOR = pc.slice(i0, i1).trim();

const cab = (tipo) => `-- GENERADO por tools/generar-manufactura-026.cjs — migración PRODUCTIVA 026 (${tipo}). NO editar a mano: se regenera y se revisa el diff.\n`;
const GUARDA = `  IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION 'ABORTO: solo daubert_global (base actual: %).', current_database(); END IF;`;
const ADMIN = `  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN RAISE EXCEPTION 'ABORTO: se requiere el rol administrativo.'; END IF;`;
const COMENTARIO = '026: lectura completa para el rol de respaldos daubert_backup (pg_dump --enable-row-security). Solo SELECT; no concede escritura. Las políticas de daubert_hub_app no cambian.';

// Huellas que la 026 NO debe cambiar: políticas que no son del respaldo (las de la aplicación) y privilegios de tabla de manufactura.
const HUELLA_POLITICAS = `SELECT md5(COALESCE(string_agg(tablename || '.' || policyname || ':' || cmd || ':' || permissive || ':' || roles::text || ':' || COALESCE(qual, '') || ':' || COALESCE(with_check, ''), '|' ORDER BY tablename, policyname), '')) FROM pg_policies WHERE schemaname = 'manufactura' AND policyname <> 'pol_respaldo_sel'`;
const HUELLA_GRANTS = `SELECT md5(COALESCE(string_agg(table_name || ':' || grantee || ':' || privilege_type, '|' ORDER BY table_name, grantee, privilege_type), '')) FROM information_schema.role_table_grants WHERE table_schema = 'manufactura'`;

// Toda tabla con RLS (de cualquier esquema) debe tener una política de lectura que alcance a daubert_backup (o a PUBLIC): si no, --enable-row-security la volcaría VACÍA sin error.
const TODA_RLS_CUBIERTA = `NOT EXISTS (
        SELECT 1 FROM pg_class c WHERE c.relkind IN ('r', 'p') AND c.relrowsecurity
           AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = (SELECT nspname FROM pg_namespace WHERE oid = c.relnamespace) AND p.tablename = c.relname
                             AND p.cmd IN ('SELECT', 'ALL') AND p.permissive = 'PERMISSIVE' AND (p.roles @> ARRAY['daubert_backup']::name[] OR p.roles @> ARRAY['public']::name[]) AND p.qual = 'true'))`;

const precheck = `${cab('precheck')}-- =====================================================================================================================
-- PRECHECK · manufactura 026 · respaldo con RLS (SOLO PRODUCCIÓN: daubert_global). SOLO LECTURA.
--   psql -h localhost -p 5432 -d daubert_global -U postgres -X -w -v ON_ERROR_STOP=1 -f ${BASE}.precheck.sql
-- Esperado: all_prechecks_pass = t. Anote huella_politicas_app y huella_privilegios: el postcheck las recibe con -v para demostrar que la 026 no tocó nada más.
-- =====================================================================================================================
\\set ON_ERROR_STOP on
\\pset pager off
BEGIN TRANSACTION READ ONLY;
DO $$ BEGIN IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION 'ABORTO: solo daubert_global (base actual: %).', current_database(); END IF; END $$;
WITH c AS (
  SELECT
    (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)                                                                AS rol_es_administrador,
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'daubert_backup')                                                            AS rol_respaldos_existe,
    (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura' AND rowsecurity) = ${TABLAS.length}                          AS nueve_tablas_con_rls,
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'manufactura') = 24                                                    AS politicas_de_la_024,
    NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'pol_respaldo_sel')                                                AS la_026_no_esta_aplicada,
    NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'manufactura' AND roles::text LIKE '%daubert_backup%')             AS sin_politicas_previas_para_respaldos,
    NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname <> 'manufactura' AND rowsecurity)                                      AS sin_rls_fuera_de_manufactura,
${LECTOR.replace(/^ {4}/gm, '    ')}                                                                                             AS respaldos_solo_lectura
)
SELECT c.*, (rol_es_administrador AND rol_respaldos_existe AND nueve_tablas_con_rls AND politicas_de_la_024 AND la_026_no_esta_aplicada AND sin_politicas_previas_para_respaldos
             AND sin_rls_fuera_de_manufactura AND respaldos_solo_lectura) AS all_prechecks_pass FROM c;
SELECT (${HUELLA_POLITICAS}) AS huella_politicas_app, (${HUELLA_GRANTS}) AS huella_privilegios;
ROLLBACK;
`;

const up = `${cab('UP')}-- =====================================================================================================================
-- UP · manufactura 026 · POLÍTICAS DE LECTURA PARA EL ROL DE RESPALDOS (SOLO PRODUCCIÓN: daubert_global)
--
-- PROBLEMA: daubert_backup lee manufactura por pertenencia a pg_read_all_data, pero esa pertenencia NO salta RLS y daubert_backup no tiene BYPASSRLS (política del proyecto, postcheck 013 de Caterpillar).
--   Las políticas de manufactura son TO daubert_hub_app, así que pg_dump como daubert_backup FALLA («query would be affected by row-level security policy») y, con --enable-row-security y sin política,
--   volcaría las tablas VACÍAS sin error.
-- SOLUCIÓN (UNA transacción): una política PERMISSIVE FOR SELECT TO daubert_backup USING (true) en cada una de las ${TABLAS.length} tablas con RLS de manufactura (pol_respaldo_sel). El respaldo debe ejecutarse con
--   pg_dump --enable-row-security (scripts/backup/lib/BackupPgTools.psm1; ver docs/hub/manufactura-ensayo-6b-resultados.md).
-- NO HACE: no concede escritura ni ningún privilegio de tabla (solo cambia qué filas ve el rol que YA podía leer); no cambia roles, membresías ni atributos (sin BYPASSRLS, SUPERUSER, pg_write_all_data);
--   no modifica ni elimina políticas de daubert_hub_app; no deshabilita RLS; no toca datos, funciones, triggers ni objetos fuera de manufactura (Caterpillar, Audi, Pagos intactos).
-- Uso (operador autorizado, rol administrativo; NUNCA con daubert_hub_app):
--   psql -h localhost -p 5432 -d daubert_global -U postgres -X -w -v ON_ERROR_STOP=1 -f ${BASE}.up.sql
-- =====================================================================================================================
\\set ON_ERROR_STOP on
\\pset pager off
BEGIN;
SET LOCAL lock_timeout = '10s';

DO $$
DECLARE
  v_tablas text[] := ARRAY[${LISTA}];
  t text;
BEGIN
${GUARDA}
${ADMIN}
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'daubert_backup') THEN RAISE EXCEPTION 'ABORTO: no existe el rol daubert_backup.'; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'pol_respaldo_sel') THEN RAISE EXCEPTION 'ABORTO: la 026 ya existe (pol_respaldo_sel); no se reaplica.'; END IF;
  IF (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura' AND rowsecurity) <> ${TABLAS.length} OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'manufactura') <> 24 THEN
    RAISE EXCEPTION 'ABORTO: la 026 exige las migraciones 020-024 aplicadas (${TABLAS.length} tablas con RLS y 24 políticas).';
  END IF;
  IF NOT (
${LECTOR}
  ) THEN RAISE EXCEPTION 'ABORTO: daubert_backup no cumple el perfil de lector de solo lectura (sin escritura, administración, BYPASSRLS ni membresías extra).'; END IF;

  FOREACH t IN ARRAY v_tablas LOOP
    EXECUTE format('CREATE POLICY pol_respaldo_sel ON manufactura.%I AS PERMISSIVE FOR SELECT TO daubert_backup USING (true)', t);
    EXECUTE format('COMMENT ON POLICY pol_respaldo_sel ON manufactura.%I IS %L', t, ${"'" + COMENTARIO + "'"});
  END LOOP;

  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'manufactura' AND policyname = 'pol_respaldo_sel' AND cmd = 'SELECT' AND roles = ARRAY['daubert_backup']::name[] AND permissive = 'PERMISSIVE' AND qual = 'true' AND with_check IS NULL) <> ${TABLAS.length} THEN
    RAISE EXCEPTION 'Las políticas de respaldo no quedaron como se esperaba.';
  END IF;
  IF (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura' AND NOT rowsecurity) <> 0 THEN RAISE EXCEPTION 'Toda tabla de manufactura debe conservar RLS.'; END IF;
END $$;

SELECT 'UP_OK manufactura 026 (${TABLAS.length} políticas SELECT para daubert_backup; sin cambios en privilegios, roles, políticas de la aplicación ni datos)' AS resultado;
COMMIT;
`;

const postcheck = `${cab('postcheck')}-- =====================================================================================================================
-- POSTCHECK · manufactura 026 (SOLO PRODUCCIÓN: daubert_global). SOLO LECTURA.
--   psql -h localhost -p 5432 -d daubert_global -U postgres -X -w -v ON_ERROR_STOP=1 -v huella_politicas_app=<del precheck> -v huella_privilegios=<del precheck> -f ${BASE}.postcheck.sql
-- Esperado: all_postchecks_pass = t.
-- =====================================================================================================================
\\set ON_ERROR_STOP on
\\pset pager off
BEGIN TRANSACTION READ ONLY;
DO $$ BEGIN IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION 'ABORTO: solo daubert_global (base actual: %).', current_database(); END IF; END $$;
WITH r AS (
  SELECT
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'manufactura' AND policyname = 'pol_respaldo_sel') = ${TABLAS.length}                         AS nueve_politicas_de_respaldo,
    (SELECT count(DISTINCT tablename) FROM pg_policies WHERE schemaname = 'manufactura' AND policyname = 'pol_respaldo_sel') = ${TABLAS.length}       AS una_por_tabla,
    (SELECT bool_and(cmd = 'SELECT' AND roles = ARRAY['daubert_backup']::name[] AND permissive = 'PERMISSIVE' AND qual = 'true' AND with_check IS NULL)
       FROM pg_policies WHERE schemaname = 'manufactura' AND policyname = 'pol_respaldo_sel')                                                       AS solo_select_para_respaldos_sin_with_check,
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'manufactura' AND roles::text LIKE '%daubert_backup%') = ${TABLAS.length}                     AS ninguna_otra_politica_para_respaldos,
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'manufactura') = 24 + ${TABLAS.length}                                                      AS treinta_y_tres_politicas,
    (${HUELLA_POLITICAS}) = :'huella_politicas_app'                                                                                                  AS politicas_de_la_aplicacion_sin_cambios,
    (${HUELLA_GRANTS}) = :'huella_privilegios'                                                                                                       AS privilegios_de_tabla_sin_cambios,
    (SELECT count(*) FROM pg_tables WHERE schemaname = 'manufactura' AND rowsecurity) = ${TABLAS.length}                                              AS rls_activa_en_las_${TABLAS.length},
    ${TODA_RLS_CUBIERTA}                                                                                                                              AS toda_tabla_con_rls_cubierta_para_respaldos,
${LECTOR}                                                                                                                                           AS respaldos_solo_lectura
)
SELECT r.*, (nueve_politicas_de_respaldo AND una_por_tabla AND solo_select_para_respaldos_sin_with_check AND ninguna_otra_politica_para_respaldos AND treinta_y_tres_politicas
             AND politicas_de_la_aplicacion_sin_cambios AND privilegios_de_tabla_sin_cambios AND rls_activa_en_las_${TABLAS.length} AND toda_tabla_con_rls_cubierta_para_respaldos AND respaldos_solo_lectura) AS all_postchecks_pass FROM r;
ROLLBACK;
`;

const down = `${cab('DOWN')}-- =====================================================================================================================
-- DOWN · manufactura 026 · respaldo con RLS (SOLO PRODUCCIÓN: daubert_global). IDEMPOTENTE. No toca datos, roles ni otras políticas.
-- Elimina únicamente pol_respaldo_sel. Tras el DOWN, pg_dump como daubert_backup vuelve a fallar con manufactura (ver el UP).
--   psql -h localhost -p 5432 -d daubert_global -U postgres -X -w -v ON_ERROR_STOP=1 -f ${BASE}.down.sql
-- =====================================================================================================================
\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '10s';
DO $$
DECLARE t text;
BEGIN
${GUARDA}
${ADMIN}
  FOR t IN SELECT tablename FROM pg_policies WHERE schemaname = 'manufactura' AND policyname = 'pol_respaldo_sel' LOOP
    EXECUTE format('DROP POLICY pol_respaldo_sel ON manufactura.%I', t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'pol_respaldo_sel') THEN RAISE EXCEPTION 'No se eliminaron todas las políticas de respaldo.'; END IF;
END $$;
SELECT 'DOWN_OK 026 (políticas de respaldo eliminadas; datos, roles y políticas de la aplicación intactos)' AS resultado;
COMMIT;
`;

for (const [tipo, texto] of Object.entries({ precheck, up, postcheck, down })) fs.writeFileSync(path.join(PROD, `${BASE}.${tipo}.sql`), texto, 'utf8');
console.log('generados:', ['precheck', 'up', 'postcheck', 'down'].map((x) => `${BASE}.${x}.sql`).join(', '));
