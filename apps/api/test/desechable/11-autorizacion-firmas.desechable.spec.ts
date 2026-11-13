import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { actor, codigoUnico, crearServicio, entradaBorrador, falla, MotorFalso, poolAdmin, type Vista } from './entorno';
import { pngFirma } from '../imagenes-firma';

// Autorización de USO de firmas (acceso al recurso; no aprueba nada): explícita, auditada, revocable y sin alterar lo ya finalizado. Cuentas: 1 y 5 ADMIN, 2 y 3 GENERAL, 4 inactiva.
const motor = new MotorFalso();
const { service } = crearServicio(motor);
const crear = (n: 1 | 2 | 3): Promise<Vista> => service.crearBorrador(actor(n), entradaBorrador(codigoUnico('AUT'), { cliente: { nombre: 'Cliente de prueba' } }) as never) as Promise<Vista>;
const conFirma = (n: 1 | 2 | 3, id: string, version: number, firmaId: string): Promise<Vista> => service.actualizarBorrador(actor(n), id, { version, responsables: [{ funcion: 'GENERO', nombre: 'x', firmaId }] } as never) as Promise<Vista>;
const filasAut = async (firmaId: string) => (await poolAdmin.query(
  "SELECT a.usuario_id::text AS usuario, a.otorgada_por_usuario_id::text AS otorgante, a.revocada_en IS NOT NULL AS revocada FROM manufactura.firma_autorizaciones a JOIN manufactura.firmas f USING (firma_id) WHERE f.public_id = $1 ORDER BY a.autorizacion_id", [firmaId])).rows;

