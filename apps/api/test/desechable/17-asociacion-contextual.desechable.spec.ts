import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { DatabaseService } from '../../src/database/database.service';
import { ClientAbbreviationsRepository } from '../../src/manufacturing-documents/client-abbreviations.repository';
import { ClientAbbreviationsService } from '../../src/manufacturing-documents/client-abbreviations.service';
import { DocumentsRepository } from '../../src/manufacturing-documents/documents.repository';
import { actor, crearServicio, entradaBorrador, poolAdmin, poolApp, type Vista } from './entorno';

// Flujo contextual de la hoja de punta a punta en la instancia desechable (101–104): el usuario elige un cliente DISTINTO al sugerido, propone una excepción por código completo (GENERAL propone, ADMIN confirma)
// o descarta la invitación («Solo esta hoja»). La elección del cliente y el guardado de la hoja no dependen de la invitación. Cuentas: 1 ADMIN, 2 y 3 GENERAL.
const { service: documentos } = crearServicio();
const abreviaturas = new ClientAbbreviationsService(new DocumentsRepository({ connect: () => poolApp.connect() } as unknown as DatabaseService), new ClientAbbreviationsRepository());
let n = 0;
async function cliente(nombre: string): Promise<string> {
  n += 1;
  const e = await poolAdmin.query("INSERT INTO core.empresas (tipo_empresa, nombre_comercial) VALUES ('CLIENTE', $1) RETURNING empresa_id::text AS id", [`${nombre} ${Date.now()}-${n}`]);
  await poolAdmin.query("INSERT INTO core.empresa_roles (empresa_id, rol) VALUES ($1, 'CLIENTE')", [e.rows[0].id]);
  return e.rows[0].id;
}
const prefijo = (): string => { n += 1; return `W${String.fromCharCode(65 + (n % 26))}${String.fromCharCode(65 + (Math.floor(n / 26) % 26))}`; };
const filasDe = async (clienteId: string): Promise<number> => (await poolAdmin.query('SELECT count(*)::int AS n FROM manufactura.cliente_abreviaturas WHERE cliente_empresa_id = $1', [clienteId])).rows[0].n;
const instantanea = (v: Vista) => JSON.stringify({ version: v.version, cliente: v.cliente, datos: v.especificacion.datos, estado: v.estado });

