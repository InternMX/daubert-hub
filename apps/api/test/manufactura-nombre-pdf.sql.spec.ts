import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nombreArchivoBorrador, nombreArchivoFinalizado } from '../src/manufacturing-sheets/preview/sheet-pdf.service';

// CONTRATO DEL NOMBRE DEL PDF FINALIZADO entre PostgreSQL (manufactura.fn_nombre_pdf, impuesta por el trigger fn_pdfs_before_insert) y TypeScript (nombreArchivoFinalizado).
// PostgreSQL WASM EN MEMORIA (PGlite, PostgreSQL 18): sin red, sin pg Pool, sin URL ni archivos de entorno, sin datos de Daubert. Se ejecutan las definiciones SQL REALES:
//   · TEST: las UP reales 101→106 (estado anterior a la 107) y después la 107 real (precheck, UP, postcheck y DOWN).
//   · PROD: la sentencia CREATE FUNCTION de fn_nombre_pdf tal como está en la 020 generada.
// PGlite solo tiene la base «postgres»: se adapta EN MEMORIA únicamente la guarda current_database() <> 'daubert_hub_test' (mismo criterio que caterpillar-cancellation.sql.spec.ts).
const RAIZ = resolve(__dirname, '..', '..', '..');
const TEST = join(RAIZ, 'database', 'migrations', 'daubert_hub_test');
const PROD = join(RAIZ, 'database', 'migrations', 'daubert_global');
const M107 = '20261113_107_manufactura_nombre_pdf_revision_test';
const leer = (dir: string, archivo: string) => readFileSync(join(dir, archivo), 'utf8');
const sinMeta = (sql: string) => sql.split(/\r?\n/).filter((l) => !l.trimStart().startsWith('\\')).join('\n');   // \set, \pset, \if…: comandos de psql
const enPglite = (sql: string) => sinMeta(sql).split("current_database() <> 'daubert_hub_test'").join("current_database() <> 'postgres'");
const migracion107 = (tipo: 'precheck' | 'up' | 'postcheck' | 'down', huella?: string) => {
  let s = enPglite(leer(TEST, `${M107}.${tipo}.sql`));
  if (huella !== undefined) s = s.split(":'huella_resto'").join(`'${huella}'`);
  return s;
};
const ADMIN = 'admin1@example.invalid';
const FN = 'manufactura.fn_nombre_pdf(text,text,integer)';

async function baseTestAnteriorA107(): Promise<PGlite> {
  const db = new PGlite();
  const { INIT } = createRequire(__filename)(join(TEST, 'tools', 'instancia-desechable.cjs')) as { INIT: string };
  await db.exec(INIT.split('\n').filter((l) => !/^CREATE DATABASE/.test(l) && !l.startsWith('\\c ')).join('\n'));
  for (const f of readdirSync(TEST).filter((x) => /^2026\d{4}_10[1-6]_.*\.up\.sql$/.test(x)).sort()) await db.exec(enPglite(leer(TEST, f)));
  return db;
}
/** Ejecuta un script que puede abortar; si aborta, deja la sesión limpia (ROLLBACK) y devuelve el mensaje. */
async function ejecutar(db: PGlite, sql: string): Promise<{ ok: true; filas: Record<string, unknown>[] } | { ok: false; error: string }> {
  try { const r = await db.exec(sql); return { ok: true, filas: r.flatMap((x) => x.rows as Record<string, unknown>[]) }; }
  catch (e) { await db.exec('ROLLBACK'); return { ok: false, error: (e as Error).message }; }
}
/** El script DEBE terminar bien: devuelve sus filas (o falla la prueba con el error de PostgreSQL). */
async function exito(db: PGlite, sql: string): Promise<Record<string, unknown>[]> {
  const r = await ejecutar(db, sql);
  expect(r.ok ? '' : r.error).toBe('');
  return r.ok ? r.filas : [];
}
/** El script DEBE abortar: devuelve el mensaje (o falla la prueba si terminó bien). */
async function fallo(db: PGlite, sql: string): Promise<string> {
  const r = await ejecutar(db, sql);
  expect(r.ok).toBe(false);
  return r.ok ? '' : r.error;
}
const fila = (filas: Record<string, unknown>[], campo: string) => { const f = filas.find((x) => campo in x); expect(f, `columna ${campo}`).toBeDefined(); return f!; };
const prosrc = async (db: PGlite) => ((await db.query<{ s: string }>(`SELECT prosrc AS s FROM pg_proc WHERE oid = '${FN}'::regprocedure`)).rows[0]!.s);
/** Huella de TODAS las filas de TODAS las tablas de manufactura (documentos, revisiones, PDF, contenidos, firmas…). */
async function huellaDatos(db: PGlite): Promise<string> {
  const tablas = (await db.query<{ t: string }>("SELECT relname AS t FROM pg_class WHERE relnamespace = 'manufactura'::regnamespace AND relkind = 'r' ORDER BY relname")).rows.map((r) => r.t);
  expect(tablas.length).toBeGreaterThanOrEqual(9);
  const partes: string[] = [];
  for (const t of tablas) partes.push(t + '=' + (await db.query<{ h: string }>(`SELECT coalesce(md5(string_agg(row_to_json(x)::text, '|' ORDER BY row_to_json(x)::text)), '-') AS h FROM manufactura.${t} x`)).rows[0]!.h);
  return partes.join(';');
}

