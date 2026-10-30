import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { SafeExceptionFilter } from '../src/common/http-exception.filter';
import { actorDeSolicitud, DocumentsController, HistoryQueryDto } from '../src/manufacturing-documents/documents.controller';
import { AssignReviewerDto, CreateDraftDto, UpdateDraftDto, VersionDto } from '../src/manufacturing-documents/documents.dto';
import { DocumentsService } from '../src/manufacturing-documents/documents.service';
import { ManufacturingDocumentsModule } from '../src/manufacturing-documents/manufacturing-documents.module';
import { TestOnlyGuard } from '../src/manufacturing-documents/test-only.guard';
import { campoDeMensaje } from '../src/manufacturing-documents/validation-detail.filter';

// El controlador no decide permisos (los decide el servicio y la base): aquí se prueba que la IDENTIDAD solo sale de la sesión autenticada, que los DTO rechazan campos de actor y que las rutas
// validan sus identificadores. Sin base de datos (servicio simulado).
const ID = '3f1c2a52-6d0e-4d3a-9d62-0f4f0c1b7a11';
const servicio = { crearBorrador: vi.fn(), obtener: vi.fn(), actualizarBorrador: vi.fn(), finalizar: vi.fn(), descargarPdf: vi.fn(), historial: vi.fn(), listarAbiertas: vi.fn(), usuariosRevisores: vi.fn(), registrarRevision: vi.fn(), descartarBorrador: vi.fn(), asignarRevisor: vi.fn(), cancelarFinalizacion: vi.fn(), crearRevisionNueva: vi.fn() };
let app: INestApplication;
let conSesion = true;

beforeAll(async () => {
  // esbuild (vitest) no emite metadata de decoradores: se declara a mano lo que Nest toma de los tipos (inyección y DTO del ValidationPipe).
  const tipos: Record<string, unknown[]> = { reviewers: [Object], open: [Object], history: [HistoryQueryDto, Object], createDraft: [CreateDraftDto, Object], get: [String, Object], update: [String, UpdateDraftDto, Object], discard: [String, VersionDto, Object], assignReviewer: [String, AssignReviewerDto, Object], review: [String, VersionDto, Object], finalize: [String, VersionDto, Object], cancelFinalization: [String, VersionDto, Object], pdf: [String, Object, Object], newRevision: [String, Object] };
  Reflect.defineMetadata('design:paramtypes', [DocumentsService], DocumentsController);
  Reflect.defineMetadata('design:paramtypes', [ConfigService], TestOnlyGuard);
  for (const [metodo, t] of Object.entries(tipos)) Reflect.defineMetadata('design:paramtypes', t, DocumentsController.prototype, metodo);
  const modulo = await Test.createTestingModule({ controllers: [DocumentsController], providers: [{ provide: DocumentsService, useValue: servicio }, { provide: ConfigService, useValue: { get: () => ({ name: 'daubert_hub_test' }) } }] }).compile();
  app = modulo.createNestApplication();
  app.setGlobalPrefix('api');
  // Hace el papel del AuthGuard: request.user solo existe si hay sesión (aquí, la cuenta 7 de la prueba).
  app.use((req: { requestId?: string; user?: unknown }, _res: unknown, next: () => void) => { req.requestId = 'req-http-1'; if (conSesion) req.user = { id: '7', email: 'sesion@example.invalid', displayName: 'Cuenta De Sesión', role: 'GENERAL' }; next(); });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new SafeExceptionFilter());
  await app.init();
});
afterAll(async () => { await app.close(); });
beforeEach(() => { conSesion = true; for (const f of Object.values(servicio)) f.mockReset(); });

const cuerpo = { codigo: 'DOC001', familia: 'BOLSA_PLANA_1', datos: { codigo: 'DOC001', ancho: '13' } };

describe('actor documental', () => {
  it('se construye solo con request.user y el requestId del servidor', () => {
    expect(actorDeSolicitud({ requestId: 'r', user: { id: '7', email: 'a@x', displayName: 'A', role: 'ADMIN' }, headers: { 'x-user-id': '99' }, body: { userId: '99' } } as never)).toEqual({ userId: '7', email: 'a@x', displayName: 'A', role: 'ADMIN', requestId: 'r' });
    expect(() => actorDeSolicitud({ requestId: 'r' } as never)).toThrow(expect.objectContaining({ status: 401 }));
  });
});

