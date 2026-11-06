import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Offline evidence for commercial regeneration (017). The SQL behaviour is proven against real PostgreSQL by test/caterpillar-017-real.test-runner.cjs
// (documented in the runbook); this file guards the n8n entry nodes and the shape of the migration so they cannot drift silently.
const root = resolve(__dirname, '../../..');
const dir = resolve(root, 'n8n/workflows/remisiones-caterpillar');
type Node = { name: string; parameters: { jsCode: string } };
type Workflow = { nodes: Node[] };
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as Workflow;
const workflows: Array<[string, Workflow]> = [
  ['TEST FULL', readJson(resolve(dir, 'candidate-015/caterpillar-test-015.FULL.INACTIVE.json'))],
  ['TEST FAILURE copy', readJson(resolve(dir, 'candidate-015/caterpillar-test-015.FAILURE.INACTIVE.json'))],
  ['PROD candidate', readJson(resolve(dir, 'candidate-016-prod/caterpillar-prod-016.CANDIDATE.INACTIVE.json'))]
];
const code = (w: Workflow, name: string) => w.nodes.find(n => n.name === name)!.parameters.jsCode;
const sql = (name: string) => fs.readFileSync(resolve(root, 'database/migrations/daubert_global', name), 'utf8').replace(/\r\n/g, '\n');

function runEntry(w: Workflow, body: Record<string, unknown>) {
  const run = new Function('$input', code(w, 'Normalizar y validar entrada reproceso CAT'));
  return (run({ first: () => ({ json: { body } }) }) as Array<{ json: Record<string, unknown> }>)[0]!.json;
}
// The eligibility decision is the single expression patched into the node: evaluate exactly that line.
function eligible(w: Workflow, entrada: Record<string, unknown>, estado: string) {
  const line = code(w, 'Validar elegibilidad reproceso CAT').split('\n').find(l => l.startsWith('const estadoElegible = '))!;
  return new Function('entrada', 'estado', `${line}\nreturn estadoElegible;`)(entrada, estado) as boolean;
}

describe.each(workflows)('reprocess entry nodes — %s', (_name, w) => {
  it('a plain request keeps the exact reprocess contract (no kind, valid, not a regeneration)', () => {
    expect(runEntry(w, { executionId: '194', reason: 'motivo' })).toMatchObject({ original_execution_id: '194', entrada_valida: true, regeneracion: false });
  });
  it('kind=REGENERATION is recognised and anything else is an invalid entry', () => {
    expect(runEntry(w, { executionId: '194', reason: 'motivo', kind: 'REGENERATION' })).toMatchObject({ entrada_valida: true, regeneracion: true });
    for (const kind of ['regeneration', 'REPROCESS', 'x']) expect(runEntry(w, { executionId: '194', reason: 'motivo', kind }), kind).toMatchObject({ entrada_valida: false });
  });
  it('eligibility: regeneration accepts ONLY COMPLETADA; the technical reprocess still accepts ONLY ERROR/CANCELADA', () => {
    for (const estado of ['ERROR', 'CANCELADA', 'COMPLETADA', 'PROCESANDO']) {
      expect(eligible(w, { regeneracion: true }, estado), `regeneration ${estado}`).toBe(estado === 'COMPLETADA');
      expect(eligible(w, { regeneracion: false }, estado), `reprocess ${estado}`).toBe(estado === 'ERROR' || estado === 'CANCELADA');
    }
  });
});

describe('migration 017 shape', () => {
  const up = sql('20261024_017_caterpillar_regeneration_test.up.sql');
  it('adds one table and one Hub function, replaces only the reprocess gate, and is guarded to TEST', () => {
    expect(up.match(/CREATE TABLE /g)).toHaveLength(1);
    expect(up.match(/CREATE FUNCTION /g)).toHaveLength(1);
    expect(up.match(/CREATE OR REPLACE FUNCTION /g)).toHaveLength(1);
    expect(up).toContain("current_database()<>'daubert_hub_test'");
    expect(up).toContain('refusing replacement');
  });
  it('a COMPLETADA parent needs a recorded authorization, formally cancelled remissions and is consumed by the child; ERROR/CANCELADA rules stay', () => {
    expect(up).toContain("regen:=par.parent_state='COMPLETADA'");
    expect(up).toContain("IF par.parent_state NOT IN ('ERROR','CANCELADA') THEN");
    expect(up).toContain('FROM operacion.autorizaciones_regeneracion_caterpillar x WHERE x.ejecucion_origen_id=p_parent FOR UPDATE');
    expect(up).toContain('NOT EXISTS(SELECT 1 FROM operacion.cancelaciones_remisiones c WHERE c.remision_id=m.remision_id)');
    expect(up).toContain('SET ejecucion_nueva_id=own_id');
    expect(up).toContain('CAT_REGEN_AUTHORIZATION_ALREADY_USED');
  });
  it('the authorization is single-use by construction and cannot be written by the Hub, n8n or anyone but the definer function', () => {
    expect(up).toContain('ejecucion_origen_id bigint NOT NULL UNIQUE');
    expect(up).toContain('ejecucion_nueva_id bigint UNIQUE');
    expect(up).toMatch(/GRANT SELECT ON operacion\.autorizaciones_regeneracion_caterpillar TO %I/);
    expect(up).toMatch(/GRANT EXECUTE ON FUNCTION operacion\.fn_autorizar_regeneracion_caterpillar\(bigint,text,bigint,text\) TO %I/);
    expect(up).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)/i);
    expect(up).not.toMatch(/TO n8n_cat_test/);
  });
  it('rollback refuses once any authorization exists and restores the validated 015 reprocess definition', () => {
    const down = sql('20261024_017_caterpillar_regeneration_test.down.sql');
    expect(down).toContain('authorizations exist; rollback refused');
    const start = down.indexOf('$fn$', down.indexOf('CREATE OR REPLACE FUNCTION ops.fn_reprocesar_reservar_caterpillar_test')) + 4;
    const restored = down.slice(start, down.indexOf('$fn$', start));
    // md5 of the validated 015 definition (also pinned by the 015 postcheck and the 017 guard).
    expect(createHash('md5').update(restored).digest('hex')).toBe('da2088a4bb82bffb90ccd632d6108dde');
  });
});
