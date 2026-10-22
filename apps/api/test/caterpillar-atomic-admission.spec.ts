import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCaterpillarAdmissionCandidate, createCaterpillarAdmissionSnapshot, normalizeCaterpillarProgrammingName } from '../src/automations/remisiones-caterpillar/caterpillar-automatic-admission';

// One in-memory backend, legacy contract doubles. NOT real two-backend concurrency/Daubert evidence.
const dir = resolve(__dirname, '../../../database/migrations/daubert_global');
const up = readFileSync(resolve(dir, '20261022_015_caterpillar_atomic_admission_test.up.sql'), 'utf8');
const databaseOnly = (sql: string) => sql.replace(/current_database\(\)/g, "'daubert_hub_test'::text");
const md5 = (text: string) => createHash('md5').update(text.replace(/\r/g,'')).digest('hex');
const bodies = up.split('CREATE FUNCTION ').slice(1).map(block => block.split('AS $fn$')[1]!.split('$fn$;')[0]!);
// Runtime database name is the ONLY production check adapted. Match fingerprints of those test copies.
const inMemory = (sql: string) => bodies.reduce((text,body) => text.replaceAll(md5(body),md5(databaseOnly(body))),databaseOnly(sql));
const script = (phase: string) => readFileSync(resolve(dir,`20261022_015_caterpillar_atomic_admission_test.${phase}.sql`),'utf8');
const fixture = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/caterpillar-normalized-items.json'), 'utf8')) as { normal: Array<{ json: Record<string, unknown> }>; torreonBeforeGrouping: Array<{json: Record<string, unknown>}> };
interface Gate { decision: string; reason: string; can_emit: boolean; worker_id: string | null; ejecucion_id: number; reserva_id: number; legacy_unverified: number }
describe('015 atomic admission SQL — isolated contract tests, not real concurrency', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(readFileSync(resolve(__dirname, 'fixtures/caterpillar-atomic-admission-schema.sql'), 'utf8'));
    await db.exec(inMemory(script('precheck')));
    await db.exec(inMemory(up));
    await db.exec(inMemory(script('postcheck')));
  }, 30000);
  afterAll(async () => db?.close());
  beforeEach(async () => {
    await db.exec(`RESET ROLE; TRUNCATE core.documentos,ops.ejecuciones_automatizacion,operacion.reservas_folios,
      operacion.remisiones,operacion.remision_detalle; UPDATE operacion.series_documentales SET siguiente_folio=CASE serie_id WHEN 1 THEN 1000 ELSE 2000 END;`);
  });
  async function document(id: number, name = 'NEW.xlsx', changes: Record<string, unknown> = {}, legacy = false) {
    const items = fixture.normal.map(item => ({ json: { ...item.json, ...changes } }));
    const snapshot = legacy ? null : createCaterpillarAdmissionSnapshot(createCaterpillarAdmissionCandidate({ sourceCompanyId: '77', fileName: name, normalizedItems: items }));
    await db.query(`INSERT INTO core.documentos VALUES($1,77,'PROGRAMACION_ENTREGA',$2,$3,$4::jsonb)`, [id, name, 'physical-'+id, snapshot ? JSON.stringify(snapshot) : null]);
  }
  async function gate(id: number, worker = 'worker-A', series = 'SYN_P5', quantity = 2) {
    await db.exec('SET ROLE n8n_cat_test');
    try { return (await db.query<Gate>(inMemory('SELECT * FROM ops.fn_admitir_reservar_caterpillar_test($1,$2,$3,$4)'), [id,worker,series,quantity])).rows[0]!; }
    finally { await db.exec('RESET ROLE'); }
  }
  async function counts() {
    return (await db.query<{executions:number;reservations:number;remissions:number;next:number}>(`SELECT (SELECT count(*)::int FROM ops.ejecuciones_automatizacion) AS executions,
      (SELECT count(*)::int FROM operacion.reservas_folios) AS reservations,
      (SELECT count(*)::int FROM operacion.remisiones) AS remissions,
      (SELECT siguiente_folio::int FROM operacion.series_documentales WHERE serie_id=1) AS next`)).rows[0];
  }
  it('first programming creates one execution and reservation in the same operation', async () => {
    await document(1);
    expect(await gate(1)).toMatchObject({ decision: 'ADMIT', reason: 'ACQUIRED', can_emit: true, worker_id: 'worker-A' });
    expect(await counts()).toEqual({ executions: 1, reservations: 1, remissions: 0, next: 1002 });
  });
  it('same-owner retry returns the same execution/range and never advances twice', async () => {
    await document(1);
    const a = await gate(1), b = await gate(1);
    expect(b).toMatchObject({ reason: 'OWNED_RETRY', can_emit: true, ejecucion_id: a.ejecucion_id, reserva_id: a.reserva_id });
    expect(await counts()).toEqual({ executions: 1, reservations: 1, remissions: 0, next: 1002 });
  });
  it('second worker cannot continue on ALREADY_PROCESSING', async () => {
    await document(1); await gate(1);
    expect(await gate(1,'worker-B')).toMatchObject({ reason: 'PROGRAM_IN_PROGRESS', can_emit: false });
    expect((await counts())?.reservations).toBe(1);
  });
  it('two submissions are serialized by PGlite; one winner (NOT a visible lock-wait test)', async () => {
    await document(1);
    // PGlite serializes one backend. Deliberately no claim of two-backend concurrency here.
    const a = await gate(1,'worker-A'), b = await gate(1,'worker-B');
    expect([a,b].filter(x=>x.can_emit)).toHaveLength(1);
  });
  it('same name/hash change cannot create another claim', async () => {
    await document(1); await gate(1);
    await document(2,'new.xlsm',{ cantidad_numerica: 55 });
    expect(await gate(2,'worker-B')).toMatchObject({ decision: 'BLOCK', reason: 'PROGRAM_IN_PROGRESS', can_emit: false });
    expect((await counts())?.executions).toBe(1);
  });
  it('renamed equivalent content requires review while first is processing', async () => {
    await document(1); await gate(1); await document(2,'RENAMED.xlsx');
    expect(await gate(2,'worker-B')).toMatchObject({ decision: 'REVIEW', reason: 'MANIFEST_MATCH_REVIEW', can_emit: false });
    expect((await counts())?.reservations).toBe(1);
  });
  it.each([['COMPLETADA','PROGRAM_ALREADY_EMITTED'],['CANCELADA','REGENERATION_AUTHORIZATION_REQUIRED'],['ERROR','MANUAL_REPROCESS_REQUIRED']])('blocks terminal %s even for the old owner', async (state, reason) => {
    await document(1); const a = await gate(1);
    await db.query('UPDATE ops.ejecuciones_automatizacion SET estado=$1 WHERE ejecucion_id=$2',[state,a.ejecucion_id]);
    expect(await gate(1)).toMatchObject({ reason, can_emit: false });
    expect((await counts())?.reservations).toBe(1);
  });
  it('legacy missing snapshot protects its name without inventing scope', async () => {
    await document(1,'LEGACY.xlsx',{},true);
    await db.exec("INSERT INTO ops.ejecuciones_automatizacion(automatizacion_id,documento_origen_id,estado,n8n_execution_id) VALUES(1,1,'COMPLETADA','old')");
    await document(2,'legacy.XLSM',{ planta_codigo: 'P5', cantidad_numerica: 99 });
    expect(await gate(2)).toMatchObject({ decision: 'REVIEW', reason: 'LEGACY_NAME_MATCH', can_emit: false, legacy_unverified: 1 });
    expect((await counts())?.reservations).toBe(0);
  });
  it('unrelated legacy NULL snapshot does not universally block a new name; coverage gap remains visible', async () => {
    await document(1,'LEGACY.xlsx',{},true);
    await db.exec("INSERT INTO ops.ejecuciones_automatizacion(automatizacion_id,documento_origen_id,estado) VALUES(1,1,'COMPLETADA')");
    await document(2,'TRULY-NEW.xlsx',{ cantidad_numerica: 99 });
    expect(await gate(2)).toMatchObject({ can_emit: true, legacy_unverified: 1 });
    expect((await db.query('SELECT caterpillar_admission FROM core.documentos WHERE documento_id=1')).rows[0]).toEqual({ caterpillar_admission: null });
  });
  it('renamed legacy with the same physical hash is a review signal, never a delivery identity', async () => {
    await document(1,'LEGACY.xlsx',{},true);
    await db.exec("INSERT INTO ops.ejecuciones_automatizacion(automatizacion_id,documento_origen_id,estado) VALUES(1,1,'COMPLETADA')");
    await document(2,'RENAMED.xlsx');
    await db.exec("UPDATE core.documentos SET hash_archivo='physical-1' WHERE documento_id=2");
    expect(await gate(2)).toMatchObject({can_emit:false,reason:'LEGACY_FILE_MATCH'});
    expect((await counts())?.reservations).toBe(0);
  });
  it('reservation failure rolls back execution and counter, not an orphaned claim', async () => {
    await document(1);
    await expect(gate(1,'worker-A','SYN_P5',1)).rejects.toThrow(/QUANTITY_MISMATCH/);
    expect(await counts()).toEqual({ executions: 0, reservations: 0, remissions: 0, next: 1000 });
    expect(await gate(1)).toMatchObject({ can_emit: true });
  });
  it('a failure INSIDE the reserver rolls back the newly created execution atomically', async () => {
    await document(1);
    await db.exec(`CREATE FUNCTION operacion.fail_reserve_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic reserver failure'; END $$;
      CREATE TRIGGER fail_reserve_fixture BEFORE INSERT ON operacion.reservas_folios FOR EACH ROW EXECUTE FUNCTION operacion.fail_reserve_fixture();`);
    try {
      await expect(gate(1)).rejects.toThrow('synthetic reserver failure');
      expect(await counts()).toEqual({executions:0,reservations:0,remissions:0,next:1000});
    } finally { await db.exec('DROP TRIGGER fail_reserve_fixture ON operacion.reservas_folios; DROP FUNCTION operacion.fail_reserve_fixture()'); }
    expect(await gate(1)).toMatchObject({reason:'ACQUIRED',can_emit:true});
  });
  it('does not allow using an unrelated active series', async () => {
    await document(1);
    await expect(gate(1,'worker-A','SYN_TOR')).rejects.toThrow(/ROUTE_NOT_ALLOWED/);
    expect((await counts())?.executions).toBe(0);
  });
  it('blocks bypassing admission by calling the old reserver/creator', async () => {
    await db.exec('SET ROLE n8n_cat_test');
    await expect(db.query("SELECT * FROM operacion.reservar_folios_para_ejecucion(1,'SYN_P5',2)")).rejects.toMatchObject({ code: '42501' });
    await expect(db.query("SELECT * FROM ops.fn_crear_ejecucion_automatizacion('REMISIONES_CATERPILLAR',1,'B',NULL,NULL)")).rejects.toMatchObject({ code: '42501' });
    await db.exec('RESET ROLE');
  });
  it('Hub role has no right to reserve through the new gate', async () => {
    await document(1); await db.exec('SET ROLE daubert_hub_test_user');
    await expect(db.query("SELECT * FROM ops.fn_admitir_reservar_caterpillar_test(1,'api','SYN_P5',2)")).rejects.toMatchObject({ code: '42501' });
    await db.exec('RESET ROLE');
  });
  it('checks owner on registration and leaves the legacy idempotent register contract intact', async () => {
    await document(1); const a = await gate(1);
    const args = [a.ejecucion_id,'worker-A','SYN_P5',1000,'2026-10-21','E2E-NO-FILE/synthetic.pdf','[{"codigo_interno":"SYN","cantidad_texto":"1 pieza"}]'];
    await db.exec('SET ROLE n8n_cat_test');
    await expect(db.query('SELECT * FROM operacion.fn_registrar_remision_caterpillar_test($1,$2,$3,$4,$5,$6,$7)',[...args.slice(0,1),'worker-B',...args.slice(2)])).rejects.toMatchObject({ code:'42501' });
    const first=await db.query<{remision_id:number;ya_existia:boolean}>('SELECT * FROM operacion.fn_registrar_remision_caterpillar_test($1,$2,$3,$4,$5,$6,$7)',args);
    const repeat=await db.query('SELECT * FROM operacion.fn_registrar_remision_caterpillar_test($1,$2,$3,$4,$5,$6,$7)',args);
    expect(repeat.rows[0]).toMatchObject({ ...first.rows[0], ya_existia: true });
    await db.exec('RESET ROLE');
    expect((await counts())?.remissions).toBe(1);
  });
  it.each(['  programación\u00a0  001.xlsx  ','straße.xlsx','ﬁle.XLSM'])('matches the existing JS key normalization for %s', async name => {
    await document(1,name);
    expect(await gate(1)).toMatchObject({ can_emit: true });
    const actual=(await db.query<{name:string}>('SELECT ops.fn_cat_key_text_015($1) AS name',[name])).rows[0]!.name.replace(/\.(XLSX|XLSM|XLS)$/,'').trim();
    expect(actual).toBe(normalizeCaterpillarProgrammingName(name));
  });
  it('retries after a nonterminal worker failure reuse the same reservation', async () => {
    await document(1); const a=await gate(1);
    await db.exec('SET ROLE n8n_cat_test');
    await db.query('SELECT * FROM ops.fn_fallo_caterpillar_test($1,$2,$3,$4)',[a.ejecucion_id,'worker-A','synthetic','synthetic failure']);
    await expect(db.query('SELECT * FROM ops.fn_finalizar_caterpillar_test($1,$2,$3)',[a.ejecucion_id,'worker-B','ERROR'])).rejects.toMatchObject({code:'42501'});
    await db.exec('RESET ROLE');
    expect(await gate(1)).toMatchObject({reason:'OWNED_RETRY',reserva_id:a.reserva_id,can_emit:true});
    expect((await counts())?.next).toBe(1002);
  });
  it('handles actual TORREON/PLANTA_2 grouping and repeated lines without changing reservation count', async () => {
    const base=fixture.torreonBeforeGrouping.map(i=>({json:{...i.json,planta_codigo:'TORREON',subplanta_codigo:'PLANTA_2'}}));
    const items=[...base,structuredClone(base[0]!)];
    const snap=createCaterpillarAdmissionSnapshot(createCaterpillarAdmissionCandidate({sourceCompanyId:'77',fileName:'TOR.xlsx',normalizedItems:items}));
    await db.query("INSERT INTO core.documentos VALUES(1,77,'PROGRAMACION_ENTREGA','TOR.xlsx','physical',$1)",[JSON.stringify(snap)]);
    expect(await gate(1,'worker-A','SYN_TOR',1)).toMatchObject({can_emit:true,cantidad:1});
    expect(JSON.parse(snap.manifestCanonical).documents[0].lines).toHaveLength(3);
  });
  it('postcheck detects an unauthorized EXECUTE grant without changing any legacy function body', async () => {
    await db.exec('GRANT EXECUTE ON FUNCTION ops.fn_admitir_reservar_caterpillar_test(bigint,text,text,integer) TO daubert_hub_test_user');
    await expect(db.exec(inMemory(script('postcheck')))).rejects.toThrow(/privilege drift/);
    await db.exec('ROLLBACK; REVOKE EXECUTE ON FUNCTION ops.fn_admitir_reservar_caterpillar_test(bigint,text,text,integer) FROM daubert_hub_test_user');
    await db.exec(inMemory(script('postcheck')));
  });
  it('postcheck rejects STABLE volatility drift that could invalidate fresh post-lock visibility', async () => {
    await db.exec('ALTER FUNCTION ops.fn_admitir_reservar_caterpillar_test(bigint,text,text,integer) STABLE');
    await expect(db.exec(inMemory(script('postcheck')))).rejects.toThrow(/definition drift/);
    await db.exec('ROLLBACK; ALTER FUNCTION ops.fn_admitir_reservar_caterpillar_test(bigint,text,text,integer) VOLATILE');
    await db.exec(inMemory(script('postcheck')));
  });
  it('down refuses removing claim infrastructure once evidence exists', async () => {
    await document(1); await gate(1);
    await expect(db.exec(inMemory(script('down')))).rejects.toThrow(/rollback refused/);
    await db.exec('ROLLBACK');
    expect((await counts())?.reservations).toBe(1);
  });
  it('empty down/up restores the reviewed legacy ACL and leaves data/allocator definitions intact', async () => {
    const before=(await db.query("SELECT prosrc FROM pg_proc WHERE oid='operacion.reservar_folios_para_ejecucion(bigint,text,integer)'::regprocedure")).rows;
    await db.exec(inMemory(script('down')));
    expect((await db.query("SELECT has_function_privilege('n8n_cat_test','operacion.reservar_folios_para_ejecucion(bigint,text,integer)','EXECUTE') AS allowed")).rows[0]).toEqual({allowed:true});
    await db.exec(inMemory(script('precheck'))); await db.exec(inMemory(up)); await db.exec(inMemory(script('postcheck')));
    expect((await db.query("SELECT prosrc FROM pg_proc WHERE oid='operacion.reservar_folios_para_ejecucion(bigint,text,integer)'::regprocedure")).rows).toEqual(before);
  });
  it('rejects a stale REPEATABLE READ view rather than deciding after an advisory lock with old visibility', async () => {
    await document(1);
    await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ; SET ROLE n8n_cat_test');
    await expect(db.query("SELECT * FROM ops.fn_admitir_reservar_caterpillar_test(1,'worker-A','SYN_P5',2)")).rejects.toThrow(/READ_COMMITTED_REQUIRED/);
    await db.exec('ROLLBACK');
    expect((await counts())?.executions).toBe(0);
  });
  it('invalid non-NULL history is not silently reclassified as unrelated legacy', async () => {
    await document(1,'OLD.xlsx');
    await db.exec(`UPDATE core.documentos SET caterpillar_admission='{"version":"OLD"}';
      INSERT INTO ops.ejecuciones_automatizacion(automatizacion_id,documento_origen_id,estado) VALUES(1,1,'COMPLETADA')`);
    await document(2,'NEW.xlsx');
    expect(await gate(2)).toMatchObject({can_emit:false,reason:'HISTORY_UNAVAILABLE'});
    expect((await counts())?.reservations).toBe(0);
  });
  it('a cancelled remission does not cancel the completed execution or allow automatic regeneration', async () => {
    await document(1); const a=await gate(1);
    await db.exec('SET ROLE n8n_cat_test');
    for(const folio of [1000,1001])await db.query('SELECT * FROM operacion.fn_registrar_remision_caterpillar_test($1,$2,$3,$4,$5,$6,$7)',
      [a.ejecucion_id,'worker-A','SYN_P5',folio,'2026-10-21',`E2E-NO-FILE/${folio}.pdf`,'[{"codigo_interno":"SYN","cantidad_texto":"1 pieza"}]']);
    await db.query('SELECT * FROM ops.fn_finalizar_caterpillar_test($1,$2,$3)',[a.ejecucion_id,'worker-A','COMPLETADA']);
    await db.exec('RESET ROLE');
    await db.exec("UPDATE operacion.remisiones SET estatus='CANCELADA' WHERE folio=1000");
    expect(await gate(1)).toMatchObject({can_emit:false,reason:'REGENERATION_AUTHORIZATION_REQUIRED'});
    expect((await db.query('SELECT estado FROM ops.ejecuciones_automatizacion WHERE ejecucion_id=$1',[a.ejecucion_id])).rows[0]).toEqual({estado:'COMPLETADA'});
  });
});