describe('POST /api/manufacturing-sheets/documents/drafts', () => {
  it('pasa al servicio el actor de la SESIÓN aunque la petición intente suplantar con cabeceras o parámetros de consulta', async () => {
    servicio.crearBorrador.mockResolvedValue({ id: ID });
    const r = await request(app.getHttpServer()).post('/api/manufacturing-sheets/documents/drafts?userId=99').set('X-User-Id', '99').set('X-User-Email', 'otro@x').send(cuerpo);
    expect(r.status).toBe(201);
    expect(servicio.crearBorrador).toHaveBeenCalledTimes(1);
    expect(servicio.crearBorrador.mock.calls[0]![0]).toEqual({ userId: '7', email: 'sesion@example.invalid', displayName: 'Cuenta De Sesión', role: 'GENERAL', requestId: 'req-http-1' });
  });

  it.each(['creadoPor', 'creado_por_usuario_id', 'usuarioId', 'usuarioEmail', 'actor', 'estado', 'revision', 'huella', 'createdAt', 'role', 'finalizadoPor'])('rechaza con 400 el campo «%s» en el cuerpo (no llega al servicio)', async (campo) => {
    const r = await request(app.getHttpServer()).post('/api/manufacturing-sheets/documents/drafts').send({ ...cuerpo, [campo]: 'x' });
    expect(r.status).toBe(400);
    expect(servicio.crearBorrador).not.toHaveBeenCalled();
  });

  it('valida el código, la variante y la familia', async () => {
    for (const mal of [{ codigo: '../x' }, { codigo: '.oculto' }, { codigo: 'A B' }, { variante: '../v' }, { familia: 'OTRA' }]) {
      expect((await request(app.getHttpServer()).post('/api/manufacturing-sheets/documents/drafts').send({ ...cuerpo, ...mal })).status).toBe(400);
    }
    expect(servicio.crearBorrador).not.toHaveBeenCalled();
  });

  it('un 400 de validación nombra los CAMPOS rechazados (nunca sus valores) para que la pantalla pueda indicarlos', async () => {
    const mal = await request(app.getHttpServer()).post('/api/manufacturing-sheets/documents/drafts').send({ ...cuerpo, datos: { ...cuerpo.datos, pesoLb: '12345678901234567', composicion: 'SECRETO-XYZ' }, intruso: 'VALOR-PRIVADO' });
    expect(mal.status).toBe(400);
    expect(mal.body).toMatchObject({ statusCode: 400, code: 'INVALID_DATA' });
    expect(mal.body.fields).toEqual(expect.arrayContaining(['datos.pesoLb', 'datos.composicion', 'intruso']));
    expect(JSON.stringify(mal.body)).not.toMatch(/12345678901234567|SECRETO-XYZ|VALOR-PRIVADO/);
    expect(servicio.crearBorrador).not.toHaveBeenCalled();
  });

  it('campoDeMensaje solo extrae nombres de campo válidos', () => {
    expect(campoDeMensaje('datos.pesoLb must be shorter than or equal to 16 characters')).toBe('datos.pesoLb');
    expect(campoDeMensaje('property intruso should not exist')).toBe('intruso');
    expect(campoDeMensaje('«datos.ancho» es demasiado largo.')).toBe('datos.ancho');
    expect(campoDeMensaje('algo raro; DROP TABLE x')).toBeNull();
  });

  it('sin sesión autenticada responde 401 sin invocar al servicio', async () => {
    conSesion = false;
    expect((await request(app.getHttpServer()).post('/api/manufacturing-sheets/documents/drafts').send(cuerpo)).status).toBe(401);
    expect(servicio.crearBorrador).not.toHaveBeenCalled();
  });
});

