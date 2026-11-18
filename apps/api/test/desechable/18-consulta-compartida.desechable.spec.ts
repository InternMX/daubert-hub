import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { DatabaseService } from '../../src/database/database.service';
import { ManufacturingActivityRepository } from '../../src/recent-activity/manufacturing-activity.repository';
import { jpgFirma, pngFirma } from '../imagenes-firma';
import { actor, codigoUnico, crearServicio, entradaBorrador, falla, poolAdmin, poolApp, type Vista } from './entorno';

// CONSULTA COMPARTIDA DE BORRADORES (migración 105) contra la instancia desechable (101–105). Cuentas: 1 y 5 ADMIN, 2 y 3 GENERAL.
// Verifica: consulta de borradores y finalizaciones en curso ajenos en solo lectura; nadie ajeno modifica/descarta/finaliza (API ni SQL directo); descartadas restringidas; imágenes de firma y PDF no
// finalizado sin exposición nueva; listas separadas en el servidor sin duplicados; Actividad reciente alineada; consultar nunca modifica.
const { service } = crearServicio();
const crear = (n: 1 | 2 | 3, codigo: string, extra: Record<string, unknown> = {}): Promise<Vista> => service.crearBorrador(actor(n), entradaBorrador(codigo, { cliente: { nombre: 'Cliente de prueba' }, ...extra }) as never) as Promise<Vista>;
const actividad = new ManufacturingActivityRepository({ connect: () => poolApp.connect() } as unknown as DatabaseService);
const eventosDe = async (n: 1 | 2 | 3 | 5, codigo: string) => (await actividad.findRecent(200, { userId: String(n), role: n === 1 || n === 5 ? 'ADMIN' : 'GENERAL' })).filter((e) => e.codigo === codigo);
const ids = (r: { data: unknown[] }): string[] => (r.data as Vista[]).map((x) => x.id);
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

/** Estado persistido de una revisión leído como administrador de la instancia desechable (sin RLS). */
async function fila(publicId: string) {
  const r = await poolAdmin.query('SELECT version, estado, updated_at::text AS u, actualizado_por_usuario_id::text AS ap, especificacion_sha256 AS h FROM manufactura.revisiones WHERE public_id = $1', [publicId]);
  return r.rows[0] as { version: number; estado: string; u: string; ap: string; h: string };
}
const auditoria = async (publicId: string): Promise<number> =>
  (await poolAdmin.query("SELECT count(*)::int AS n FROM audit.cambios a WHERE a.esquema = 'manufactura' AND a.tabla = 'revisiones' AND a.registro_id::text = (SELECT revision_id::text FROM manufactura.revisiones WHERE public_id = $1)", [publicId])).rows[0].n;

/** SQL directo con el ROL DE LA APLICACIÓN y la identidad indicada, en una transacción que se revierte. */
async function sqlComo(usuarioId: number, correo: string, consulta: string, params: unknown[] = []): Promise<{ filas: number; error?: string }> {
  const c = await poolApp.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.origin', 'DAUBERT_HUB', true), set_config('app.user_id', $1, true), set_config('app.user_email', $2, true)", [String(usuarioId), correo]);
    try { const r = await c.query(consulta, params); return { filas: r.rowCount ?? 0 }; } catch (e) { return { filas: 0, error: (e as Error).message }; }
  } finally { await c.query('ROLLBACK'); c.release(); }
}

