import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentsService } from '../src/manufacturing-documents/documents.service';
import type { CambiosBorrador, DocumentsRepository } from '../src/manufacturing-documents/documents.repository';
import type { ActorDocumental, RevisionRow } from '../src/manufacturing-documents/documents.types';
import type { ResponsablesRepository } from '../src/manufacturing-documents/responsables.repository';
import type { SheetEngine } from '../src/manufacturing-documents/sheet-engine.port';

const ID = '00000000-0000-4000-8000-000000000001';
const actor: ActorDocumental = { userId: '1', email: 'synthetic@example.invalid', displayName: 'Synthetic', role: 'ADMIN', requestId: 'client-integrity' };

describe('cliente documental: una sola identidad para metadatos, copia guardada y renderer', () => {
  let fila: RevisionRow;
  const persistir = (c: CambiosBorrador) => {
    fila = { ...fila, especificacion: c.especificacion, cliente_empresa_id: c.clienteEmpresaId, cliente_nombre: c.clienteNombre, cliente_verificado: c.clienteVerificado };
  };
  const repo = {
    conSesion: async (_actor: ActorDocumental, trabajo: (c: unknown) => Promise<unknown>) => trabajo({ query: async () => ({ rows: [{ documento_id: '1' }] }) }),
    buscarCliente: vi.fn(async (_c: unknown, id: string) => ({ id, nombre: id === '10' ? 'Cliente A' : 'Cliente C' })),
    buscarDocumento: vi.fn(async () => null),
    crearDocumento: vi.fn(async () => ({ documento_id: '1' })),
    crearBorrador: vi.fn(async (_c: unknown, _documento: string, cambios: CambiosBorrador) => { persistir(cambios); return ID; }),
    obtenerRevision: vi.fn(async () => fila),
    confirmaciones: vi.fn(async () => []),
    actualizarBorrador: vi.fn(async (_c: unknown, _id: string, _v: number, cambios: CambiosBorrador) => { persistir(cambios); return true; }),
    iniciarFinalizacion: vi.fn(async () => ({ revision_id: '1', revision_prevista: 1, finalizando_token: ID, fecha: '2026-11-13' })),
    completarFinalizacion: vi.fn(async () => { fila = { ...fila, estado: 'FINALIZADA' }; return true; }),
    ultimaFinalizada: vi.fn(async () => fila),
    revisionAbiertaDelDocumento: vi.fn(async () => null)
  };
  const engine = {
    disponible: true,
    evaluar: vi.fn(async () => ({ completo: true, faltantes: [], incidencias: [], bloqueado: null })),
    generarFinalizada: vi.fn(async () => ({ pdf: Buffer.from('%PDF-synthetic'), filename: 'SYNTHETIC_REV01.pdf' }))
  };
  const service = new DocumentsService(repo as unknown as DocumentsRepository, engine as unknown as SheetEngine,
    { disponible: async () => false } as unknown as ResponsablesRepository);

  beforeEach(() => {
    vi.clearAllMocks();
    fila = {
      revision_id: '1', public_id: ID, codigo_dcmx: 'SYNTHETIC', familia: 'BOLSA_PLANA_1', estado: 'BORRADOR', version: 1,
      creado_por_usuario_id: '1', cliente_empresa_id: '10', cliente_nombre: 'Cliente A', cliente_verificado: true,
      elaboro_nombre: null, elaboro_confirmado: false, especificacion_sha256: 'a'.repeat(64),
      especificacion: { datos: { codigo: 'SYNTHETIC', cliente: 'Cliente A', ancho: '13' } }
    } as unknown as RevisionRow;
  });

  it('crear toma el nombre del catálogo y no el dato impreso enviado', async () => {
    await service.crearBorrador(actor, { codigo: 'SYNTHETIC', familia: 'BOLSA_PLANA_1', datos: { cliente: 'Cliente B' }, cliente: { empresaId: '10' } });
    expect(fila).toMatchObject({ cliente_nombre: 'Cliente A', cliente_verificado: true, especificacion: { datos: { cliente: 'Cliente A' } } });
  });

  it('crear sin cliente documental no acepta un cliente impreso como identidad', async () => {
    await service.crearBorrador(actor, { codigo: 'SYNTHETIC', familia: 'BOLSA_PLANA_1', datos: { cliente: 'Cliente B' } });
    expect(fila).toMatchObject({ cliente_nombre: null, cliente_verificado: false, especificacion: { datos: { cliente: '' } } });
  });

  it('PATCH sin sección cliente conserva A verificado, recupera A y envía A al renderer', async () => {
    await service.actualizarBorrador(actor, ID, { version: 1, datos: { cliente: 'Cliente B', ancho: '14' } });
    expect(await service.obtener(actor, ID)).toMatchObject({ cliente: { empresaId: '10', nombre: 'Cliente A', verificado: true }, especificacion: { datos: { cliente: 'Cliente A', ancho: '14' } } });
    await service.finalizar(actor, ID, 1);
    expect(engine.generarFinalizada).toHaveBeenCalledWith('BOLSA_PLANA_1', expect.objectContaining({ cliente: 'Cliente A' }), undefined, expect.any(Object), undefined);
  });

  it.each([
    [{ empresaId: '20' }, '20', 'Cliente C', true],
    [{ nombre: 'Cliente manual' }, null, 'Cliente manual', false],
    [{}, null, null, false]
  ] as const)('cambio explícito %j sustituye identidad y verificación juntas', async (cliente, id, nombre, verificado) => {
    await service.actualizarBorrador(actor, ID, { version: 1, cliente, datos: { cliente: 'No autorizado' } });
    expect(fila).toMatchObject({ cliente_empresa_id: id, cliente_nombre: nombre, cliente_verificado: verificado });
    expect(fila.especificacion.datos.cliente).toBe(nombre ?? '');
  });

  it('un borrador antiguo contradictorio no finaliza; guardarlo lo repara sin cambiar la identidad', async () => {
    fila.especificacion.datos.cliente = 'Cliente B';
    await expect(service.finalizar(actor, ID, 1)).rejects.toMatchObject({ status: 422, response: { code: 'SPEC_INVALID' } });
    expect(repo.iniciarFinalizacion).not.toHaveBeenCalled();
    expect(engine.generarFinalizada).not.toHaveBeenCalled();
    await service.actualizarBorrador(actor, ID, { version: 1 });
    expect(fila.especificacion.datos.cliente).toBe('Cliente A');
  });

  it('recuperar una finalizada no reescribe historia aunque conserve una discrepancia antigua', async () => {
    fila.estado = 'FINALIZADA';
    fila.especificacion.datos.cliente = 'Cliente B histórico';
    expect(await service.obtener(actor, ID)).toMatchObject({ especificacion: { datos: { cliente: 'Cliente B histórico' } } });
    expect(repo.actualizarBorrador).not.toHaveBeenCalled();
  });

  it('una nueva revisión normaliza su copia sin modificar la finalizada de origen', async () => {
    fila.estado = 'FINALIZADA';
    fila.especificacion.datos.cliente = 'Cliente B histórico';
    const original = fila;
    await service.crearRevisionNueva(actor, ID);
    expect(fila.especificacion.datos.cliente).toBe('Cliente A');
    expect(original.especificacion.datos.cliente).toBe('Cliente B histórico');
  });
});
