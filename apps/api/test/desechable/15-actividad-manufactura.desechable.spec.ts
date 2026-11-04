import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { DatabaseService } from '../../src/database/database.service';
import { ManufacturingActivityRepository } from '../../src/recent-activity/manufacturing-activity.repository';
import { actor, codigoUnico, crearServicio, entradaBorrador, poolApp, type Vista } from './entorno';

// «Actividad reciente» de Hojas de manufactura contra la instancia desechable (101–104): solo creaciones y finalizaciones; los borradores ajenos nunca aparecen. Cuentas: 1 y 5 ADMIN, 2 y 3 GENERAL.
const { service } = crearServicio();
const repo = new ManufacturingActivityRepository({ connect: () => poolApp.connect() } as unknown as DatabaseService);
const como = (n: 1 | 2 | 3 | 5, limite = 100) => repo.findRecent(limite, { userId: String(n), role: n === 1 || n === 5 ? 'ADMIN' : 'GENERAL' });
const crear = (n: 1 | 2 | 3, codigo: string): Promise<Vista> => service.crearBorrador(actor(n), entradaBorrador(codigo, { cliente: { nombre: 'Cliente de prueba' } }) as never) as Promise<Vista>;
async function finalizada(n: 1 | 2 | 3, codigo: string): Promise<Vista> {
  const v = await crear(n, codigo);
  const c = await service.actualizarBorrador(actor(n), v.id, { version: v.version, elaboroConfirmado: true } as never) as Vista;
  return service.finalizar(actor(n), c.id, c.version) as Promise<Vista>;
}

describe('actividad reciente de manufactura (instancia desechable)', () => {
  it('un documento creado aparece con código, estado, responsable y enlace a su hoja; solo lo ven su autor y los ADMIN', async () => {
    const codigo = codigoUnico('ACT');
    const v = await crear(2, codigo);
    const propio = (await como(2)).find((e) => e.codigo === codigo);
    expect(propio).toMatchObject({ tipo: 'DOCUMENTO_CREADO', estado: 'BORRADOR', revision: null, revision_public_id: v.id, actor_id: '2', actor_nombre: 'General Dos' });
    expect((await como(1)).some((e) => e.codigo === codigo)).toBe(true);
    expect((await como(3)).some((e) => e.codigo === codigo)).toBe(false);          // un borrador ajeno jamás se muestra
  });

  it('la finalización genera el evento «REVISION_FINALIZADA» con la revisión, visible para todas las cuentas', async () => {
    const codigo = codigoUnico('FIN');
    const v = await finalizada(2, codigo);
    for (const n of [2, 3, 1] as const) {
      const evento = (await como(n)).find((e) => e.codigo === codigo && e.tipo === 'REVISION_FINALIZADA');
      expect(evento, `cuenta ${n}`).toMatchObject({ revision: 1, estado: 'FINALIZADA', revision_public_id: v.id, actor_id: '2', actor_nombre: 'General Dos' });
    }
    // El documento (creado) de una hoja finalizada también es visible para otras cuentas, y apunta a la revisión visible.
    expect((await como(3)).find((e) => e.codigo === codigo && e.tipo === 'DOCUMENTO_CREADO')).toMatchObject({ estado: 'FINALIZADA', revision: 1 });
  });

  it('el autoguardado NO genera actividad: varias ediciones del mismo borrador siguen siendo un único evento', async () => {
    const codigo = codigoUnico('AUT');
    let v = await crear(2, codigo);
    for (let i = 0; i < 3; i += 1) v = await service.actualizarBorrador(actor(2), v.id, { version: v.version, autorizoNombre: `Persona ${i}` } as never) as Vista;
    expect((await como(2)).filter((e) => e.codigo === codigo)).toHaveLength(1);
  });

  it('respeta el límite, ordena por fecha descendente y no devuelve nada sin identidad válida', async () => {
    const eventos = await como(1, 3);
    expect(eventos.length).toBeLessThanOrEqual(3);
    const fechas = eventos.map((e) => new Date(e.occurred_at).getTime());
    expect([...fechas].sort((a, b) => b - a)).toEqual(fechas);
    expect(await repo.findRecent(5, { userId: 'no-numerico', role: 'ADMIN' })).toEqual([]);
  });
});