describe('consulta compartida: lectura de borradores ajenos', () => {
  it('GENERAL consulta el borrador de otro usuario: propietario, estado y todos los permisos de escritura en falso', async () => {
    const codigo = codigoUnico('CC');
    const v = await crear(2, codigo);
    const visto = await service.obtener(actor(3), v.id) as Vista;
    expect(visto).toMatchObject({ id: v.id, codigo, estado: 'BORRADOR', propio: false, propietario: { nombre: 'General Dos', email: 'g2@example.invalid' } });
    expect(visto.especificacion.datos.codigo).toBe(codigo);
    expect(visto.permisos).toMatchObject({ editar: false, finalizar: false, asignarRevisor: false, registrarRevision: false, crearRevisionNueva: false, descargarPdf: false });
  });

  it('consultar (obtener / listas / historial / Actividad reciente) NO modifica nada: versión, fecha, huella, actor y auditoría quedan idénticos', async () => {
    const v = await crear(2, codigoUnico('CC'));
    const antes = await fila(v.id);
    const aud = await auditoria(v.id);
    await service.obtener(actor(3), v.id);
    await service.listarDelEquipo(actor(3));
    await service.listarAbiertas(actor(3));
    await service.historial(actor(3), v.codigo);
    await eventosDe(3, v.codigo);
    expect(await fila(v.id)).toEqual(antes);
    expect(await auditoria(v.id)).toBe(aud);
  });

  it('GENERAL ajeno no modifica, descarta, finaliza, asigna revisor ni registra revisión por la API (403) y el contenido no cambia', async () => {
    const v = await crear(2, codigoUnico('CC'));
    const antes = await fila(v.id);
    expect((await falla(service.actualizarBorrador(actor(3), v.id, { version: v.version, datos: v.especificacion.datos } as never))).status).toBe(403);
    expect((await falla(service.descartarBorrador(actor(3), v.id, v.version))).status).toBe(403);
    expect((await falla(service.finalizar(actor(3), v.id, v.version))).status).toBe(403);
    expect((await falla(service.asignarRevisor(actor(3), v.id, { version: v.version, revisorUsuarioId: '3' } as never))).status).toBe(403);
    expect((await falla(service.registrarRevision(actor(3), v.id, v.version))).status).toBe(403);
    expect(await fila(v.id)).toEqual(antes);
  });

  it('SQL directo con el rol de la aplicación: GENERAL ve la fila pero no puede actualizar, descartar, iniciar la finalización ni borrar (RLS + triggers + privilegios)', async () => {
    const v = await crear(2, codigoUnico('CC'));
    const visible = await sqlComo(3, 'g3@example.invalid', 'SELECT 1 FROM manufactura.revisiones WHERE public_id = $1', [v.id]);
    expect(visible.filas).toBe(1);
    for (const sentencia of [
      "UPDATE manufactura.revisiones SET elaboro_nombre = 'Intruso', version = version + 1 WHERE public_id = $1",
      "UPDATE manufactura.revisiones SET estado = 'DESCARTADA', version = version + 1 WHERE public_id = $1",
      "UPDATE manufactura.revisiones SET estado = 'FINALIZANDO' WHERE public_id = $1"
    ]) expect((await sqlComo(3, 'g3@example.invalid', sentencia, [v.id])).filas).toBe(0);
    expect((await sqlComo(3, 'g3@example.invalid', 'DELETE FROM manufactura.revisiones WHERE public_id = $1', [v.id])).error).toMatch(/permission denied/);
    expect((await sqlComo(3, 'g3@example.invalid', "INSERT INTO manufactura.revision_responsables (revision_id, posicion, funcion, nombre) SELECT revision_id, 3, 'REVISO', 'Intruso' FROM manufactura.revisiones WHERE public_id = $1", [v.id])).error).toMatch(/row-level security|permission|Solo el creador/);
    expect((await sqlComo(1, 'admin1@example.invalid', "UPDATE manufactura.revisiones SET elaboro_nombre = 'Admin', version = version + 1 WHERE public_id = $1", [v.id])).filas).toBe(1);   // ADMIN conserva su permiso
    expect((await fila(v.id)).version).toBe(v.version);                                                                                                                                 // (todo se revirtió)
  });

  it('sin identidad de sesión la base no entrega ningún borrador', async () => {
    const v = await crear(2, codigoUnico('CC'));
    const c = await poolApp.connect();
    try {
      await c.query('BEGIN');
      const r = await c.query('SELECT count(*)::int AS n FROM manufactura.revisiones WHERE public_id = $1', [v.id]);
      expect(r.rows[0].n).toBe(0);
    } finally { await c.query('ROLLBACK'); c.release(); }
  });

  it('propietario y ADMIN conservan edición; el ADMIN edita el borrador ajeno y el propietario sigue editando y finalizando', async () => {
    const v = await crear(2, codigoUnico('CC'));
    const porAdmin = await service.actualizarBorrador(actor(1), v.id, { version: v.version, datos: { ...v.especificacion.datos, ancho: '14' } } as never) as Vista;
    expect(porAdmin.version).toBe(v.version + 1);
    expect(porAdmin.permisos).toMatchObject({ editar: true, finalizar: true });
    const propio = await service.actualizarBorrador(actor(2), v.id, { version: porAdmin.version, elaboroConfirmado: true } as never) as Vista;
    const f = await service.finalizar(actor(2), v.id, propio.version) as Vista;
    expect(f.estado).toBe('FINALIZADA');
  });
});

