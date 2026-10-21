import { describe, expect, it, vi } from 'vitest';
import { AUTHORIZED_N8N_TEST_TARGETS, isIsolatedN8nTestTarget } from '../src/automations/payment-notifications/payment-file-n8n-target';
import { PaymentFileAssignmentsRepository } from '../src/automations/payment-notifications/payment-file-assignments.repository';
import { PaymentFileAssignmentsService } from '../src/automations/payment-notifications/payment-file-assignments.service';
import { validateEnvironment } from '../src/config/environment';

const identity = { userId: '42', userEmail: 'actor@example.test' };
const TEST_PATH = '/webhook/daubert-hub-test/notificaciones-pago/reprocesar';
const PROD_PATH = '/webhook/daubert-hub/notificaciones-pago/reprocesar';
const DOCKER_ORIGIN = 'http://host.docker.internal:5678';
const WINDOWS_ORIGIN = 'http://127.0.0.1:5678';
const LEGACY_ORIGIN = 'http://127.0.0.1:5690';
const LEGACY_PATH = '/webhook/daubert-hub-test-aislado/notificaciones-pago/reprocesar';
const TEST_ORIGIN = DOCKER_ORIGIN;
const TEST_WEBHOOK = DOCKER_ORIGIN + TEST_PATH;
const PROD_WEBHOOK = DOCKER_ORIGIN + PROD_PATH;

