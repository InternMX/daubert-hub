// CONTROLES DE INTEGRIDAD del primer respaldo posterior a la liberación de Manufactura (y de cualquier respaldo después de la 026). Solo lectura sobre el archivo .dump (formato custom, ya descifrado
// en el área de staging del trabajo de respaldo) y, opcionalmente, restauración en una instancia Docker DESECHABLE para comparar contenido. No toca ninguna base real.
//   node verificar-respaldo-manufactura.cjs --dump <archivo.dump> [--pg-bin "C:/Program Files/PostgreSQL/18/bin"] [--tablas-esperadas 45]
//   node verificar-respaldo-manufactura.cjs --dump <archivo.dump> --restaurar [--filas-origen <daubert_global_filas_origen_*.txt>] [--roles <globals.sql>]
// Códigos de salida: 0 todo bien · 1 algún control falló (el respaldo NO debe darse por bueno) · 2 uso incorrecto.
const { spawnSync } = require('node:child_process'); const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; }; const flag = (n) => process.argv.includes(n);
const DUMP = arg('--dump'); const BIN = arg('--pg-bin'); const ESPERADAS = Number(arg('--tablas-esperadas') ?? 45);
if (!DUMP || !fs.existsSync(DUMP)) { console.error('Uso: --dump <archivo.dump> [--pg-bin <carpeta>] [--tablas-esperadas N] [--restaurar [--filas-origen archivo] [--roles globals.sql]]'); process.exit(2); }
const exe = (n) => (BIN ? path.join(BIN, n) : n);
let fails = 0; const ok = (c, m, x) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (c || x === undefined ? '' : ' :: ' + String(x).replace(/\s+/g, ' ').slice(0, 240))); if (!c) fails++; };
const TABLAS = ['cliente_abreviaturas', 'confirmaciones_revision', 'documentos', 'firma_autorizaciones', 'firmas', 'pdf_contenidos', 'pdfs', 'revision_responsables', 'revisiones'];

// ---- 1. Catálogo del respaldo (pg_restore -l)
const toc = spawnSync(exe('pg_restore'), ['-l', DUMP], { encoding: 'utf8', maxBuffer: 100_000_000 });
ok(toc.status === 0, 'pg_restore -l lee el catálogo del respaldo', toc.stderr);
const lineas = toc.stdout.split('\n').filter((l) => l && !l.startsWith(';'));
const datos = lineas.filter((l) => /\bTABLE DATA\b/.test(l));
ok(datos.length >= ESPERADAS, `el respaldo contiene los datos de ${datos.length} tablas (mínimo esperado ${ESPERADAS})`, datos.length);
for (const t of TABLAS) ok(datos.some((l) => new RegExp(`TABLE DATA manufactura ${t}\\b`).test(l)), `incluye los DATOS de manufactura.${t}`);
ok(lineas.filter((l) => /\bPOLICY manufactura \S+ pol_respaldo_sel\b/.test(l)).length === 9, 'incluye las 9 políticas pol_respaldo_sel (sin ellas un respaldo con --enable-row-security saldría con las tablas vacías)', lineas.filter((l) => /POLICY manufactura S+ pol_respaldo_sel/.test(l)).length);
ok(lineas.filter((l) => /\bPOLICY manufactura\b/.test(l)).length === 33, 'incluye las 33 políticas de manufactura (24 de la aplicación + 9 de respaldo)', lineas.filter((l) => /\bPOLICY manufactura\b/.test(l)).length);
ok(fs.statSync(DUMP).size > 200_000, `tamaño plausible (${fs.statSync(DUMP).size} bytes)`);