describe('consulta compartida: revisor asignado, descartadas, finalizaciones en curso y finalizadas', () => {
  it('el revisor asignado conserva su revisión autenticada (no edita); otra cuenta solo consulta', async () => {
    const v = await crear(2, codigoUnico('CC'));
    const asignado = await service.asignarRevisor(actor(2), v.id, { version: v.version, revisorUsuarioId: '3' } as never) as Vista;
    const visto = await service.obtener(actor(3), v.id) as Vista;
    expect(visto).toMatchObject({ asignadoComoRevisor: true, propio: false });
    expect(visto.permisos).toMatchObject({ editar: false, finalizar: false, asignarRevisor: false });
    const conRevision = await service.registrarRevision(actor(3), v.id, asignado.version) as Vista;
    expect(conRevision.confirmaciones[0]).toMatchObject({ comoRevisorAsignado: true, vigente: true });
    expect((await falla(service.actualizarBorrador(actor(3), v.id, { version: asignado.version, datos: asignado.especificacion.datos } as never))).status).toBe(403);
    const ajena = await service.obtener(actor(5), v.id) as Vista;                                    // un ADMIN distinto del creador también consulta
    expect(ajena.permisos.editar).toBe(true);
  });

  it('descartada: solo el creador y el ADMIN la abren; otra cuenta GENERAL recibe 404, no aparece en listas ni en Actividad reciente', async () => {
    const codigo = codigoUnico('CC');
    const v = await crear(2, codigo);
    await service.descartarBorrador(actor(2), v.id, v.version);
    expect(((await service.obtener(actor(2), v.id)) as Vista).estado).toBe('DESCARTADA');
    expect(((await service.obtener(actor(1), v.id)) as Vista).estado).toBe('DESCARTADA');
    expect((await falla(service.obtener(actor(3), v.id))).status).toBe(404);
    expect(ids(await service.listarDelEquipo(actor(3))).includes(v.id)).toBe(false);
    expect(await eventosDe(3, codigo)).toEqual([]);
  });

  it('finalización en curso: se consulta como FINALIZANDO sin PDF definitivo, solo lectura; el PDF ya generado pero no finalizado no lo ve otra cuenta (RLS) ni se descarga', async () => {
    const codigo = codigoUnico('CC');
    const v = await crear(2, codigo);
    const c = await poolApp.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.origin', 'DAUBERT_HUB', true), set_config('app.user_id', '2', true), set_config('app.user_email', 'g2@example.invalid', true)");
      await c.query("UPDATE manufactura.revisiones SET estado = 'FINALIZANDO' WHERE public_id = $1", [v.id]);
      const rev = (await c.query('SELECT revision_id::text AS id, especificacion_sha256 AS h FROM manufactura.revisiones WHERE public_id = $1', [v.id])).rows[0];
      const contenido = Buffer.from('%PDF-1.4 sin finalizar');
      await c.query('INSERT INTO manufactura.pdfs (revision_id, pdf_sha256, bytes, especificacion_sha256, nombre_archivo) VALUES ($1, $2, $3, $4, $5)', [rev.id, sha(contenido), contenido.length, rev.h, `${codigo}_REV01.pdf`]);
      await c.query('INSERT INTO manufactura.pdf_contenidos (revision_id, contenido) VALUES ($1, $2)', [rev.id, contenido]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }

    const ajeno = await service.obtener(actor(3), v.id) as Vista;
    expect(ajeno).toMatchObject({ estado: 'FINALIZANDO', propio: false, pdf: null });
    expect(ajeno.permisos).toMatchObject({ editar: false, finalizar: false, descargarPdf: false });
    expect((await falla(service.descargarPdf(actor(3), v.id))).status).toBeGreaterThanOrEqual(400);
    expect(ids(await service.listarDelEquipo(actor(3))).includes(v.id)).toBe(true);
    // El PDF sin finalizar sigue visible solo para creador/ADMIN (misma exposición que antes de la 105).
    expect((await sqlComo(3, 'g3@example.invalid', 'SELECT 1 FROM manufactura.pdfs p JOIN manufactura.revisiones r USING (revision_id) WHERE r.public_id = $1', [v.id])).filas).toBe(0);
    expect((await sqlComo(3, 'g3@example.invalid', 'SELECT 1 FROM manufactura.pdf_contenidos k JOIN manufactura.revisiones r USING (revision_id) WHERE r.public_id = $1', [v.id])).filas).toBe(0);
    expect((await sqlComo(2, 'g2@example.invalid', 'SELECT 1 FROM manufactura.pdf_contenidos k JOIN manufactura.revisiones r USING (revision_id) WHERE r.public_id = $1', [v.id])).filas).toBe(1);
    expect((await sqlComo(1, 'admin1@example.invalid', 'SELECT 1 FROM manufactura.pdfs p JOIN manufactura.revisiones r USING (revision_id) WHERE r.public_id = $1', [v.id])).filas).toBe(1);
    expect((await falla(service.cancelarFinalizacion(actor(3), v.id, ajeno.version))).status).toBe(403);
    expect((await fila(v.id)).estado).toBe('FINALIZANDO');
  });

  it('una revisión finalizada sigue siendo visible y descargable para todos, sin cambios', async () => {
    const v = await crear(2, codigoUnico('CC'));
    const c = await service.actualizarBorrador(actor(2), v.id, { version: v.version, elaboroConfirmado: true } as never) as Vista;
    const f = await service.finalizar(actor(2), v.id, c.version) as Vista;
    const visto = await service.obtener(actor(3), f.id) as Vista;
    expect(visto).toMatchObject({ estado: 'FINALIZADA', revision: 1 });
    expect(visto.permisos.descargarPdf).toBe(true);
    expect((await service.descargarPdf(actor(3), f.id)).contenido.length).toBeGreaterThan(0);
  });
});

