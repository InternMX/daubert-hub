import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { actor, falla, codigoUnico, crearServicio, entradaBorrador, poolAdmin, type Vista } from './entorno';

// BLOQUES 2-4 · actualizar con control de versiones · «Elaboró» sugerido y confirmado · acciones con el usuario autenticado real.
const { service } = crearServicio();
const crear = (n: 1 | 2 | 3, codigo: string, extra: Record<string, unknown> = {}): Promise<Vista> => service.crearBorrador(actor(n), entradaBorrador(codigo, extra) as never) as Promise<Vista>;
const actualizar = (n: 1 | 2 | 3 | 5, id: string, cuerpo: Record<string, unknown>): Promise<Vista> => service.actualizarBorrador(actor(n), id, cuerpo as never) as Promise<Vista>;

describe('bloque 2 · actualizar con control de versiones', () => {
  it('cada edición incrementa la versión en 1, recalcula la huella y deja constancia de quién modificó', async () => {
    const v1 = await crear(2, codigoUnico());
    const v2 = await actualizar(2, v1.id, { version: 1, datos: { ...v1.especificacion.datos, ancho: '15' } });
    expect(v2.version).toBe(2);
    expect(v2.especificacion.datos.ancho).toBe('15');
    expect(v2.huella).not.toBe(v1.huella);
    expect(v2.actualizadoPor).toBe('g2@example.invalid');
    const v3 = await actualizar(2, v1.id, { version: 2, datos: { ...v2.especificacion.datos, ancho: '15' } });
    expect(v3.version).toBe(3);
    expect(v3.huella).toBe(v2.huella);
  });

  it('el código del documento no cambia aunque la edición traiga otro en datos.codigo', async () => {
    const codigo = codigoUnico();
    const v1 = await crear(2, codigo);
    const v2 = await actualizar(2, v1.id, { version: 1, datos: { ...v1.especificacion.datos, codigo: 'FALSO' } });
    expect(v2.codigo).toBe(codigo);
    expect(v2.especificacion.datos.codigo).toBe(codigo);
  });

  it('una edición con versión vieja se rechaza con 409 y la versión vigente; no pisa el trabajo ajeno', async () => {
    const v1 = await crear(2, codigoUnico());
    await actualizar(2, v1.id, { version: 1, datos: { ...v1.especificacion.datos, largo: '20' } });
    const e = await falla(actualizar(2, v1.id, { version: 1, datos: { ...v1.especificacion.datos, largo: '99' } }));
    expect(e).toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
    expect(e.body.versionActual).toBe(2);
    expect((await service.obtener(actor(2), v1.id) as Vista).especificacion.datos.largo).toBe('20');
  });

  it('dos ediciones simultáneas con la misma versión: una gana y la otra recibe 409 (bloqueo optimista)', async () => {
    const v1 = await crear(2, codigoUnico());
    const resultados = await Promise.allSettled([
      actualizar(2, v1.id, { version: 1, datos: { ...v1.especificacion.datos, largo: '31' } }),
      actualizar(2, v1.id, { version: 1, datos: { ...v1.especificacion.datos, largo: '32' } })
    ]);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const perdedor = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(perdedor.reason.getStatus()).toBe(409);
    const final = await service.obtener(actor(2), v1.id) as Vista;
    expect(final.version).toBe(2);
  });

  it('solo el creador o un ADMIN editan; otra cuenta GENERAL ni siquiera ve el borrador (404) y un ADMIN sí puede editarlo', async () => {
    const v1 = await crear(2, codigoUnico());
    expect((await falla(actualizar(3, v1.id, { version: 1, datos: v1.especificacion.datos }))).status).toBe(404);
    const porAdmin = await actualizar(1, v1.id, { version: 1, datos: { ...v1.especificacion.datos, ancho: '14' } });
    expect(porAdmin.version).toBe(2);
    expect(porAdmin.actualizadoPor).toBe('admin1@example.invalid');
    expect(porAdmin.creadoPor).toBe('g2@example.invalid');
  });

  it('una sección omitida se conserva; una enviada reemplaza a la guardada', async () => {
    const codigo = codigoUnico();
    const v1 = await crear(2, codigo, { bind: { Code: codigo, Title: 'Titulo' }, procedencia: { ancho: 'BIND' } });
    const v2 = await actualizar(2, v1.id, { version: 1, datos: { ...v1.especificacion.datos, calibre: '3.0' } });
    expect(v2.especificacion.bind).toEqual({ Code: codigo, Title: 'Titulo' });
    expect(v2.especificacion.procedencia).toEqual({ ancho: 'BIND' });
    const v3 = await actualizar(2, v1.id, { version: 2, procedencia: { calibre: 'MANUAL' } });
    expect(v3.especificacion.procedencia).toEqual({ calibre: 'MANUAL' });
    expect(v3.especificacion.datos.calibre).toBe('3.0');
  });

  it('el cambio de familia se guarda y cambia la huella; el cliente puede identificarse después', async () => {
    const v1 = await crear(2, codigoUnico());
    const v2 = await actualizar(2, v1.id, { version: 1, familia: 'HOJA_PAQ', cliente: { empresaId: '1' } });
    expect(v2.familia).toBe('HOJA_PAQ');
    expect(v2.huella).not.toBe(v1.huella);
    expect(v2.cliente).toEqual({ empresaId: '1', nombre: 'Cliente simulado', verificado: true });
    expect(v2.especificacion.datos.cliente).toBe('Cliente simulado');
  });

  it('descartar un borrador libera el código para empezar de nuevo con otra revisión y lo deja inmutable', async () => {
    const v1 = await crear(2, codigoUnico());
    const d = await service.descartarBorrador(actor(2), v1.id, 1) as Vista;
    expect(d.estado).toBe('DESCARTADA');
    expect((await falla(actualizar(2, v1.id, { version: d.version, datos: v1.especificacion.datos }))).code).toBe('NOT_EDITABLE');
  });
});

