import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { build } = createRequire(__filename)('../../../scripts/n8n/build-payment-recovery-test.cjs');
const credential = { postgres: { id: 'pgTestAisladoCred01', name: 'Postgres pruebas (n8n_app_test)' } };
function input() {
  return { id: 'pnHarnessReproc00001', nodes: [
    { name: 'Reprocesar correo manual', type: 'n8n-nodes-base.manualTrigger' },
    { name: 'Seleccionar correo a reprocesar', type: 'n8n-nodes-base.set' },
    { name: 'Preparar correo para reproceso', type: 'n8n-nodes-base.postgres', credentials: credential },
    { name: 'Aplicar toma de archivo', type: 'n8n-nodes-base.code' },
    { name: 'Verificar duplicados', type: 'n8n-nodes-base.code' }
  ], connections: { 'Aplicar toma de archivo': { main: [[{ node: 'Verificar duplicados', type: 'main', index: 0 }]] } } };
}

describe('isolated payment recovery workflow', () => {
  it('does not release ownership on a child error, timeout or partial output', () => {
    const { wrapper, body } = build(input(), '123');
    const call = wrapper.nodes.find((node: { name: string }) => node.name === 'Procesar y esperar');
    expect(call.parameters.options.waitForSubWorkflow).toBe(true);
    expect(call.onError).toBeUndefined();
    expect(wrapper.connections['Procesar y esperar'].main[0][0].node).toBe('Confirmar fin y rehabilitar');
    expect(body.nodes.filter((node: { type: string }) => /manualTrigger|scheduleTrigger|webhook$/.test(node.type))).toEqual([]);
    expect(body.connections['Aplicar toma de archivo'].main[0][0].node).toBe('Registrar evidencia sin efectos');
  });
  it('rejects production workflow IDs, external effects and other credentials before generating files', () => {
    expect(() => build({ ...input(), id: 'pagosProdAsignaciones01' }, '44')).toThrow();
    for (const type of ['n8n-nodes-base.microsoftOutlook', 'n8n-nodes-base.httpRequest']) {
      expect(() => build({ ...input(), nodes: [...input().nodes, { type }] }, '123')).toThrow();
    }
    expect(() => build({ ...input(), nodes: [{ type: 'n8n-nodes-base.postgres', credentials: { postgres: { id: 'prod' } } }] }, '123')).toThrow();
  });
});
