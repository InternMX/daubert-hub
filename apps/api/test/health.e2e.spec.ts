import { Controller, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SafeExceptionFilter } from '../src/common/http-exception.filter';
let connected = true;

@Controller('health')
class TestHealthController {
  @Get()
  getHealth(): { status: 'ok'; database: 'connected' | 'unavailable' } {
    return { status: 'ok', database: connected ? 'connected' : 'unavailable' };
  }
}

@Controller('failure')
class FailureController {
  @Get()
  fail(): never {
    throw new Error('postgres://user:password@host/daubert_global SELECT secret');
  }
}

describe('health endpoint', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const module = await Test.createTestingModule({ controllers: [TestHealthController, FailureController] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new SafeExceptionFilter());
    await app.init();
  });

  afterEach(async () => app.close());

  it('returns the healthy API and database result without credentials', async () => {
    connected = true;
    const response = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(response.body).toEqual({ status: 'ok', database: 'connected' });
    expect(JSON.stringify(response.body)).not.toContain('password');
  });

  it('explicitly reports an unavailable database', async () => {
    connected = false;
    await request(app.getHttpServer()).get('/api/health').expect(200, { status: 'ok', database: 'unavailable' });
  });

  it('does not leak internal errors or connection strings', async () => {
    const response = await request(app.getHttpServer()).get('/api/failure').expect(500);
    expect(response.body).toEqual({ statusCode: 500, message: 'Error interno del servidor.' });
    expect(JSON.stringify(response.body)).not.toContain('postgres');
    expect(JSON.stringify(response.body)).not.toContain('password');
  });
});
