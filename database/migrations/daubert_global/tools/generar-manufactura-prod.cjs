#!/usr/bin/env node
// GENERADOR DETERMINISTA de las migraciones PRODUCTIVAS de Manufactura (012–016) a partir de las migraciones de TEST 101–105 (que NO se modifican).
//   node database/migrations/daubert_global/tools/generar-manufactura-prod.cjs
// Cada sustitución es explícita y CONTADA: si una no ocurre el número esperado de veces el generador falla (así TEST y PROD no pueden divergir en silencio). Al final comprueba que no queda
// ninguna referencia a TEST en los archivos de PRODUCCIÓN, salvo las permitidas (roles que deben NO tener acceso). Los archivos generados son los que se revisan, se firman con SHA-256 y se aplican.
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..', '..', '..', '..');
const TEST = path.join(RAIZ, 'database', 'migrations', 'daubert_hub_test');
const PROD = path.join(RAIZ, 'database', 'migrations', 'daubert_global');
const REPLICA = path.join(PROD, 'replica_only');
const FECHA = '20261108';

const MIGRACIONES = [
  { origen: '20261030_101_manufactura_gestor_documental_test', destino: `${FECHA}_012_manufactura_gestor_documental_prod`, n: '101', nueva: '012' },
  { origen: '20261103_102_manufactura_responsables_firmas_test', destino: `${FECHA}_013_manufactura_responsables_firmas_prod`, n: '102', nueva: '013' },
  { origen: '20261105_103_manufactura_inventario_firmas_admin_test', destino: `${FECHA}_014_manufactura_inventario_firmas_admin_prod`, n: '103', nueva: '014' },
  { origen: '20261106_104_manufactura_cliente_abreviaturas_test', destino: `${FECHA}_015_manufactura_cliente_abreviaturas_prod`, n: '104', nueva: '015' },
  { origen: '20261107_105_manufactura_consulta_compartida_borradores_test', destino: `${FECHA}_016_manufactura_consulta_compartida_borradores_prod`, n: '105', nueva: '016' }
];

const errores = [];
function sub(texto, desde, hacia, { min = 1, max = Infinity, etiqueta, archivo }) {
  let n = 0;
  let salida;
  if (typeof desde === 'string') { const partes = texto.split(desde); n = partes.length - 1; salida = partes.join(hacia); }
  else salida = texto.replace(desde, (...a) => { n += 1; return typeof hacia === 'function' ? hacia(...a) : hacia; });
  if (n < min || n > max) errores.push(`${archivo}: «${etiqueta ?? String(desde).slice(0, 60)}» ocurrió ${n} veces (esperado ${min}${max === Infinity ? '+' : '–' + max})`);
  return salida;
}

