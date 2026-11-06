import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaterpillarExecutionsRepository } from '../src/automations/remisiones-caterpillar/caterpillar-executions.repository';
import { createCaterpillarAdmissionCandidate, createCaterpillarAdmissionSnapshot } from '../src/automations/remisiones-caterpillar/caterpillar-automatic-admission';

// In-memory PostgreSQL WASM only. No pg Pool, TEST_* URLs, services or Daubert data.
const dir = resolve(__dirname, '../../../database/migrations/daubert_global');
const sql = (phase: string) => readFileSync(resolve(dir, `20261021_014_caterpillar_admission_test.${phase}.sql`), 'utf8');
// Adapt ONLY current_database() in test copies: PGlite calls its isolated database postgres.
const localSql = (text: string, database = 'daubert_hub_test') => text.replace(/current_database\(\)/g, `'${database}'::text`);
const schema = `CREATE SCHEMA core; CREATE SCHEMA ops; CREATE SCHEMA operacion;
  CREATE TABLE core.documentos(documento_id bigint PRIMARY KEY,empresa_id bigint,tipo_documento text NOT NULL,
    nombre_archivo text NOT NULL,ruta_archivo text,hash_archivo text,update_count int NOT NULL DEFAULT 0);
  CREATE FUNCTION core.count_update() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN NEW.update_count=OLD.update_count+1; RETURN NEW; END $$;
  CREATE TRIGGER count_update BEFORE UPDATE ON core.documentos FOR EACH ROW EXECUTE FUNCTION core.count_update();
  CREATE TABLE ops.automatizaciones(automatizacion_id bigint PRIMARY KEY,codigo text NOT NULL);
  CREATE TABLE ops.ejecuciones_automatizacion(ejecucion_id bigint PRIMARY KEY,automatizacion_id bigint,
    documento_origen_id bigint,estado text);
  CREATE TABLE operacion.remisiones(remision_id bigint PRIMARY KEY,ejecucion_id bigint,estatus text);
  CREATE TABLE operacion.reservas_folios(reserva_id bigint PRIMARY KEY,ejecucion_id bigint);`;
const fixture = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/caterpillar-normalized-items.json'), 'utf8')) as {
  normal: Array<{ json: Record<string, unknown> }>;
};
const expected = () => createCaterpillarAdmissionSnapshot(createCaterpillarAdmissionCandidate({
  sourceCompanyId: '77', fileName: 'PROGRAMACION SINTETICA.xlsx', normalizedItems: fixture.normal
}));