describe('bloque 3 · «Elaboró»: sugerido desde la cuenta autenticada, editable, confirmado expresamente', () => {
  it('se sugiere el nombre de la cuenta, nace sin confirmar y se puede editar; confirmar es una acción explícita', async () => {
    const v1 = await crear(2, codigoUnico());
    expect(v1.elaboro).toEqual({ nombre: 'General Dos', confirmado: false, sugerido: 'General Dos' });
    const v2 = await actualizar(2, v1.id, { version: 1, elaboroConfirmado: true });
    expect(v2.elaboro).toEqual({ nombre: 'General Dos', confirmado: true, sugerido: 'General Dos' });
  });

  it('cambiar el nombre impreso retira la confirmación, salvo que la misma petición confirme el nombre nuevo', async () => {
    const v1 = await crear(2, codigoUnico());
    const v2 = await actualizar(2, v1.id, { version: 1, elaboroConfirmado: true });
    const v3 = await actualizar(2, v1.id, { version: 2, elaboroNombre: 'Ing. Ana Pérez' });
    expect(v3.elaboro).toMatchObject({ nombre: 'Ing. Ana Pérez', confirmado: false });
    const v4 = await actualizar(2, v1.id, { version: v3.version, elaboroNombre: 'Ing. Ana Pérez López', elaboroConfirmado: true });
    expect(v4.elaboro).toMatchObject({ nombre: 'Ing. Ana Pérez López', confirmado: true });
    const sinCambioDeNombre = await actualizar(2, v1.id, { version: v4.version, datos: { ...v4.especificacion.datos, calibre: '2.5' } });
    expect(sinCambioDeNombre.elaboro.confirmado).toBe(true);
    expect(v2.elaboro.confirmado).toBe(true);
  });

  it('el nombre impreso es distinto de la identidad de auditoría: editarlo no cambia quién actuó', async () => {
    const v1 = await crear(2, codigoUnico());
    const v2 = await actualizar(2, v1.id, { version: 1, elaboroNombre: 'Persona Distinta', elaboroConfirmado: true });
    expect(v2.elaboro.nombre).toBe('Persona Distinta');
    expect(v2.actualizadoPor).toBe('g2@example.invalid');
    expect(v2.creadoPor).toBe('g2@example.invalid');
  });

  it('un ADMIN que edita el borrador ajeno ve su propia sugerencia pero no cambia el nombre guardado', async () => {
    const v1 = await crear(2, codigoUnico());
    const porAdmin = await actualizar(1, v1.id, { version: 1, autorizoNombre: 'Dirección' });
    expect(porAdmin.elaboro).toMatchObject({ nombre: 'General Dos', confirmado: false, sugerido: 'Admin Uno' });
    expect(porAdmin.autorizo).toBe('Dirección');
    const sinAutorizo = await actualizar(1, v1.id, { version: 2, autorizoNombre: '   ' });
    expect(sinAutorizo.autorizo).toBeNull();
  });

  it('no se puede confirmar un nombre vacío', async () => {
    const v1 = await crear(2, codigoUnico());
    expect((await falla(actualizar(2, v1.id, { version: 1, elaboroNombre: '   ', elaboroConfirmado: true }))).code).toBe('ELABORO_REQUERIDO');
  });
});