function transformar(texto, tipo, m) {
  const a = `${m.origen}.${tipo}`;
  let t = texto.replace(/\r\n/g, '\n');
  const o = (min, max, etiqueta) => ({ min, max, etiqueta, archivo: a });

  // ---- 0. El postcheck de la 101 comprueba que los OTROS roles no tienen acceso: en TEST el «otro» es daubert_hub_app; en PROD es daubert_hub_test_user. Se protege antes del cambio global de rol.
  if (m.n === '101' && tipo === 'postcheck') {
    t = sub(t, "('daubert_hub_app', 'n8n_app', 'n8n_app_test', 'n8n_cat_prod', 'n8n_cat_test', 'daubert_docs_ro', 'daubert_backup')", "('@@NEGATIVO@@', 'n8n_app', 'n8n_app_test', 'n8n_cat_prod', 'n8n_cat_test', 'daubert_docs_ro', 'daubert_backup')", o(1, 1, 'lista de roles sin acceso'));
  }
  // ---- 1. Nombres de archivo (referencias entre scripts)
  for (const x of MIGRACIONES) t = sub(t, x.origen, x.destino, { min: 0, archivo: a, etiqueta: `nombre ${x.origen}` });
  // ---- 2. Rol de la aplicación y base
  t = sub(t, 'daubert_hub_test_user', 'daubert_hub_app', { min: 0, archivo: a, etiqueta: 'rol de la aplicación' });
  t = sub(t, /daubert_hub_test(?!_user)/g, 'daubert_global', { min: 1, archivo: a, etiqueta: 'base daubert_hub_test' });
  t = sub(t, '@@NEGATIVO@@', 'daubert_hub_test_user', { min: 0, archivo: a });
  // ---- 3. Cabeceras y textos de entorno
  t = sub(t, /SOLO TEST: daubert_global/g, 'SOLO PRODUCCIÓN: daubert_global', { min: 0, archivo: a, etiqueta: 'cabecera «SOLO TEST»' });
  t = sub(t, '(SOLO TEST, OPCIONAL, tras el postcheck)', '(SOLO RÉPLICA DESECHABLE; NO ejecutar en producción)', { min: 0, archivo: a });
  if (tipo === 'precheck') {
    t = sub(t, "IF current_database() = 'daubert_global' THEN\n    RAISE EXCEPTION 'ABORTO: daubert_global es PRODUCCION.';\n  END IF;",
      "IF current_database() = 'daubert_hub_test' THEN\n    RAISE EXCEPTION 'ABORTO: daubert_hub_test es TEST; use las migraciones de TEST.';\n  END IF;", { min: m.n === '101' ? 1 : 0, max: 1, archivo: a, etiqueta: 'guarda inversa del precheck' });
    t = sub(t, 'AS base_es_test', 'AS base_es_produccion', { min: 0, archivo: a });
    t = sub(t, 'rol_app_test_existe_y_sin_privilegios', 'rol_app_existe_y_sin_privilegios', { min: 0, archivo: a });
  }
  if (m.n === '101' && tipo === 'up') {
    t = sub(t, "COMMENT ON SCHEMA manufactura IS 'Gestor documental de Hojas de Instrucción de Manufactura (TEST). Revisiones finalizadas inmutables; PDF almacenados con SHA-256. Nada de aquí es válido para producción.';",
      "COMMENT ON SCHEMA manufactura IS 'Gestor documental de Hojas de Instrucción de Manufactura (PRODUCCIÓN). Revisiones finalizadas inmutables; PDF almacenados con SHA-256.';", o(1, 1, 'COMMENT ON SCHEMA'));
    t = sub(t, "identificación manual de TEST (no apta para emisión)", 'identificación manual (no vinculada al catálogo de clientes)', o(1, 1));
    t = sub(t, "entorno_emision            text NOT NULL DEFAULT 'PRUEBA',-- constancia: nada de este esquema es válido para producción", "entorno_emision            text NOT NULL DEFAULT 'PRODUCCION',-- constancia: documentos de producción", o(1, 1, 'default entorno'));
    t = sub(t, "CHECK (entorno_emision = 'PRUEBA')", "CHECK (entorno_emision = 'PRODUCCION')", o(1, 1, 'CHECK entorno'));
    t = sub(t, "NEW.entorno_emision := 'PRUEBA'", "NEW.entorno_emision := 'PRODUCCION'", o(1, 1, 'trigger entorno'));
    t = sub(t, '(permitido en TEST)', '(permitido)', o(1, 1));
    t = sub(t, 'autorrevisión permitida en TEST, con constancia', 'autorrevisión permitida, con constancia', o(1, 1));
  }
  if (m.n === '104' && tipo === 'up') {
    t = sub(t, 'ya lo tiene en TEST (la API de clientes lo usa)', 'ya lo tiene en producción (la API de clientes lo usa)', o(1, 1));
  }
  if (m.n === '101' && tipo === 'postcheck') {
    // Con la aplicación en línea pueden aparecer filas nuevas (inicios de sesión, auditoría) entre el precheck y el postcheck; la migración no escribe ninguna: se exige que NO DISMINUYAN.
    for (const k of ['baseline_users', 'baseline_empresas', 'baseline_audit_cambios']) t = sub(t, `= :${k}`, `>= :${k}`, o(1, 1, `conteo ${k}`));
  }
  if (m.n === '101' && tipo === 'postcheck') {
    t = sub(t, 'tablas_vacias_o_con_datos_de_prueba_esperados', 'tablas_vacias_esperadas', { min: 2, archivo: a, etiqueta: 'alias tablas vacías' });
  }
  if (tipo === 'down') {
    // En PRODUCCIÓN las frases de confirmación son explícitas: un DOWN con datos reales exige respaldo verificado.
    t = sub(t, 'SI_BORRAR_DATOS_DE_PRUEBA', 'SI_BORRAR_DATOS_DE_PRODUCCION_CON_RESPALDO_VERIFICADO', { min: 0, archivo: a });
    t = sub(t, 'SI_BORRAR_REVISIONES_Y_PDF_FINALIZADOS', 'SI_BORRAR_REVISIONES_Y_PDF_FINALIZADOS_DE_PRODUCCION', { min: 0, archivo: a });
    t = sub(t, 'SI_BORRAR_FIRMAS_Y_RESPONSABLES', 'SI_BORRAR_FIRMAS_Y_RESPONSABLES_DE_PRODUCCION', { min: 0, archivo: a });
    t = sub(t, 'SI_BORRAR_ABREVIATURAS', 'SI_BORRAR_ABREVIATURAS_DE_PRODUCCION', { min: 0, archivo: a });
  }
  if (tipo === 'smoke') {
    // Los smoke escriben (dentro de una transacción que termina en ROLLBACK) y necesitan usuarios/clientes: solo se ejecutan en la RÉPLICA DESECHABLE. Intercambian PRUEBA↔PRODUCCION.
    t = t.split('PRUEBA').join('@@P@@').split('PRODUCCION').join('PRUEBA').split('@@P@@').join('PRODUCCION');
    t = sub(t, 'permitida en TEST', 'permitida', { min: 0, archivo: a });
    const marca = "DO $$ BEGIN IF to_regnamespace('replica_desechable') IS NULL THEN RAISE EXCEPTION 'ABORTO: este script SOLO corre en la réplica desechable (no existe el esquema replica_desechable); NO se ejecuta en producción.'; END IF; END $$;\n";
    t = sub(t, /^(DO \$\$)/m, (x) => marca + x, o(1, 1, 'guarda de réplica'));
  }
  // ---- 4. Encabezado de trazabilidad
  const cab = `-- GENERADO desde TEST ${m.n} (${m.origen}) por tools/generar-manufactura-prod.cjs — migración PRODUCTIVA ${m.nueva}. NO editar a mano: se regenera y se revisa el diff.\n`;
  t = cab + t;
  return t;
}

