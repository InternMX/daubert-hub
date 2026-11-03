import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { actor, crearServicio, falla, MotorFalso, poolAdmin } from './entorno';
import { pngFirma } from '../imagenes-firma';

// Gestión administrativa de firmas: descripción (sin imagen), sin ampliar lo que la base deja ver. Cuentas: 1 y 5 ADMIN, 2 y 3 GENERAL.
const { service } = crearServicio(new MotorFalso());
const lista = (n: 1 | 2 | 3 | 5, propietario?: string, sinCuenta = false) => service.listarFirmasAdministrativas(actor(n), propietario, sinCuenta);

describe('firmas · gestión administrativa (instancia desechable)', () => {
  it('un usuario GENERAL no accede a la consulta administrativa; la consulta exige un usuario o «sin cuenta» (solo uno)', async () => {
    expect((await falla(lista(2, '3'))).status).toBe(403);
    expect((await falla(lista(1))).status).toBe(400);
    expect((await falla(lista(1, '3', true))).status).toBe(400);
  });

  it('el ADMIN registra una firma para un usuario con cuenta: la ve descrita (sin imagen), NO es propietario ni obtiene permiso de uso y no puede dárselo', async () => {
    const f = await service.subirFirma(actor(1), pngFirma(), '3', undefined);
    const { data, alcance } = await lista(1, '3');
    const fila = data.find((x) => x.id === f.id);
    expect(fila).toMatchObject({ propietario: 'General Tres', propietarioUsuarioId: '3', cuenta: 'ACTIVE', estado: 'ACTIVA', incorporadaPor: 'Admin Uno', subidaPor: 'Admin Uno', autorizaciones: null });
    expect(JSON.stringify(data)).not.toMatch(/miniatura|contenido|data:image/);                 // descripción únicamente
    expect(alcance).toMatch(/ser ADMIN no da acceso/);
    // No puede usarla ni autorizarse a sí mismo ni a otros en nombre de la propietaria.
    expect((await service.listarFirmas(actor(1))).data.find((x) => x.id === f.id)).toBeUndefined();
    expect((await falla(service.cambiarUsoFirma(actor(1), f.id, '1', true))).status).toBe(403);
    expect((await falla(service.cambiarUsoFirma(actor(1), f.id, '2', true))).status).toBe(403);
    expect((await poolAdmin.query('SELECT 1 FROM manufactura.firma_autorizaciones a JOIN manufactura.firmas f USING (firma_id) WHERE f.public_id = $1', [f.id])).rowCount).toBe(0);
    // La propietaria la ve y la gobierna.
    expect((await service.listarFirmas(actor(3))).data.find((x) => x.id === f.id)).toMatchObject({ propia: true });
    await service.cambiarUsoFirma(actor(3), f.id, '2', true);
    expect((await service.autorizacionesDeFirma(actor(3), f.id)).data.map((a) => a.usuarioId)).toEqual(['2']);
  });

  it('límite de lo que la base deja ver: el ADMIN no ve las firmas que la propia persona registró ni las que registró otro ADMIN', async () => {
    const propia = await service.subirFirma(actor(3), pngFirma(), undefined, undefined);
    const deOtroAdmin = await service.subirFirma(actor(5), pngFirma(), '3', undefined);
    const vistoPor1 = (await lista(1, '3')).data.map((x) => x.id);
    expect(vistoPor1).not.toContain(propia.id);
    expect(vistoPor1).not.toContain(deOtroAdmin.id);
    expect((await lista(5, '3')).data.map((x) => x.id)).toContain(deOtroAdmin.id);
  });

  it('personas sin cuenta: el ADMIN custodio las localiza, ve su custodia y autorizaciones y las gestiona; otro ADMIN no las ve', async () => {
    const f = await service.subirFirma(actor(1), pngFirma(), undefined, 'Persona Externa');
    const fila = (await lista(1, undefined, true)).data.find((x) => x.id === f.id);
    expect(fila).toMatchObject({ propietario: 'Persona Externa', propietarioUsuarioId: null, cuenta: 'SIN_CUENTA', incorporadaPor: 'Admin Uno', autorizaciones: 1 });
    await service.cambiarUsoFirma(actor(1), f.id, '2', true);
    expect((await lista(1, undefined, true)).data.find((x) => x.id === f.id)?.autorizaciones).toBe(2);
    await service.cambiarUsoFirma(actor(1), f.id, '2', false);
    expect((await lista(1, undefined, true)).data.find((x) => x.id === f.id)?.autorizaciones).toBe(1);
    expect((await lista(5, undefined, true)).data.map((x) => x.id)).not.toContain(f.id);
    await service.retirarFirma(actor(1), f.id);
    expect((await lista(1, undefined, true)).data.find((x) => x.id === f.id)).toMatchObject({ estado: 'RETIRADA' });
  });

  it('identifica las firmas de cuentas inactivas', async () => {
    const f = await service.subirFirma(actor(1), pngFirma(), '3', undefined);
    await poolAdmin.query("UPDATE security.users SET status = 'INACTIVE' WHERE user_id = 3");
    try {
      expect((await lista(1, '3')).data.find((x) => x.id === f.id)?.cuenta).toBe('INACTIVE');
    } finally { await poolAdmin.query("UPDATE security.users SET status = 'ACTIVE' WHERE user_id = 3"); }
  });
});
