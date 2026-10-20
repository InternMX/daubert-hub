import { describe, expect, it, vi } from 'vitest';
import { isIsolatedN8nTestTarget } from '../src/automations/payment-notifications/payment-file-n8n-target';
import { PaymentFileAssignmentsRepository } from '../src/automations/payment-notifications/payment-file-assignments.repository';
import { PaymentFileAssignmentsService } from '../src/automations/payment-notifications/payment-file-assignments.service';
import { validateEnvironment } from '../src/config/environment';

const identity = { userId: '42', userEmail: 'actor@example.test' };
const TEST_ORIGIN = 'http://127.0.0.1:5690';
const TEST_WEBHOOK = 'http://127.0.0.1:5690/webhook/daubert-hub-test-aislado/notificaciones-pago/reprocesar';
const PROD_WEBHOOK = 'http://127.0.0.1:5678/webhook/daubert-hub/notificaciones-pago/reprocesar';

describe('isolated n8n TEST target guard', () => {
  it.each([
    ['the isolated TEST origin and its own webhook path', TEST_WEBHOOK, TEST_ORIGIN, true],
    ['host.docker.internal on the isolated port', 'http://host.docker.internal:5690/webhook/x/reprocesar', 'http://host.docker.internal:5690', true],
    ['the production n8n port', PROD_WEBHOOK, 'http://127.0.0.1:5678', false],
    ['a webhook whose origin differs from the configured TEST origin', PROD_WEBHOOK, TEST_ORIGIN, false],
    ['the production webhook path even on the TEST port', 'http://127.0.0.1:5690/webhook/daubert-hub/notificaciones-pago/reprocesar', TEST_ORIGIN, false],
    ['a non-loopback host', 'http://n8n.example.test:5690/webhook/x/reprocesar', 'http://n8n.example.test:5690', false],
    ['an origin without an explicit port', 'http://127.0.0.1/webhook/x/reprocesar', 'http://127.0.0.1', false],
    ['a missing webhook', null, TEST_ORIGIN, false],
    ['a missing TEST origin', TEST_WEBHOOK, null, false],
    ['an invalid URL', 'not a url', TEST_ORIGIN, false],
    ['a non-http protocol', 'ftp://127.0.0.1:5690/x', 'ftp://127.0.0.1:5690', false]
  ])('%s -> %s', (_name, webhook, origin, expected) => {
    expect(isIsolatedN8nTestTarget(webhook as never, origin as never)).toBe(expected);
  });
});

describe('PaymentFileAssignmentsService.isN8nReady', () => {
  const build = (overrides: Record<string, unknown> = {}) => {
    const values: Record<string, unknown> = {
      database: { name: 'daubert_hub_test' }, paymentFileAssignmentsTestEnabled: true, paymentFileAssignmentsN8nReady: true,
      paymentFileAssignmentsN8nTestOrigin: TEST_ORIGIN, paymentNotificationsWebhooks: { reprocessWebhookUrl: TEST_WEBHOOK, webhookToken: 't' }, ...overrides
    };
    return new PaymentFileAssignmentsService({} as never, { get: (key: string) => values[key] } as never);
  };
  it('is ready only with TEST database, the feature, the READY flag and the isolated webhook', () => {
    expect(build().isN8nReady()).toBe(true);
  });
  it.each([
    ['production database', { database: { name: 'daubert_global' } }],
    ['feature disabled', { paymentFileAssignmentsTestEnabled: false }],
    ['READY flag off', { paymentFileAssignmentsN8nReady: false }],
    ['READY flag undefined', { paymentFileAssignmentsN8nReady: undefined }],
    ['webhook of the shared/production n8n', { paymentNotificationsWebhooks: { reprocessWebhookUrl: PROD_WEBHOOK, webhookToken: 't' } }],
    ['webhook not configured', { paymentNotificationsWebhooks: { reprocessWebhookUrl: null, webhookToken: null } }],
    ['TEST origin not configured', { paymentFileAssignmentsN8nTestOrigin: null }]
  ])('is NOT ready with %s', (_name, override) => {
    expect(build(override).isN8nReady()).toBe(false);
  });
  it('reports n8nReady on every file state only when ready (and never when the feature is disabled)', async () => {
    const database = { query: vi.fn().mockResolvedValueOnce([{ available: true }]).mockResolvedValueOnce([]) };
    const values = { database: { name: 'daubert_hub_test' }, paymentFileAssignmentsTestEnabled: true, paymentFileAssignmentsN8nReady: true, paymentFileAssignmentsN8nTestOrigin: TEST_ORIGIN, paymentNotificationsWebhooks: { reprocessWebhookUrl: TEST_WEBHOOK } } as Record<string, unknown>;
    const service = new PaymentFileAssignmentsService(new PaymentFileAssignmentsRepository(database as never), { get: (key: string) => values[key] } as never);
    const file = { fileName: 'a.pdf', fileHash: 'a'.repeat(64), errorCode: 'ALIAS_NO_CATALOGADO', detail: 'A' };
    await expect(service.describe('1', [file])).resolves.toEqual([expect.objectContaining({ n8nReady: true })]);
    const disabled = new PaymentFileAssignmentsRepository({ query: vi.fn().mockResolvedValueOnce([{ available: true }]).mockResolvedValueOnce([]) } as never);
    await expect(disabled.describe('1', [file], false, true, true)).resolves.toEqual([expect.objectContaining({ n8nReady: false })]);
  });
});

