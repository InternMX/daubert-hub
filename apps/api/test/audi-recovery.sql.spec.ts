import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const migration = resolve(__dirname, '../../../database/migrations/daubert_hub_test/20261118_108_audi_execution_recovery_test');
const script = (phase: string) => readFileSync(migration + '.' + phase + '.sql', 'utf8');
const testDatabase = (sql: string) => sql.replace(/current_database\(\)/g, "'daubert_hub_test'::text");
const hash = 'a'.repeat(64);
const remissions = JSON.stringify([{ fecha_documento: '2026-11-18', detalle: [{ cantidad_texto: '1' }] }]);

describe('108 Audi recovery SQL (in-memory PGlite)', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(readFileSync(resolve(__dirname, 'fixtures/audi-recovery-schema.sql'), 'utf8'));
    const precheck = await db.exec(testDatabase(script('precheck')));
    for (const key of ['series_md5', 'cat_functions_md5']) {
      const value = precheck.flatMap(result => result.rows).find(row => key in row)?.[key];
      await db.query('SELECT set_config($1,$2,false)', ['audi_recovery.' + key, value]);
    }
    await db.exec(testDatabase(script('up')));
    const postcheck = await db.exec(testDatabase(script('postcheck')));
    expect(postcheck.flatMap(result => result.rows)).toContainEqual({ result: 'ALL_CHECKS_PASS' });
  }, 30000);
  afterAll(async () => db?.close());
  beforeEach(async () => {
    await db.exec(`ROLLBACK; RESET ROLE; TRUNCATE operacion.artefactos_ejecucion,
      ops.acciones_recuperacion_ejecucion,operacion.reservas_admitidas_audi_test,
      operacion.remision_detalle,operacion.remisiones,operacion.reservas_folios,
      ops.ejecuciones_automatizacion RESTART IDENTITY;
      UPDATE operacion.series_documentales SET siguiente_folio = 988;`);
  });

  async function row<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
    return (await db.query<T>(sql, params)).rows[0]!;
  }
  async function admit(worker = 'normal', items = remissions) {
    return row<{ outcome: string; ejecucion_id: string | number; folio_inicial: string | number }>(
      'SELECT * FROM ops.fn_admitir_reservar_audi_test(1,$1,1,$2)', [worker, items]);
  }
  const authorize = (action = 'RECONCILE', request = 'first', revision = 'ERROR:0', actor = 1, execution = 1) =>
    row<{ outcome: string; accion_id: string | number; revision: string; attempt_estado: string; claimed: boolean }>(
      "SELECT * FROM ops.fn_autorizar_accion_audi_test($1,$2,'Reason',$3,$4,$5)", [execution, action, revision, actor, request]);
  const claim = (id: string | number = 1, worker = 'worker') =>
    row<{ outcome: string; token_fencing: string; expira_en: Date }>(
      'SELECT * FROM ops.fn_reclamar_accion_audi_test($1,$2)', [id, worker]);
  const heartbeat = (token: string, id: string | number = 1, worker = 'worker') =>
    row<{ outcome: string; expira_en: Date }>('SELECT * FROM ops.fn_latido_accion_audi_test($1,$2,$3)', [id, worker, token]);
  const report = (token: string | null, options: { id?: number | null; worker?: string; rem?: number | null;
    path?: string; state?: string; digest?: string } = {}) => {
    const { id = 1, worker = 'worker', rem = 1, path = 'dir/a.pdf', state = 'VERIFICADO', digest = hash } = options;
    return row(`SELECT operacion.fn_registrar_artefacto_audi_test(1,$1,$2,$3,$4,$5,$6,$7,$8,$9) AS outcome`,
      [worker,id,token,rem === null ? 'HOJAS_IDENTIFICACION_PDF' : 'REMISION_PDF',rem,path,
        state === 'VERIFICADO' ? 10 : null,state === 'VERIFICADO' ? digest : null,state]);
  };
  const finalize = (token: string | null, id: number | null = 1, worker = 'worker') =>
    row('SELECT * FROM ops.fn_finalizar_audi_test(1,$1,$2,$3)', [worker,id,token]);
  const close = (token: string) =>
    row("SELECT ops.fn_cerrar_accion_audi_test(1,'worker',$1,'WORKER_FAILED','failed') AS outcome", [token]);
  const cancel = (token: string, stopped = true, inventory: unknown[] = []) =>
    row("SELECT ops.fn_completar_cancelacion_audi_test(1,'worker',$1,$2,$3) AS outcome",
      [token,stopped,JSON.stringify(inventory)]);
  const count = (table: string) => row('SELECT count(*)::int AS n FROM ' + table);
  const next = () => row('SELECT siguiente_folio::int AS next FROM operacion.series_documentales WHERE serie_id=1');
  const state = () => row(`SELECT e.estado,r.estatus,m.estatus AS remission,m.folio::int,m.pdf_path
    FROM ops.ejecuciones_automatizacion e JOIN operacion.reservas_folios r USING (ejecucion_id)
    JOIN operacion.remisiones m USING (ejecucion_id) WHERE e.ejecucion_id=1`);
  async function failedRun() {
    await admit();
    await db.exec("UPDATE ops.ejecuciones_automatizacion SET estado='ERROR'");
  }
  async function reconcile() {
    await failedRun();
    await authorize();
    return (await claim()).token_fencing;
  }

  it('atomically admits and retries under the same owner, and refuses another worker and ERROR with active reservation', async () => {
    const first = await admit();
    expect(first).toMatchObject({ outcome:'ADMITTED' });
    expect(await state()).toMatchObject({ estado:'PROCESANDO',estatus:'RESERVADA',remission:'PENDIENTE',folio:988 });
    expect(await count('operacion.remision_detalle')).toEqual({ n:1 });
    expect(await admit()).toEqual({ ...first, outcome:'OWNED_RETRY' });
    expect(await admit('intruder')).toMatchObject({ outcome:'ALREADY_PROCESSING',ejecucion_id:null });
    await db.exec("UPDATE ops.ejecuciones_automatizacion SET estado='ERROR'");
    expect(await admit()).toMatchObject({ outcome:'REQUIRES_RECOVERY',ejecucion_id:null });
    expect(await next()).toEqual({ next:989 });
  });

  it('rolls back execution, reservation and counter when a remission cannot be inserted', async () => {
    const items = JSON.stringify([...JSON.parse(remissions), { detalle:[] }]);
    await expect(row("SELECT * FROM ops.fn_admitir_reservar_audi_test(1,'normal',2,$1)", [items]))
      .rejects.toMatchObject({ code:'23502' });
    expect(await count('ops.ejecuciones_automatizacion')).toEqual({ n:0 });
    expect(await count('operacion.reservas_folios')).toEqual({ n:0 });
    expect(await count('operacion.remisiones')).toEqual({ n:0 });
    expect(await count('operacion.remision_detalle')).toEqual({ n:0 });
    expect(await next()).toEqual({ next:988 });
    const valid = JSON.stringify([...JSON.parse(remissions), ...JSON.parse(remissions)]);
    expect(await row("SELECT outcome,folio_inicial::int,folio_final::int FROM ops.fn_admitir_reservar_audi_test(1,'normal',2,$1)", [valid]))
      .toEqual({ outcome:'ADMITTED',folio_inicial:988,folio_final:989 });
    expect(await count('operacion.remisiones')).toEqual({ n:2 });
    expect(await count('operacion.remision_detalle')).toEqual({ n:2 });
    expect(await next()).toEqual({ next:990 });
  });

  it('serializes competing authorizations with a unique index and replays the original request', async () => {
    await failedRun();
    // One PGlite backend queues both calls. The direct collision exercises the partial unique index.
    const [first,second] = await Promise.all([authorize(),authorize('RECONCILE','second')]);
    expect(first).toMatchObject({ outcome:'AUTHORIZED',attempt_estado:'EN_CURSO',claimed:false });
    expect(second).toMatchObject({ outcome:'ACTION_IN_PROGRESS',accion_id:first.accion_id,attempt_estado:'EN_CURSO',claimed:false });
    expect(await authorize()).toEqual(first);
    const token = (await claim()).token_fencing;
    expect(await authorize()).toEqual({ ...first,claimed:true });
    expect(await authorize('RECONCILE','second')).toMatchObject({
      outcome:'ACTION_IN_PROGRESS',accion_id:first.accion_id,attempt_estado:'EN_CURSO',claimed:true,
    });
    await expect(db.exec(`INSERT INTO ops.acciones_recuperacion_ejecucion
      (ejecucion_id,accion,estado,motivo,actor_nombre,actor_email,request_id,expira_en)
      VALUES (1,'CANCEL','EN_CURSO','duplicate','Admin','admin@example.invalid','direct',clock_timestamp())`))
      .rejects.toMatchObject({ code:'23505',constraint:'uq_audi_recuperacion_en_curso' });
    expect(await count('ops.acciones_recuperacion_ejecucion')).toEqual({ n:1 });
    await close(token);
    expect(await authorize()).toEqual({ ...first,attempt_estado:'FALLIDA',claimed:true });
  });

  it('renews leases after total age exceeds 15 minutes and fences incorrect workers and tokens', async () => {
    const token = await reconcile();
    expect(await claim()).toMatchObject({ token_fencing:token });
    expect(await claim(1,'other')).toMatchObject({ outcome:'ALREADY_CLAIMED',token_fencing:null });
    await db.exec(`UPDATE ops.acciones_recuperacion_ejecucion
      SET created_at=clock_timestamp()-interval '20 minutes',expira_en=clock_timestamp()+interval '1 second'`);
    const wrong = '00000000-0000-0000-0000-000000000001';
    expect(await heartbeat(wrong)).toMatchObject({ outcome:'STALE_ATTEMPT' });
    expect(await heartbeat(token,1,'other')).toMatchObject({ outcome:'STALE_ATTEMPT' });
    expect(await report(wrong)).toEqual({ outcome:'STALE_ATTEMPT' });
    expect(await count('operacion.artefactos_ejecucion')).toEqual({ n:0 });
    expect((await heartbeat(token)).expira_en.getTime()).toBeGreaterThan(Date.now()+14*60*1000);
    await db.exec("UPDATE ops.acciones_recuperacion_ejecucion SET expira_en=clock_timestamp()+interval '1 second'");
    expect(await report(token)).toEqual({ outcome:'NEW_VERSION' });
    expect((await claim()).expira_en.getTime()).toBeGreaterThan(Date.now()+14*60*1000);
  });

  it('expires on contact and via sweep, permits a new authorization, and fences all old worker writes', async () => {
    const token = await reconcile();
    await db.exec("UPDATE ops.acciones_recuperacion_ejecucion SET expira_en=clock_timestamp()-interval '1 second'");
    expect(await heartbeat(token)).toMatchObject({ outcome:'ATTEMPT_EXPIRED' });
    expect(await authorize('RECONCILE','new','ERROR:1')).toMatchObject({ outcome:'AUTHORIZED' });
    expect(await claim()).toMatchObject({ outcome:'STALE_ATTEMPT' });
    for (const call of [heartbeat(token),report(token),finalize(token),close(token),cancel(token)]) {
      expect(await call).toMatchObject({ outcome:'STALE_ATTEMPT' });
    }
    expect(await count('operacion.artefactos_ejecucion')).toEqual({ n:0 });
    expect(await state()).toMatchObject({ estado:'ERROR',estatus:'RESERVADA',remission:'PENDIENTE' });
    await db.exec("UPDATE ops.acciones_recuperacion_ejecucion SET expira_en=clock_timestamp()-interval '1 second' WHERE accion_id=2");
    expect(await row('SELECT accion_id::int FROM ops.fn_expirar_acciones_audi_test()')).toEqual({ accion_id:2 });
    expect(await row("SELECT count(*)::int AS n FROM ops.acciones_recuperacion_ejecucion WHERE estado='EXPIRADA' AND codigo_resultado='LEASE_EXPIRED'")).toEqual({ n:2 });
  });

  it.each(['COMPLETADA','FALLIDA','EXPIRADA'])('protects the terminal state %s', async (terminal) => {
    await reconcile();
    await db.query('UPDATE ops.acciones_recuperacion_ejecucion SET estado=$1,finished_at=clock_timestamp()', [terminal]);
    await expect(db.exec("UPDATE ops.acciones_recuperacion_ejecucion SET estado='EN_CURSO',finished_at=NULL"))
      .rejects.toMatchObject({ code:'55000',message:'AUDI_RECOVERY_HISTORY_IMMUTABLE' });
    await expect(db.exec("UPDATE ops.acciones_recuperacion_ejecucion SET motivo='changed'"))
      .rejects.toMatchObject({ code:'55000',message:'AUDI_RECOVERY_HISTORY_IMMUTABLE' });
    await expect(db.exec('DELETE FROM ops.acciones_recuperacion_ejecucion'))
      .rejects.toMatchObject({ code:'55000',message:'AUDI_RECOVERY_HISTORY_IMMUTABLE' });
  });

  it('protects active attempts from deletion', async () => {
    await reconcile();
    await expect(db.exec('DELETE FROM ops.acciones_recuperacion_ejecucion'))
      .rejects.toMatchObject({ code:'55000',message:'AUDI_RECOVERY_HISTORY_IMMUTABLE' });
  });

  it('reconciles fully recorded evidence after the worker expires before finalization', async () => {
    const token = await reconcile();
    expect(await report(token)).toEqual({ outcome:'NEW_VERSION' });
    expect(await report(token,{ rem:null })).toEqual({ outcome:'NEW_VERSION' });
    await db.exec("UPDATE ops.acciones_recuperacion_ejecucion SET expira_en=clock_timestamp()-interval '1 second'");
    expect(await finalize(token)).toMatchObject({ outcome:'ATTEMPT_EXPIRED' });
    expect(await authorize('RECONCILE','retry','ERROR:1')).toMatchObject({ outcome:'AUTHORIZED' });
    const retry = (await claim(2)).token_fencing;
    expect(await report(retry,{ id:2 })).toEqual({ outcome:'ALREADY_RECORDED' });
    expect(await report(retry,{ id:2,rem:null })).toEqual({ outcome:'ALREADY_RECORDED' });
    expect(await finalize(retry,2)).toMatchObject({ outcome:'COMPLETADA' });
    expect(await state()).toMatchObject({ estado:'COMPLETADA',estatus:'APLICADA' });
    expect(await count('operacion.artefactos_ejecucion')).toEqual({ n:2 });
  });

  it('keeps evidence on failure, and a new reconciliation can finish with the same evidence', async () => {
    const token = await reconcile();
    expect(await report(token)).toEqual({ outcome:'NEW_VERSION' });
    expect(await finalize(token)).toMatchObject({ outcome:'INCOMPLETE',faltantes:['HOJAS_IDENTIFICACION_PDF'] });
    expect(await close(token)).toEqual({ outcome:'FALLIDA' });
    expect(await state()).toMatchObject({ estado:'ERROR',estatus:'RESERVADA',remission:'GENERADA' });
    await authorize('RECONCILE','retry','ERROR:1');
    const retry = (await claim(2)).token_fencing;
    expect(retry).not.toBe(token);
    expect(await report(retry,{ id:2 })).toEqual({ outcome:'ALREADY_RECORDED' });
    expect(await report(retry,{ id:2,rem:null })).toEqual({ outcome:'NEW_VERSION' });
    expect(await finalize(retry,2)).toMatchObject({ outcome:'COMPLETADA' });
    expect(await state()).toMatchObject({ estado:'COMPLETADA',estatus:'APLICADA',folio:988 });
    expect(await report(null,{ id:null,worker:'normal' })).toEqual({ outcome:'EXECUTION_CLOSED' });
    expect(await next()).toEqual({ next:989 });
  });

  it('versions concurrent duplicate reports once and finalizes from only current evidence', async () => {
    const token = await reconcile();
    const pair = await Promise.all([report(token),report(token)]);
    expect(pair.map(value => value.outcome)).toEqual(['NEW_VERSION','ALREADY_RECORDED']);
    await expect(db.exec(`INSERT INTO operacion.artefactos_ejecucion
      (ejecucion_id,tipo,remision_id,ruta,estado,version,worker)
      VALUES (1,'REMISION_PDF',1,'duplicate.pdf','FALTANTE',1,'worker')`))
      .rejects.toMatchObject({ code:'23505',constraint:'uq_audi_artefacto_version' });
    expect(await report(token,{ rem:null })).toEqual({ outcome:'NEW_VERSION' });
    expect(await report(token,{ state:'FALTANTE' })).toEqual({ outcome:'NEW_VERSION' });
    expect(await finalize(token)).toMatchObject({ outcome:'INCOMPLETE' });
    expect(await report(token,{ path:'dir/v3.pdf',digest:'b'.repeat(64) })).toEqual({ outcome:'NEW_VERSION' });
    expect(await row(`SELECT array_agg(a.version ORDER BY a.version) versions,
      array_agg(p.version ORDER BY a.version) previous
      FROM operacion.artefactos_ejecucion a LEFT JOIN operacion.artefactos_ejecucion p
        ON p.artefacto_id = a.reemplaza_artefacto_id
      WHERE a.tipo='REMISION_PDF'`)).toEqual({ versions:[1,2,3],previous:[null,1,2] });
    await expect(db.exec("UPDATE operacion.artefactos_ejecucion SET ruta='changed'")).rejects.toMatchObject({ code:'55000' });
    await expect(db.exec('DELETE FROM operacion.artefactos_ejecucion WHERE version=3')).rejects.toMatchObject({ code:'55000' });
    expect(await finalize(token)).toMatchObject({ outcome:'COMPLETADA' });
    expect(await state()).toMatchObject({ pdf_path:'dir/v3.pdf' });
  });

  it('normal run records evidence and finalizes with the execution owner', async () => {
    await admit();
    expect(await report(null,{ id:null,worker:'other' })).toEqual({ outcome:'STALE_ATTEMPT' });
    await report(null,{ id:null,worker:'normal' });
    await report(null,{ id:null,worker:'normal',rem:null });
    expect(await finalize(null,null,'normal')).toMatchObject({ outcome:'COMPLETADA' });
  });

  async function reprocessAttempt() {
    await failedRun();
    expect(await authorize('REPROCESS')).toMatchObject({ outcome:'PENDING_RECONCILIATION' });
    await authorize('CANCEL');
    expect(await cancel((await claim()).token_fencing)).toEqual({ outcome:'COMPLETADA' });
    expect(await state()).toMatchObject({ estado:'CANCELADA',estatus:'ABANDONADA',remission:'CANCELADA',folio:988 });
    expect(await authorize('REPROCESS','child')).toMatchObject({ outcome:'AUTHORIZED' });
    return (await claim(2)).token_fencing;
  }

  const reprocess = (token: string | null, parent: number | null = 1, document = 1, attempt: number | null = 2) =>
    row(`SELECT outcome,ejecucion_id::int,reserva_id::int,folio_inicial::int,folio_final::int,cantidad
      FROM ops.fn_admitir_reservar_audi_test($1,'worker',2,$2,$3,$4,$5)`,
      [document, JSON.stringify([...JSON.parse(remissions), ...JSON.parse(remissions)]), parent, attempt, token]);

  async function recoverySnapshot(parentOnly = false) {
    const filter = parentOnly ? 'WHERE ejecucion_id=1' : '';
    const tables = ['ops.ejecuciones_automatizacion','operacion.reservas_folios',
      'operacion.reservas_admitidas_audi_test','operacion.remisiones','operacion.artefactos_ejecucion'];
    const rows = await Promise.all(tables.map(table => row(
      'SELECT array_agg(t::text ORDER BY t::text) AS rows FROM ' + table + ' t ' + filter)));
    return parentOnly ? rows : [...rows,await next(),await row(`SELECT
      (SELECT array_agg(a::text ORDER BY accion_id) FROM ops.acciones_recuperacion_ejecucion a) AS attempts,
      (SELECT array_agg(d::text ORDER BY d::text) FROM operacion.remision_detalle d) AS details`)];
  }

  it('creates a child with contiguous new folios, preserves the parent, and retries for the same owner', async () => {
    const token = await reprocessAttempt();
    const parent = await recoverySnapshot(true);
    await db.exec("INSERT INTO ops.ejecuciones_automatizacion(automatizacion_id,documento_origen_id,estado) VALUES (1,1,'ERROR')");
    const result = await reprocess(token);
    expect(result).toMatchObject({ outcome:'REPROCESS_CREATED',ejecucion_id:3,folio_inicial:989,folio_final:990,cantidad:2 });
    expect(await row(`SELECT e.reproceso_de_id::int,e.n8n_execution_id,a.estado,a.codigo_resultado
      FROM ops.acciones_recuperacion_ejecucion a JOIN ops.ejecuciones_automatizacion e
        ON e.ejecucion_id=a.ejecucion_hija_id WHERE a.accion_id=2`)).toEqual({
      reproceso_de_id:1,n8n_execution_id:'worker',estado:'COMPLETADA',codigo_resultado:'REPROCESS_CREATED',
    });
    expect(await row(`SELECT array_agg(folio::int ORDER BY folio) AS folios FROM operacion.remisiones
      WHERE ejecucion_id=3 AND estatus='PENDIENTE'`)).toEqual({ folios:[989,990] });
    expect(await reprocess(token)).toEqual({ ...result,outcome:'OWNED_RETRY' });
    expect(await reprocess('00000000-0000-0000-0000-000000000001')).toMatchObject({ outcome:'STALE_ATTEMPT' });
    expect(await authorize('REPROCESS','second-child')).toMatchObject({ outcome:'ALREADY_REPROCESSED' });
    expect(await recoverySnapshot(true)).toEqual(parent);
    expect(await next()).toEqual({ next:991 });
  });

  it('refuses partial credentials, wrong tokens, mismatched parent or document, and expired leases without writes', async () => {
    const token = await reprocessAttempt();
    await db.exec("INSERT INTO ops.ejecuciones_automatizacion(automatizacion_id,documento_origen_id,estado) VALUES (1,1,'ERROR')");
    const before = await recoverySnapshot();
    for (const args of [[null,1,1,2],[token,null,1,2],[token,1,1,null],
      ['00000000-0000-0000-0000-000000000001',1,1,2],[token,2,1,2],[token,1,2,2]] as const) {
      expect(await reprocess(args[0],args[1],args[2],args[3])).toMatchObject({ outcome:'STALE_ATTEMPT' });
    }
    expect(await recoverySnapshot()).toEqual(before);
    await db.exec("UPDATE ops.acciones_recuperacion_ejecucion SET expira_en=clock_timestamp()-interval '1 second' WHERE accion_id=2");
    const expired = await recoverySnapshot();
    expect(await reprocess(token)).toMatchObject({ outcome:'ATTEMPT_EXPIRED' });
    expect(await recoverySnapshot()).toEqual(expired);
  });

  it('refuses admission while another execution is processing the document', async () => {
    const token = await reprocessAttempt();
    await db.exec('INSERT INTO ops.ejecuciones_automatizacion(automatizacion_id,documento_origen_id) VALUES (2,1)');
    const before = await recoverySnapshot();
    expect(await reprocess(token)).toMatchObject({ outcome:'ALREADY_PROCESSING' });
    expect(await recoverySnapshot()).toEqual(before);
  });

  it('rechecks the locked parent for evidence after authorization and fails the attempt', async () => {
    const token = await reprocessAttempt();
    await db.exec(`INSERT INTO operacion.artefactos_ejecucion(ejecucion_id,tipo,ruta,estado,version,worker)
      VALUES (1,'HOJAS_IDENTIFICACION_PDF','missing.pdf','FALTANTE',1,'normal')`);
    const parent = await recoverySnapshot(true);
    expect(await reprocess(token)).toMatchObject({ outcome:'PARTIAL_ARTIFACTS' });
    expect(await row('SELECT estado,codigo_resultado FROM ops.acciones_recuperacion_ejecucion WHERE accion_id=2'))
      .toEqual({ estado:'FALLIDA',codigo_resultado:'PARTIAL_ARTIFACTS' });
    expect(await recoverySnapshot(true)).toEqual(parent);
    expect(await next()).toEqual({ next:989 });
  });

  it('maps a child appearing at insert time through the actual unique index without changing rows', async () => {
    const token = await reprocessAttempt();
    // A BEFORE INSERT trigger creates the conflicting key after the eligibility check.
    await db.exec(`INSERT INTO ops.ejecuciones_automatizacion(automatizacion_id,documento_origen_id,estado) VALUES (1,1,'ERROR');
      CREATE FUNCTION ops.force_reprocess_collision() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        UPDATE ops.ejecuciones_automatizacion SET reproceso_de_id=NEW.reproceso_de_id WHERE ejecucion_id=2;
        RETURN NEW;
      END $$;
      CREATE TRIGGER force_reprocess_collision BEFORE INSERT ON ops.ejecuciones_automatizacion
        FOR EACH ROW EXECUTE FUNCTION ops.force_reprocess_collision()`);
    try {
      const before = await recoverySnapshot();
      expect(await reprocess(token)).toMatchObject({ outcome:'ALREADY_REPROCESSED' });
      expect(await recoverySnapshot()).toEqual(before);
    } finally {
      await db.exec('DROP TRIGGER force_reprocess_collision ON ops.ejecuciones_automatizacion; DROP FUNCTION ops.force_reprocess_collision()');
    }
  });

  it('refuses a running cancellation and closes the attempt as failed', async () => {
    await admit();
    await authorize('CANCEL','cancel','PROCESANDO:0');
    expect(await cancel((await claim()).token_fencing,false)).toEqual({ outcome:'N8N_RUNNING' });
    expect(await row('SELECT estado FROM ops.acciones_recuperacion_ejecucion')).toEqual({ estado:'FALLIDA' });
    expect(await state()).toMatchObject({ estado:'PROCESANDO',estatus:'RESERVADA',remission:'PENDIENTE' });
  });

  it('preserves failed cancellation inventory, refuses reprocess, and allows reconciliation', async () => {
    await failedRun();
    await authorize('CANCEL');
    const token = (await claim()).token_fencing;
    expect(await cancel(token,true,[{ tipo:'REMISION_PDF',remision_id:'1',ruta:'dir/a.pdf',
      tamano_bytes:10,sha256:hash,estado:'VERIFICADO' }])).toEqual({ outcome:'PARTIAL_ARTIFACTS_REQUIRE_RECONCILIATION' });
    expect(await row('SELECT estado FROM ops.acciones_recuperacion_ejecucion')).toEqual({ estado:'FALLIDA' });
    expect(await state()).toMatchObject({ estado:'ERROR',estatus:'RESERVADA',remission:'PENDIENTE',pdf_path:null });
    expect(await count('operacion.artefactos_ejecucion')).toEqual({ n:1 });
    expect(await authorize('REPROCESS','child')).toMatchObject({ outcome:'PARTIAL_ARTIFACTS' });
    expect(await authorize('RECONCILE','retry','ERROR:1')).toMatchObject({ outcome:'AUTHORIZED' });
  });

  it('refuses cancellation when a remission has been generated', async () => {
    await failedRun();
    await db.exec("UPDATE operacion.remisiones SET estatus='GENERADA'");
    expect(await authorize('CANCEL')).toMatchObject({ outcome:'REMISSIONS_ISSUED' });
  });

  it('refuses every action for a legacy completed five-folio execution', async () => {
    await db.exec(`INSERT INTO ops.ejecuciones_automatizacion(automatizacion_id,documento_origen_id,estado,n8n_execution_id)
      VALUES (1,1,'COMPLETADA','16050');
      INSERT INTO operacion.remisiones(ejecucion_id,serie_id,folio,empresa_cliente_id,fecha_documento,estatus)
      SELECT 1,1,folio,10,'2026-11-18','GENERADA' FROM generate_series(983,987) folio`);
    for (const action of ['REPROCESS','RECONCILE','STOP','CANCEL']) {
      expect(await authorize(action)).toMatchObject({ outcome:'LEGACY_EXECUTION' });
    }
    expect(await count('ops.acciones_recuperacion_ejecucion')).toEqual({ n:0 });
    expect(await next()).toEqual({ next:988 });
  });

  it('checks role, automation, revision and Hub function ACLs', async () => {
    await failedRun();
    await db.exec('INSERT INTO ops.ejecuciones_automatizacion(automatizacion_id,documento_origen_id) VALUES (2,1)');
    await db.exec('SET ROLE daubert_hub_test_user');
    for (const actor of [2,3,4]) expect(await authorize('RECONCILE','first','ERROR:0',actor)).toMatchObject({ outcome:'FORBIDDEN' });
    expect(await authorize('RECONCILE','first','ERROR:0',1,2)).toMatchObject({ outcome:'NOT_FOUND' });
    expect(await authorize('RECONCILE','first','ERROR:999')).toMatchObject({ outcome:'STALE_REVISION' });
    await expect(claim()).rejects.toMatchObject({ code:'42501' });
    expect(await row('SELECT ops.fn_detalle_recuperacion_audi_test(1) AS detail')).toMatchObject({ detail:{ model:'ATOMIC' } });
  });

  it('rejects non-TEST and refuses down with admission history', async () => {
    await expect(db.exec(script('up').replace(/current_database\(\)/g,"'daubert_global'::text")))
      .rejects.toThrow('requires postgres exclusively in daubert_hub_test');
    await db.exec('ROLLBACK');
    await admit();
    await expect(db.exec(testDatabase(script('down')))).rejects.toThrow('rollback blocked by Audi recovery history');
  });
});
