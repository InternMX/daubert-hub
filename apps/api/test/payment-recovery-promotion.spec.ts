import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const requireLocal = createRequire(__filename);
const { verifySql } = requireLocal('../../../scripts/n8n/verify-payment-recovery-promotion.cjs');
const { build } = requireLocal('../../../scripts/n8n/build-payment-recovery-prod.cjs');

describe('payment recovery production preparation', () => {
  it('keeps all six approved SQL bodies and restores the two original bodies without deleting evidence', () => {
    expect(verifySql(path.resolve(__dirname, '../../..'))).toEqual({ approvedTestFunctionBodiesEqual: 6, previousFunctionBodiesRestored: 2 });
  });
  it('refuses a TEST export or a changed live export before preparing production artifacts', () => {
    expect(() => build(Buffer.from(JSON.stringify({ id: 'pnRecoveryParentTest01' })))).toThrow(/source drift/i);
    expect(() => build(Buffer.from(JSON.stringify({ id: 'pagosProdAsignaciones01', nodes: [] })))).toThrow(/source drift/i);
  });
});
