import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { actor, codigoUnico, crearServicio, entradaBorrador, falla, MotorFalso, poolAdmin, type Vista } from './entorno';
import { jpgFirma, pngFirma, SVG } from '../imagenes-firma';

// Responsables y firmas de extremo a extremo en el servicio documental (instancia desechable con la migración 102), con motor simulado: qué se guarda, quién puede usar qué imagen,
// qué recibe el motor para imprimir y qué NO cambia en revisiones finalizadas. Cuentas: 1 y 5 ADMIN, 2 y 3 GENERAL.
const motor = new MotorFalso();
const { service } = crearServicio(motor);
const crear = (n: 1 | 2 | 3, extra: Record<string, unknown> = {}): Promise<Vista> => service.crearBorrador(actor(n), entradaBorrador(codigoUnico('RESP'), { cliente: { nombre: 'Cliente de prueba' }, ...extra }) as never) as Promise<Vista>;
const actualizar = (n: 1 | 2 | 3, id: string, cuerpo: Record<string, unknown>): Promise<Vista> => service.actualizarBorrador(actor(n), id, cuerpo as never) as Promise<Vista>;
const subir = (n: 1 | 2 | 3 | 5, archivo: Buffer, propietarioUsuarioId?: string, propietarioNombre?: string) => service.subirFirma(actor(n), archivo, propietarioUsuarioId, propietarioNombre);