describe('bloque 4 · las acciones se registran con el usuario autenticado real', () => {
  it('creación, edición, descarte: cada fila de auditoría lleva usuario/correo/solicitud de la sesión que actuó', async () => {
    const codigo = codigoUnico();
    const crea = actor(2);
    const v1 = await service.crearBorrador(crea, entradaBorrador(codigo) as never) as Vista;
    const edita = actor(1);
    await service.actualizarBorrador(edita, v1.id, { version: 1, datos: { ...v1.especificacion.datos, ancho: '16' } } as never);
    const descarta = actor(2);
    await service.descartarBorrador(descarta, v1.id, 2);
    const r = await poolAdmin.query(
      "SELECT usuario_id, usuario_email, request_id, operacion, tabla FROM audit.cambios WHERE esquema = 'manufactura' AND request_id = ANY($1) ORDER BY cambio_id", [[crea.requestId, edita.requestId, descarta.requestId]]);
    const por = (rid: string) => r.rows.filter((x) => x.request_id === rid);
    expect(por(crea.requestId).every((x) => x.usuario_id === '2' && x.usuario_email === 'g2@example.invalid')).toBe(true);
    expect(por(edita.requestId)).toHaveLength(1);
    expect(por(edita.requestId)[0]).toMatchObject({ usuario_id: '1', usuario_email: 'admin1@example.invalid', operacion: 'UPDATE', tabla: 'revisiones' });
    expect(por(descarta.requestId)[0]).toMatchObject({ usuario_id: '2', operacion: 'UPDATE' });
  });

  it('la auditoría no guarda la especificación, los nombres impresos ni el cliente de un borrador', async () => {
    const codigo = codigoUnico();
    const a = actor(2);
    await service.crearBorrador(a, entradaBorrador(codigo, { cliente: { nombre: 'Cliente Confidencial SA' } }) as never);
    const r = await poolAdmin.query("SELECT datos_nuevos FROM audit.cambios WHERE esquema = 'manufactura' AND request_id = $1", [a.requestId]);
    const texto = JSON.stringify(r.rows);
    expect(texto).not.toContain(codigo);
    expect(texto).not.toContain('Cliente Confidencial');
    expect(texto).not.toContain('General Dos');
    expect(texto).not.toContain('especificacion"');
  });

  it('la identidad de la sesión se limita a la transacción: una petición sin sesión válida no escribe nada', async () => {
    const sinSesion = { userId: '', email: '', displayName: 'X', role: 'GENERAL' as const, requestId: 'sin-sesion' };
    const e = await falla(service.crearBorrador(sinSesion, entradaBorrador(codigoUnico()) as never));
    expect(e.status).toBe(403);
    const n = await poolAdmin.query("SELECT count(*)::int AS n FROM audit.cambios WHERE request_id = 'sin-sesion'");
    expect(n.rows[0].n).toBe(0);
  });

  it('una cuenta inactiva o inexistente no puede actuar aunque el servicio reciba su id', async () => {
    const e = await falla(service.crearBorrador({ userId: '9999', email: 'fantasma@example.invalid', displayName: 'Fantasma', role: 'ADMIN', requestId: 'fantasma' }, entradaBorrador(codigoUnico()) as never));
    expect([403, 422]).toContain(e.status);
  });
});
