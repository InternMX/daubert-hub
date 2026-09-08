import { Controller, Get, HttpCode, HttpStatus, Inject, Injectable, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SafeExceptionFilter } from '../src/common/http-exception.filter';
import { CsrfOriginGuard } from '../src/security/csrf-origin.guard';

// Proves guard ordering: CsrfOriginGuard must reject a cross-site/foreign-
// origin unsafe request BEFORE any handler or downstream service code runs
// — no expensive work (here, simulated by MutationSpy) happens on a request
// this guard rejects.
@Injectable()
class MutationSpy {
  calls = 0;
  mutate(): { mutated: true } {
    this.calls += 1;
    return { mutated: true };
  }
}

@Controller()
class SpyController {
  constructor(@Inject(MutationSpy) private readonly spy: MutationSpy) {}

  @Get('probe')
  probe(): { ok: true } {
    return { ok: true };
  }

  @Post('probe')
  @HttpCode(HttpStatus.OK)
  mutate(): { mutated: true } {
    return this.spy.mutate();
  }
}

describe('CsrfOriginGuard (e2e, real Nest guard pipeline)', () => {
  let app: INestApplication;
  let spy: MutationSpy;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [SpyController],
      providers: [MutationSpy, { provide: APP_GUARD, useClass: CsrfOriginGuard }]
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new SafeExceptionFilter());
    await app.init();
    spy = module.get(MutationSpy);
  });

  afterEach(async () => app.close());

  it('GET is never affected by CSRF headers', async () => {
    await request(app.getHttpServer()).get('/api/probe').set('Origin', 'https://evil.example').expect(200, { ok: true });
  });

  it('a same-origin POST reaches the handler and the downstream service', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/probe')
      .set('Host', 'app.example.test')
      .set('Origin', 'https://app.example.test')
      .send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ mutated: true });
    expect(spy.calls).toBe(1);
  });

  it('a foreign-Origin POST is rejected with 403 CSRF_ORIGIN_NOT_ALLOWED BEFORE the handler/service runs', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/probe')
      .set('Host', 'app.example.test')
      .set('Origin', 'https://evil.example')
      .send({});

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ statusCode: 403, message: 'El origen de la solicitud no está permitido.', code: 'CSRF_ORIGIN_NOT_ALLOWED' });
    expect(spy.calls).toBe(0);
  });

  it('a Sec-Fetch-Site: cross-site POST is rejected BEFORE the handler/service runs, even with no Origin', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/probe')
      .set('Host', 'app.example.test')
      .set('Sec-Fetch-Site', 'cross-site')
      .send({});

    expect(response.status).toBe(403);
    expect(spy.calls).toBe(0);
  });

  it('a POST with neither Origin nor Sec-Fetch-Site (non-browser client) reaches the handler', async () => {
    const response = await request(app.getHttpServer()).post('/api/probe').set('Host', 'app.example.test').send({});

    expect(response.status).toBe(200);
    expect(spy.calls).toBe(1);
  });

  it('does not expose internal host/proxy details in the rejection body', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/probe')
      .set('Host', 'app.example.test')
      .set('Origin', 'https://evil.example')
      .send({});

    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('app.example.test');
    expect(serialized).not.toContain('X-Forwarded');
  });
});
