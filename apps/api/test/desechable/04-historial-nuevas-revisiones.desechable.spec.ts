import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { actor, falla, codigoUnico, crearServicio, entradaBorrador, MotorFalso, poolAdmin, type Vista } from './entorno';

// BLOQUES 7-8 · historial y descarga de versiones finalizadas · nuevas revisiones sin modificar las anteriores.
const motor = new MotorFalso();
const { service } = crearServicio(motor);
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
/** Documento finalizado (REV01) por la cuenta indicada. */
async function finalizado(n: 1 | 2 | 3 = 2, codigo = codigoUnico('HIS'), extra: Record<string, unknown> = {}): Promise<Vista> {
  const v = await service.crearBorrador(actor(n), entradaBorrador(codigo, { cliente: { nombre: 'Cliente de prueba' }, ...extra }) as never) as Vista;
  const c = await service.actualizarBorrador(actor(n), v.id, { version: 1, elaboroConfirmado: true } as never) as Vista;
  return service.finalizar(actor(n), v.id, c.version) as Promise<Vista>;
}

describe('bloque 7 · historial y descarga de versiones finalizadas', () => {
  it('las versiones finalizadas las ve cualquier cuenta autenticada; los borradores ajenos, no', async () => {
    const codigo = codigoUnico('HIS');
    const f = await finalizado(2, codigo);
    const abierto = await service.crearRevisionNueva(actor(2), f.documentoId) as Vista;
    const visto3 = await service.historial(actor(3), codigo);
    expect((visto3.data as Vista[]).map((r) => `${r.estado}:${r.revision}`)).toEqual(['FINALIZADA:1']);
    const visto2 = await service.historial(actor(2), codigo);
    expect((visto2.data as Vista[]).map((r) => `${r.estado}:${r.revision}`)).toEqual(['BORRADOR:null', 'FINALIZADA:1']);
    expect((visto2.data as Vista[])[0]!.id).toBe(abierto.id);
    const detalle = await service.obtener(actor(3), f.id) as Vista;
    expect(detalle).toMatchObject({ estado: 'FINALIZADA', revision: 1, propio: false });
    expect(detalle.permisos).toMatchObject({ editar: false, finalizar: false, descargarPdf: true, crearRevisionNueva: false });
  });

  it('descarga el PDF de una versión finalizada (cualquier cuenta autenticada) verificando su SHA-256 y su nombre', async () => {
    const f = await finalizado(2);
    const d = await service.descargarPdf(actor(3), f.id);
    expect(d.nombre).toBe(f.pdf.nombre);
    expect(sha(d.contenido)).toBe(f.pdf.sha256);
    expect(d.sha256).toBe(f.pdf.sha256);
    expect(d.contenido.toString()).toContain('%PDF-1.4');
  });

  it('un borrador o un id inexistente no tiene PDF (404); el borrador de otra cuenta tampoco se revela', async () => {
    const b = await service.crearBorrador(actor(2), entradaBorrador(codigoUnico()) as never) as Vista;
    expect((await falla(service.descargarPdf(actor(2), b.id))).status).toBe(404);
    expect((await falla(service.descargarPdf(actor(3), b.id))).status).toBe(404);
    expect((await falla(service.descargarPdf(actor(2), '00000000-0000-4000-8000-000000000000'))).status).toBe(404);
  });

  it('si los bytes guardados dejaran de coincidir con el SHA-256 registrado, no se entregan (error de integridad)', async () => {
    const f = await finalizado(2);
    const admin = await poolAdmin.connect();
    try {
      await admin.query('BEGIN'); await admin.query('SET LOCAL session_replication_role = replica');
      await admin.query('UPDATE manufactura.pdf_contenidos SET contenido = $1 WHERE revision_id = (SELECT revision_id FROM manufactura.revisiones WHERE public_id = $2)', [Buffer.from('%PDF-1.4 adulterado'), f.id]);
      await admin.query('COMMIT');
    } finally { admin.release(); }
    const e = await falla(service.descargarPdf(actor(2), f.id));
    expect(e).toMatchObject({ status: 500, code: 'PDF_INTEGRITY' });
  });

  it('el historial por código reúne todas las variantes, con revisiones de la más nueva a la más antigua dentro de cada variante', async () => {
    const codigo = codigoUnico('HIS');
    const sin = await finalizado(2, codigo);
    const doblada = await finalizado(2, codigo, { variante: 'Doblada' });
    await service.crearRevisionNueva(actor(2), sin.documentoId);
    const h = await service.historial(actor(2), codigo);
    const filas = (h.data as Vista[]).map((r) => `${r.variante ?? '-'}:${r.estado}:${r.revision}`);
    expect(filas).toEqual(['-:BORRADOR:null', '-:FINALIZADA:1', 'Doblada:FINALIZADA:1']);
    expect(doblada.pdf.nombre).toBe(`${codigo}-DOBLADA_REV01.pdf`);
    expect(sin.pdf.nombre).toBe(`${codigo}_REV01.pdf`);
  });
});