/** Documento + revisión en FINALIZANDO con la revisión reservada indicada (inserción directa del administrador; los CHECK de la tabla se siguen aplicando). */
async function finalizando(db: PGlite, codigo: string, variante: string | null, revision: number): Promise<number> {
  await db.exec('BEGIN; SET LOCAL session_replication_role = replica;');
  try {
    const d = await db.query<{ id: number }>('INSERT INTO manufactura.documentos (codigo_dcmx, variante, creado_por_usuario_id, creado_por_email) VALUES ($1, $2, 1, $3) RETURNING documento_id AS id', [codigo, variante, ADMIN]);
    const r = await db.query<{ id: number }>(`INSERT INTO manufactura.revisiones (documento_id, revision_prevista, estado, familia, especificacion, especificacion_sha256, creado_por_usuario_id, creado_por_email,
        actualizado_por_usuario_id, actualizado_por_email, finalizando_token, finalizando_desde, finalizando_por_usuario_id, finalizando_por_email, cliente_nombre)
      VALUES ($1, $2, 'FINALIZANDO', 'COEX', '{"datos":{}}', repeat('a', 64), 1, $3, 1, $3, gen_random_uuid(), now(), 1, $3, 'Cliente simulado') RETURNING revision_id AS id`, [d.rows[0]!.id, revision, ADMIN]);
    await db.exec('COMMIT');
    return r.rows[0]!.id;
  } catch (e) { await db.exec('ROLLBACK'); throw e; }
}
/** Registra el PDF a través del trigger REAL fn_pdfs_before_insert (el que exige nombre_archivo = fn_nombre_pdf(...)). */
async function registrarPdf(db: PGlite, revisionId: number, nombre: string): Promise<string | null> {
  try {
    await db.exec(`BEGIN; SELECT set_config('app.user_id', '1', true), set_config('app.user_email', '${ADMIN}', true);`);
    await db.query("INSERT INTO manufactura.pdfs (revision_id, pdf_sha256, bytes, especificacion_sha256, nombre_archivo) VALUES ($1, repeat('b', 64), 10, repeat('a', 64), $2)", [revisionId, nombre]);
    await db.exec('COMMIT');
    return null;
  } catch (e) { await db.exec('ROLLBACK'); return (e as Error).message; }
}

