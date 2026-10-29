import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Incidencia } from '../../src/manufacturing-sheets/preview/incidencias';
import { actor, falla, codigoUnico, crearServicio, entradaBorrador, MotorFalso, poolAdmin, poolApp, type Vista } from './entorno';

// BLOQUES 5-6 · asignar y confirmar revisiones (acción autenticada, vinculada al contenido) · finalizar desde la copia guardada y producir el PDF.
const motor = new MotorFalso();
const { service, repo } = crearServicio(motor);
const crear = (n: 1 | 2 | 3, codigo: string, extra: Record<string, unknown> = {}): Promise<Vista> => service.crearBorrador(actor(n), entradaBorrador(codigo, extra) as never) as Promise<Vista>;
const actualizar = (n: 1 | 2 | 3, id: string, cuerpo: Record<string, unknown>): Promise<Vista> => service.actualizarBorrador(actor(n), id, cuerpo as never) as Promise<Vista>;
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const contradiccion = (campos: string[] = ['producto']): Incidencia => ({ id: 'PRODUCTO_FAMILIA:producto', codigo: 'PRODUCTO_FAMILIA', nivel: 'CONTRADICCION', campos: campos as never, seccion: 'datos', mensaje: 'La denominación no coincide con la familia.', origen: 'SISTEMA', afectaVistaPrevia: false, reconocible: true });
const restablecer = (): void => { motor.disponible = true; motor.fallarRender = false; motor.retardoMs = 0; motor.renders = []; motor.evaluacion = { completo: true, faltantes: [], bloqueado: null, incidencias: [] }; };
/** Borrador completo, con «Elaboró» confirmado y cliente manual: listo para finalizar. */
async function listo(n: 1 | 2 | 3 = 2, extra: Record<string, unknown> = {}): Promise<Vista> {
  const v = await crear(n, codigoUnico('FIN'), { cliente: { nombre: 'Cliente de prueba' }, ...extra });
  return actualizar(n, v.id, { version: v.version, elaboroConfirmado: true });
}
const contarPdf = async (revisionPublicId: string): Promise<number> => (await poolAdmin.query('SELECT count(*)::int AS n FROM manufactura.pdfs p JOIN manufactura.revisiones r USING (revision_id) WHERE r.public_id = $1', [revisionPublicId])).rows[0].n;