describe('014 snapshot persistence (isolated PGlite, never TEST/PROD)', () => {
  let db: PGlite;
  const query = vi.fn(async (text: string, params?: unknown[]) => (await db.query(localSql(text), params)).rows);
  const repo = new CaterpillarExecutionsRepository({ query } as never);
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(schema);
    for (const phase of ['precheck', 'up', 'postcheck']) await db.exec(localSql(sql(phase)));
  }, 30000);
  afterAll(async () => db?.close());
  beforeEach(async () => {
    await db.exec(`TRUNCATE core.documentos,ops.automatizaciones,ops.ejecuciones_automatizacion,
      operacion.remisiones,operacion.reservas_folios;
      INSERT INTO ops.automatizaciones VALUES(1,'REMISIONES_CATERPILLAR'),(2,'OTHER_SYNTHETIC');
      INSERT INTO core.documentos(documento_id,empresa_id,tipo_documento,nombre_archivo,ruta_archivo,hash_archivo) VALUES
        (1,77,'PROGRAMACION_ENTREGA','PROGRAMACION SINTETICA.xlsx','synthetic/1.xlsx','physical-a'),
        (2,77,'PROGRAMACION_ENTREGA','HISTORICAL.xlsx','synthetic/2.xlsx','physical-b'),
        (3,88,'PROGRAMACION_ENTREGA','OTHER OWNER.xlsx','synthetic/3.xlsx','physical-c'),
        (4,77,'OTHER','OTHER TYPE.xlsx','synthetic/4.xlsx','physical-d'),
        (5,77,'PROGRAMACION_ENTREGA','OTHER AUTOMATION.xlsx','synthetic/5.xlsx','physical-e'),
        (6,77,'PROGRAMACION_ENTREGA','IN PROGRESS.xlsx','synthetic/6.xlsx','physical-f'),
        (7,77,'PROGRAMACION_ENTREGA','RESERVED.xlsx','synthetic/7.xlsx','physical-g'),
        (8,77,'PROGRAMACION_ENTREGA','PARTIAL.xlsx','synthetic/8.xlsx','physical-h'),
        (9,77,'PROGRAMACION_ENTREGA','CANCELLED.xlsx','synthetic/9.xlsx','physical-i'),
        (10,77,'PROGRAMACION_ENTREGA','ERROR.xlsx','synthetic/10.xlsx','physical-j');
      INSERT INTO ops.ejecuciones_automatizacion VALUES
        (2,1,2,'COMPLETADA'),(5,2,5,'PROCESANDO'),(6,1,6,'PROCESANDO'),
        (7,1,7,'PROCESANDO'),(8,1,8,'PROCESANDO'),(9,1,9,'CANCELADA'),(10,1,10,'ERROR');
      INSERT INTO operacion.reservas_folios VALUES(7,7);
      INSERT INTO operacion.remisiones VALUES(8,8,'GENERADA');`);
    query.mockClear();
  });
  it('adds only a nullable JSONB column without default or row backfill', async () => {
    const result = await db.query(`SELECT format_type(atttypid,atttypmod) AS type,attnotnull,atthasdef
      FROM pg_attribute WHERE attrelid='core.documentos'::regclass AND attname='caterpillar_admission'`);
    expect(result.rows[0]).toEqual({ type: 'jsonb', attnotnull: false, atthasdef: false });
    expect((await db.query('SELECT count(*)::int AS n FROM core.documentos WHERE caterpillar_admission IS NOT NULL')).rows[0]).toEqual({ n: 0 });
  });
  it('reads empty storage without inventing a snapshot', async () => {
    expect(await repo.findAdmissionSnapshot('1', '77')).toMatchObject({ status: 'EMPTY', snapshot: null,
      document: { documentId: '1', fileName: 'PROGRAMACION SINTETICA.xlsx', writable: true } });
    expect(query.mock.calls.every(([text]) => !/UPDATE core.documentos/.test(text))).toBe(true);
  });
  it('stores the original V1 canonical snapshot and reads it back', async () => {
    expect(await repo.storeAdmissionSnapshot('1', '77', fixture.normal)).toEqual({ status: 'STORED', snapshot: expected() });
    expect(await repo.findAdmissionSnapshot('1', '77')).toMatchObject({ status: 'FOUND', snapshot: expected() });
    expect((await db.query('SELECT update_count,hash_archivo,ruta_archivo FROM core.documentos WHERE documento_id=1')).rows[0])
      .toEqual({ update_count: 1, hash_archivo: 'physical-a', ruta_archivo: 'synthetic/1.xlsx' });
  });
  it('is idempotent without issuing another UPDATE or touching timestamps/triggers', async () => {
    await repo.storeAdmissionSnapshot('1', '77', fixture.normal);
    query.mockClear();
    expect(await repo.storeAdmissionSnapshot('1', '77', fixture.normal)).toEqual({ status: 'ALREADY_STORED', snapshot: expected() });
    expect(query.mock.calls.some(([text]) => /UPDATE core.documentos/.test(text))).toBe(false);
    expect((await db.query('SELECT update_count FROM core.documentos WHERE documento_id=1')).rows[0]).toEqual({ update_count: 1 });
  });
  it('refuses changed content and preserves the first snapshot', async () => {
    await repo.storeAdmissionSnapshot('1', '77', fixture.normal);
    const changed = fixture.normal.map(i => ({ json: { ...i.json, cantidad_numerica: 99 } }));
    expect(await repo.storeAdmissionSnapshot('1', '77', changed)).toEqual({ status: 'CONFLICT', snapshot: expected() });
    expect((await db.query('SELECT update_count,caterpillar_admission FROM core.documentos WHERE documento_id=1')).rows[0])
      .toEqual({ update_count: 1, caterpillar_admission: expected() });
  });
  it.each(['2', '7', '8', '9', '10'])('never backfills historical/reserved/emitted document %s', async documentId => {
    const before = JSON.stringify((await db.query('SELECT * FROM core.documentos WHERE documento_id=$1', [documentId])).rows);
    expect(await repo.storeAdmissionSnapshot(documentId, '77', fixture.normal)).toEqual({ status: 'HISTORICAL_LOCKED', snapshot: null });
    expect(JSON.stringify((await db.query('SELECT * FROM core.documentos WHERE documento_id=$1', [documentId])).rows)).toBe(before);
    expect(query.mock.calls.some(([text]) => /UPDATE core.documentos/.test(text))).toBe(false);
  });
  it('allows capture in PROCESANDO only before any reservation/remission exists', async () => {
    expect(await repo.storeAdmissionSnapshot('6', '77', fixture.normal)).toMatchObject({ status: 'STORED' });
  });
  it.each(['3', '4', '5', '999'])('does not write foreign owner/type/automation or nonexistent document %s', async documentId => {
    expect(await repo.storeAdmissionSnapshot(documentId, '77', fixture.normal)).toEqual({ status: 'NOT_FOUND', snapshot: null });
  });
  it.each([null, { version: 'OLD' }, { version: 'CAT_ADMISSION_V1', programmingKey: 'forged', manifestCanonical: '{}' }])('does not replace invalid existing JSON %j', async value => {
    await db.query('UPDATE core.documentos SET caterpillar_admission=$1::jsonb WHERE documento_id=1', [JSON.stringify(value)]);
    query.mockClear();
    expect((await repo.findAdmissionSnapshot('1', '77')).status).toBe('INVALID');
    expect(await repo.storeAdmissionSnapshot('1', '77', fixture.normal)).toEqual({ status: 'CONFLICT', snapshot: null });
    expect(query.mock.calls.some(([text]) => /UPDATE core.documentos/.test(text))).toBe(false);
  });
  it('rejects invalid normalized input without writing', async () => {
    await expect(repo.storeAdmissionSnapshot('1', '77', [])).rejects.toThrow();
    expect(query.mock.calls.some(([text]) => /UPDATE core.documentos/.test(text))).toBe(false);
  });
  it('makes valid snapshots visible to the all-version admission reader', async () => {
    await repo.storeAdmissionSnapshot('1', '77', fixture.normal);
    const result = await repo.findAutomaticAdmissionHistory('77');
    expect(result?.snapshot_storage_ready).toBe(true);
    expect(result?.entries.find(r => r.documentId === '1')).toMatchObject({ admissionSnapshot: expected(), executionId: null });
    // A null snapshot on an unrelated non-Caterpillar execution is NOT a JSON object/history row.
    expect(result?.entries.some(r => r.documentId === '5')).toBe(false);
  });
  it('refuses reinstallation but leaves the known postcheck valid', async () => {
    await expect(db.exec(localSql(sql('up')))).rejects.toThrow(/already exists/);
    await db.exec('ROLLBACK');
    await db.exec(localSql(sql('postcheck')));
  });
  it('refuses down once snapshot evidence exists', async () => {
    await repo.storeAdmissionSnapshot('1', '77', fixture.normal);
    await expect(db.exec(localSql(sql('down')))).rejects.toThrow(/snapshots exist/);
    await db.exec('ROLLBACK');
    expect((await repo.findAdmissionSnapshot('1', '77')).status).toBe('FOUND');
  });
  it('rejects the PROD database identity in a synthetic test copy, without any PROD connection', async () => {
    await expect(db.exec(localSql(sql('up'), 'daubert_global'))).rejects.toThrow(/exclusively/);
    await db.exec('ROLLBACK');
  });
  it('never mutates remissions, reservations or executions', async () => {
    const before = await db.query('SELECT * FROM ops.ejecuciones_automatizacion ORDER BY ejecucion_id');
    const reservations = await db.query('SELECT * FROM operacion.reservas_folios');
    const remissions = await db.query('SELECT * FROM operacion.remisiones');
    await repo.storeAdmissionSnapshot('1', '77', fixture.normal);
    expect(await db.query('SELECT * FROM ops.ejecuciones_automatizacion ORDER BY ejecucion_id')).toEqual(before);
    expect(await db.query('SELECT * FROM operacion.reservas_folios')).toEqual(reservations);
    expect(await db.query('SELECT * FROM operacion.remisiones')).toEqual(remissions);
  });
  it('can roll back an empty column without changing existing document data', async () => {
    const before = await db.query("SELECT to_jsonb(d)-'caterpillar_admission' AS row FROM core.documentos d ORDER BY documento_id");
    await db.exec(localSql(sql('down')));
    expect((await repo.findAdmissionSnapshot('1', '77')).status).toBe('UNAVAILABLE');
    await db.exec(localSql(sql('up')));
    await db.exec(localSql(sql('postcheck')));
    expect(await db.query("SELECT to_jsonb(d)-'caterpillar_admission' AS row FROM core.documentos d ORDER BY documento_id")).toEqual(before);
  });
});