function verificarSinTest(texto, archivo, tipo) {
  const permitido = (linea) => linea.includes("current_database() = 'daubert_hub_test'") || /daubert_hub_test_user|n8n_app_test|n8n_cat_test|daubert_hub_test'?\)? es TEST|replica_desechable|GENERADO desde TEST|origen TEST/.test(linea);
  texto.split('\n').forEach((linea, i) => {
    if (/daubert_hub_test(?!_user)|\bTEST\b|PRUEBA|_test\b/.test(linea) && !permitido(linea)) {
      if (tipo === 'smoke' && /PRUEBA/.test(linea)) return; // los smoke intercambian el valor; PRUEBA es el valor RECHAZADO
      errores.push(`${archivo}:${i + 1}: queda una referencia a TEST/PRUEBA: ${linea.trim().slice(0, 140)}`);
    }
  });
}

fs.mkdirSync(PROD, { recursive: true }); fs.mkdirSync(REPLICA, { recursive: true });
const generados = [];
for (const m of MIGRACIONES) {
  for (const tipo of ['precheck', 'up', 'postcheck', 'down', 'smoke']) {
    const origen = path.join(TEST, `${m.origen}.${tipo}.sql`);
    if (!fs.existsSync(origen)) { errores.push(`falta ${origen}`); continue; }
    const salida = transformar(fs.readFileSync(origen, 'utf8'), tipo, m);
    const archivo = `${m.destino}.${tipo}.sql`;
    verificarSinTest(salida, archivo, tipo);
    const destino = tipo === 'smoke' ? path.join(REPLICA, `${m.destino}.smoke_replica.sql`) : path.join(PROD, archivo);
    fs.writeFileSync(destino, salida, 'utf8');
    generados.push(path.relative(RAIZ, destino));
  }
}
if (errores.length) { console.error('GENERACIÓN FALLIDA:\n' + errores.map((e) => ' · ' + e).join('\n')); process.exit(1); }
console.log(`OK: ${generados.length} archivos generados\n` + generados.map((g) => ' · ' + g).join('\n'));