describe('bloque 5 · revisor opcional y revisión autenticada', () => {
  it('el creador asigna un revisor; el revisor ve el borrador (no los ajenos) pero no lo edita', async () => {
    restablecer();
    const v = await crear(2, codigoUnico());
    const otro = await crear(2, codigoUnico());
    expect((await falla(service.obtener(actor(3), v.id))).status).toBe(404);
    const asignado = await service.asignarRevisor(actor(2), v.id, { version: 1, revisorUsuarioId: '3' }) as Vista;
    expect(asignado.revisor).toEqual({ id: '3', nombre: 'General Tres' });
    expect(asignado.version).toBe(2);
    const visto = await service.obtener(actor(3), v.id) as Vista;
    expect(visto.asignadoComoRevisor).toBe(true);
    expect(visto.permisos).toMatchObject({ editar: false, finalizar: false, asignarRevisor: false, registrarRevision: true });
    expect((await falla(actualizar(3, v.id, { version: 2, datos: v.especificacion.datos }))).status).toBe(403);
    expect((await falla(service.obtener(actor(3), otro.id))).status).toBe(404);
    const lista = await service.listarAbiertas(actor(3));
    expect((lista.data as Vista[]).map((r) => r.id)).toContain(v.id);
    expect((lista.data as Vista[]).map((r) => r.id)).not.toContain(otro.id);
  });

  it('solo el creador o un ADMIN asignan; el revisor debe ser un usuario ACTIVO; null retira al revisor', async () => {
    const v = await crear(2, codigoUnico());
    expect((await falla(service.asignarRevisor(actor(3), v.id, { version: 1, revisorUsuarioId: '3' }))).status).toBe(404);
    expect((await falla(service.asignarRevisor(actor(2), v.id, { version: 1, revisorUsuarioId: '4' }))).status).toBe(422);
    expect((await falla(service.asignarRevisor(actor(2), v.id, { version: 1, revisorUsuarioId: '9999' }))).status).toBe(422);
    const porAdmin = await service.asignarRevisor(actor(1), v.id, { version: 1, revisorUsuarioId: '5' }) as Vista;
    expect(porAdmin.revisor?.nombre).toBe('Admin Cinco');
    const sin = await service.asignarRevisor(actor(2), v.id, { version: 2, revisorUsuarioId: null }) as Vista;
    expect(sin.revisor).toBeNull();
    const lista = await service.usuariosRevisores(actor(2));
    expect((lista.data as Array<{ displayName: string }>).map((u) => u.displayName)).not.toContain('Inactivo Cuatro');
  });

  it('el revisor asignado confirma con SU cuenta: la base fija usuario, nombre, versión y huella; no se captura ningún nombre', async () => {
    restablecer();
    const v = await crear(2, codigoUnico());
    const a = await service.asignarRevisor(actor(2), v.id, { version: 1, revisorUsuarioId: '3' }) as Vista;
    const r = actor(3);
    const hecho = await service.registrarRevision(r, v.id, a.version) as Vista;
    expect(hecho.confirmaciones).toHaveLength(1);
    expect(hecho.confirmaciones[0]).toMatchObject({ usuario: 'General Tres', correo: 'g3@example.invalid', version: 2, vigente: true, autorrevision: false, comoRevisorAsignado: true });
    const aud = await poolAdmin.query("SELECT usuario_id, usuario_email, tabla FROM audit.cambios WHERE esquema = 'manufactura' AND request_id = $1", [r.requestId]);
    expect(aud.rows).toEqual([{ usuario_id: '3', usuario_email: 'g3@example.invalid', tabla: 'confirmaciones_revision' }]);
  });

  it('autorrevisión permitida en TEST pero con constancia; es idempotente para la misma versión', async () => {
    restablecer();
    const v = await crear(2, codigoUnico());
    const uno = await service.registrarRevision(actor(2), v.id, 1) as Vista;
    expect(uno.confirmaciones[0]).toMatchObject({ autorrevision: true, comoRevisorAsignado: false, vigente: true });
    const dos = await service.registrarRevision(actor(2), v.id, 1) as Vista;
    expect(dos.confirmaciones).toHaveLength(1);
  });

  it('una cuenta ajena al borrador no puede revisarlo; un ADMIN sí; la versión debe ser la que se vio', async () => {
    restablecer();
    const v = await crear(2, codigoUnico());
    expect((await falla(service.registrarRevision(actor(3), v.id, 1))).status).toBe(404);
    expect((await falla(service.registrarRevision(actor(2), v.id, 7))).code).toBe('VERSION_CONFLICT');
    const porAdmin = await service.registrarRevision(actor(1), v.id, 1) as Vista;
    expect(porAdmin.confirmaciones[0]).toMatchObject({ usuario: 'Admin Uno', autorrevision: false, comoRevisorAsignado: false });
  });

  it('cualquier cambio técnico deja la revisión sin vigencia; un cambio no técnico (Autorizó) no', async () => {
    restablecer();
    const v = await crear(2, codigoUnico());
    await service.registrarRevision(actor(2), v.id, 1);
    const noTecnico = await actualizar(2, v.id, { version: 1, autorizoNombre: 'Dirección' });
    expect(noTecnico.confirmaciones[0].vigente).toBe(true);
    const tecnico = await actualizar(2, v.id, { version: 2, datos: { ...v.especificacion.datos, ancho: '99' } });
    expect(tecnico.confirmaciones[0].vigente).toBe(false);
    const familia = await actualizar(2, v.id, { version: 3, familia: 'HOJA_PAQ' });
    expect(familia.confirmaciones[0].vigente).toBe(false);
    const nueva = await service.registrarRevision(actor(2), v.id, 4) as Vista;
    expect(nueva.confirmaciones.filter((k: Vista) => k.vigente)).toHaveLength(1);
    expect(nueva.confirmaciones).toHaveLength(2);
  });

  it('no se revisa una hoja incompleta, bloqueada ni con contradicciones sin reconocer; con el reconocimiento recalculado por el servidor sí', async () => {
    const v = await crear(2, codigoUnico(), { datos: { codigo: 'x', producto: 'Producto raro' } });
    motor.evaluacion = { completo: false, faltantes: ['ancho'], bloqueado: null, incidencias: [] };
    const e1 = await falla(service.registrarRevision(actor(2), v.id, 1));
    expect(e1).toMatchObject({ status: 422, code: 'REVISION_BLOQUEADA' });
    expect(e1.body.motivos[0].codigo).toBe('HOJA_INCOMPLETA');
    motor.evaluacion = { completo: true, faltantes: [], bloqueado: 'Modalidad sin variante gráfica.', incidencias: [] };
    expect((await falla(service.registrarRevision(actor(2), v.id, 1))).body.motivos[0].codigo).toBe('HOJA_BLOQUEADA');
    motor.evaluacion = { completo: true, faltantes: [], bloqueado: null, incidencias: [contradiccion()] };
    expect((await falla(service.registrarRevision(actor(2), v.id, 1))).body.motivos[0].codigo).toBe('INCIDENCIAS_SIN_RECONOCER');
    // Un reconocimiento con una huella inventada no sirve: el servidor la recalcula con los datos guardados.
    const falso = await actualizar(2, v.id, { version: 1, incidenciasReconocidas: [{ id: 'PRODUCTO_FAMILIA:producto', huella: 'inventada' }] });
    expect((await falla(service.registrarRevision(actor(2), v.id, falso.version))).code).toBe('REVISION_BLOQUEADA');
    const huella = JSON.stringify(['PRODUCTO_FAMILIA:producto', 'La denominación no coincide con la familia.', ['Producto raro']]);
    const bueno = await actualizar(2, v.id, { version: falso.version, incidenciasReconocidas: [{ id: 'PRODUCTO_FAMILIA:producto', huella }] });
    expect((await service.registrarRevision(actor(2), v.id, bueno.version) as Vista).confirmaciones).toHaveLength(1);
    // Si cambia el dato que originó la contradicción, el reconocimiento caduca.
    const cambiado = await actualizar(2, v.id, { version: bueno.version, datos: { ...bueno.especificacion.datos, producto: 'Otro producto' } });
    expect((await falla(service.registrarRevision(actor(2), v.id, cambiado.version))).code).toBe('REVISION_BLOQUEADA');
    restablecer();
  });
});

