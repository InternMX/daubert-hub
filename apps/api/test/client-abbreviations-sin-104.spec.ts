import 'reflect-metadata';
import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { ClientAbbreviationsRepository } from '../src/manufacturing-documents/client-abbreviations.repository';
import { ClientAbbreviationsService } from '../src/manufacturing-documents/client-abbreviations.service';
import type { DocumentsRepository } from '../src/manufacturing-documents/documents.repository';
import type { ActorDocumental } from '../src/manufacturing-documents/documents.types';

// Sin la migración 104 el formulario NO falla: «catálogo no habilitado» es un estado distinto de «sin sugerencias». Sin base: un cliente falso responde que el catálogo no existe.
const actorDe = (role: 'ADMIN' | 'GENERAL'): ActorDocumental => ({ userId: '9', email: 'x@example.invalid', displayName: 'X', role, requestId: 'r' });
function servicio(disponible: boolean) {
  const consultas: string[] = [];
  const c = { query: async (sql: string) => { consultas.push(sql); return { rows: [{ ok: disponible }] }; } } as unknown as PoolClient;
  const repo = { conSesion: async <T>(_a: ActorDocumental, t: (c: PoolClient) => Promise<T>) => t(c) } as unknown as DocumentsRepository;
  return { s: new ClientAbbreviationsService(repo, new ClientAbbreviationsRepository()), consultas };
}

describe('abreviaturas de cliente sin la migración 104', () => {
  it('estado: no disponible; las sugerencias responden NO_HABILITADO sin consultar el catálogo ni lanzar error', async () => {
    const { s, consultas } = servicio(false);
    expect(await s.estado(actorDe('GENERAL'))).toEqual({ disponible: false, puedeResolver: false });
    expect(await s.sugerir(actorDe('GENERAL'), 'audfpmg001')).toEqual({ disponible: false, estado: 'NO_HABILITADO', codigo: 'AUDFPMG001', alternativas: [], relacionadas: [], sinConfirmar: [] });
    expect(consultas.every((q) => !q.includes('fn_sugerir_cliente($1'))).toBe(true);
  });

  it('crear y resolver responden 409 CATALOGO_NO_HABILITADO; la lista de administración devuelve vacío y no disponible', async () => {
    const { s } = servicio(false);
    await expect(s.crear(actorDe('ADMIN'), { abreviatura: 'AUD', clienteId: '1' })).rejects.toMatchObject({ status: 409, response: { code: 'CATALOGO_NO_HABILITADO' } });
    await expect(s.resolver(actorDe('ADMIN'), '00000000-0000-4000-8000-000000000000', 'CONFIRMAR', undefined)).rejects.toMatchObject({ status: 409 });
    expect(await s.listar(actorDe('ADMIN'), undefined, undefined)).toEqual({ disponible: false, data: [], conteos: {} });
  });

  it('solo un ADMIN lista y resuelve, aun sin consultar la base', async () => {
    const { s } = servicio(true);
    await expect(s.listar(actorDe('GENERAL'), undefined, undefined)).rejects.toMatchObject({ status: 403 });
    await expect(s.resolver(actorDe('GENERAL'), '00000000-0000-4000-8000-000000000000', 'CONFIRMAR', undefined)).rejects.toMatchObject({ status: 403 });
  });
});