describe('rutas de revisiones', () => {
  it('los identificadores deben ser UUID', async () => {
    expect((await request(app.getHttpServer()).get('/api/manufacturing-sheets/documents/revisions/1')).status).toBe(400);
    expect((await request(app.getHttpServer()).patch('/api/manufacturing-sheets/documents/revisions/abc').send({ version: 1 })).status).toBe(400);
    expect(servicio.obtener).not.toHaveBeenCalled();
  });

  it('PATCH exige versión y rechaza campos de actor; el servicio recibe el DTO validado', async () => {
    servicio.actualizarBorrador.mockResolvedValue({ id: ID });
    const base = `/api/manufacturing-sheets/documents/revisions/${ID}`;
    expect((await request(app.getHttpServer()).patch(base).send({ elaboroNombre: 'X' })).status).toBe(400);
    expect((await request(app.getHttpServer()).patch(base).send({ version: 1, actualizadoPor: 'otro' })).status).toBe(400);
    expect((await request(app.getHttpServer()).patch(base).send({ version: 0 })).status).toBe(400);
    expect((await request(app.getHttpServer()).patch(base).send({ version: 3, elaboroNombre: 'Ana', elaboroConfirmado: true })).status).toBe(200);
    expect(servicio.actualizarBorrador).toHaveBeenCalledTimes(1);
    expect(servicio.actualizarBorrador.mock.calls[0]![1]).toBe(ID);
    expect(servicio.actualizarBorrador.mock.calls[0]![2]).toMatchObject({ version: 3, elaboroNombre: 'Ana', elaboroConfirmado: true });
  });

  it('revisar y finalizar solo reciben la versión; cualquier otro campo se rechaza', async () => {
    servicio.registrarRevision.mockResolvedValue({}); servicio.finalizar.mockResolvedValue({});
    const base = `/api/manufacturing-sheets/documents/revisions/${ID}`;
    expect((await request(app.getHttpServer()).post(`${base}/review`).send({ version: 2, revisor: 'Otra Persona' })).status).toBe(400);
    expect((await request(app.getHttpServer()).post(`${base}/review`).send({ version: 2 })).status).toBe(200);
    expect(servicio.registrarRevision).toHaveBeenCalledWith(expect.objectContaining({ userId: '7' }), ID, 2);
    expect((await request(app.getHttpServer()).post(`${base}/finalize`).send({ version: 2, revision: 9 })).status).toBe(400);
    expect((await request(app.getHttpServer()).post(`${base}/finalize`).send({ version: 2 })).status).toBe(200);
    expect(servicio.finalizar).toHaveBeenCalledWith(expect.objectContaining({ userId: '7' }), ID, 2);
  });

  it('asignar revisor acepta un id o null y rechaza cualquier otra forma', async () => {
    servicio.asignarRevisor.mockResolvedValue({});
    const url = `/api/manufacturing-sheets/documents/revisions/${ID}/reviewer`;
    expect((await request(app.getHttpServer()).put(url).send({ version: 1, revisorUsuarioId: '3' })).status).toBe(200);
    expect((await request(app.getHttpServer()).put(url).send({ version: 2, revisorUsuarioId: null })).status).toBe(200);
    for (const mal of ['abc', '0', '-1', 3, '9'.repeat(30)]) expect((await request(app.getHttpServer()).put(url).send({ version: 1, revisorUsuarioId: mal })).status).toBe(400);
    expect(servicio.asignarRevisor).toHaveBeenCalledTimes(2);
  });

  it('el historial exige un código DCMX válido y no admite filtros de usuario', async () => {
    servicio.historial.mockResolvedValue({ data: [] });
    const url = '/api/manufacturing-sheets/documents/history';
    expect((await request(app.getHttpServer()).get(url)).status).toBe(400);
    expect((await request(app.getHttpServer()).get(`${url}?codigo=../x`)).status).toBe(400);
    expect((await request(app.getHttpServer()).get(`${url}?codigo=DOC001&userId=9`)).status).toBe(400);
    expect((await request(app.getHttpServer()).get(`${url}?codigo=DOC001`)).status).toBe(200);
    expect(servicio.historial).toHaveBeenCalledWith(expect.objectContaining({ userId: '7' }), 'DOC001');
  });

  it('la descarga entrega el PDF como adjunto sin caché, con su nombre y SHA-256', async () => {
    servicio.descargarPdf.mockResolvedValue({ nombre: 'DOC001_REV01.pdf', contenido: Buffer.from('%PDF-1.4 x'), sha256: 'a'.repeat(64) });
    const r = await request(app.getHttpServer()).get(`/api/manufacturing-sheets/documents/revisions/${ID}/pdf`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('application/pdf');
    expect(r.headers['content-disposition']).toBe('attachment; filename="DOC001_REV01.pdf"');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-pdf-sha256']).toBe('a'.repeat(64));
  });

  it('nueva revisión: POST /:documentId/revisions sin cuerpo; el documento debe ser UUID', async () => {
    servicio.crearRevisionNueva.mockResolvedValue({});
    expect((await request(app.getHttpServer()).post(`/api/manufacturing-sheets/documents/${ID}/revisions`).send({})).status).toBe(201);
    expect((await request(app.getHttpServer()).post('/api/manufacturing-sheets/documents/uno/revisions').send({})).status).toBe(400);
    expect(servicio.crearRevisionNueva).toHaveBeenCalledWith(expect.objectContaining({ userId: '7' }), ID);
  });
});

describe('aislamiento del módulo', () => {
  it('está registrado en AppModule y el controlador exige TestOnlyGuard (solo funciona con la base daubert_hub_test)', () => {
    const importados = (Reflect.getMetadata('imports', AppModule) ?? []) as unknown[];
    expect(importados).toContain(ManufacturingDocumentsModule);
    expect(Reflect.getMetadata('__guards__', DocumentsController)).toContain(TestOnlyGuard);
  });

  it('el módulo documental solo depende de la generación de hojas a través del puerto SheetEngine', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const carpeta = join(__dirname, '..', 'src', 'manufacturing-documents');
    for (const archivo of readdirSync(carpeta).filter((f) => f.endsWith('.ts'))) {
      const texto = readFileSync(join(carpeta, archivo), 'utf8');
      const servicios = [...texto.matchAll(/from '\.\.\/manufacturing-sheets\/([^']+)'/g)].map((m) => m[1]);
      for (const ruta of servicios) {
        const permitido = archivo === 'sheet-engine.port.ts' || /preview\/(family-registry|incidencias|draft-layer|sheet-data\.mapper|technical-coherence|sheet-preview\.dto)$/.test(ruta ?? '') && !/Service|Renderer/.test(ruta ?? '') || ruta === 'manufacturing-sheets.module';
        expect(permitido, `${archivo} importa ${ruta}`).toBe(true);
      }
    }
  });
});
