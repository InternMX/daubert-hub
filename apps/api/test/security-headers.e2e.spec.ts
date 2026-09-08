import { Controller, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import helmet from 'helmet';

@Controller('health')
class TestHealthController {
  @Get()
  getHealth(): { status: 'ok' } {
    return { status: 'ok' };
  }
}

// Mirrors the helmet() call in src/main.ts — see the comment there for why
// CSP is locked down and HSTS stays off.
function applyProductionHeaders(app: INestApplication): void {
  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    hsts: false
  }));
}

describe('HTTP security headers', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const module = await Test.createTestingModule({ controllers: [TestHealthController] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    applyProductionHeaders(app);
    await app.init();
  });

  afterEach(async () => app.close());

  it('sets X-Content-Type-Options: nosniff', async () => {
    const response = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets frame protection (X-Frame-Options)', async () => {
    const response = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('sets a restrictive Referrer-Policy', async () => {
    const response = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(response.headers['referrer-policy']).toBeTruthy();
    expect(response.headers['referrer-policy']).not.toBe('unsafe-url');
  });

  it('sets a locked-down Content-Security-Policy for this JSON-only API', async () => {
    const response = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('does NOT set Strict-Transport-Security in this local HTTP TEST deployment', async () => {
    const response = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(response.headers['strict-transport-security']).toBeUndefined();
  });

  it('removes the X-Powered-By header', async () => {
    const response = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('leaves ordinary health/business behavior unchanged', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200, { status: 'ok' });
  });
});
