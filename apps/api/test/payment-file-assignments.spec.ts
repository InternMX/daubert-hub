import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it, vi } from 'vitest';
import { PaymentFileAssignmentDto } from '../src/automations/payment-notifications/dto/payment-file-assignment.dto';
import { describePointFile, PaymentFileAssignmentsRepository, type RegisteredPaymentFile } from '../src/automations/payment-notifications/payment-file-assignments.repository';
import { PaymentFileAssignmentsService } from '../src/automations/payment-notifications/payment-file-assignments.service';
import { validateEnvironment } from '../src/config/environment';

const file = { fileName: 'test.pdf', fileHash: 'a'.repeat(64), errorCode: 'ALIAS_NO_CATALOGADO', detail: 'TEST' };
const registered: RegisteredPaymentFile = { fileId: '9007199254740993', fileHash: file.fileHash, fileName: file.fileName, errorCode: file.errorCode,
  identityState: 'VERIFICADA', operationalState: 'SIN_EFECTOS', safe: true, companyId: null, companyName: null, status: null, version: null, updatedAt: null };
const identity = { userId: '42', userEmail: 'actor@example.test' };

describe('trusted file mapping', () => {
  it('does not manufacture an identity for historical errors', () => {
    expect(describePointFile(file, [file], [])).toMatchObject({ fileId: null, canManage: false });
  });
  it('accepts only one registered occurrence and one corresponding persisted error', () => {
    expect(describePointFile(file, [file], [registered])).toMatchObject({ fileId: registered.fileId, canManage: true, n8nReady: false });
    expect(describePointFile(file, [file, file], [registered]).canManage).toBe(false);
    expect(describePointFile(file, [file], [registered, { ...registered, fileId: '2' }]).canManage).toBe(false);
  });
  it.each([
    { identityState: 'AMBIGUA' }, { identityState: 'NO_VERIFICADA' }, { operationalState: 'INCIERTO' },
    { operationalState: 'INICIADO' }, { operationalState: 'REPROCESO_SOLICITADO' }, { safe: false }, { errorCode: 'DIFFERENT' }
  ])('blocks unsafe or uncorrelated state %#', (change) => {
    expect(describePointFile(file, [file], [{ ...registered, ...change }]).canManage).toBe(false);
  });
  it('retains an assignment read-only when operations are blocked', () => {
    expect(describePointFile(file, [file], [{ ...registered, operationalState: 'INICIADO', safe: false, status: 'ACTIVA', companyId: '121', companyName: 'TEST COMPANY', version: 3, updatedAt: 'v3' }])).toMatchObject({ canManage: false, assignment: { status: 'ACTIVA', version: 3 } });
  });
});

describe('point assignment backend enablement', () => {
  it.each([['daubert_global', true], ['other_database', true], ['daubert_hub_test', false]])('refuses mutations in %s (flag=%s)', async (database, flag) => {
    const repository = { mutate: vi.fn() };
    const config = { get: (key: string) => key === 'database' ? { name: database } : flag };
    const service = new PaymentFileAssignmentsService(repository as never, config as never);
    await expect(service.mutate('1', '2', { action: 'ASSIGN', companyId: '3', confirmed: true, expectedVersion: 0 }, 'req', identity)).rejects.toMatchObject({ status: 403 });
    expect(repository.mutate).not.toHaveBeenCalled();
  });
  it('allows only explicit TEST activation and still delegates live destination checks to persistence', async () => {
    const repository = { mutate: vi.fn().mockResolvedValue({ version: 1 }) };
    const service = new PaymentFileAssignmentsService(repository as never, { get: (key: string) => key === 'database' ? { name: 'daubert_hub_test' } : true } as never);
    await expect(service.mutate('1', '2', { action: 'ASSIGN', companyId: '3', confirmed: true, expectedVersion: 0 }, 'r', identity)).resolves.toMatchObject({ data: { version: 1 } });
  });
  it('defaults to disabled and validates the flag', () => {
    const env = { DB_HOST: 'test', DB_PORT: '5432', DB_NAME: 'daubert_hub_test', DB_USER: 'test', DB_PASSWORD: 'test' };
    expect(validateEnvironment(env).paymentFileAssignmentsTestEnabled).toBe(false);
    expect(() => validateEnvironment({ ...env, PAYMENT_FILE_ASSIGNMENTS_TEST_ENABLED: 'yes' })).toThrow();
  });
});