describe('responsables y firmas (instancia desechable)', () => {
  it('«Generó» se sugiere desde la cuenta y es editable; no hay casilla de confirmación', async () => {
    const v = await crear(2);
    expect(v.responsables).toEqual([expect.objectContaining({ posicion: 1, funcion: 'GENERO', nombre: 'General Dos', firma: null })]);
    expect(v.elaboro).toMatchObject({ nombre: 'General Dos', confirmado: false, sugerido: 'General Dos' });
    const editado = await actualizar(2, v.id, { version: v.version, responsables: [{ funcion: 'GENERO', nombre: 'Persona que generó' }] });
    expect(editado.elaboro.nombre).toBe('Persona que generó');           // correspondencia con el campo documental Elaboró
    expect(editado.responsables[0]).toMatchObject({ nombre: 'Persona que generó', funcion: 'GENERO' });
    expect((await falla(actualizar(2, v.id, { version: editado.version, responsables: [{ funcion: 'REVISO', nombre: 'x' }] }))).status).toBe(400);   // el primero es siempre Generó
  });

  it('un responsable sin imágenes, dos responsables y tres con funciones repetidas se guardan y se recuperan desde PostgreSQL', async () => {
    const v = await crear(2);
    const dos = await actualizar(2, v.id, { version: v.version, responsables: [{ funcion: 'GENERO', nombre: 'Ana' }, { funcion: 'APROBO', nombre: 'Beto' }] });
    expect(dos.responsables.map((r: Vista) => [r.posicion, r.funcion, r.nombre])).toEqual([[1, 'GENERO', 'Ana'], [2, 'APROBO', 'Beto']]);
    const tres = await actualizar(2, v.id, { version: dos.version, responsables: [{ funcion: 'GENERO', nombre: 'Ana' }, { funcion: 'GENERO', nombre: 'Beto' }, { funcion: 'GENERO', nombre: 'Carla' }] });
    const releido = await service.obtener(actor(2), v.id) as Vista;
    expect(releido.responsables.map((r: Vista) => [r.posicion, r.funcion, r.nombre])).toEqual([[1, 'GENERO', 'Ana'], [2, 'GENERO', 'Beto'], [3, 'GENERO', 'Carla']]);
    expect(tres.version).toBe(dos.version + 1);
    const quitado = await actualizar(2, v.id, { version: tres.version, responsables: [{ funcion: 'GENERO', nombre: 'Ana' }] });
    expect(quitado.responsables).toHaveLength(1);
    const e = await falla(actualizar(2, v.id, { version: quitado.version, responsables: Array.from({ length: 4 }, () => ({ funcion: 'GENERO', nombre: 'x' })) }));
    expect(e.status).toBe(400);
  });

  it('sube JPG y PNG válidos (se normalizan a PNG) y rechaza SVG, archivos dañados y vacíos', async () => {
    const png = await subir(2, pngFirma());
    const jpg = await subir(2, jpgFirma());
    expect(png).toMatchObject({ propietario: 'General Dos', propia: true });
    expect(png.miniatura).toMatch(/^data:image\/png;base64,/);
    expect(jpg.id).not.toBe(png.id);
    expect((await falla(subir(2, SVG))).status).toBe(400);
    expect((await falla(subir(2, Buffer.from('no es una imagen')))).status).toBe(400);
    expect((await falla(service.subirFirma(actor(2), undefined, undefined, undefined))).status).toBe(400);
    const lista = (await service.listarFirmas(actor(2))).data;
    expect(lista.map((f) => f.id)).toEqual(expect.arrayContaining([png.id, jpg.id]));
  });

  it('las firmas ajenas no se listan ni se usan sin autorización; con autorización sí; al revocarla ya no se asignan; el nombre impreso es el de la propietaria', async () => {
    const f = await subir(2, pngFirma());
    expect((await service.listarFirmas(actor(3))).data.find((x) => x.id === f.id)).toBeUndefined();
    const v = await crear(3);
    const sinPermiso = await falla(actualizar(3, v.id, { version: v.version, responsables: [{ funcion: 'GENERO', nombre: 'Quien sea', firmaId: f.id }] }));
    expect(sinPermiso).toMatchObject({ status: 403, code: 'FIRMA_NO_AUTORIZADA' });
    await service.cambiarUsoFirma(actor(2), f.id, '3', true);
    expect((await service.listarFirmas(actor(3))).data.find((x) => x.id === f.id)).toMatchObject({ propietario: 'General Dos', propia: false });
    const conFirma = await actualizar(3, v.id, { version: v.version, responsables: [{ funcion: 'GENERO', nombre: 'Nombre cambiado a mano', firmaId: f.id }] });
    expect(conFirma.responsables[0]).toMatchObject({ nombre: 'General Dos', conFirma: true, firma: { id: f.id, propietario: 'General Dos' } });
    expect(conFirma.elaboro.nombre).toBe('General Dos');                    // no se puede atribuir la imagen a otro nombre
    await service.cambiarUsoFirma(actor(2), f.id, '3', false);
    const v2 = await crear(3);
    expect((await falla(actualizar(3, v2.id, { version: v2.version, responsables: [{ funcion: 'GENERO', nombre: 'x', firmaId: f.id }] }))).status).toBe(403);
    // quien no es propietaria no puede autorizar el uso de una imagen ajena
    expect((await falla(service.cambiarUsoFirma(actor(3), f.id, '3', true))).status).toBeGreaterThanOrEqual(403);
  });

  it('solo un ADMIN incorpora firmas de otras personas o de personas sin cuenta, y queda constancia de quién la incorporó', async () => {
    expect((await falla(subir(2, pngFirma(), '3'))).status).toBe(403);
    expect((await falla(subir(2, pngFirma(), undefined, 'Persona Externa'))).status).toBe(403);
    const externa = await subir(1, pngFirma(), undefined, 'Persona Externa');
    expect(externa).toMatchObject({ propietario: 'Persona Externa', propia: false });
    const deTres = await subir(1, pngFirma(), '3');
    expect(deTres.propietario).toBe('General Tres');
    const fila = (await poolAdmin.query('SELECT subida_por_usuario_id, incorporada_por_usuario_id, propietario_usuario_id FROM manufactura.firmas WHERE public_id = $1', [externa.id])).rows[0];
    expect(fila).toMatchObject({ subida_por_usuario_id: '1', incorporada_por_usuario_id: '1', propietario_usuario_id: null });
    // el ADMIN custodio puede usarla; otra persona no
    const v = await crear(1);
    const ok = await actualizar(1, v.id, { version: v.version, responsables: [{ funcion: 'GENERO', nombre: 'x', firmaId: externa.id }, { funcion: 'APROBO', nombre: 'y' }] });
    expect(ok.responsables[0]).toMatchObject({ nombre: 'Persona Externa', conFirma: true });
    const v3 = await crear(3);
    expect((await falla(actualizar(3, v3.id, { version: v3.version, responsables: [{ funcion: 'GENERO', nombre: 'x', firmaId: externa.id }] }))).status).toBe(403);
  });

  it('al finalizar, el motor recibe los responsables con sus imágenes; REV01 conserva esas firmas aunque el catálogo cambie; REV02 hereda nombres y NO imágenes', async () => {
    const f = await subir(2, pngFirma());
    const v = await crear(2);
    const a = await actualizar(2, v.id, { version: v.version, responsables: [{ funcion: 'GENERO', nombre: 'x', firmaId: f.id }, { funcion: 'REVISO', nombre: 'Revisora Uno' }, { funcion: 'REVISO', nombre: 'Revisora Dos' }] });
    motor.renders = [];
    const fin = await service.finalizar(actor(2), v.id, a.version) as Vista;     // sin confirmar «Elaboró» aparte
    expect(fin).toMatchObject({ estado: 'FINALIZADA', revision: 1, elaboro: { confirmado: true, nombre: 'General Dos' } });
    const info = motor.renders[0]!.info;
    expect(info.responsables?.map((r) => [r.posicion, r.funcion, r.nombre, r.firma !== null])).toEqual([[1, 'GENERO', 'General Dos', true], [2, 'REVISO', 'Revisora Uno', false], [3, 'REVISO', 'Revisora Dos', false]]);
    expect(info.responsables?.[0]?.firma?.contenido.subarray(1, 4).toString()).toBe('PNG');

    // El catálogo cambia después: la firma se retira y se revoca su uso. REV01 no cambia.
    await service.retirarFirma(actor(2), f.id);
    const antes = fin.responsables;
    const despues = (await service.obtener(actor(2), v.id) as Vista).responsables;
    expect(despues).toEqual(antes);
    expect(despues[0]).toMatchObject({ conFirma: true, nombre: 'General Dos' });
    const huella = (await poolAdmin.query('SELECT rr.firma_sha256 FROM manufactura.revision_responsables rr JOIN manufactura.revisiones r USING (revision_id) WHERE r.public_id = $1 AND rr.posicion = 1', [v.id])).rows[0].firma_sha256;
    expect(huella).toMatch(/^[0-9a-f]{64}$/);

    const rev2 = await service.crearRevisionNueva(actor(2), fin.documentoId) as Vista;
    expect(rev2.responsables.map((r: Vista) => [r.posicion, r.funcion, r.nombre, r.firma])).toEqual([[1, 'GENERO', 'General Dos', null], [2, 'REVISO', 'Revisora Uno', null], [3, 'REVISO', 'Revisora Dos', null]]);
    expect(rev2.responsables.every((r: Vista) => r.conFirma === false)).toBe(true);
  });

  it('si una imagen asignada deja de estar disponible, no se finaliza ni queda nada a medias; una hoja sin responsables guardados se finaliza con «Generó» y espacio de firma vacío', async () => {
    const f = await subir(2, pngFirma());
    await service.cambiarUsoFirma(actor(2), f.id, '3', true);
    const v = await crear(3);
    const a = await actualizar(3, v.id, { version: v.version, responsables: [{ funcion: 'GENERO', nombre: 'x', firmaId: f.id }] });
    await service.cambiarUsoFirma(actor(2), f.id, '3', false);                       // se revoca el uso antes de finalizar
    const e = await falla(service.finalizar(actor(3), v.id, a.version));
    expect(e).toMatchObject({ status: 422, code: 'FIRMA_NO_DISPONIBLE' });
    expect(await service.obtener(actor(3), v.id) as Vista).toMatchObject({ estado: 'BORRADOR', version: a.version, elaboro: { confirmado: false } });

    // Hoja sin responsables guardados: el motor recibe igualmente «Generó» con el nombre documental y sin imagen (espacio vacío), nunca el marcador «SIN FIRMA».
    const vieja = await crear(2);
    motor.renders = [];
    const fin = await service.finalizar(actor(2), vieja.id, vieja.version) as Vista;
    expect(fin.estado).toBe('FINALIZADA');
    expect(motor.renders[0]!.info.responsables).toEqual([{ posicion: 1, funcion: 'GENERO', nombre: 'General Dos', firma: null }]);
  });
});