// Casos VÁLIDOS para la base (ck_manufactura_documentos_codigo / ck_manufactura_documentos_variante / revisión >= 1).
const CODIGOS = ['SCHFPMG001', 'FUELLE61', 'CONFPMG04', 'A', 'x9', 'A.B_C-D', '_X', 'CON', 'con', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT9', 'A'.repeat(64)];
const VARIANTES: (string | null)[] = [null, 'Extendida', 'Doble cara.2', 'doblada', 'A_', 'X  y  Z ', '9-', 'a.b', '1'];
const REVISIONES = [1, 9, 10, 99, 100, 105, 999, 1000, 2147483647];
const INVALIDOS = ['', 'A/B', '../x', 'A B', '.oculto', '-X', '-', '--', 'A'.repeat(65), 'Ñ1', 'A\\B', 'A:B'];

describe('nombre del PDF finalizado: PostgreSQL y TypeScript producen EXACTAMENTE el mismo nombre', () => {
  let test: PGlite;
  let prod: PGlite;
  beforeAll(async () => {
    test = await baseTestAnteriorA107();
    prod = new PGlite();
    const def020 = /CREATE FUNCTION manufactura\.fn_nombre_pdf\([\s\S]*?\$fn\$;/.exec(leer(PROD, '20261108_020_manufactura_gestor_documental_prod.up.sql'))?.[0];
    expect(def020).toBeDefined();
    await prod.exec('CREATE SCHEMA manufactura;\n' + def020);
  }, 180_000);
  afterAll(async () => { await test?.close(); await prod?.close(); });

  const matriz = async (db: PGlite) => (await db.query<{ c: string; v: string | null; r: number; n: string }>(
    `SELECT c, v, r, manufactura.fn_nombre_pdf(c, v, r) AS n FROM unnest($1::text[]) c, unnest($2::text[]) v, unnest($3::int[]) r`, [CODIGOS, VARIANTES, REVISIONES])).rows;

  it('estado ANTERIOR (101–106, como TEST hoy): la base TRUNCA las revisiones de tres dígitos y rechaza en el trigger el nombre de la API', async () => {
    const r = (await test.query<{ a: string; b: string; c: string }>("SELECT manufactura.fn_nombre_pdf('HOJA48','doblada',100) a, manufactura.fn_nombre_pdf('HOJA48','doblada',105) b, manufactura.fn_nombre_pdf('CON',NULL,1) c")).rows[0]!;
    expect(r).toEqual({ a: 'HOJA48-DOBLADA_REV10.pdf', b: 'HOJA48-DOBLADA_REV10.pdf', c: 'CON_REV01.pdf' });
    expect(nombreArchivoFinalizado('HOJA48', 'doblada', 100)).toBe('HOJA48-DOBLADA_REV100.pdf');
    const id = await finalizando(test, 'HOJA48', 'doblada', 100);
    expect(await registrarPdf(test, id, nombreArchivoFinalizado('HOJA48', 'doblada', 100))).toMatch(/El nombre del PDF debe ser HOJA48-DOBLADA_REV10\.pdf/);
    // Error original del código reservado: la API anteponía «_» (_CON_REV01.pdf) y la base exige el código tal cual.
    const con = await finalizando(test, 'CON', null, 1);
    expect(await registrarPdf(test, con, '_CON_REV01.pdf')).toMatch(/El nombre del PDF debe ser CON_REV01\.pdf/);
    expect(await registrarPdf(test, con, nombreArchivoFinalizado('CON', null, 1))).toBeNull();
  });

  it('PROD (definición real de la 020): toda la matriz válida coincide con nombreArchivoFinalizado', async () => {
    const filas = await matriz(prod);
    expect(filas).toHaveLength(CODIGOS.length * VARIANTES.length * REVISIONES.length);
    for (const f of filas) expect(f.n).toBe(nombreArchivoFinalizado(f.c, f.v, f.r));
  });

  it('regresiones de los errores originales con nombres exactos (SQL de la 020 = TypeScript)', async () => {
    const casos: [string, string | null, number, string][] = [
      ['SCHFPMG001', null, 1, 'SCHFPMG001_REV01.pdf'], ['SCHFPMG001', null, 9, 'SCHFPMG001_REV09.pdf'], ['SCHFPMG001', null, 10, 'SCHFPMG001_REV10.pdf'],
      ['SCHFPMG001', null, 99, 'SCHFPMG001_REV99.pdf'], ['SCHFPMG001', null, 100, 'SCHFPMG001_REV100.pdf'], ['HOJA48', 'doblada', 105, 'HOJA48-DOBLADA_REV105.pdf'],
      ['CON', null, 1, 'CON_REV01.pdf'], ['con', 'Extendida', 100, 'con-EXTENDIDA_REV100.pdf'], ['COM1', null, 2, 'COM1_REV02.pdf'], ['LPT9', 'a.b', 12, 'LPT9-A-B_REV12.pdf'],
      ['A', 'Doble cara.2', 12, 'A-DOBLE-CARA-2_REV12.pdf'], ['SMOKE001', 'Extendida', 1, 'SMOKE001-EXTENDIDA_REV01.pdf']
    ];
    for (const [c, v, r, esperado] of casos) {
      expect(nombreArchivoFinalizado(c, v, r)).toBe(esperado);
      expect((await prod.query<{ n: string }>('SELECT manufactura.fn_nombre_pdf($1, $2, $3) AS n', [c, v, r])).rows[0]!.n).toBe(esperado);
    }
  });

  it('códigos y variantes de la matriz son válidos para la base (CHECK reales) y los inválidos los rechazan la base y la API', async () => {
    const valido = async (c: string, v: string | null) => {
      await test.exec('BEGIN; SET LOCAL session_replication_role = replica;');
      try { await test.query('INSERT INTO manufactura.documentos (codigo_dcmx, variante, creado_por_usuario_id, creado_por_email) VALUES ($1, $2, 1, $3)', [c, v, ADMIN]); return true; }
      catch { return false; } finally { await test.exec('ROLLBACK'); }
    };
    for (const c of CODIGOS) expect(await valido(c, 'zz-matriz')).toBe(true);
    for (const v of VARIANTES) expect(await valido('MATRIZ', v)).toBe(true);
    for (const c of INVALIDOS) {
      expect(await valido(c, null)).toBe(false);
      expect(() => nombreArchivoFinalizado(c, null, 1)).toThrow();
    }
    for (const r of [0, -1, 1.5, Number.NaN]) expect(() => nombreArchivoFinalizado('OK', null, r)).toThrow();
  });

  it('los BORRADORES conservan su protección de nombres reservados (sin cambios)', () => {
    expect(nombreArchivoBorrador('CON')).toBe('_CON.pdf');
    expect(nombreArchivoBorrador('com1')).toBe('_com1.pdf');
    expect(nombreArchivoBorrador('SCHFPMG001')).toBe('SCHFPMG001.pdf');
    expect(nombreArchivoBorrador('../x')).toBe('HOJA_SIN_CODIGO.pdf');
    expect(nombreArchivoBorrador('-X')).toBe('-X.pdf');
  });

  it('migración 107 sobre el estado anterior: precheck, UP, postcheck; conserva datos, permisos y todo lo demás; no se reaplica', async () => {
    const pre = await exito(test, migracion107('precheck'));
    expect(fila(pre, 'all_prechecks_pass')).toMatchObject({ rol_es_administrador: true, migracion_101_aplicada: true, funcion_existe: true, propietario_es_el_del_esquema: true, atributos_de_la_101: true,
      definicion_de_la_101_la_107_no_aplicada: true, app_puede_ejecutar: true, public_sin_execute: true, toda_tabla_con_rls: true, all_prechecks_pass: true });
    const huella = String(fila(pre, 'huella_resto').huella_resto);
    expect(huella).toMatch(/^[0-9a-f]{32}$/);
    expect(Number(fila(pre, 'revisiones_100_o_mas').revisiones_100_o_mas)).toBe(1);   // la del primer caso: reservada, su PDF no pudo registrarse
    const datos = await huellaDatos(test);

    const up = await exito(test, migracion107('up'));
    expect(String(fila(up, 'resultado').resultado)).toMatch(/^UP_OK manufactura 107/);
    expect(await huellaDatos(test)).toBe(datos);                                           // ninguna fila de ninguna tabla cambió

    const post = await exito(test, migracion107('postcheck', huella));
    expect(fila(post, 'all_postchecks_pass')).toMatchObject({ definicion_de_la_107: true, atributos_conservados: true, propietario_conservado: true, app_puede_ejecutar: true,
      public_sin_execute: true, nombres_esperados: true, toda_tabla_con_rls: true, resto_sin_cambios: true, all_postchecks_pass: true });
    const malaHuella = await exito(test, migracion107('postcheck', 'otra'));
    expect(fila(malaHuella, 'all_postchecks_pass')).toMatchObject({ resto_sin_cambios: false, all_postchecks_pass: false });

    expect(await prosrc(test)).toBe(await prosrc(prod));                                    // TEST tras la 107 = PROD 020
    for (const f of await matriz(test)) expect(f.n).toBe(nombreArchivoFinalizado(f.c, f.v, f.r));

    expect(await fallo(test, migracion107('up'))).toMatch(/ya está aplicada/);
    expect(fila(await exito(test, migracion107('precheck')), 'all_prechecks_pass')).toMatchObject({ definicion_de_la_101_la_107_no_aplicada: false, all_prechecks_pass: false });
  });

  it('tras la 107 el trigger REAL acepta el nombre de la API para la revisión 100 y 105 (y sigue rechazando nombres distintos)', async () => {
    const id100 = Number((await test.query<{ id: number }>("SELECT r.revision_id AS id FROM manufactura.revisiones r JOIN manufactura.documentos d USING (documento_id) WHERE d.codigo_dcmx = 'HOJA48' AND r.revision_prevista = 100")).rows[0]!.id);
    expect(await registrarPdf(test, id100, 'HOJA48-DOBLADA_REV10.pdf')).toMatch(/debe ser HOJA48-DOBLADA_REV100\.pdf/);
    expect(await registrarPdf(test, id100, nombreArchivoFinalizado('HOJA48', 'doblada', 100))).toBeNull();
    const id105 = await finalizando(test, 'SCHFPMG001', null, 105);
    expect(await registrarPdf(test, id105, nombreArchivoFinalizado('SCHFPMG001', null, 105))).toBeNull();
    const nombres = (await test.query<{ n: string }>('SELECT nombre_archivo AS n FROM manufactura.pdfs ORDER BY nombre_archivo')).rows.map((r) => r.n);
    expect(nombres).toEqual(['CON_REV01.pdf', 'HOJA48-DOBLADA_REV100.pdf', 'SCHFPMG001_REV105.pdf']);
  });

  it('DOWN inseguro bloqueado: con revisiones >= 100 (PDF REV100/REV105 ya inmutables) aborta y deja la 107', async () => {
    expect(await fallo(test, migracion107('down'))).toMatch(/revisiones con número >= 100/);
    expect(await prosrc(test)).toBe(await prosrc(prod));
  });
});

describe('migración 107: el DOWN rechaza un destino incorrecto ANTES de bloquear (base vacía, sin esquema manufactura)', () => {
  // Si el LOCK TABLE se ejecutara antes de las guardas, estas pruebas fallarían con «relation "manufactura.revisiones" does not exist».
  let vacia: PGlite;
  beforeAll(async () => { vacia = new PGlite(); await vacia.exec('CREATE ROLE m107_no_admin NOLOGIN'); }, 60_000);
  afterAll(async () => vacia?.close());
  const sinEsquema = async () => expect((await vacia.query("SELECT 1 FROM pg_namespace WHERE nspname = 'manufactura'")).rows).toHaveLength(0);

  it('otra base: aborta por la guarda de base, no por la tabla bloqueada inexistente', async () => {
    await sinEsquema();
    const error = await fallo(vacia, sinMeta(leer(TEST, `${M107}.down.sql`)));   // sin adaptar la guarda: la base es «postgres»
    expect(error).toMatch(/solo daubert_hub_test/);
    expect(error).not.toMatch(/does not exist|no existe la relación/);
  });

  it('rol no administrativo: aborta por la guarda de rol, no por la tabla bloqueada inexistente', async () => {
    await sinEsquema();
    const error = await fallo(vacia, 'SET ROLE m107_no_admin;\n' + migracion107('down'));
    await vacia.exec('RESET ROLE');
    expect(error).toMatch(/se requiere el rol administrativo/);
    expect(error).not.toMatch(/does not exist|no existe la relación|permission denied/);
  });
});

describe('migración 107: reversión segura sin revisiones >= 100 y rechazo de estados desconocidos', () => {
  let db: PGlite;
  beforeAll(async () => { db = await baseTestAnteriorA107(); }, 180_000);
  afterAll(async () => db?.close());
  const src101 = " SELECT p_codigo || CASE WHEN p_variante IS NULL THEN '' ELSE '-' || upper(btrim(regexp_replace(btrim(p_variante), '[^A-Za-z0-9]+', '-', 'g'), '-')) END || '_REV' || lpad(p_revision::text, 2, '0') || '.pdf' ";

  it('rechaza otra base y un rol no administrativo sin cambiar nada', async () => {
    expect(await fallo(db, sinMeta(leer(TEST, `${M107}.up.sql`)))).toMatch(/solo daubert_hub_test/);   // sin adaptar la guarda: la base es «postgres»
    expect(await fallo(db, sinMeta(leer(TEST, `${M107}.down.sql`)))).toMatch(/solo daubert_hub_test/);
    expect(await fallo(db, 'SET ROLE daubert_hub_test_user;\n' + migracion107('up'))).toMatch(/rol administrativo|permission denied/);
    await db.exec('RESET ROLE');
    expect(await prosrc(db)).toBe(src101);
  });

  it('el DOWN comprueba la base y el rol antes del primer LOCK TABLE', () => {
    const sql = leer(TEST, `${M107}.down.sql`);
    const primerLock = sql.search(/^\s*LOCK\s+TABLE\b/im);
    expect(primerLock).toBeGreaterThan(-1);
    const antesDelLock = sql.slice(0, primerLock);
    expect(antesDelLock).toContain("IF current_database() <> 'daubert_hub_test'");
    expect(antesDelLock).toContain('IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)');
  });

  it('UP, DOWN e idempotencia: el DOWN restaura exactamente la 101 (con PDF de revisiones < 100) y conserva propietario y privilegios', async () => {
    const id = await finalizando(db, 'SCHFPMG001', 'Extendida', 2);
    expect(await registrarPdf(db, id, nombreArchivoFinalizado('SCHFPMG001', 'Extendida', 2))).toBeNull();
    const acl = async () => (await db.query<{ a: string }>(`SELECT pg_get_userbyid(proowner) || ':' || coalesce(proacl::text, '') AS a FROM pg_proc WHERE oid = '${FN}'::regprocedure`)).rows[0]!.a;
    const antes = await acl();
    const datos = await huellaDatos(db);
    await exito(db, migracion107('up'));
    expect(String(fila(await exito(db, migracion107('down')), 'accion').accion)).toMatch(/se restaura/);
    expect(await prosrc(db)).toBe(src101);
    expect(await acl()).toBe(antes);
    expect(await huellaDatos(db)).toBe(datos);
    expect(String(fila(await exito(db, migracion107('down')), 'accion').accion)).toMatch(/sin cambios/);
    expect(fila(await exito(db, migracion107('precheck')), 'all_prechecks_pass').all_prechecks_pass).toBe(true);
  });

  it('una definición desconocida de fn_nombre_pdf: precheck en false, UP y DOWN abortan sin cambiarla', async () => {
    await db.exec("CREATE OR REPLACE FUNCTION manufactura.fn_nombre_pdf(p_codigo text, p_variante text, p_revision integer) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $fn$ SELECT p_codigo || '_REV' || p_revision::text || '.pdf' $fn$");
    const desconocida = await prosrc(db);
    expect(fila(await exito(db, migracion107('precheck')), 'all_prechecks_pass')).toMatchObject({ definicion_de_la_101_la_107_no_aplicada: false, all_prechecks_pass: false });
    expect(await fallo(db, migracion107('up'))).toMatch(/estado desconocido/);
    expect(await fallo(db, migracion107('down'))).toMatch(/estado desconocido/);
    expect(await prosrc(db)).toBe(desconocida);
  });
});