describe('point DTO', () => {
  it.each([
    { action: 'ASSIGN', expectedVersion: 0, confirmed: true },
    { action: 'REVOKE', expectedVersion: -1, confirmed: true },
    { action: 'REVOKE', expectedVersion: 1, confirmed: false },
    { action: 'ASSIGN', companyId: '3', expectedVersion: 0, confirmed: true, fileHash: 'a'.repeat(64) },
    { action: 'REGISTER', companyId: '3', expectedVersion: 0, confirmed: true }
  ])('rejects invalid requests or frontend-made identities %#', async (input) => {
    expect(await validate(plainToInstance(PaymentFileAssignmentDto, input), { whitelist: true, forbidNonWhitelisted: true })).not.toHaveLength(0);
  });
});

describe('reprocess protection', () => {
  it('keeps the existing dispatch path when the new schema is not installed', async () => {
    const connect = vi.fn();
    const repo = new PaymentFileAssignmentsRepository({ query: vi.fn().mockResolvedValue([{ available: false }]), connect } as never);
    const dispatch = vi.fn().mockResolvedValue({ status: 'TRIGGERED' });
    await expect(repo.protectReprocess('1', 'r', identity, dispatch)).resolves.toEqual({ status: 'TRIGGERED' });
    expect(connect).not.toHaveBeenCalled();
  });
  function harness(active: boolean) {
    const query = vi.fn(async (sql: string) => ({ rows: sql.includes("a.estatus = 'ACTIVA'") && active ? [{}] : [] }));
    const client = { query, release: vi.fn() };
    const repo = new PaymentFileAssignmentsRepository({ query: vi.fn().mockResolvedValue([{ available: true }]), connect: vi.fn().mockResolvedValue(client) } as never);
    return { repo, query, client };
  }
  it('never dispatches a mail with an active point assignment', async () => {
    const { repo, query } = harness(true);
    const dispatch = vi.fn();
    await expect(repo.protectReprocess('1', 'r', identity, dispatch)).rejects.toMatchObject({ response: { code: 'POINT_FILE_N8N_NOT_READY' } });
    expect(dispatch).not.toHaveBeenCalled(); expect(query).toHaveBeenCalledWith('ROLLBACK');
  });
  it('commits the freeze before dispatch and keeps it committed even if the upstream throws', async () => {
    const { repo, query } = harness(false);
    const dispatch = vi.fn(async () => { expect(query).toHaveBeenCalledWith('COMMIT'); throw new Error('uncertain upstream'); });
    await expect(repo.protectReprocess('1', 'r', identity, dispatch)).rejects.toThrow('uncertain upstream');
    expect(query).toHaveBeenCalledWith('SELECT core.fn_bloquear_archivos_reproceso_pago($1)', ['1']);
    expect(query).not.toHaveBeenCalledWith('ROLLBACK');
  });
});

describe('compatibility with a database without migration 012 (PROD)', () => {
  const build = (database: string, flag: boolean) => {
    const db = { query: vi.fn().mockRejectedValue(new Error('no query expected')), connect: vi.fn() };
    const repo = new PaymentFileAssignmentsRepository(db as never);
    const config = { get: (key: string) => key === 'database' ? { name: database } : flag };
    return { db, service: new PaymentFileAssignmentsService(repo, config as never) };
  };
  it.each([['daubert_global', false], ['daubert_global', true]])('never queries or connects to the new tables in %s (flag=%s)', async (database, flag) => {
    const { db, service } = build(database, flag);
    await expect(service.describe('1', [file])).resolves.toEqual([expect.objectContaining({ enabled: false, canManage: false, assignment: null })]);
    await expect(service.reprocessBlockedCorreoIds(['1'])).resolves.toEqual([]);
    const dispatch = vi.fn().mockResolvedValue('ok');
    await expect(service.protectReprocess('1', 'r', identity, dispatch)).resolves.toBe('ok');
    expect(db.query).not.toHaveBeenCalled();
    expect(db.connect).not.toHaveBeenCalled();
  });
  it('still tolerates missing tables in TEST with the flag off', async () => {
    const db = { query: vi.fn().mockResolvedValue([{ available: false }]), connect: vi.fn() };
    const config = { get: (key: string) => key === 'database' ? { name: 'daubert_hub_test' } : false };
    const service = new PaymentFileAssignmentsService(new PaymentFileAssignmentsRepository(db as never), config as never);
    await expect(service.describe('1', [file])).resolves.toEqual([expect.objectContaining({ enabled: false, canManage: false })]);
  });
});
