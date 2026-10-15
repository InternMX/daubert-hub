import { UnauthorizedException, type CanActivate, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudiExecutionsController } from '../src/automations/remisiones-audi/audi-executions.controller';
import { AudiExecutionsService } from '../src/automations/remisiones-audi/audi-executions.service';
import { SafeExceptionFilter } from '../src/common/http-exception.filter';
import { RolesGuard } from '../src/security/roles.guard';

// Session stand-in only; real role authorization, controller and service, no database writes.
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const role = req.headers['x-test-role'];
    if (!role) throw new UnauthorizedException();
    req.user = { role, status: 'ACTIVE', mustChangePassword: false };
    return true;
  }
}

const execution = {
  ejecucion_id: '9007199254740993', execution_state: 'COMPLETADA',
  started_at: '2026-08-27T22:39:53.204Z', finished_at: '2026-08-27T22:40:01.933Z',
  error_message: null, documento_id: '103', source_filename: 'entrada.xlsx'
};
const remission = { remision_id: '12', serie_codigo: 'REMISION_AUDI', folio: '9007199254740994', document_date: '2026-08-27', estatus: 'GENERADA' };

describe('Audi detail HTTP (mock repository, no PostgreSQL)', () => {
  let app: INestApplication;
  const repository = { findById: vi.fn(), findRemissionsByExecutionId: vi.fn() };
  const path = '/api/automations/remissions/audi/executions/';
  beforeAll(async () => {
    Reflect.defineMetadata('design:paramtypes', [AudiExecutionsService], AudiExecutionsController);
    const module = await Test.createTestingModule({
      controllers: [AudiExecutionsController],
      providers: [
        { provide: AudiExecutionsService, useValue: new AudiExecutionsService(repository as never, {} as never) },
        { provide: APP_GUARD, useClass: FakeAuthGuard },
        { provide: APP_GUARD, useFactory: (reflector: Reflector) => new RolesGuard(reflector), inject: [Reflector] }
      ]
    }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix('api'); app.useGlobalFilters(new SafeExceptionFilter());
    await app.init();
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    repository.findById.mockReset().mockImplementation(async (id: string) => id === execution.ejecucion_id ? execution : null);
    repository.findRemissionsByExecutionId.mockReset().mockResolvedValue([remission]);
  });

  it('requires authentication before reading data', async () => {
    await request(app.getHttpServer()).get(path + execution.ejecucion_id).expect(401);
    expect(repository.findById).not.toHaveBeenCalled();
  });
  it.each(['ADMIN', 'GENERAL'])('allows %s and preserves bigint identities/folios without reservations', async (role) => {
    const { body } = await request(app.getHttpServer()).get(path + execution.ejecucion_id).set('x-test-role', role).expect(200);
    expect(body.data).toMatchObject({ executionId: execution.ejecucion_id, outcome: 'COMPLETED', generatedCount: 1,
      sourceDocument: { documentId: '103', filename: 'entrada.xlsx' }, remittances: [{ folio: remission.folio, remissionId: '12', documentDate: '2026-08-27' }] });
    expect(repository.findById).toHaveBeenCalledWith(execution.ejecucion_id);
    expect(JSON.stringify(body)).not.toMatch(/pdf_path|ruta_archivo|reservations|n8n|run_name/);
  });
  it('returns 200 with empty remittances, even without source metadata or final timestamp', async () => {
    repository.findById.mockResolvedValue({ ...execution, documento_id: null, source_filename: null, finished_at: null });
    repository.findRemissionsByExecutionId.mockResolvedValue([]);
    const { body } = await request(app.getHttpServer()).get(path + execution.ejecucion_id).set('x-test-role', 'GENERAL').expect(200);
    expect(body.data).toMatchObject({ generatedCount: 0, remittances: [], sourceDocument: null, finishedAt: null });
  });
  it.each(['0', '-1', 'abc', '1.5', '01', '9223372036854775808', '1%27%20OR%201=1'])('rejects invalid id %s before querying', async (id) => {
    await request(app.getHttpServer()).get(path + id).set('x-test-role', 'GENERAL').expect(400);
    expect(repository.findById).not.toHaveBeenCalled();
  });
  it.each(['9223372036854775807', '9'])('returns 404 for missing/out-of-scope id %s, not an empty success', async (id) => {
    await request(app.getHttpServer()).get(path + id).set('x-test-role', 'GENERAL').expect(404);
    expect(repository.findRemissionsByExecutionId).not.toHaveBeenCalled();
  });
  it('shows the recorded error even when there are no remissions', async () => {
    repository.findById.mockResolvedValue({ ...execution, execution_state: 'ERROR', error_message: 'No fue posible generar el documento.' });
    repository.findRemissionsByExecutionId.mockResolvedValue([]);
    const { body } = await request(app.getHttpServer()).get(path + execution.ejecucion_id).set('x-test-role', 'GENERAL').expect(200);
    expect(body.data).toMatchObject({ outcome: 'FAILED', latestErrorMessage: 'No fue posible generar el documento.', generatedCount: 0 });
  });
  it.each(['C:\\private\\input.xlsx', 'password: secret', '{"payload":"secret"}', 'https://internal/?token=secret', 'Error\nstack trace'])('withholds unsafe diagnostic %s and source paths', async (message) => {
    repository.findById.mockResolvedValue({ ...execution, error_message: message, source_filename: 'C:\\private\\entrada.xlsx' });
    const { body } = await request(app.getHttpServer()).get(path + execution.ejecucion_id).set('x-test-role', 'GENERAL').expect(200);
    expect(body.data.sourceDocument.filename).toBe('entrada.xlsx');
    expect(body.data.latestErrorMessage).toBe('Existe un diagnóstico registrado cuyo contenido técnico no se muestra.');
    expect(JSON.stringify(body)).not.toMatch(/private|secret|internal|stack trace/);
  });
});
