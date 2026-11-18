import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { DatabaseService } from '../../src/database/database.service';
import { ManufacturingActivityRepository } from '../../src/recent-activity/manufacturing-activity.repository';
import { actor, codigoUnico, crearServicio, entradaBorrador, poolApp, type Vista } from './entorno';

// «Actividad reciente» de Hojas de manufactura contra la instancia desechable (101–104): creación del documento inicial, nuevas revisiones y finalizaciones; cada evento describe lo que ocurrió en su fecha;
// los borradores ajenos nunca aparecen y el autoguardado no genera eventos. Cuentas: 1 y 5 ADMIN, 2 y 3 GENERAL.
const { service } = crearServicio();
const repo = new ManufacturingActivityRepository({ connect: () => poolApp.connect() } as unknown as DatabaseService);
const como = (n: 1 | 2 | 3 | 5, limite = 200) => repo.findRecent(limite, { userId: String(n), role: n === 1 || n === 5 ? 'ADMIN' : 'GENERAL' });
const de = async (n: 1 | 2 | 3 | 5, codigo: string) => (await como(n)).filter((e) => e.codigo === codigo);
const crear = (n: 1 | 2 | 3, codigo: string): Promise<Vista> => service.crearBorrador(actor(n), entradaBorrador(codigo, { cliente: { nombre: 'Cliente de prueba' } }) as never) as Promise<Vista>;
async function finalizar(n: 1 | 2 | 3, v: Vista): Promise<Vista> {
  const c = await service.actualizarBorrador(actor(n), v.id, { version: v.version, elaboroConfirmado: true } as never) as Vista;
  return service.finalizar(actor(n), c.id, c.version) as Promise<Vista>;
}
const finalizada = async (n: 1 | 2 | 3, codigo: string): Promise<Vista> => finalizar(n, await crear(n, codigo));

describe('actividad reciente de manufactura (instancia desechable)', () => {
  it('un documento creado aparece como creación del documento inicial (sin estado ni revisión actuales) con responsable y enlace; lo ven su autor, los ADMIN y (consulta compartida) las demás cuentas', async () => {
    const codigo = codigoUnico('ACT');
    const v = await crear(2, codigo);
    expect(await de(2, codigo)).toMatchObject([{ tipo: 'DOCUMENTO_CREADO', revision: null, revision_base: null, revision_public_id: v.id, actor_id: '2', actor_nombre: 'General Dos' }]);
    expect(await de(1, codigo)).toHaveLength(1);
    expect(await de(3, codigo)).toMatchObject([{ tipo: 'DOCUMENTO_CREADO', revision_public_id: v.id, actor_id: '2' }]);   // consulta compartida: el enlace abre el borrador ajeno en solo lectura
  });

  it('la finalización genera «REVISION_FINALIZADA» con su número, visible para todas las cuentas; el documento creado NO cambia para reflejar el estado actual', async () => {
    const codigo = codigoUnico('FIN');
    const v = await finalizada(2, codigo);
    for (const n of [2, 3, 1] as const) {
      const eventos = await de(n, codigo);
      expect(eventos.find((e) => e.tipo === 'REVISION_FINALIZADA'), `cuenta ${n}`).toMatchObject({ revision: 1, revision_base: null, revision_public_id: v.id, actor_id: '2', actor_nombre: 'General Dos' });
      expect(eventos.find((e) => e.tipo === 'DOCUMENTO_CREADO'), `cuenta ${n}`).toMatchObject({ revision: null, revision_base: null });
    }
  });

  it('una NUEVA REVISIÓN genera su propio evento «basada en REV01» con su autor; mientras es borrador también la consultan las demás cuentas (solo lectura); al finalizarla se suma «REV02 finalizada»', async () => {
    const codigo = codigoUnico('REV');
    const v1 = await finalizada(2, codigo);
    const doc = await service.listarAbiertas(actor(2));                           // (el documento ya no tiene borradores abiertos)
    expect((doc.data as Vista[]).some((r) => r.codigo === codigo)).toBe(false);
    const v2 = await service.crearRevisionNueva(actor(2), v1.documentoId) as Vista;
    const propios = await de(2, codigo);
    expect(propios.find((e) => e.tipo === 'REVISION_CREADA')).toMatchObject({ revision: null, revision_base: 1, revision_public_id: v2.id, actor_id: '2' });
    expect((await de(3, codigo)).some((e) => e.tipo === 'REVISION_CREADA')).toBe(true);        // borrador ajeno: consultable
    expect((await de(1, codigo)).some((e) => e.tipo === 'REVISION_CREADA')).toBe(true);
    await finalizar(2, v2);
    const todas = await de(3, codigo);
    expect(todas.filter((e) => e.tipo === 'REVISION_FINALIZADA').map((e) => e.revision).sort()).toEqual([1, 2]);
    expect(todas.filter((e) => e.tipo === 'DOCUMENTO_CREADO')).toHaveLength(1);              // el documento se creó una sola vez
  });

  it('el autoguardado NO genera actividad: varias ediciones del mismo borrador siguen siendo un único evento', async () => {
    const codigo = codigoUnico('AUT');
    let v = await crear(2, codigo);
    for (let i = 0; i < 3; i += 1) v = await service.actualizarBorrador(actor(2), v.id, { version: v.version, autorizoNombre: `Persona ${i}` } as never) as Vista;
    expect(await de(2, codigo)).toHaveLength(1);
  });

  it('respeta el límite, ordena por fecha descendente y no devuelve nada sin identidad válida', async () => {
    const eventos = await como(1, 3);
    expect(eventos.length).toBeLessThanOrEqual(3);
    const fechas = eventos.map((e) => new Date(e.occurred_at).getTime());
    expect([...fechas].sort((a, b) => b - a)).toEqual(fechas);
    expect(await repo.findRecent(5, { userId: 'no-numerico', role: 'ADMIN' })).toEqual([]);
  });
});