// Firmas OPCIONALES (Generó, Revisó y Aprobó): sin ninguna selección se finaliza; con selección se imprimen solo las elegidas; las posiciones no se desplazan.
describe('firmas opcionales al finalizar (casos A–E)', () => {
  const impreso = (): Array<[number, string, string, boolean]> => (motor.renders.at(-1)!.info.responsables ?? []).map((r) => [r.posicion, r.funcion, r.nombre, r.firma !== null]);
  const contarPdf = async (id: string): Promise<number> => (await poolAdmin.query('SELECT count(*)::int AS n FROM manufactura.pdfs p JOIN manufactura.revisiones r USING (revision_id) WHERE r.public_id = $1', [id])).rows[0].n;

  it('A · ninguna firma ni nombre: finaliza, registra el PDF y el espacio de «Generó» queda en blanco (sin imagen ni nombre)', async () => {
    const v = await crear(2);
    const a = await actualizar(2, v.id, { version: v.version, responsables: [{ funcion: 'GENERO', nombre: '' }] });
    expect(a.elaboro.nombre).toBeNull();
    motor.renders = [];
    const fin = await service.finalizar(actor(2), v.id, a.version) as Vista;
    expect(fin).toMatchObject({ estado: 'FINALIZADA', revision: 1 });
    expect(impreso()).toEqual([[1, 'GENERO', '', false]]);
    expect(await contarPdf(v.id)).toBe(1);
  });

  it('B · solo una firma: únicamente esa aparece', async () => {
    const f = await subir(2, pngFirma());
    const v = await crear(2);
    const a = await actualizar(2, v.id, { version: v.version, responsables: [{ funcion: 'GENERO', nombre: 'x', firmaId: f.id }] });
    motor.renders = [];
    await service.finalizar(actor(2), v.id, a.version);
    expect(impreso()).toEqual([[1, 'GENERO', 'General Dos', true]]);
  });

  it('C · dos firmas de tres responsables: ambas aparecen y el tercero queda sin imagen; con «Generó» en blanco su recuadro se conserva vacío', async () => {
    const f1 = await subir(2, pngFirma()); const f2 = await subir(2, pngFirma());
    const v = await crear(2);
    const a = await actualizar(2, v.id, { version: v.version, responsables: [{ funcion: 'GENERO', nombre: 'x', firmaId: f1.id }, { funcion: 'REVISO', nombre: 'Sin imagen' }, { funcion: 'APROBO', nombre: 'y', firmaId: f2.id }] });
    motor.renders = [];
    await service.finalizar(actor(2), v.id, a.version);
    expect(impreso()).toEqual([[1, 'GENERO', 'General Dos', true], [2, 'REVISO', 'Sin imagen', false], [3, 'APROBO', 'General Dos', true]]);

    const w = await crear(2);
    const b = await actualizar(2, w.id, { version: w.version, responsables: [{ funcion: 'GENERO', nombre: '' }, { funcion: 'REVISO', nombre: 'r', firmaId: f1.id }, { funcion: 'APROBO', nombre: 'a', firmaId: f2.id }] });
    motor.renders = [];
    const fin = await service.finalizar(actor(2), w.id, b.version) as Vista;
    expect(fin.estado).toBe('FINALIZADA');
    expect(impreso()).toEqual([[1, 'GENERO', '', false], [2, 'REVISO', 'General Dos', true], [3, 'APROBO', 'General Dos', true]]);
  });

  it('D · tres firmas: las tres aparecen (comportamiento anterior intacto)', async () => {
    const fs = [await subir(2, pngFirma()), await subir(2, pngFirma()), await subir(2, pngFirma())];
    const v = await crear(2);
    const a = await actualizar(2, v.id, { version: v.version, responsables: [{ funcion: 'GENERO', nombre: 'x', firmaId: fs[0]!.id }, { funcion: 'REVISO', nombre: 'x', firmaId: fs[1]!.id }, { funcion: 'APROBO', nombre: 'x', firmaId: fs[2]!.id }] });
    motor.renders = [];
    const fin = await service.finalizar(actor(2), v.id, a.version) as Vista;
    expect(fin).toMatchObject({ estado: 'FINALIZADA', elaboro: { nombre: 'General Dos', confirmado: true } });
    expect(impreso()).toEqual([[1, 'GENERO', 'General Dos', true], [2, 'REVISO', 'General Dos', true], [3, 'APROBO', 'General Dos', true]]);
  });

  it('E · nueva revisión sin firmas: se finaliza como REV02 y el historial conserva REV01', async () => {
    const f = await subir(2, pngFirma());
    const v = await crear(2);
    const a = await actualizar(2, v.id, { version: v.version, responsables: [{ funcion: 'GENERO', nombre: 'x', firmaId: f.id }] });
    const rev1 = await service.finalizar(actor(2), v.id, a.version) as Vista;
    const borrador = await service.crearRevisionNueva(actor(2), rev1.documentoId) as Vista;
    const sinFirmas = await actualizar(2, borrador.id, { version: borrador.version, responsables: [{ funcion: 'GENERO', nombre: '' }] });
    motor.renders = [];
    const rev2 = await service.finalizar(actor(2), borrador.id, sinFirmas.version) as Vista;
    expect(rev2).toMatchObject({ estado: 'FINALIZADA', revision: 2 });
    expect(impreso()).toEqual([[1, 'GENERO', '', false]]);
    const historial = (await service.historial(actor(2), v.codigo)).data as Vista[];
    expect(historial.filter((h) => h.estado === 'FINALIZADA').map((h) => h.revision).sort()).toEqual([1, 2]);
    expect((await service.obtener(actor(2), v.id) as Vista).responsables[0]).toMatchObject({ conFirma: true, nombre: 'General Dos' });   // REV01 intacta
  });
});
