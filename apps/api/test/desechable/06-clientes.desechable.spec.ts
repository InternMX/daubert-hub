import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { actor, codigoUnico, crearServicio, entradaBorrador, falla, MotorFalso, poolAdmin, type Vista } from './entorno';

// Relación histórica con clientes: las claves foráneas impiden BORRAR una empresa referenciada, la DESACTIVACIÓN sigue siendo posible y cada revisión conserva el cliente con que se finalizó.
const { service } = crearServicio(new MotorFalso());
async function nuevaEmpresa(nombre: string): Promise<string> {
  const e = await poolAdmin.query("INSERT INTO core.empresas (tipo_empresa, nombre_comercial) VALUES ('CLIENTE', $1) RETURNING empresa_id::text AS id", [nombre]);
  await poolAdmin.query("INSERT INTO core.empresa_roles (empresa_id, rol) VALUES ($1, 'CLIENTE')", [e.rows[0].id]);
  return e.rows[0].id;
}
async function borradorCon(empresaId: string): Promise<Vista> {
  const v = await service.crearBorrador(actor(2), entradaBorrador(codigoUnico('CLI'), { cliente: { empresaId } }) as never) as Vista;
  return service.actualizarBorrador(actor(2), v.id, { version: 1, elaboroConfirmado: true } as never) as Promise<Vista>;
}

describe('clientes: relación histórica con core.empresas', () => {
  it('una empresa referenciada por un documento no se puede borrar físicamente; una no referenciada sí; desactivar siempre es posible', async () => {
    const usada = await nuevaEmpresa('Cliente Usado SA');
    const libre = await nuevaEmpresa('Cliente Libre SA');
    await borradorCon(usada);
    await expect(poolAdmin.query('DELETE FROM core.empresas WHERE empresa_id = $1', [usada])).rejects.toThrow(/foreign key|referenc/i);
    await expect(poolAdmin.query('DELETE FROM core.empresa_roles WHERE empresa_id = $1', [libre])).resolves.toBeTruthy();
    await expect(poolAdmin.query('DELETE FROM core.empresas WHERE empresa_id = $1', [libre])).resolves.toBeTruthy();
    // Operaciones habituales de la API de clientes/empresas: cambiar estatus, desactivar el rol, renombrar.
    await expect(poolAdmin.query("UPDATE core.empresas SET estatus = 'INACTIVO' WHERE empresa_id = $1", [usada])).resolves.toBeTruthy();
    await expect(poolAdmin.query("UPDATE core.empresa_roles SET estatus = 'INACTIVO' WHERE empresa_id = $1 AND rol = 'CLIENTE'", [usada])).resolves.toBeTruthy();
    await expect(poolAdmin.query("UPDATE core.empresas SET nombre_comercial = 'Renombrada' WHERE empresa_id = $1", [usada])).resolves.toBeTruthy();
  });

  it('la revisión finalizada conserva el nombre y el id del cliente aunque la empresa se renombre o se desactive después', async () => {
    const id = await nuevaEmpresa('Cliente Histórico SA');
    const b = await borradorCon(id);
    const f = await service.finalizar(actor(2), b.id, b.version) as Vista;
    expect(f.cliente).toEqual({ empresaId: id, nombre: 'Cliente Histórico SA', verificado: true });
    expect(f.especificacion.datos.cliente).toBe('Cliente Histórico SA');
    await poolAdmin.query("UPDATE core.empresas SET nombre_comercial = 'Nombre Nuevo SA', estatus = 'INACTIVO' WHERE empresa_id = $1", [id]);
    const despues = await service.obtener(actor(3), b.id) as Vista;
    expect(despues.cliente).toEqual({ empresaId: id, nombre: 'Cliente Histórico SA', verificado: true });
    expect(despues.huella).toBe(f.huella);
    expect((await service.descargarPdf(actor(3), b.id)).sha256).toBe(f.pdf.sha256);
  });

  it('no se finaliza con un cliente que ya no está activo (422) ni con un nombre que cambió en el catálogo (409); se corrige reseleccionándolo', async () => {
    const id = await nuevaEmpresa('Cliente Cambiante SA');
    const b = await borradorCon(id);
    await poolAdmin.query("UPDATE core.empresas SET nombre_comercial = 'Cliente Cambiante Renombrado SA' WHERE empresa_id = $1", [id]);
    const e1 = await falla(service.finalizar(actor(2), b.id, b.version));
    expect(e1).toMatchObject({ status: 409, code: 'CLIENTE_ACTUALIZADO' });
    expect(e1.body.nombreActual).toBe('Cliente Cambiante Renombrado SA');
    const re = await service.actualizarBorrador(actor(2), b.id, { version: b.version, cliente: { empresaId: id } } as never) as Vista;
    expect(re.cliente?.nombre).toBe('Cliente Cambiante Renombrado SA');
    await poolAdmin.query("UPDATE core.empresas SET estatus = 'INACTIVO' WHERE empresa_id = $1", [id]);
    expect((await falla(service.finalizar(actor(2), b.id, re.version))).code).toBe('CLIENTE_NO_VALIDO');
    expect((await service.obtener(actor(2), b.id) as Vista).estado).toBe('BORRADOR');
    // Con identificación manual (solo TEST, marcada) sí puede continuar.
    const manual = await service.actualizarBorrador(actor(2), b.id, { version: re.version, cliente: { nombre: 'Cliente manual' } } as never) as Vista;
    expect(manual.cliente).toEqual({ empresaId: null, nombre: 'Cliente manual', verificado: false });
    expect((await service.finalizar(actor(2), b.id, manual.version) as Vista).estado).toBe('FINALIZADA');
  });
});
