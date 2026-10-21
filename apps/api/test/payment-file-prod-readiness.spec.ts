import { describe, expect, it, vi } from 'vitest';
import { AUTHORIZED_N8N_PRODUCTION_TARGETS, isIsolatedN8nTestTarget, isProductionN8nTarget } from '../src/automations/payment-notifications/payment-file-n8n-target';
import { PaymentFileAssignmentsService } from '../src/automations/payment-notifications/payment-file-assignments.service';
import { validateEnvironment } from '../src/config/environment';

const PROD_PATH = '/webhook/daubert-hub/notificaciones-pago/reprocesar';
const TEST_PATH = '/webhook/daubert-hub-test/notificaciones-pago/reprocesar';
const DOCKER = 'http://host.docker.internal:5678';

describe('PRODUCTION n8n target guard (closed list, independent of TEST)', () => {
  it('lists exactly the production Pagos webhook', () => {
    expect(AUTHORIZED_N8N_PRODUCTION_TARGETS.map((target) => target.path)).toEqual([PROD_PATH]);
  });

  it.each([
    ['Hub in Docker -> shared Windows n8n', DOCKER + PROD_PATH, DOCKER, true],
    ['Hub as a Windows process', 'http://127.0.0.1:5678' + PROD_PATH, 'http://127.0.0.1:5678', true],
    ['the TEST webhook path', DOCKER + TEST_PATH, DOCKER, false],
    ['the isolated Docker TEST path', 'http://127.0.0.1:5690/webhook/daubert-hub-test-aislado/notificaciones-pago/reprocesar', 'http://127.0.0.1:5690', false],
    ['the n8n test-listener path', DOCKER + PROD_PATH.replace('/webhook/', '/webhook-test/'), DOCKER, false],
    ['a path traversal that normalizes to the TEST path', DOCKER + '/webhook/daubert-hub/../daubert-hub-test/notificaciones-pago/reprocesar', DOCKER, false],
    ['a trailing slash', DOCKER + PROD_PATH + '/', DOCKER, false],
    ['different letter case', DOCKER + PROD_PATH.toUpperCase(), DOCKER, false],
    ['the Caterpillar webhook', DOCKER + '/webhook/cat-test-reprocess', DOCKER, false],
    ['a query string', DOCKER + PROD_PATH + '?x=1', DOCKER, false],
    ['credentials in the URL', 'http://u:p@host.docker.internal:5678' + PROD_PATH, DOCKER, false],
    ['https', 'https://host.docker.internal:5678' + PROD_PATH, 'https://host.docker.internal:5678', false],
    ['an unauthorized host', 'http://n8n.example.test:5678' + PROD_PATH, 'http://n8n.example.test:5678', false],
    ['a LAN address', 'http://192.168.1.10:5678' + PROD_PATH, 'http://192.168.1.10:5678', false],
    ['an unauthorized port', 'http://host.docker.internal:5690' + PROD_PATH, 'http://host.docker.internal:5690', false],
    ['the default port (not explicit)', 'http://host.docker.internal' + PROD_PATH, 'http://host.docker.internal', false],
    ['an origin that differs from the webhook origin', DOCKER + PROD_PATH, 'http://127.0.0.1:5678', false],
    ['an origin that carries a path', DOCKER + PROD_PATH, DOCKER + '/webhook', false],
    ['a missing webhook', null, DOCKER, false],
    ['a missing origin', DOCKER + PROD_PATH, null, false]
  ])('%s -> %s', (_name, webhook, origin, expected) => {
    expect(isProductionN8nTarget(webhook as never, origin as never)).toBe(expected);
  });

  it('the TEST guard still rejects the production webhook, so neither guard accepts the other environment', () => {
    expect(isIsolatedN8nTestTarget(DOCKER + PROD_PATH, DOCKER)).toBe(false);
    expect(isProductionN8nTarget(DOCKER + TEST_PATH, DOCKER)).toBe(false);
  });
});