describe('protectReprocess with the database eligibility (migration 014)', () => {
  function harness(eligibility: unknown) {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('fn_reproceso_asignaciones_puntuales')) {
        if (eligibility instanceof Error) throw eligibility;
        return { rows: eligibility === undefined ? [] : [eligibility] };
      }
      return { rows: [] };
    });
    const client = { query, release: vi.fn() };
    const repo = new PaymentFileAssignmentsRepository({ query: vi.fn().mockResolvedValue([{ available: true }]), connect: vi.fn().mockResolvedValue(client) } as never);
    return { repo, query };
  }
  it('dispatches only when the database says eligible, after freezing the files and committing', async () => {
    const { repo, query } = harness({ elegible: true });
    const dispatch = vi.fn(async () => { expect(query).toHaveBeenCalledWith('COMMIT'); return 'ok'; });
    await expect(repo.protectReprocess('1', 'r', identity, dispatch, true)).resolves.toBe('ok');
    expect(query).toHaveBeenCalledWith('SELECT core.fn_bloquear_archivos_reproceso_pago($1)', ['1']);
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining("a.estatus = 'ACTIVA' LIMIT 1"), expect.anything());
  });
  it.each([
    ['not eligible', { elegible: false }, 'POINT_FILE_REPROCESS_BLOCKED'],
    ['unknown (null) verdict', { elegible: null }, 'POINT_FILE_REPROCESS_BLOCKED'],
    ['unexpected shape', { otro: 1 }, 'POINT_FILE_REPROCESS_BLOCKED'],
    ['no row', undefined, 'POINT_FILE_REPROCESS_BLOCKED'],
    ['missing/failing function', new Error('function does not exist'), 'POINT_FILE_ELIGIBILITY_UNAVAILABLE']
  ])('stays blocked and never dispatches or freezes on %s', async (_name, eligibility, code) => {
    const { repo, query } = harness(eligibility);
    const dispatch = vi.fn();
    await expect(repo.protectReprocess('1', 'r', identity, dispatch, true)).rejects.toMatchObject({ response: { code } });
    expect(dispatch).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(query).not.toHaveBeenCalledWith('SELECT core.fn_bloquear_archivos_reproceso_pago($1)', expect.anything());
    expect(query).not.toHaveBeenCalledWith('COMMIT');
  });
  it('keeps blocking every active assignment when the integration is not ready', async () => {
    const query = vi.fn(async (sql: string) => ({ rows: sql.includes("a.estatus = 'ACTIVA'") ? [{}] : [] }));
    const repo = new PaymentFileAssignmentsRepository({ query: vi.fn().mockResolvedValue([{ available: true }]), connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }) } as never);
    await expect(repo.protectReprocess('1', 'r', identity, vi.fn(), false)).rejects.toMatchObject({ response: { code: 'POINT_FILE_N8N_NOT_READY' } });
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining('fn_reproceso_asignaciones_puntuales'), expect.anything());
  });
});

describe('reprocessBlockedCorreoIds with the database eligibility', () => {
  const build = (eligibilityQuery: () => Promise<unknown>) => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('available')) return [{ available: true }];
      if (sql.includes('fn_reproceso_asignaciones_puntuales')) return eligibilityQuery();
      return [{ id: '1' }, { id: '2' }];
    });
    return { repo: new PaymentFileAssignmentsRepository({ query } as never), query };
  };
  it('returns only the correos the database marks as not eligible', async () => {
    const { repo } = build(async () => [{ id: '2' }]);
    await expect(repo.reprocessBlockedCorreoIds(['1', '2'], true)).resolves.toEqual(['2']);
  });
  it('falls back to blocking every correo with an active assignment when the function fails', async () => {
    const { repo } = build(async () => { throw new Error('function does not exist'); });
    await expect(repo.reprocessBlockedCorreoIds(['1', '2'], true)).resolves.toEqual(['1', '2']);
  });
  it('without the integration every active assignment blocks and the function is never called', async () => {
    const { repo, query } = build(async () => []);
    await expect(repo.reprocessBlockedCorreoIds(['1', '2'], false)).resolves.toEqual(['1', '2']);
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining('fn_reproceso_asignaciones_puntuales'), expect.anything());
  });
});

describe('environment', () => {
  const base = { DB_HOST: 'h', DB_PORT: '5432', DB_NAME: 'n', DB_USER: 'u', DB_PASSWORD: 'p' };
  it('defaults to not ready with no TEST origin and validates the flag', () => {
    const config = validateEnvironment(base);
    expect(config.paymentFileAssignmentsN8nReady).toBe(false);
    expect(config.paymentFileAssignmentsN8nTestOrigin).toBeNull();
    expect(() => validateEnvironment({ ...base, PAYMENT_FILE_ASSIGNMENTS_N8N_READY: 'maybe' })).toThrow();
    expect(validateEnvironment({ ...base, PAYMENT_FILE_ASSIGNMENTS_N8N_READY: 'true', PAYMENT_FILE_ASSIGNMENTS_N8N_TEST_ORIGIN: ` ${TEST_ORIGIN} ` })).toMatchObject({ paymentFileAssignmentsN8nReady: true, paymentFileAssignmentsN8nTestOrigin: TEST_ORIGIN });
  });
});