describe('snapshot persistence fails closed before DML', () => {
  it('does not reference the missing column or attempt UPDATE', async () => {
    const query = vi.fn().mockResolvedValue([{ database_name: 'daubert_hub_test', ready: false }]);
    const repo = new CaterpillarExecutionsRepository({ query } as never);
    expect(await repo.storeAdmissionSnapshot('1', '77', fixture.normal)).toEqual({ status: 'UNAVAILABLE', snapshot: null });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).not.toContain('d.caterpillar_admission');
  });
  it('does not read business rows or write outside TEST', async () => {
    const query = vi.fn().mockResolvedValue([{ database_name: 'daubert_global', ready: true }]);
    const repo = new CaterpillarExecutionsRepository({ query } as never);
    expect(await repo.storeAdmissionSnapshot('1', '77', fixture.normal)).toEqual({ status: 'UNAVAILABLE', snapshot: null });
    expect(query).toHaveBeenCalledTimes(1);
  });
  it.each(['same', 'different'])('compare-and-set loss returns %s observed result, never overwrites', async mode => {
    const desired = expected();
    const other = { ...desired, manifestCanonical: desired.manifestCanonical.replace('10,', '11,') };
    const doc = { document_id: '1', source_company_id: '77', file_name: 'PROGRAMACION SINTETICA.xlsx', writable: true };
    const query = vi.fn()
      .mockResolvedValueOnce([{ database_name: 'daubert_hub_test', ready: true }])
      .mockResolvedValueOnce([{ ...doc, snapshot: null, is_empty: true }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ database_name: 'daubert_hub_test', ready: true }])
      .mockResolvedValueOnce([{ ...doc, snapshot: mode === 'same' ? desired : other, is_empty: false }]);
    const repo = new CaterpillarExecutionsRepository({ query } as never);
    expect((await repo.storeAdmissionSnapshot('1', '77', fixture.normal)).status).toBe(mode === 'same' ? 'ALREADY_STORED' : 'CONFLICT');
    expect(query.mock.calls.filter(([text]) => /UPDATE core.documentos/.test(text))).toHaveLength(1);
    expect(query.mock.calls[2]?.[0]).toContain('d.caterpillar_admission IS NULL');
  });
});
