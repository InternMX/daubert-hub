import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// PostgreSQL WASM IN MEMORY ONLY. No pg Pool, URLs, environment files, sockets or Daubert data.
// PGlite's database is named postgres: adapt ONLY the deployment database allowlist in memory.
const migration = readFileSync(resolve(__dirname, '../../../database/migrations/daubert_global/20261020_013_caterpillar_cancellation.up.sql'), 'utf8');
const revision = '2026-10-20T12:00:00.123456Z';
describe('Caterpillar cancellation SQL (isolated in-memory PostgreSQL)', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(readFileSync(resolve(__dirname,'fixtures/caterpillar-cancellation-schema.sql'),'utf8'));
    await db.exec(migration.replace("('daubert_hub_test', 'daubert_global')", "('postgres', 'daubert_hub_test', 'daubert_global')"));
  }, 30_000);
  afterAll(async () => db?.close());
  beforeEach(async () => {
    await db.exec(`RESET ROLE; DROP TRIGGER IF EXISTS fail_audit ON operacion.cancelaciones_remisiones;
      TRUNCATE operacion.cancelaciones_remisiones, operacion.remisiones, operacion.remision_detalle,
        operacion.reservas_folios, ops.ejecuciones_automatizacion;
      INSERT INTO ops.ejecuciones_automatizacion VALUES (14,1,'COMPLETADA'),(22,1,'PROCESANDO'),(30,2,'COMPLETADA');
      INSERT INTO operacion.remisiones VALUES
        (100,14,5,128,'GENERADA',null,'original.pdf','${revision}'),
        (101,14,5,129,'GENERADA',null,'other.pdf','${revision}'),
        (102,22,5,130,'GENERADA',null,'processing.pdf','${revision}'),
        (103,30,5,131,'GENERADA',null,'audi.pdf','${revision}');
      INSERT INTO operacion.remision_detalle VALUES (1,100,'10 piezas');
      INSERT INTO operacion.reservas_folios VALUES (1,14,'APLICADA'),(2,22,'RESERVADA');
    `);
  });
  const cancel = async (execution = '14', remission = '100', rev = revision, reason = ' Corrección ', user = '1') => {
    const result = await db.query<{ resultado: string; motivo: string; cancelacion_id: number; usuario_nombre: string }>(
      'SELECT * FROM operacion.fn_cancelar_remision_caterpillar($1,$2,$3,$4,$5,$6)', [execution, remission, rev, reason, user, 'req-test']);
    return result.rows[0]!;
  };
  it('applies the source migration atomically and grants only SELECT + narrow EXECUTE to the Hub', async () => {
    const { rows } = await db.query(`SELECT
      has_table_privilege('daubert_hub_test_user','operacion.cancelaciones_remisiones','SELECT') AS ledger_read,
      has_table_privilege('daubert_hub_test_user','operacion.remisiones','UPDATE') AS general_update,
      has_table_privilege('daubert_hub_test_user','operacion.cancelaciones_remisiones','INSERT,UPDATE,DELETE') AS ledger_write,
      has_function_privilege('n8n_app','operacion.fn_cancelar_remision_caterpillar(bigint,bigint,text,text,bigint,text)','EXECUTE') AS n8n_execute,
      has_function_privilege('public','operacion.fn_cancelar_remision_caterpillar(bigint,bigint,text,text,bigint,text)','EXECUTE') AS public_execute`);
    expect(rows[0]).toEqual({ ledger_read: true, general_update: false, ledger_write: false, n8n_execute: false, public_execute: false });
    await db.exec('SET ROLE daubert_hub_test_user');
    expect((await cancel()).resultado).toBe('CANCELLED');
  });
  it('cancels exactly one remission and preserves execution, PDF, details, other remissions, series and reservations', async () => {
    const before = await db.query(`SELECT row_to_json(s) AS series FROM operacion.series_documentales s`);
    const result = await cancel();
    expect(result).toMatchObject({ resultado: 'CANCELLED', motivo: 'Corrección', usuario_nombre: 'Admin histórico' });
    const { rows } = await db.query('SELECT * FROM operacion.remisiones ORDER BY remision_id');
    expect(rows[0]).toMatchObject({ estatus: 'CANCELADA', motivo_cancelacion: 'Corrección', pdf_path: 'original.pdf' });
    expect(rows[1]).toMatchObject({ estatus: 'GENERADA', motivo_cancelacion: null, pdf_path: 'other.pdf' });
    expect((await db.query('SELECT estado FROM ops.ejecuciones_automatizacion WHERE ejecucion_id=14')).rows[0]).toEqual({ estado: 'COMPLETADA' });
    expect((await db.query('SELECT cantidad_texto FROM operacion.remision_detalle')).rows[0]).toEqual({ cantidad_texto: '10 piezas' });
    expect(await db.query(`SELECT row_to_json(s) AS series FROM operacion.series_documentales s`)).toEqual(before);
    expect((await db.query('SELECT estatus FROM operacion.reservas_folios ORDER BY reserva_id')).rows).toEqual([{ estatus: 'APLICADA' }, { estatus: 'RESERVADA' }]);
  });
  it.each([
    ['999','100',revision,'Motivo','1','PCA01'], ['14','999',revision,'Motivo','1','PCA01'],
    ['14','102',revision,'Motivo','1','PCA01'], ['30','103',revision,'Motivo','1','PCA01'],
    ['22','102',revision,'Motivo','1','PCA02'], ['14','100','2026-10-20T12:00:00.123457Z','Motivo','1','PCA04'],
    ['14','100',revision,'   ','1','22023'], ['14','100',revision,'x'.repeat(501),'1','22023'],
    ['14','100',revision,'Motivo','2','PCA05']
  ])('rejects unsafe input (%s,%s) with SQLSTATE %s and no audit', async (execution, remission, rev, reason, user, code) => {
    await expect(cancel(execution, remission, rev, reason, user)).rejects.toMatchObject({ code });
    expect((await db.query('SELECT count(*)::int AS count FROM operacion.cancelaciones_remisiones')).rows[0]).toEqual({ count: 0 });
  });
  it('rejects PENDIENTE', async () => {
    await db.exec("UPDATE operacion.remisiones SET estatus='PENDIENTE' WHERE remision_id=100");
    await expect(cancel()).rejects.toMatchObject({ code: 'PCA03' });
  });
  it('returns the original audit on repeated and concurrently submitted requests, without overwriting reason', async () => {
    // PGlite serializes submissions on one backend. Real two-session lock contention remains a TEST check.
    const results = await Promise.all([cancel(), cancel('14','100',revision,'Otra razón')]);
    expect(results.map((r) => r.resultado)).toEqual(['CANCELLED', 'ALREADY_CANCELLED']);
    expect(results[1].motivo).toBe('Corrección');
    expect(results[0].cancelacion_id).toBe(results[1].cancelacion_id);
    expect((await db.query('SELECT count(*)::int AS count FROM operacion.cancelaciones_remisiones')).rows[0]).toEqual({ count: 1 });
  });
  it('does not fabricate an audit for legacy CANCELADA rows', async () => {
    await db.exec("UPDATE operacion.remisiones SET estatus='CANCELADA', motivo_cancelacion='Histórico' WHERE remision_id=100");
    expect(await cancel()).toMatchObject({ resultado: 'ALREADY_CANCELLED', motivo: 'Histórico', cancelacion_id: null });
  });
  it('rolls back remission UPDATE when the mandatory audit INSERT fails', async () => {
    await db.exec(`CREATE OR REPLACE FUNCTION fail_cancel_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'audit failure'; END $$;
      CREATE TRIGGER fail_audit BEFORE INSERT ON operacion.cancelaciones_remisiones FOR EACH ROW EXECUTE FUNCTION fail_cancel_fixture();`);
    await expect(cancel()).rejects.toThrow('audit failure');
    expect((await db.query('SELECT estatus, motivo_cancelacion FROM operacion.remisiones WHERE remision_id=100')).rows[0])
      .toEqual({ estatus: 'GENERADA', motivo_cancelacion: null });
  });
  it('refuses rollback of the migration once cancellation evidence exists', async () => {
    await cancel();
    const down = readFileSync(resolve(__dirname, '../../../database/migrations/daubert_global/20261020_013_caterpillar_cancellation.down.sql'), 'utf8');
    await expect(db.exec(down.replace("('daubert_hub_test', 'daubert_global')", "('postgres', 'daubert_hub_test', 'daubert_global')"))).rejects.toThrow(/history exists/);
    await db.exec('ROLLBACK');
    expect((await db.query('SELECT count(*)::int AS count FROM operacion.cancelaciones_remisiones')).rows[0]).toEqual({ count: 1 });
  });
  it('passes strict postcheck, detects ACL drift and rejects a second installation', async () => {
    const post = readFileSync(resolve(__dirname,'../../../database/migrations/daubert_global/20261020_013_caterpillar_cancellation.postcheck.sql'),'utf8')
      .replace("('daubert_hub_test','daubert_global')","('postgres','daubert_hub_test','daubert_global')");
    await db.exec(post);
    await db.exec('GRANT SELECT ON operacion.cancelaciones_remisiones TO n8n_app');
    await expect(db.exec(post)).rejects.toThrow(/excessive/);
    await db.exec('ROLLBACK; REVOKE SELECT ON operacion.cancelaciones_remisiones FROM n8n_app');
    await expect(db.exec(migration.replace("('daubert_hub_test', 'daubert_global')","('postgres','daubert_hub_test','daubert_global')"))).rejects.toThrow(/already exist/);
    await db.exec('ROLLBACK');
  });
});