describe('bloque 8 · nuevas revisiones sin modificar las anteriores', () => {
  it('crea un borrador basado en la última versión finalizada: copia la especificación, sugiere «Elaboró» al usuario actual sin confirmar, sin revisor ni confirmaciones', async () => {
    const f = await finalizado(2);
    const asignado = await service.crearRevisionNueva(actor(2), f.documentoId) as Vista;
    expect(asignado).toMatchObject({ estado: 'BORRADOR', revision: null, version: 1, basadaEnRevision: 1, documentoId: f.documentoId, creadoPor: 'g2@example.invalid' });
    expect(asignado.especificacion).toEqual(f.especificacion);
    expect(asignado.elaboro).toEqual({ nombre: 'General Dos', confirmado: false, sugerido: 'General Dos' });
    expect(asignado.revisor).toBeNull();
    expect(asignado.confirmaciones).toEqual([]);
    expect(asignado.cliente).toEqual(f.cliente);
  });

  it('la revisión anterior queda exactamente igual (estado, huella, PDF, fecha) tras crear, editar y finalizar la siguiente', async () => {
    const f1 = await finalizado(2);
    const antes = await poolAdmin.query('SELECT r.estado, r.revision, r.especificacion_sha256, r.finalizado_en, r.version, p.pdf_sha256, md5(c.contenido) AS md5 FROM manufactura.revisiones r JOIN manufactura.pdfs p USING (revision_id) JOIN manufactura.pdf_contenidos c USING (revision_id) WHERE r.public_id = $1', [f1.id]);
    const b = await service.crearRevisionNueva(actor(2), f1.documentoId) as Vista;
    const e = await service.actualizarBorrador(actor(2), b.id, { version: 1, datos: { ...b.especificacion.datos, ancho: '21' }, elaboroConfirmado: true } as never) as Vista;
    const f2 = await service.finalizar(actor(2), b.id, e.version) as Vista;
    expect(f2).toMatchObject({ estado: 'FINALIZADA', revision: 2, basadaEnRevision: 1 });
    expect(f2.pdf.nombre).toBe(`${f1.codigo}_REV02.pdf`);
    expect(f2.huella).not.toBe(f1.huella);
    const despues = await poolAdmin.query('SELECT r.estado, r.revision, r.especificacion_sha256, r.finalizado_en, r.version, p.pdf_sha256, md5(c.contenido) AS md5 FROM manufactura.revisiones r JOIN manufactura.pdfs p USING (revision_id) JOIN manufactura.pdf_contenidos c USING (revision_id) WHERE r.public_id = $1', [f1.id]);
    expect(despues.rows).toEqual(antes.rows);
    const viejo = await service.descargarPdf(actor(3), f1.id);
    expect(sha(viejo.contenido)).toBe(f1.pdf.sha256);
    const nuevo = await service.descargarPdf(actor(3), f2.id);
    expect(sha(nuevo.contenido)).toBe(f2.pdf.sha256);
    expect(nuevo.nombre).toBe(`${f1.codigo}_REV02.pdf`);
  });

  it('solo puede haber una revisión abierta por documento; el 409 indica cuál es; dos peticiones simultáneas crean una sola', async () => {
    const f = await finalizado(2);
    const [a, b] = await Promise.allSettled([service.crearRevisionNueva(actor(2), f.documentoId), service.crearRevisionNueva(actor(1), f.documentoId)]);
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
    const rechazada = (a.status === 'rejected' ? a : b) as PromiseRejectedResult;
    expect(rechazada.reason.getStatus()).toBe(409);
    const otra = await falla(service.crearRevisionNueva(actor(2), f.documentoId));
    expect(otra).toMatchObject({ status: 409, code: 'OPEN_DRAFT_EXISTS' });
    expect(otra.body.borradorId).toBeTruthy();
  });

  it('solo el creador del documento o un ADMIN crean revisiones nuevas; otra cuenta GENERAL recibe 403; un documento sin versión finalizada da 404', async () => {
    const f = await finalizado(2);
    expect((await falla(service.crearRevisionNueva(actor(3), f.documentoId))).status).toBe(403);
    const porAdmin = await service.crearRevisionNueva(actor(1), f.documentoId) as Vista;
    expect(porAdmin).toMatchObject({ creadoPor: 'admin1@example.invalid', basadaEnRevision: 1 });
    expect(porAdmin.permisos.editar).toBe(true);
    const soloBorrador = await service.crearBorrador(actor(2), entradaBorrador(codigoUnico()) as never) as Vista;
    expect((await falla(service.crearRevisionNueva(actor(2), soloBorrador.documentoId))).status).toBe(404);
    expect((await falla(service.crearRevisionNueva(actor(2), '00000000-0000-4000-8000-000000000000'))).status).toBe(404);
  });

  it('un borrador descartado permite abrir otro; la numeración continúa sin huecos ni repeticiones (REV01, REV02, REV03)', async () => {
    const f1 = await finalizado(2);
    const b = await service.crearRevisionNueva(actor(2), f1.documentoId) as Vista;
    await service.descartarBorrador(actor(2), b.id, 1);
    const b2 = await service.crearRevisionNueva(actor(2), f1.documentoId) as Vista;
    const c2 = await service.actualizarBorrador(actor(2), b2.id, { version: 1, elaboroConfirmado: true } as never) as Vista;
    const f2 = await service.finalizar(actor(2), b2.id, c2.version) as Vista;
    const b3 = await service.crearRevisionNueva(actor(2), f1.documentoId) as Vista;
    const c3 = await service.actualizarBorrador(actor(2), b3.id, { version: 1, elaboroConfirmado: true } as never) as Vista;
    const f3 = await service.finalizar(actor(2), b3.id, c3.version) as Vista;
    expect([f1.revision, f2.revision, f3.revision]).toEqual([1, 2, 3]);
    expect(f3.pdf.nombre).toBe(`${f1.codigo}_REV03.pdf`);
    expect(f3.basadaEnRevision).toBe(2);
  });

  it('variantes del mismo código: cada una lleva su propia numeración (ambas REV01) y sus nuevas revisiones no se mezclan', async () => {
    const codigo = codigoUnico('HIS');
    const a = await finalizado(2, codigo, { variante: 'Doblada' });
    const b = await finalizado(2, codigo, { variante: 'Extendida' });
    expect([a.revision, b.revision]).toEqual([1, 1]);
    const nueva = await service.crearRevisionNueva(actor(2), a.documentoId) as Vista;
    expect(nueva.variante).toBe('Doblada');
    expect((await service.historial(actor(2), codigo)).data).toHaveLength(3);
  });
});