describe('asociación contextual con un cliente distinto al sugerido (instancia desechable)', () => {
  it('sugiere A sin asignarlo; el usuario elige B; la propuesta (excepción por código completo) no toca la hoja; el ADMIN la confirma y B pasa a ser lo sugerido para ese código, sin ambigüedad para los demás', async () => {
    const p = prefijo(); const A = await cliente('Sugerido'); const B = await cliente('Elegido');
    await abreviaturas.crear(actor(1), { abreviatura: p, clienteId: A });
    const codigo = `${p}FPMG001`;
    const v = await documentos.crearBorrador(actor(2), entradaBorrador(codigo, { cliente: {} }) as never) as Vista;
    expect(v.cliente).toBeNull();                                                              // la sugerencia nunca asigna
    const s1 = await abreviaturas.sugerir(actor(2), codigo);
    expect(s1).toMatchObject({ estado: 'EXACTA' });
    expect(s1.alternativas.map((a) => a.clienteId)).toEqual([A]);
    expect(((await documentos.obtener(actor(2), v.id)) as Vista).cliente).toBeNull();           // consultar sugerencias no modifica la hoja

    // El usuario elige B (otro cliente del catálogo): la hoja lo acepta.
    const conB = await documentos.actualizarBorrador(actor(2), v.id, { version: v.version, cliente: { empresaId: B } } as never) as Vista;
    expect(conB.cliente).toMatchObject({ empresaId: B, verificado: true });
    const antes = instantanea(conB);

    // «¿Guardar esta relación para futuras hojas?» → revisa y PROPONE una excepción por código completo con la abreviatura ya identificada (p).
    const propuesta = await abreviaturas.crear(actor(2), { abreviatura: p, clienteId: B, alcance: 'CODIGO_COMPLETO', codigoPatron: codigo, evidencia: `Registrada desde la hoja de manufactura (código ${codigo}).` });
    expect(propuesta).toMatchObject({ estado: 'PROPUESTA', alcance: 'CODIGO_COMPLETO', codigoPatron: codigo, clienteId: B });
    expect(instantanea(await documentos.obtener(actor(2), v.id) as Vista)).toBe(antes);          // proponer NO modifica la hoja (ni su versión)
    const s2 = await abreviaturas.sugerir(actor(2), codigo);
    expect(s2.alternativas.map((a) => a.clienteId)).toEqual([A]);                              // sin confirmar no cambia lo sugerido
    expect(s2.sinConfirmar.map((a) => a.clienteId)).toEqual([B]);
    expect((await abreviaturas.sugerir(actor(3), codigo)).sinConfirmar).toEqual([]);            // otra cuenta no ve la propuesta ajena

    await abreviaturas.resolver(actor(1), propuesta.id, 'CONFIRMAR', undefined);
    const s3 = await abreviaturas.sugerir(actor(2), codigo);
    expect(s3).toMatchObject({ estado: 'EXACTA' });
    expect(s3.alternativas.map((a) => [a.clienteId, a.nivelNombre])).toEqual([[B, 'CODIGO_COMPLETO']]);   // la excepción prevalece sobre la general
    expect(s3.relacionadas.map((a) => a.clienteId)).toEqual([A]);
    const otro = await abreviaturas.sugerir(actor(2), `${p}FPMG002`);                            // otros códigos del prefijo siguen sin ambigüedad
    expect(otro).toMatchObject({ estado: 'EXACTA' });
    expect(otro.alternativas.map((a) => a.clienteId)).toEqual([A]);
    expect(instantanea(await documentos.obtener(actor(2), v.id) as Vista)).toBe(antes);          // y la hoja sigue igual tras confirmarse
  });

  it('«Solo esta hoja» (descartar la invitación): no se crea ninguna asociación y la hoja con el cliente elegido se guarda y se finaliza con normalidad', async () => {
    const p = prefijo(); const A = await cliente('Sugerido 2'); const B = await cliente('Elegido 2');
    await abreviaturas.crear(actor(1), { abreviatura: p, clienteId: A });
    const codigo = `${p}FPMG010`;
    const v = await documentos.crearBorrador(actor(2), entradaBorrador(codigo, { cliente: { empresaId: B } }) as never) as Vista;
    expect(v.cliente).toMatchObject({ empresaId: B });
    expect((await abreviaturas.sugerir(actor(2), codigo)).alternativas.map((a) => a.clienteId)).toEqual([A]);   // la invitación aparecería; el usuario la descarta = no llama a nada
    const c = await documentos.actualizarBorrador(actor(2), v.id, { version: v.version, elaboroConfirmado: true } as never) as Vista;
    const f = await documentos.finalizar(actor(2), c.id, c.version) as Vista;
    expect(f).toMatchObject({ estado: 'FINALIZADA', cliente: { empresaId: B } });
    expect(await filasDe(B)).toBe(0);                                                          // nada se registró para el cliente elegido
    expect(await filasDe(A)).toBe(1);                                                          // y la asociación existente no cambió
  });

  it('proponer una relación que ya existe (duplicado) no genera una segunda fila ni un error para el usuario del formulario', async () => {
    const p = prefijo(); const B = await cliente('Duplicada');
    const codigo = `${p}FPMG020`;
    const args = { abreviatura: p, clienteId: B, alcance: 'CODIGO_COMPLETO' as const, codigoPatron: codigo };
    await abreviaturas.crear(actor(2), args);
    await expect(abreviaturas.crear(actor(2), args)).rejects.toMatchObject({ status: 409, response: { code: 'ABREVIATURA_DUPLICADA' } });   // la interfaz lo informa una vez («ya estaba registrada»)
    expect(await filasDe(B)).toBe(1);
  });
});
