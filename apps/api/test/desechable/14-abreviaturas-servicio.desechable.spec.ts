import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { DatabaseService } from '../../src/database/database.service';
import { ClientAbbreviationsRepository } from '../../src/manufacturing-documents/client-abbreviations.repository';
import { ClientAbbreviationsService } from '../../src/manufacturing-documents/client-abbreviations.service';
import { DocumentsRepository } from '../../src/manufacturing-documents/documents.repository';
import { actor, falla, poolAdmin, poolApp } from './entorno';

// Servicio de abreviaturas de cliente (lo que usa la API) contra la instancia desechable CON la migración 104. Cuentas: 1 y 5 ADMIN, 2 y 3 GENERAL.
const servicio = new ClientAbbreviationsService(new DocumentsRepository({ connect: () => poolApp.connect() } as unknown as DatabaseService), new ClientAbbreviationsRepository());
let n = 0;
async function cliente(nombre: string, rol = 'CLIENTE'): Promise<string> {
  n += 1;
  const r = await poolAdmin.query<{ empresa_id: string }>('INSERT INTO core.empresas (tipo_empresa, nombre_comercial) VALUES ($1, $2) RETURNING empresa_id', [rol, `${nombre} S${Date.now()}-${n}`]);
  await poolAdmin.query('INSERT INTO core.empresa_roles (empresa_id, rol) VALUES ($1, $2)', [r.rows[0]!.empresa_id, rol]);
  return r.rows[0]!.empresa_id;
}
let u = 100;
const pref = (): string => { u += 1; return `Y${String.fromCharCode(65 + (u % 26))}${String.fromCharCode(65 + (Math.floor(u / 26) % 26))}`; };
const admin = () => actor(1);