describe('bloque 6 · finalizar desde la copia guardada y producir el PDF', () => {
  it('sin los requisitos no se finaliza y la revisión sigue siendo borrador (Elaboró sin confirmar, sin cliente)', async () => {
    restablecer();
    const v = await crear(2, codigoUnico());
    const e = await falla(service.finalizar(actor(2), v.id, 1));
    expect(e).toMatchObject({ status: 422, code: 'FINALIZACION_NO_LISTA' });
    expect(e.body.motivos.map((m: Vista) => m.codigo).sort()).toEqual(['CLIENTE_REQUERIDO', 'ELABORO_SIN_CONFIRMAR']);
    expect((await service.obtener(actor(2), v.id) as Vista).estado).toBe('BORRADOR');
    expect(motor.renders).toHaveLength(0);
  });

  it('hoja incompleta, bloqueada o con contradicciones sin reconocer: no se finaliza', async () => {
    const v = await listo();
    motor.evaluacion = { completo: false, faltantes: ['ancho'], bloqueado: null, incidencias: [contradiccion()] };
    const e = await falla(service.finalizar(actor(2), v.id, v.version));
    expect(e.body.motivos.map((m: Vista) => m.codigo)).toEqual(['HOJA_INCOMPLETA', 'INCIDENCIAS_SIN_RECONOCER']);
    expect(await contarPdf(v.id)).toBe(0);
    restablecer();
  });

  it('finaliza: revisión 1, PDF CODIGO_REV01.pdf registrado con su SHA-256, finalizado por la sesión, entorno PRUEBA, sin tocar el contenido', async () => {
    restablecer();
    const v = await listo();
    const a = actor(2);
    const f = await service.finalizar(a, v.id, v.version) as Vista;
    expect(f).toMatchObject({ estado: 'FINALIZADA', revision: 1, entorno: 'PRUEBA', finalizadoPor: 'g2@example.invalid', huella: v.huella });
    expect(f.pdf.nombre).toBe(`${v.codigo}_REV01.pdf`);
    const descarga = await service.descargarPdf(actor(2), v.id);
    expect(sha(descarga.contenido)).toBe(f.pdf.sha256);
    expect(descarga.contenido.length).toBe(f.pdf.bytes);
    expect(motor.renders).toHaveLength(1);
    expect(motor.renders[0]!.info).toMatchObject({ revision: 1, elaboro: 'General Dos', reviso: null, autorizo: null, huella: v.huella });
    expect(motor.renders[0]!.info.finalizadoEn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(motor.renders[0]!.datos).toEqual(v.especificacion.datos);
    const aud = await poolAdmin.query("SELECT usuario_id, tabla, operacion FROM audit.cambios WHERE esquema = 'manufactura' AND request_id = $1 ORDER BY cambio_id", [a.requestId]);
    expect(aud.rows.every((r) => r.usuario_id === '2')).toBe(true);
    expect(aud.rows.map((r) => `${r.tabla}:${r.operacion}`)).toEqual(['revisiones:UPDATE', 'pdfs:INSERT', 'revisiones:UPDATE']);
  });

  it('con variante el archivo es CODIGO-VARIANTE_REV01.pdf; «Revisó» sale solo de una confirmación vigente (con constancia de autorrevisión)', async () => {
    restablecer();
    const v = await listo(2, { variante: 'Extendida' });
    await service.asignarRevisor(actor(2), v.id, { version: v.version, revisorUsuarioId: '3' });
    await service.registrarRevision(actor(3), v.id, v.version + 1);
    const f = await service.finalizar(actor(2), v.id, v.version + 1) as Vista;
    expect(f.pdf.nombre).toBe(`${v.codigo}-EXTENDIDA_REV01.pdf`);
    expect(motor.renders[0]!.info.reviso).toBe('General Tres');
    expect(motor.renders[0]!.variante).toBe('Extendida');

    restablecer();
    const w = await listo();
    await service.registrarRevision(actor(2), w.id, w.version);
    await service.finalizar(actor(2), w.id, w.version);
    expect(motor.renders[0]!.info.reviso).toBe('General Dos (autorrevisión)');
  });

  it('una revisión caducada por un cambio técnico no se imprime como «Revisó»', async () => {
    restablecer();
    const v = await listo();
    await service.registrarRevision(actor(2), v.id, v.version);
    const cambiado = await actualizar(2, v.id, { version: v.version, datos: { ...v.especificacion.datos, calibre: '3.5' } });
    await service.finalizar(actor(2), v.id, cambiado.version);
    expect(motor.renders[0]!.info.reviso).toBeNull();
  });

  it('sin Chrome (motor no disponible): error claro, la revisión sigue en borrador y no queda ningún PDF', async () => {
    restablecer();
    const v = await listo();
    motor.disponible = false;
    const e = await falla(service.finalizar(actor(2), v.id, v.version));
    expect(e).toMatchObject({ status: 501, code: 'PDF_NOT_AVAILABLE' });
    expect((await service.obtener(actor(2), v.id) as Vista).estado).toBe('BORRADOR');
    expect(await contarPdf(v.id)).toBe(0);
    restablecer();
    expect((await service.finalizar(actor(2), v.id, v.version) as Vista).estado).toBe('FINALIZADA');
  });

  it('si el render falla la revisión vuelve a borrador (versión intacta) y no queda ningún PDF; se puede reintentar', async () => {
    restablecer();
    const v = await listo();
    motor.fallarRender = true;
    await expect(service.finalizar(actor(2), v.id, v.version)).rejects.toThrow('fallo simulado del render');
    const despues = await service.obtener(actor(2), v.id) as Vista;
    expect(despues).toMatchObject({ estado: 'BORRADOR', version: v.version, revision: null, revisionPrevista: null });
    expect(await contarPdf(v.id)).toBe(0);
    motor.fallarRender = false;
    expect((await service.finalizar(actor(2), v.id, v.version) as Vista)).toMatchObject({ estado: 'FINALIZADA', revision: 1 });
  });

  it('dos finalizaciones simultáneas: una produce el PDF y la otra recibe 409 (sin segundo PDF)', async () => {
    restablecer();
    const v = await listo();
    motor.retardoMs = 400;
    const r = await Promise.allSettled([service.finalizar(actor(2), v.id, v.version), service.finalizar(actor(1), v.id, v.version)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const perdedor = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(perdedor.reason.getStatus()).toBe(409);
    expect(await contarPdf(v.id)).toBe(1);
    expect(motor.renders).toHaveLength(1);
    restablecer();
  });

  it('permisos: otra cuenta GENERAL ni ve el borrador; el revisor asignado no finaliza; un ADMIN sí y queda como quien finalizó', async () => {
    restablecer();
    const v = await listo();
    expect((await falla(service.finalizar(actor(3), v.id, v.version))).status).toBe(404);
    const a = await service.asignarRevisor(actor(2), v.id, { version: v.version, revisorUsuarioId: '3' }) as Vista;
    expect((await falla(service.finalizar(actor(3), v.id, a.version))).status).toBe(403);
    const f = await service.finalizar(actor(1), v.id, a.version) as Vista;
    expect(f).toMatchObject({ estado: 'FINALIZADA', finalizadoPor: 'admin1@example.invalid', creadoPor: 'g2@example.invalid' });
  });

  it('una revisión finalizada es inmutable: ni el servicio ni un UPDATE/DELETE directo con el rol de la aplicación pueden alterarla', async () => {
    restablecer();
    const v = await listo();
    const f = await service.finalizar(actor(2), v.id, v.version) as Vista;
    expect((await falla(actualizar(2, v.id, { version: f.version, datos: v.especificacion.datos }))).code).toBe('NOT_EDITABLE');
    expect((await falla(service.finalizar(actor(2), v.id, f.version))).code).toBe('ALREADY_FINAL');
    const c = await poolApp.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.user_id','1',true), set_config('app.user_email','admin1@example.invalid',true)");
      await expect(c.query("UPDATE manufactura.revisiones SET cliente_nombre = 'Alterado' WHERE public_id = $1", [v.id])).rejects.toThrow(/inmutable/);
      await c.query('ROLLBACK');
      await c.query('BEGIN');
      await expect(c.query('DELETE FROM manufactura.revisiones WHERE public_id = $1', [v.id])).rejects.toThrow(/permission denied/);
    } finally { await c.query('ROLLBACK'); c.release(); }
  });

  it('finalización abandonada: congelada durante 10 minutos; después la reclama el creador o un ADMIN y el proceso original ya no puede completar', async () => {
    restablecer();
    const v = await listo();
    const inicio = await repo.conSesion(actor(2), (c) => repo.iniciarFinalizacion(c, v.id, v.version));
    expect(inicio?.revision_prevista).toBe(1);
    const congelada = await service.obtener(actor(2), v.id) as Vista;
    expect(congelada.estado).toBe('FINALIZANDO');
    expect((await falla(actualizar(2, v.id, { version: v.version, datos: v.especificacion.datos }))).code).toBe('NOT_EDITABLE');
    expect((await falla(service.finalizar(actor(2), v.id, v.version))).code).toBe('FINALIZACION_EN_CURSO');
    // Se envejece la finalización (con triggers de usuario desactivados en esta sesión de administración de la instancia DESECHABLE).
    const admin = await poolAdmin.connect();
    try {
      await admin.query('BEGIN'); await admin.query('SET LOCAL session_replication_role = replica');
      await admin.query("UPDATE manufactura.revisiones SET finalizando_desde = now() - interval '11 minutes' WHERE public_id = $1", [v.id]);
      await admin.query('COMMIT');
    } finally { admin.release(); }
    const f = await service.finalizar(actor(1), v.id, v.version) as Vista;
    expect(f).toMatchObject({ estado: 'FINALIZADA', revision: 1, finalizadoPor: 'admin1@example.invalid' });
    const tardio = await repo.conSesion(actor(2), (c) => repo.completarFinalizacion(c, { revisionId: inicio!.revision_id, token: inicio!.finalizando_token, version: v.version, nombreArchivo: `${v.codigo}_REV01.pdf`, sha256: sha(Buffer.from('x')), contenido: Buffer.from('x'), especificacionSha256: v.huella })).catch(() => 'rechazado');
    expect(tardio).toBe('rechazado');
    expect(await contarPdf(v.id)).toBe(1);
  });

  it('cancelar una finalización en curso devuelve el borrador (idempotente); el proceso original ya no puede completar', async () => {
    restablecer();
    const v = await listo();
    const inicio = await repo.conSesion(actor(2), (c) => repo.iniciarFinalizacion(c, v.id, v.version));
    const cancelada = await service.cancelarFinalizacion(actor(2), v.id, v.version) as Vista;
    expect(cancelada.estado).toBe('BORRADOR');
    const otra = await service.cancelarFinalizacion(actor(2), v.id, v.version) as Vista;
    expect(otra.estado).toBe('BORRADOR');
    const ok = await repo.conSesion(actor(2), async (c) => {
      try { return await repo.completarFinalizacion(c, { revisionId: inicio!.revision_id, token: inicio!.finalizando_token, version: v.version, nombreArchivo: `${v.codigo}_REV01.pdf`, sha256: sha(Buffer.from('x')), contenido: Buffer.from('x'), especificacionSha256: v.huella }); } catch { return false; }
    }).catch(() => false);
    expect(ok).toBe(false);
    expect(await contarPdf(v.id)).toBe(0);
  });
});