describe('PaymentFileAssignmentsService per environment', () => {
  const build = (database: string, overrides: Record<string, unknown> = {}, query = vi.fn()) => {
    const values: Record<string, unknown> = {
      database: { name: database },
      paymentNotificationsWebhooks: { reprocessWebhookUrl: DOCKER + PROD_PATH, webhookToken: 't' },
      ...overrides
    };
    const repository = { describe: vi.fn().mockResolvedValue([]), reprocessBlockedCorreoIds: vi.fn().mockResolvedValue([]), protectReprocess: vi.fn().mockResolvedValue('guarded') };
    const service = new PaymentFileAssignmentsService(repository as never, { get: (key: string) => values[key] } as never);
    return { service, repository, query };
  };
  const prodOn = { paymentFileAssignmentsProdEnabled: true, paymentFileAssignmentsProdN8nReady: true, paymentFileAssignmentsProdN8nOrigin: DOCKER };

  it('PRODUCTION with every flag off behaves as before: never operational, nothing is queried and the dispatch is untouched', async () => {
    const { service, repository } = build('daubert_global');
    expect(service.isEnabled()).toBe(false);
    expect(service.isOperational()).toBe(false);
    expect(service.isN8nReady()).toBe(false);
    await expect(service.reprocessBlockedCorreoIds(['1'])).resolves.toEqual([]);
    expect(repository.reprocessBlockedCorreoIds).not.toHaveBeenCalled();
    const dispatch = vi.fn().mockResolvedValue('sent');
    await expect(service.protectReprocess('1', 'r', { userId: '1', userEmail: 'a@b.test' } as never, dispatch)).resolves.toBe('sent');
    expect(repository.protectReprocess).not.toHaveBeenCalled();
  });

  it('TEST flags never enable PRODUCTION (even with every TEST flag on and a TEST-valid origin)', () => {
    const { service } = build('daubert_global', { paymentFileAssignmentsTestEnabled: true, paymentFileAssignmentsN8nReady: true, paymentFileAssignmentsN8nTestOrigin: DOCKER,
      paymentNotificationsWebhooks: { reprocessWebhookUrl: DOCKER + TEST_PATH, webhookToken: 't' } });
    expect(service.isEnabled()).toBe(false);
    expect(service.isOperational()).toBe(false);
    expect(service.isN8nReady()).toBe(false);
  });

  it('PRODUCTION flags never enable TEST', () => {
    const { service } = build('daubert_hub_test', { ...prodOn });
    expect(service.isEnabled()).toBe(false);
    expect(service.isN8nReady()).toBe(false);
    expect(service.isOperational()).toBe(true); // the TEST database always has the migrations; the assignments themselves stay disabled
  });

  it('PRODUCTION enabled but not READY: assignments work, n8n is not ready (any active assignment keeps blocking the reprocess)', async () => {
    const { service, repository } = build('daubert_global', { paymentFileAssignmentsProdEnabled: true });
    expect(service.isEnabled()).toBe(true);
    expect(service.isOperational()).toBe(true);
    expect(service.isN8nReady()).toBe(false);
    await service.describe('1', []);
    expect(repository.describe).toHaveBeenCalledWith('1', [], true, true, false);
  });

  it('PRODUCTION READY only with the READY flag, the token and the exact production webhook on the configured production origin', () => {
    expect(build('daubert_global', prodOn).service.isN8nReady()).toBe(true);
    expect(build('daubert_global', { ...prodOn, paymentFileAssignmentsProdN8nReady: false }).service.isN8nReady()).toBe(false);
    expect(build('daubert_global', { ...prodOn, paymentFileAssignmentsProdEnabled: false }).service.isN8nReady()).toBe(false);
    expect(build('daubert_global', { ...prodOn, paymentFileAssignmentsProdN8nOrigin: null }).service.isN8nReady()).toBe(false);
    expect(build('daubert_global', { ...prodOn, paymentNotificationsWebhooks: { reprocessWebhookUrl: DOCKER + PROD_PATH, webhookToken: null } }).service.isN8nReady()).toBe(false);
    expect(build('daubert_global', { ...prodOn, paymentNotificationsWebhooks: { reprocessWebhookUrl: DOCKER + TEST_PATH, webhookToken: 't' } }).service.isN8nReady()).toBe(false);
  });

  it('any other database is never enabled or operational', () => {
    const { service } = build('otra_base', { ...prodOn, paymentFileAssignmentsTestEnabled: true, paymentFileAssignmentsN8nReady: true });
    expect(service.isEnabled()).toBe(false);
    expect(service.isOperational()).toBe(false);
    expect(service.isN8nReady()).toBe(false);
  });
});

describe('environment parsing of the production flags', () => {
  const base = { DB_HOST: 'h', DB_PORT: '5432', DB_NAME: 'daubert_global', DB_USER: 'u', DB_PASSWORD: 'p' };
  it('defaults to disabled and independent of the TEST variables', () => {
    const config = validateEnvironment(base);
    expect(config.paymentFileAssignmentsProdEnabled).toBe(false);
    expect(config.paymentFileAssignmentsProdN8nReady).toBe(false);
    expect(config.paymentFileAssignmentsProdN8nOrigin).toBeNull();
    const testOnly = validateEnvironment({ ...base, PAYMENT_FILE_ASSIGNMENTS_TEST_ENABLED: 'true', PAYMENT_FILE_ASSIGNMENTS_N8N_READY: 'true', PAYMENT_FILE_ASSIGNMENTS_N8N_TEST_ORIGIN: DOCKER });
    expect(testOnly.paymentFileAssignmentsProdEnabled).toBe(false);
    expect(testOnly.paymentFileAssignmentsProdN8nReady).toBe(false);
  });
  it('parses the production variables and rejects invalid booleans', () => {
    const config = validateEnvironment({ ...base, PAYMENT_FILE_ASSIGNMENTS_PROD_ENABLED: 'true', PAYMENT_FILE_ASSIGNMENTS_PROD_N8N_READY: 'true', PAYMENT_FILE_ASSIGNMENTS_PROD_N8N_ORIGIN: ` ${DOCKER} ` });
    expect(config).toMatchObject({ paymentFileAssignmentsProdEnabled: true, paymentFileAssignmentsProdN8nReady: true, paymentFileAssignmentsProdN8nOrigin: DOCKER });
    expect(() => validateEnvironment({ ...base, PAYMENT_FILE_ASSIGNMENTS_PROD_ENABLED: 'maybe' })).toThrow();
  });
});