describe('n8n TEST target guard (closed list of exact targets)', () => {
  it('lists only TEST targets and none of them is the production webhook', () => {
    expect(AUTHORIZED_N8N_TEST_TARGETS.map((target) => target.path)).toEqual([TEST_PATH, LEGACY_PATH]);
    expect(AUTHORIZED_N8N_TEST_TARGETS.every((target) => !target.path.includes('/daubert-hub/'))).toBe(true);
  });

  it.each([
    ['Hub in Docker -> shared Windows n8n (host.docker.internal)', DOCKER_ORIGIN + TEST_PATH, DOCKER_ORIGIN, true],
    ['Hub as a Windows process -> 127.0.0.1', WINDOWS_ORIGIN + TEST_PATH, WINDOWS_ORIGIN, true],
    ['Hub as a Windows process -> localhost', 'http://localhost:5678' + TEST_PATH, 'http://localhost:5678', true],
    ['temporary isolated n8n on 127.0.0.1:5690', LEGACY_ORIGIN + LEGACY_PATH, LEGACY_ORIGIN, true],
    ['temporary isolated n8n through host.docker.internal:5690', 'http://host.docker.internal:5690' + LEGACY_PATH, 'http://host.docker.internal:5690', true],
    ['the production webhook on the shared n8n (Docker host)', DOCKER_ORIGIN + PROD_PATH, DOCKER_ORIGIN, false],
    ['the production webhook on the shared n8n (Windows host)', WINDOWS_ORIGIN + PROD_PATH, WINDOWS_ORIGIN, false],
    ['the production webhook path on the isolated port', LEGACY_ORIGIN + PROD_PATH, LEGACY_ORIGIN, false],
    ['the n8n test-listener path (/webhook-test/)', DOCKER_ORIGIN + TEST_PATH.replace('/webhook/', '/webhook-test/'), DOCKER_ORIGIN, false],
    ['a path traversal that normalizes to the production webhook', DOCKER_ORIGIN + '/webhook/daubert-hub-test/../daubert-hub/notificaciones-pago/reprocesar', DOCKER_ORIGIN, false],
    ['an encoded path traversal', DOCKER_ORIGIN + '/webhook/daubert-hub-test/%2e%2e/daubert-hub/notificaciones-pago/reprocesar', DOCKER_ORIGIN, false],
    ['a path with a trailing slash', DOCKER_ORIGIN + TEST_PATH + '/', DOCKER_ORIGIN, false],
    ['a path with different letter case', DOCKER_ORIGIN + TEST_PATH.toUpperCase(), DOCKER_ORIGIN, false],
    ['a look-alike prefix', DOCKER_ORIGIN + '/webhook/daubert-hub-testing/notificaciones-pago/reprocesar', DOCKER_ORIGIN, false],
    ['an extra path segment', DOCKER_ORIGIN + TEST_PATH + '/otro', DOCKER_ORIGIN, false],
    ['a different last segment', DOCKER_ORIGIN + '/webhook/daubert-hub-test/notificaciones-pago/ejecutar', DOCKER_ORIGIN, false],
    ['the TEST path of the isolated n8n on the shared port', DOCKER_ORIGIN + LEGACY_PATH, DOCKER_ORIGIN, false],
    ['the shared-n8n TEST path on the isolated port', LEGACY_ORIGIN + TEST_PATH, LEGACY_ORIGIN, false],
    ['a query string', DOCKER_ORIGIN + TEST_PATH + '?x=1', DOCKER_ORIGIN, false],
    ['a fragment', DOCKER_ORIGIN + TEST_PATH + '#x', DOCKER_ORIGIN, false],
    ['credentials in the URL', 'http://user:pass@host.docker.internal:5678' + TEST_PATH, DOCKER_ORIGIN, false],
    ['https', 'https://host.docker.internal:5678' + TEST_PATH, 'https://host.docker.internal:5678', false],
    ['a host that is not authorized', 'http://n8n.example.test:5678' + TEST_PATH, 'http://n8n.example.test:5678', false],
    ['a look-alike host', 'http://host.docker.internal.evil.test:5678' + TEST_PATH, 'http://host.docker.internal.evil.test:5678', false],
    ['a LAN address', 'http://192.168.1.10:5678' + TEST_PATH, 'http://192.168.1.10:5678', false],
    ['0.0.0.0', 'http://0.0.0.0:5678' + TEST_PATH, 'http://0.0.0.0:5678', false],
    ['an unauthorized port', 'http://host.docker.internal:5679' + TEST_PATH, 'http://host.docker.internal:5679', false],
    ['the default port (not explicit)', 'http://host.docker.internal' + TEST_PATH, 'http://host.docker.internal', false],
    ['a configured origin that differs from the webhook origin', DOCKER_ORIGIN + TEST_PATH, WINDOWS_ORIGIN, false],
    ['a configured origin that carries a path', DOCKER_ORIGIN + TEST_PATH, DOCKER_ORIGIN + '/webhook', false],
    ['a missing webhook', null, TEST_ORIGIN, false],
    ['a missing TEST origin', TEST_WEBHOOK, null, false],
    ['an invalid URL', 'not a url', TEST_ORIGIN, false],
    ['a non-http protocol', 'ftp://host.docker.internal:5678' + TEST_PATH, 'ftp://host.docker.internal:5678', false]
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
  it('is ready only with TEST database, the feature, the READY flag, the webhook token and an authorized TEST webhook', () => {
    expect(build().isN8nReady()).toBe(true);
    expect(build({ paymentFileAssignmentsN8nTestOrigin: WINDOWS_ORIGIN, paymentNotificationsWebhooks: { reprocessWebhookUrl: WINDOWS_ORIGIN + TEST_PATH, webhookToken: 't' } }).isN8nReady()).toBe(true);
  });
  it.each([
    ['production database', { database: { name: 'daubert_global' } }],
    ['production database even with every flag on', { database: { name: 'daubert_global' }, paymentFileAssignmentsTestEnabled: true, paymentFileAssignmentsN8nReady: true }],
    ['feature disabled', { paymentFileAssignmentsTestEnabled: false }],
    ['READY flag off', { paymentFileAssignmentsN8nReady: false }],
    ['READY flag undefined', { paymentFileAssignmentsN8nReady: undefined }],
    ['the production webhook on the shared n8n', { paymentNotificationsWebhooks: { reprocessWebhookUrl: PROD_WEBHOOK, webhookToken: 't' } }],
    ['webhook not configured', { paymentNotificationsWebhooks: { reprocessWebhookUrl: null, webhookToken: null } }],
    ['webhook token missing', { paymentNotificationsWebhooks: { reprocessWebhookUrl: TEST_WEBHOOK, webhookToken: null } }],
    ['webhook token empty', { paymentNotificationsWebhooks: { reprocessWebhookUrl: TEST_WEBHOOK, webhookToken: '' } }],
    ['TEST origin not configured', { paymentFileAssignmentsN8nTestOrigin: null }],
    ['localhost inside Docker pointing at a different origin than configured', { paymentFileAssignmentsN8nTestOrigin: 'http://localhost:5678' }]
  ])('is NOT ready with %s', (_name, override) => {
    expect(build(override).isN8nReady()).toBe(false);
  });
  it('reports n8nReady on every file state only when ready (and never when the feature is disabled)', async () => {
    const database = { query: vi.fn().mockResolvedValueOnce([{ available: true }]).mockResolvedValueOnce([]) };
    const values = { database: { name: 'daubert_hub_test' }, paymentFileAssignmentsTestEnabled: true, paymentFileAssignmentsN8nReady: true, paymentFileAssignmentsN8nTestOrigin: TEST_ORIGIN, paymentNotificationsWebhooks: { reprocessWebhookUrl: TEST_WEBHOOK, webhookToken: 't' } } as Record<string, unknown>;
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