describe('abreviaturas de cliente · servicio (instancia desechable con la 104)', () => {
  it('el catálogo está habilitado; coincidencia exacta: una sola alternativa, que el usuario debe confirmar (estado EXACTA, sin asignar nada)', async () => {
    expect(await servicio.estado(actor(2))).toEqual({ disponible: true, puedeResolver: false });
    expect(await servicio.estado(admin())).toEqual({ disponible: true, puedeResolver: true });
    const p = pref(); const c = await cliente('Exacto');
    await servicio.crear(admin(), { abreviatura: p.toLowerCase(), clienteId: c });
    const s = await servicio.sugerir(actor(2), `${p.toLowerCase()}fpmg001`);
    expect(s).toMatchObject({ disponible: true, estado: 'EXACTA', codigo: `${p}FPMG001` });
    expect(s.alternativas).toHaveLength(1);
    expect(s.alternativas[0]).toMatchObject({ clienteId: c, confirmada: true, nivelNombre: 'GENERAL' });
  });

  it('cliente sin asociación: SIN_SUGERENCIAS (distinto de «catálogo no habilitado»)', async () => {
    const s = await servicio.sugerir(actor(2), 'QQQFPMG001');
    expect(s).toMatchObject({ disponible: true, estado: 'SIN_SUGERENCIAS', alternativas: [] });
  });

  it('prefijo compartido por dos clientes: ELEGIR con las dos alternativas; nunca se resuelve a favor de uno', async () => {
    const p = pref(); const a = await cliente('Cat'); const b = await cliente('Elec');
    await servicio.crear(admin(), { abreviatura: p, clienteId: a }); await servicio.crear(admin(), { abreviatura: p, clienteId: b });
    const s = await servicio.sugerir(actor(3), `${p}FPMG010`);
    expect(s.estado).toBe('ELEGIR');
    expect(s.alternativas.map((x) => x.clienteId).sort()).toEqual([a, b].sort());
  });

  it('código completo ambiguo (ITESFCP003): dos excepciones confirmadas ⇒ ELEGIR; con una sola excepción gana sobre la general ambigua', async () => {
    const p = pref(); const a = await cliente('Ite'); const b = await cliente('Mahle');
    await servicio.crear(admin(), { abreviatura: p, clienteId: a }); await servicio.crear(admin(), { abreviatura: p, clienteId: b });
    await servicio.crear(admin(), { abreviatura: p, clienteId: a, alcance: 'CODIGO_COMPLETO', codigoPatron: `${p}FCP003` });
    const unica = await servicio.sugerir(actor(2), `${p}FCP003`);
    expect(unica).toMatchObject({ estado: 'EXACTA' });
    expect(unica.alternativas[0]).toMatchObject({ clienteId: a, nivelNombre: 'CODIGO_COMPLETO' });
    expect(unica.relacionadas.map((r) => r.clienteId)).toEqual([b]);                // la otra asociación general se muestra como información
    await servicio.crear(admin(), { abreviatura: p, clienteId: b, alcance: 'CODIGO_COMPLETO', codigoPatron: `${p}FCP003` });
    const ambigua = await servicio.sugerir(actor(2), `${p}FCP003`);
    expect(ambigua.estado).toBe('ELEGIR');
    expect(ambigua.alternativas).toHaveLength(2);
  });

  it('confirmada frente a propuesta: la propuesta no cuenta como sugerencia (va aparte, sin confirmar); al confirmarla pasa a decidir', async () => {
    const p = pref(); const conf = await cliente('Conf'); const prop = await cliente('Prop');
    await servicio.crear(admin(), { abreviatura: p, clienteId: conf });
    const propuesta = await servicio.crear(actor(2), { abreviatura: p, clienteId: prop });
    expect(propuesta).toMatchObject({ estado: 'PROPUESTA', origen: 'PROPUESTA_USUARIO' });
    const antes = await servicio.sugerir(actor(2), `${p}FPMG001`);
    expect(antes).toMatchObject({ estado: 'EXACTA' });
    expect(antes.alternativas.map((x) => x.clienteId)).toEqual([conf]);
    expect(antes.sinConfirmar.map((x) => x.clienteId)).toEqual([prop]);              // la ve quien la propuso
    expect((await servicio.sugerir(actor(3), `${p}FPMG001`)).sinConfirmar).toEqual([]);   // otra cuenta GENERAL no la ve
    await servicio.resolver(admin(), propuesta.id, 'CONFIRMAR', undefined);
    expect((await servicio.sugerir(actor(2), `${p}FPMG001`)).estado).toBe('ELEGIR');
  });

  it('propuesta por GENERAL y resolución por ADMIN: GENERAL no confirma ni lista; ADMIN confirma/rechaza con motivo; GENERAL retira solo la suya', async () => {
    const c = await cliente('Flujo'); const p = pref();
    const x = await servicio.crear(actor(2), { abreviatura: p, clienteId: c });
    expect((await falla(servicio.resolver(actor(2), x.id, 'CONFIRMAR', undefined))).status).toBe(403);
    expect((await falla(servicio.listar(actor(2), undefined, undefined))).status).toBe(403);
    expect((await falla(servicio.resolver(actor(3), x.id, 'RETIRAR', undefined))).status).toBe(404);   // no la ve
    const lista = await servicio.listar(admin(), 'PROPUESTA', p);
    expect(lista.data.map((f) => f.id)).toContain(x.id);
    expect((await falla(servicio.resolver(admin(), x.id, 'RECHAZAR', ' '))).status).toBe(422);
    expect(await servicio.resolver(admin(), x.id, 'RECHAZAR', 'Es un prefijo de producto')).toMatchObject({ estado: 'RECHAZADA', resueltaPor: 'admin1@example.invalid', motivo: 'Es un prefijo de producto' });
    const y = await servicio.crear(actor(2), { abreviatura: pref(), clienteId: c });
    expect(await servicio.resolver(actor(2), y.id, 'RETIRAR', undefined)).toMatchObject({ estado: 'INACTIVA' });
  });

  it('un ADMIN registra desde la hoja (confirmada) o solo propone; el servicio rechaza empresas sin rol CLIENTE, duplicados y formatos inválidos', async () => {
    const c = await cliente('Hoja'); const prov = await cliente('Prov', 'PROVEEDOR'); const p = pref();
    expect(await servicio.crear(admin(), { abreviatura: p, clienteId: c, evidencia: 'Registrada desde la hoja' })).toMatchObject({ estado: 'CONFIRMADA', origen: 'MANUAL_ADMIN', evidencia: 'Registrada desde la hoja' });
    expect(await servicio.crear(admin(), { abreviatura: pref(), clienteId: c, soloProponer: true })).toMatchObject({ estado: 'PROPUESTA' });
    expect((await falla(servicio.crear(admin(), { abreviatura: p, clienteId: c }))).body.code).toBe('ABREVIATURA_DUPLICADA');
    expect((await falla(servicio.crear(admin(), { abreviatura: pref(), clienteId: prov }))).body.code).toBe('CLIENTE_INVALIDO');
    expect((await falla(servicio.crear(admin(), { abreviatura: p, clienteId: c, alcance: 'CONTEXTO', codigoPatron: 'ZZZZ' }))).body.code).toBe('ABREVIATURA_INVALIDA');
    expect((await falla(servicio.crear(admin(), { abreviatura: p, clienteId: c, alcance: 'CONTEXTO' }))).body.code).toBe('PATRON_REQUERIDO');
    expect((await falla(servicio.crear(admin(), { abreviatura: pref(), clienteId: '999999999' }))).body.code).toBe('CLIENTE_INVALIDO');
  });

  it('inactivar y reactivar: una abreviatura inactiva deja de sugerir; reactivarla la devuelve', async () => {
    const c = await cliente('Ciclo'); const p = pref();
    const x = await servicio.crear(admin(), { abreviatura: p, clienteId: c });
    await servicio.resolver(admin(), x.id, 'INACTIVAR', 'Ya no se usa');
    expect((await servicio.sugerir(actor(2), `${p}FPMG001`)).estado).toBe('SIN_SUGERENCIAS');
    await servicio.resolver(admin(), x.id, 'REACTIVAR', undefined);
    expect((await servicio.sugerir(actor(2), `${p}FPMG001`)).estado).toBe('EXACTA');
    await servicio.resolver(admin(), x.id, 'INACTIVAR', 'otra vez');
    expect((await falla(servicio.resolver(admin(), x.id, 'RECHAZAR', 'no aplica desde inactiva'))).body.code).toBe('TRANSICION_NO_PERMITIDA');
  });
});