describe('autorización de uso de firmas (instancia desechable)', () => {
  it('una firma que un ADMIN sube para otra persona con cuenta conserva a esa persona como propietaria y NO le da permiso a quien la subió', async () => {
    const f = await service.subirFirma(actor(1), pngFirma(), '3', undefined);
    expect(f).toMatchObject({ propietario: 'General Tres', propia: false, utilizable: false });
    expect(await filasAut(f.id)).toEqual([]);                                                // ninguna autorización automática
    const fila = (await poolAdmin.query('SELECT propietario_usuario_id::text AS prop, subida_por_usuario_id::text AS subio, incorporada_por_usuario_id::text AS incorporo FROM manufactura.firmas WHERE public_id = $1', [f.id])).rows[0];
    expect(fila).toEqual({ prop: '3', subio: '1', incorporo: '1' });                         // propietaria y quién la subió/incorporó, por separado
    expect((await service.listarFirmas(actor(1))).data.find((x) => x.id === f.id)).toBeUndefined();      // el ADMIN que la subió no la ve en su selector
    const v = await crear(1);
    expect(await falla(conFirma(1, v.id, v.version, f.id))).toMatchObject({ status: 403, code: 'FIRMA_NO_AUTORIZADA' });
    expect((await service.listarFirmas(actor(3))).data.find((x) => x.id === f.id)).toMatchObject({ propia: true });   // la propietaria sí la ve y la usa
  });

  it('la propietaria autoriza de forma explícita: queda la lista, la persona autorizada la usa sin errores y todo queda auditado', async () => {
    const f = await service.subirFirma(actor(3), pngFirma(), undefined, undefined);
    expect((await service.autorizacionesDeFirma(actor(3), f.id)).data).toEqual([]);
    await service.cambiarUsoFirma(actor(3), f.id, '2', true);
    await service.cambiarUsoFirma(actor(3), f.id, '2', true);                                // idempotente
    const lista = (await service.autorizacionesDeFirma(actor(3), f.id)).data;
    expect(lista).toEqual([expect.objectContaining({ usuarioId: '2', nombre: 'General Dos', otorgadaPor: 'General Tres' })]);
    expect(await filasAut(f.id)).toEqual([{ usuario: '2', otorgante: '3', revocada: false }]);
    expect((await service.autorizacionesDeFirma(actor(2), f.id)).data.map((a) => a.usuarioId)).toEqual(['2']);   // la autorizada solo ve la suya
    const v = await crear(2);
    const ok = await conFirma(2, v.id, v.version, f.id);
    expect(ok.responsables[0]).toMatchObject({ conFirma: true, nombre: 'General Tres' });
    const auditoria = await poolAdmin.query("SELECT operacion, usuario_email FROM audit.cambios WHERE esquema = 'manufactura' AND tabla = 'firma_autorizaciones' AND datos_nuevos->>'firma_id' = (SELECT firma_id::text FROM manufactura.firmas WHERE public_id = $1)", [f.id]);
    expect(auditoria.rows).toEqual([{ operacion: 'INSERT', usuario_email: 'g3@example.invalid' }]);
  });

  it('solo la propietaria autoriza; no se autoriza a cuentas inactivas ni se revoca algo inexistente', async () => {
    const f = await service.subirFirma(actor(3), pngFirma(), undefined, undefined);
    await service.cambiarUsoFirma(actor(3), f.id, '2', true);
    expect((await falla(service.cambiarUsoFirma(actor(2), f.id, '5', true))).status).toBe(403);       // la autorizada no reparte permisos
    expect((await falla(service.cambiarUsoFirma(actor(5), f.id, '5', true))).status).toBe(403);       // ni un ADMIN ajeno se autoriza solo
    expect((await falla(service.cambiarUsoFirma(actor(3), f.id, '4', true))).status).toBeGreaterThanOrEqual(400);   // cuenta inactiva
    expect((await falla(service.cambiarUsoFirma(actor(3), f.id, '5', false))).status).toBe(404);      // sin autorización vigente
    expect((await falla(service.cambiarUsoFirma(actor(2), f.id, '2', false))).status).toBe(404);      // la autorizada no puede revocarse a sí misma por esta vía
  });

  it('al revocar: no se asigna en borradores nuevos y no se finaliza con ella; la revisión ya finalizada y su PDF no cambian', async () => {
    const f = await service.subirFirma(actor(3), pngFirma(), undefined, undefined);
    await service.cambiarUsoFirma(actor(3), f.id, '2', true);

    // Una revisión finalizada con la firma autorizada.
    const hist = await crear(2);
    const a = await conFirma(2, hist.id, hist.version, f.id);
    const fin = await service.finalizar(actor(2), hist.id, a.version) as Vista;
    const pdfAntes = (await service.descargarPdf(actor(2), hist.id)).contenido;

    // Un borrador en curso con la misma firma.
    const enCurso = await crear(2);
    const b = await conFirma(2, enCurso.id, enCurso.version, f.id);

    await service.cambiarUsoFirma(actor(3), f.id, '2', false);
    expect(await filasAut(f.id)).toEqual([{ usuario: '2', otorgante: '3', revocada: true }]);
    expect((await service.autorizacionesDeFirma(actor(3), f.id)).data).toEqual([]);
    expect((await service.listarFirmas(actor(2))).data.find((x) => x.id === f.id)).toBeUndefined();

    const nuevo = await crear(2);
    expect(await falla(conFirma(2, nuevo.id, nuevo.version, f.id))).toMatchObject({ status: 403, code: 'FIRMA_NO_AUTORIZADA' });   // nuevas asignaciones
    expect(await falla(service.finalizar(actor(2), enCurso.id, b.version))).toMatchObject({ status: 422, code: 'FIRMA_NO_DISPONIBLE' });   // nuevas finalizaciones
    expect(((await service.obtener(actor(2), enCurso.id)) as Vista).estado).toBe('BORRADOR');                                            // el borrador sigue intacto

    // Lo histórico no se altera.
    const despues = await service.obtener(actor(2), hist.id) as Vista;
    expect(despues).toMatchObject({ estado: 'FINALIZADA', revision: fin.revision, responsables: [expect.objectContaining({ conFirma: true, nombre: 'General Tres' })] });
    expect((await service.descargarPdf(actor(2), hist.id)).contenido.equals(pdfAntes)).toBe(true);

    // La revocación queda auditada y volver a autorizar restablece el uso.
    const rev = await poolAdmin.query("SELECT usuario_email FROM audit.cambios WHERE esquema = 'manufactura' AND tabla = 'firma_autorizaciones' AND operacion = 'UPDATE' AND datos_nuevos->>'revocada_en' IS NOT NULL AND datos_nuevos->>'firma_id' = (SELECT firma_id::text FROM manufactura.firmas WHERE public_id = $1)", [f.id]);
    expect(rev.rows).toEqual([{ usuario_email: 'g3@example.invalid' }]);
    await service.cambiarUsoFirma(actor(3), f.id, '2', true);
    expect((await service.listarFirmas(actor(2))).data.find((x) => x.id === f.id)).toBeDefined();
    expect((await service.finalizar(actor(2), enCurso.id, b.version) as Vista).estado).toBe('FINALIZADA');
  });

  it('la custodia de una persona sin cuenta (comportamiento existente de la migración 102) se registra a nombre del ADMIN que la incorporó y puede ampliarse solo de forma explícita', async () => {
    const f = await service.subirFirma(actor(1), pngFirma(), undefined, 'Persona Externa');
    expect(f).toMatchObject({ propietario: 'Persona Externa', utilizable: true });
    expect(await filasAut(f.id)).toEqual([{ usuario: '1', otorgante: '1', revocada: false }]);
    expect((await falla(service.cambiarUsoFirma(actor(5), f.id, '5', true))).status).toBe(403);       // otro ADMIN no se autoriza solo
    await service.cambiarUsoFirma(actor(1), f.id, '2', true);
    expect((await service.autorizacionesDeFirma(actor(1), f.id)).data.map((a) => a.usuarioId).sort()).toEqual(['1', '2']);
  });
});
