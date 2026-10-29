import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CreateDraftDto, UpdateDraftDto, AssignReviewerDto, VersionDto } from '../../src/manufacturing-documents/documents.dto';
import { actor, falla, codigoUnico, crearServicio, entradaBorrador, poolAdmin, type Vista } from './entorno';

// BLOQUE 1 · crear y recuperar borradores (instancia PostgreSQL desechable con el UP real de la migración).
const { service } = crearServicio();
const tuberia = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
const crear = (n: 1 | 2 | 3, codigo: string, extra: Record<string, unknown> = {}): Promise<Vista> => service.crearBorrador(actor(n), entradaBorrador(codigo, extra) as never) as Promise<Vista>;

describe('bloque 1 · crear y recuperar borradores', () => {
  it('crea un borrador con la identidad de la SESIÓN, «Elaboró» sugerido sin confirmar, versión 1 y huella calculada por la base', async () => {
    const codigo = codigoUnico();
    const v = await crear(2, codigo);
    expect(v).toMatchObject({ codigo, variante: null, estado: 'BORRADOR', revision: null, version: 1, entorno: 'PRUEBA', propio: true, creadoPor: 'g2@example.invalid', actualizadoPor: 'g2@example.invalid' });
    expect(v.elaboro).toEqual({ nombre: 'General Dos', confirmado: false, sugerido: 'General Dos' });
    expect(v.huella).toMatch(/^[0-9a-f]{64}$/);
    expect(v.especificacion.datos.codigo).toBe(codigo);
    expect(v.permisos).toMatchObject({ editar: true, finalizar: true, asignarRevisor: true, descargarPdf: false });
  });

  it('el código del documento manda sobre lo que traiga datos.codigo (la identidad del documento no puede divergir)', async () => {
    const codigo = codigoUnico();
    const v = await service.crearBorrador(actor(2), { codigo, familia: 'BOLSA_PLANA_1', datos: { codigo: 'OTRO-CODIGO', ancho: '13' } } as never) as Vista;
    expect(v.especificacion.datos.codigo).toBe(codigo);
  });

  it('el actor registrado en la base es el de la sesión: auditoría con usuario, correo, origen y request reales', async () => {
    const codigo = codigoUnico();
    const a = actor(3);
    const v = await service.crearBorrador(a, entradaBorrador(codigo) as never) as Vista;
    const r = await poolAdmin.query("SELECT usuario_id, usuario_email, origen, request_id, tabla FROM audit.cambios WHERE esquema = 'manufactura' AND request_id = $1 ORDER BY cambio_id", [a.requestId]);
    expect(r.rows.map((x) => x.tabla)).toEqual(['documentos', 'revisiones']);
    for (const fila of r.rows) expect(fila).toMatchObject({ usuario_id: '3', usuario_email: 'g3@example.invalid', origen: 'DAUBERT_HUB' });
    expect(v.creadoPor).toBe('g3@example.invalid');
  });

  it('los DTO no admiten campos de actor, estado, revisión, huella ni fechas (el ValidationPipe global los rechaza)', async () => {
    const base = entradaBorrador(codigoUnico());
    for (const campo of ['creadoPor', 'creado_por_usuario_id', 'usuarioId', 'usuarioEmail', 'actualizadoPor', 'finalizadoPor', 'estado', 'revision', 'huella', 'version', 'createdAt', 'elaboroConfirmado', 'revisorUsuarioId', 'entorno']) {
      await expect(tuberia.transform({ ...base, [campo]: campo === 'version' ? 5 : 'x' }, { type: 'body', metatype: CreateDraftDto })).rejects.toThrow();
    }
    await expect(tuberia.transform({ version: 1, creadoPor: 'otro@x' }, { type: 'body', metatype: UpdateDraftDto })).rejects.toThrow();
    await expect(tuberia.transform({ version: 1, usuarioId: '9' }, { type: 'body', metatype: VersionDto })).rejects.toThrow();
    await expect(tuberia.transform({ version: 1, revisorUsuarioId: '2', actor: 'x' }, { type: 'body', metatype: AssignReviewerDto })).rejects.toThrow();
    await expect(tuberia.transform({ ...base, datos: { codigo: 'A', usuario: 'x' } }, { type: 'body', metatype: CreateDraftDto })).rejects.toThrow();
    await expect(tuberia.transform(base, { type: 'body', metatype: CreateDraftDto })).resolves.toBeInstanceOf(CreateDraftDto);
  });

  it('un documento (código + variante) es único; el 409 no trae identificadores y el borrador propio se recupera por la lista/historial', async () => {
    const codigo = codigoUnico();
    const primero = await crear(2, codigo);
    const e = await falla(crear(2, codigo));
    expect(e).toMatchObject({ status: 409, code: 'DOCUMENT_EXISTS' });
    expect(Object.keys(e.body).sort()).toEqual(['code', 'message']);
    const hist = await service.historial(actor(2), codigo);
    expect((hist.data as Vista[]).map((r) => r.id)).toEqual([primero.id]);
  });

  it('privacidad: el 409 es IDÉNTICO si el choque es con un borrador ajeno invisible, con uno propio o con una versión finalizada', async () => {
    const ajeno = codigoUnico();
    await crear(2, ajeno);
    const propio = codigoUnico();
    await crear(3, propio);
    const finalizado = codigoUnico();
    const f = await crear(2, finalizado, { cliente: { nombre: 'Cliente de prueba' } });
    const c = await service.actualizarBorrador(actor(2), f.id, { version: 1, elaboroConfirmado: true } as never) as Vista;
    await service.finalizar(actor(2), f.id, c.version);
    const cuerpos = [await falla(crear(3, ajeno)), await falla(crear(3, propio)), await falla(crear(3, finalizado)), await falla(crear(1, ajeno))];
    for (const e of cuerpos) expect(e).toMatchObject({ status: 409, code: 'DOCUMENT_EXISTS' });
    expect(new Set(cuerpos.map((e) => JSON.stringify(e.body))).size).toBe(1);
    // Una carrera entre dos altas simultáneas (la restricción única de la base) responde igual.
    const codigo = codigoUnico();
    const r = await Promise.allSettled([crear(2, codigo), crear(3, codigo)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const perdedor = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(perdedor.reason.getResponse()).toEqual(cuerpos[0]!.body);
  });

  it('otra cuenta GENERAL no ve el borrador ajeno: ni lo recupera, ni lo abre, ni se entera de su id', async () => {
    const codigo = codigoUnico();
    const mio = await crear(2, codigo);
    const e = await falla(crear(3, codigo));
    expect(e).toMatchObject({ status: 409, code: 'DOCUMENT_EXISTS' });
    expect(e.body.borradorId ?? null).toBeNull();
    expect(e.body.documentoId ?? null).toBeNull();
    const abrir = await falla(service.obtener(actor(3), mio.id));
    expect(abrir.status).toBe(404);
    const lista = await service.listarAbiertas(actor(3));
    expect((lista.data as Vista[]).some((r) => r.id === mio.id)).toBe(false);
    const hist = await service.historial(actor(3), codigo);
    expect(hist.data).toEqual([]);
  });

  it('el creador y un ADMIN sí recuperan el borrador', async () => {
    const codigo = codigoUnico();
    const mio = await crear(2, codigo);
    const propia = await service.listarAbiertas(actor(2));
    expect((propia.data as Vista[]).find((r) => r.id === mio.id)).toMatchObject({ codigo, estado: 'BORRADOR', propio: true });
    const admin = await service.listarAbiertas(actor(1));
    expect((admin.data as Vista[]).find((r) => r.id === mio.id)).toMatchObject({ propio: false });
    const abierto = await service.obtener(actor(1), mio.id) as Vista;
    expect(abierto.especificacion.datos.codigo).toBe(codigo);
    expect(abierto.permisos.editar).toBe(true);
    const mismo = await service.obtener(actor(2), mio.id) as Vista;
    expect(mismo.id).toBe(mio.id);
  });

  it('un código puede tener varias variantes (hoja doblada / extendida); la unicidad no distingue mayúsculas', async () => {
    const codigo = codigoUnico();
    const sin = await crear(2, codigo);
    const doblada = await crear(2, codigo, { variante: 'Doblada' });
    const extendida = await crear(2, codigo, { variante: 'Extendida' });
    expect(new Set([sin.documentoId, doblada.documentoId, extendida.documentoId]).size).toBe(3);
    expect(doblada.variante).toBe('Doblada');
    expect((await falla(crear(2, codigo, { variante: 'DOBLADA' }))).code).toBe('DOCUMENT_EXISTS');
    const hist = await service.historial(actor(2), codigo);
    expect((hist.data as Vista[]).map((r) => r.variante ?? '').sort()).toEqual(['', 'Doblada', 'Extendida']);
  });

  it('acepta descripciones legítimas con «token», «secret» o «password»; rechaza nombres de campo de credencial', async () => {
    const codigo = codigoUnico();
    const descripcion = 'BOLSA TOKEN SECRET PASSWORD AUTHORIZATION BEARER para empaque';
    const v = await service.crearBorrador(actor(2), { codigo, familia: 'BOLSA_PLANA_1', datos: { ...entradaBorrador(codigo).datos as object, descripcion }, bind: { Code: codigo, Title: descripcion, Description: descripcion } } as never) as Vista;
    expect(v.especificacion.datos.descripcion).toBe(descripcion);
    expect(v.especificacion.bind.Title).toBe(descripcion);
    const e = await falla(service.crearBorrador(actor(2), entradaBorrador(codigoUnico(), { procedencia: { apiKey: 'campo' } }) as never));
    expect(e.status).toBe(400);
    const t = await falla(service.crearBorrador(actor(2), entradaBorrador(codigoUnico(), { procedencia: { descripcion: 1 } }) as never));
    expect(t.status).toBe(400);
  });

  it('cliente: vinculado a core.empresas (rol CLIENTE) o manual SIN verificar; un proveedor o un id inexistente se rechazan', async () => {
    const vinculado = await crear(2, codigoUnico(), { cliente: { empresaId: '1' } });
    expect(vinculado.cliente).toEqual({ empresaId: '1', nombre: 'Cliente simulado', verificado: true });
    expect(vinculado.especificacion.datos.cliente).toBe('Cliente simulado');
    const manual = await crear(2, codigoUnico(), { cliente: { nombre: '  Cliente   manual ' } });
    expect(manual.cliente).toEqual({ empresaId: null, nombre: 'Cliente manual', verificado: false });
    expect((await falla(crear(2, codigoUnico(), { cliente: { empresaId: '2' } }))).code).toBe('CLIENTE_NO_VALIDO');
    expect((await falla(crear(2, codigoUnico(), { cliente: { empresaId: '999' } }))).code).toBe('CLIENTE_NO_VALIDO');
    const sin = await crear(2, codigoUnico());
    expect(sin.cliente).toBeNull();
  });

  it('las secciones guardadas se limitan a las permitidas: el BIND solo conserva sus 5 campos y los reconocimientos conservan {id, huella}', async () => {
    const codigo = codigoUnico();
    const v = await crear(2, codigo, { bind: { Code: codigo, Title: 'T', Weight: 1.5 }, colorPersonalizado: { nombre: 'Verde 5', hex: '#00AA00' }, incidenciasReconocidas: [{ id: 'PRODUCTO_FAMILIA:producto', huella: '["x"]' }], procedencia: { ancho: 'BIND' } });
    expect(Object.keys(v.especificacion).sort()).toEqual(['bind', 'colorPersonalizado', 'datos', 'incidenciasReconocidas', 'procedencia']);
    expect(v.especificacion.bind).toEqual({ Code: codigo, Title: 'T', Weight: 1.5 });
  });
});
