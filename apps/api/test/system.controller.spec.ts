import type { INestApplication } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthGuard } from '../src/security/auth.guard';
import { IS_PUBLIC_KEY } from '../src/security/route-access.decorators';
import { SystemController } from '../src/system/system.controller';
import { SystemStatusService } from '../src/system/system-status.service';

const payload = { status: 'operational', n8n: { status: 'UP', latencyMs: 42, checkedAt: '2026-01-01T00:00:00.000Z' } };

describe('SystemController', () => {
  it('delegates to the service with no parameters', async () => {
    const getStatus = vi.fn().mockResolvedValue(payload);
    await expect(new SystemController({ getStatus } as never).getStatus()).resolves.toEqual(payload);
    expect(getStatus).toHaveBeenCalledWith();
  });

  it('is not marked @Public()', () => {
    const reflector = new Reflector();
    expect(reflector.getAllAndOverride(IS_PUBLIC_KEY, [SystemController.prototype.getStatus, SystemController])).toBeUndefined();
  });
});

describe('GET /api/system/status authentication', () => {
  // Vitest (esbuild) does not emit decorator metadata, so declare the constructor dependency
  // Nest would otherwise read from it.
  Reflect.defineMetadata('design:paramtypes', [SystemStatusService], SystemController);

  let app: INestApplication;
  const resolveActiveSession = vi.fn();

  async function boot() {
    const module = await Test.createTestingModule({
      controllers: [SystemController],
      providers: [
        { provide: SystemStatusService, useValue: { getStatus: vi.fn().mockResolvedValue(payload) } },
        { provide: APP_GUARD, useValue: new AuthGuard(new Reflector(), { resolveActiveSession } as never) }
      ]
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  }

  afterEach(async () => {
    resolveActiveSession.mockReset();
    await app.close();
  });

  it('rejects an unauthenticated request with 401 and does not report status', async () => {
    await boot();
    const response = await request(app.getHttpServer()).get('/api/system/status').expect(401);
    expect(response.body).not.toHaveProperty('n8n');
  });

  it('serves the status to a request with a valid session', async () => {
    resolveActiveSession.mockResolvedValue({ user: { id: '1' } });
    await boot();
    const response = await request(app.getHttpServer()).get('/api/system/status').set('Cookie', ['daubert_session=token']).expect(200);
    expect(response.body).toEqual(payload);
  });
});