// ---- 2. Restauración de prueba y comparación (opcional; Docker)
if (flag('--restaurar')) {
  const dk = (a) => spawnSync('docker', a, { encoding: 'utf8', maxBuffer: 200_000_000, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
  const C = 'verif-respaldo-' + Date.now().toString(36); const psql = (sql, db = 'daubert_global') => { const r = dk(['exec', '-e', 'PGPASSWORD=scratch', C, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', db, '-X', '-At', '-F', '|', '-c', sql]); return { rc: r.status, out: r.stdout.trim(), err: r.stderr.trim() }; };
  try {
    const up = dk(['run', '-d', '--rm', '--name', C, '--network', 'none', '-e', 'POSTGRES_PASSWORD=scratch', 'postgres:18-alpine']); ok(up.status === 0, 'instancia desechable sin red creada', up.stderr);
    for (let i = 0; i < 60; i += 1) { if (dk(['exec', C, 'pg_isready', '-U', 'postgres', '-h', '127.0.0.1']).status === 0) break; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500); }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
    if (arg('--roles')) { const crudo = fs.readFileSync(arg('--roles'), 'utf8'); const login = [...crudo.matchAll(/^CREATE ROLE (\w+);/gm)].map((m) => m[1]).filter((n) => n !== 'postgres');
      const sql = crudo.split(/\r?\n/).filter((l) => !/^(CREATE|ALTER) ROLE postgres\b/.test(l) && !/^\\(un)?restrict\b/.test(l)).join('\n') + '\n' + login.map((n) => `ALTER ROLE ${n} PASSWORD 'scratch';`).join('\n') + '\n'; const f = path.join(os.tmpdir(), 'verif-roles.sql'); fs.writeFileSync(f, sql); dk(['cp', f, `${C}:/tmp/roles.sql`]); dk(['exec', '-e', 'PGPASSWORD=scratch', C, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-f', '/tmp/roles.sql']); }
    psql('CREATE DATABASE daubert_global', 'postgres'); dk(['cp', DUMP, `${C}:/tmp/r.dump`]);
    const rs = dk(['exec', '-e', 'PGPASSWORD=scratch', C, 'pg_restore', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'daubert_global', '/tmp/r.dump']); ok(rs.status === 0 || !arg('--roles') === false, 'restauración de prueba del respaldo' + (rs.status === 0 ? '' : ' (con avisos de roles ausentes si no se pasó --roles)'), rs.stderr.slice(0, 200));
    const cuentas = TABLAS.map((t) => [t, Number(psql(`SELECT count(*) FROM manufactura.${t}`).out)]);
    console.log('INFO filas restauradas en manufactura: ' + cuentas.map(([t, n]) => `${t}=${n}`).join(', '));
    const pdf = psql("SELECT count(*), count(*) FILTER (WHERE encode(sha256(c.contenido), 'hex') = p.pdf_sha256 AND length(c.contenido) = p.bytes) FROM manufactura.pdfs p LEFT JOIN manufactura.pdf_contenidos c USING (revision_id)").out.split('|');
    ok(pdf[0] === pdf[1], 'cada PDF registrado tiene sus bytes y coinciden con su SHA-256 y tamaño (detecta pdf_contenidos vacío por RLS)', pdf.join('/'));
    const fir = psql("SELECT count(*), count(*) FILTER (WHERE encode(sha256(contenido), 'hex') = sha256 AND length(contenido) = bytes) FROM manufactura.firmas").out.split('|'); ok(fir[0] === fir[1], 'cada firma tiene sus bytes y coincide con su SHA-256 y tamaño (detecta firmas vacías por RLS)', fir.join('/'));
    const huer = psql("SELECT (SELECT count(*) FROM manufactura.revisiones WHERE estado = 'FINALIZADA' AND NOT EXISTS (SELECT 1 FROM manufactura.pdf_contenidos c WHERE c.revision_id = revisiones.revision_id))").out; ok(huer === '0', 'ninguna revisión FINALIZADA quedó sin PDF', huer);
    if (arg('--filas-origen')) {
      const esperado = new Map(fs.readFileSync(arg('--filas-origen'), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean).map((l) => l.split('|')));
      const real = new Map(psql("SELECT table_schema || '.' || table_name, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema','pg_toast','manufactura')").out.split('\n').map((l) => l.split('|')));
      const menos = [...esperado].filter(([k, v]) => Number(real.get(k) ?? -1) < Number(v)); ok(menos.length === 0, 'ninguna tabla ajena a Manufactura tiene MENOS filas que las del archivo de conteos de referencia (el respaldo es posterior: puede tener más)', menos.map(([k, v]) => `${k}: ${real.get(k)} < ${v}`).join('; '));
    }
  } finally { dk(['rm', '-f', C]); }
}
console.log(fails ? `RESULTADO: ${fails} FAIL: NO dar por bueno este respaldo` : 'RESULTADO: respaldo íntegro (todos los controles PASS)'); process.exit(fails ? 1 : 0);