describe('consulta compartida: imágenes de firma privadas', () => {
  it('un borrador ajeno muestra los nombres de responsables, pero la imagen de una firma sin autorización no se entrega a quien consulta', async () => {
    const firma = await service.subirFirma(actor(2), pngFirma(), undefined, undefined);
    const v = await crear(2, codigoUnico('CC'));
    const conFirma = await service.actualizarBorrador(actor(2), v.id, { version: v.version, responsables: [{ funcion: 'GENERO', nombre: 'General Dos', firmaId: firma.id }] } as never) as Vista;
    expect(conFirma.responsables[0]).toMatchObject({ conFirma: true, firma: { id: firma.id } });
    expect(conFirma.responsables[0].firma.miniatura).toMatch(/^data:image\//);                      // el propietario sí la ve
    const ajeno = await service.obtener(actor(3), v.id) as Vista;
    expect(ajeno.responsables[0]).toMatchObject({ nombre: 'General Dos', conFirma: true, firma: null });   // nombre sí; imagen no
    expect(JSON.stringify(ajeno)).not.toContain('data:image');
    expect((await service.listarFirmas(actor(3))).data.some((x) => x.id === firma.id)).toBe(false);
    // Con autorización vigente de la propietaria, la consulta sí muestra la miniatura (solo entonces).
    await service.cambiarUsoFirma(actor(2), firma.id, '3', true);
    const autorizado = await service.obtener(actor(3), v.id) as Vista;
    expect(autorizado.responsables[0].firma).toMatchObject({ id: firma.id });
    expect(jpgFirma().length).toBeGreaterThan(0);
  });
});

describe('consulta compartida: listas sin duplicados y Actividad reciente alineada', () => {
  it('Mis borradores / Borradores del equipo se separan en el servidor: ninguno se repite entre secciones ni entre cuentas', async () => {
    const codigoA = codigoUnico('CC');
    const codigoB = codigoUnico('CC');
    const deDos = await crear(2, codigoA);
    const deTres = await crear(3, codigoB);
    const misDos = ids(await service.listarAbiertas(actor(2)));
    const equipoDos = ids(await service.listarDelEquipo(actor(2)));
    expect(misDos).toContain(deDos.id);
    expect(misDos).not.toContain(deTres.id);
    expect(equipoDos).toContain(deTres.id);
    expect(equipoDos).not.toContain(deDos.id);
    expect(misDos.filter((id) => equipoDos.includes(id))).toEqual([]);
    const equipoAdmin = ids(await service.listarDelEquipo(actor(1)));
    expect(equipoAdmin).toEqual(expect.arrayContaining([deDos.id, deTres.id]));
    expect(ids(await service.listarAbiertas(actor(1))).some((id) => id === deDos.id || id === deTres.id)).toBe(false);
    const porCodigo = await service.listarDelEquipo(actor(3), codigoA) as { data: Vista[] };
    expect(porCodigo.data.map((r) => r.id)).toEqual([deDos.id]);
    expect(porCodigo.data[0]).toMatchObject({ codigo: codigoA, estado: 'BORRADOR', propio: false, propietario: { nombre: 'General Dos' } });
    // El historial por código lista todo lo consultable del código (el diálogo reparte los borradores en sus secciones y deja aquí solo las finalizadas).
    expect(ids(await service.historial(actor(3), codigoA))).toContain(deDos.id);
    expect(ids(await service.historial(actor(2), codigoA))).toContain(deDos.id);
  });

  it('Actividad reciente muestra la creación del borrador ajeno (con enlace a su revisión) a otras cuentas; no registra autoguardados', async () => {
    const codigo = codigoUnico('CC');
    const v = await crear(2, codigo);
    for (const n of [3, 1, 5, 2] as const) expect(await eventosDe(n, codigo), `cuenta ${n}`).toMatchObject([{ tipo: 'DOCUMENTO_CREADO', revision_public_id: v.id, actor_id: '2' }]);
    await service.actualizarBorrador(actor(2), v.id, { version: v.version, datos: { ...v.especificacion.datos, ancho: '15' } } as never);   // autoguardado
    await service.actualizarBorrador(actor(2), v.id, { version: v.version + 1, datos: { ...v.especificacion.datos, ancho: '16' } } as never);
    expect(await eventosDe(3, codigo)).toHaveLength(1);                                              // sigue habiendo un solo evento
    // El enlace de ese evento abre la misma revisión en solo lectura para la otra cuenta.
    const abierto = await service.obtener(actor(3), (await eventosDe(3, codigo))[0]!.revision_public_id) as Vista;
    expect(abierto).toMatchObject({ id: v.id, propio: false });
    expect(abierto.permisos.editar).toBe(false);
  });
});
