import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { actor, poolAdmin, poolApp } from './entorno';

// Migración 104 (abreviaturas de cliente) en la instancia desechable, con el ROL DE LA APLICACIÓN. Casos reales del análisis histórico: prefijos compartidos por clientes distintos (ANC, CAT, CIE, DAI, FIL),
// separación por contexto (DAID/DAIM) y contradicciones por código completo (ITESFCP003). Cuentas: 1 y 5 ADMIN, 2 y 3 GENERAL.
type Cliente = PoolClient;
async function conSesion<T>(n: 1 | 2 | 3 | 5 | null, trabajo: (c: Cliente) => Promise<T>): Promise<T> {
  const a = n === null ? null : actor(n);
  const c = await poolApp.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.origin','DAUBERT_HUB',true), set_config('app.request_id',$1,true), set_config('app.user_id',$2,true), set_config('app.user_email',$3,true)", [a?.requestId ?? 'sin-sesion', a?.userId ?? '', a?.email ?? '']);
    const r = await trabajo(c);
    await c.query('COMMIT');
    return r;
  } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
}
const falla = async (p: Promise<unknown>): Promise<{ code?: string; message: string }> => { try { await p; } catch (e) { return e as { code?: string; message: string }; } throw new Error('Se esperaba un error'); };

let n = 0;
async function cliente(nombre: string, rol = 'CLIENTE', estatus = 'ACTIVO'): Promise<number> {
  n += 1;
  const r = await poolAdmin.query<{ empresa_id: string }>("INSERT INTO core.empresas (tipo_empresa, nombre_comercial, estatus) VALUES ($1, $2, $3) RETURNING empresa_id", [rol, `${nombre} ${Date.now()}-${n}`, estatus]);
  const id = Number(r.rows[0]!.empresa_id);
  await poolAdmin.query('INSERT INTO core.empresa_roles (empresa_id, rol, estatus) VALUES ($1, $2, $3)', [id, rol, estatus === 'ACTIVO' ? 'ACTIVO' : 'INACTIVO']);
  return id;
}
interface Alta { abreviatura: string; cliente: number; alcance?: string; patron?: string | null; estado?: string; origen?: string; docs?: number; codigos?: number }
const alta = (c: Cliente, a: Alta) => c.query<{ abreviatura_id: string; public_id: string }>(
  `INSERT INTO manufactura.cliente_abreviaturas (abreviatura, cliente_empresa_id, alcance, codigo_patron, estado, origen, documentos_evidencia, codigos_evidencia)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING abreviatura_id, public_id`, [a.abreviatura, a.cliente, a.alcance ?? 'GENERAL', a.patron ?? null, a.estado ?? 'CONFIRMADA', a.origen ?? 'MANUAL_ADMIN', a.docs ?? 0, a.codigos ?? 0]).then((r) => r.rows[0]!);
const confirmar = async (a: Alta) => conSesion(1, (c) => alta(c, { ...a, estado: 'CONFIRMADA' }));
const sugerir = (codigo: string, noConfirmadas = false) => conSesion(2, (c) => c.query<{ nivel: number; cliente_empresa_id: string; decisivo: boolean; requiere_eleccion: boolean; abreviatura: string }>(
  'SELECT nivel, cliente_empresa_id, decisivo, requiere_eleccion, abreviatura FROM manufactura.fn_sugerir_cliente($1, $2)', [codigo, noConfirmadas]).then((r) => r.rows));
// Prefijos únicos por prueba para que las pruebas sean independientes entre sí.
let u = 0;
const pref = (): string => { u += 1; return `Q${String.fromCharCode(65 + (u % 26))}${String.fromCharCode(65 + Math.floor(u / 26) % 26)}`; };

describe('abreviaturas de cliente · motor de sugerencias (instancia desechable)', () => {
  it('abreviatura compartida (como ANC/CAT/CIE/FIL): devuelve todas las alternativas y exige elegir; jamás resuelve a favor de una empresa', async () => {
    const p = pref(); const a = await cliente('Uno'); const b = await cliente('Dos');
    await confirmar({ abreviatura: p, cliente: a }); await confirmar({ abreviatura: p, cliente: b });
    const r = await sugerir(`${p}FPMG001`);
    expect(r).toHaveLength(2);
    expect(r.every((x) => x.decisivo && x.requiere_eleccion && x.nivel === 3)).toBe(true);
    expect(new Set(r.map((x) => Number(x.cliente_empresa_id)))).toEqual(new Set([a, b]));
  });

  it('un único cliente confirmado se sugiere sin ambigüedad (la interfaz igual pedirá confirmación al usuario)', async () => {
    const p = pref(); const a = await cliente('Solo');
    await confirmar({ abreviatura: p, cliente: a });
    expect(await sugerir(`${p.toLowerCase()}fpmg002`)).toMatchObject([{ nivel: 3, decisivo: true, requiere_eleccion: false }]);
  });

  it('contexto validado (DAID/DAIM): separa clientes con la misma abreviatura general y tiene prioridad sobre ella', async () => {
    const p = pref(); const daido = await cliente('Daido'); const daimler = await cliente('Daimler');
    await confirmar({ abreviatura: p, cliente: daido }); await confirmar({ abreviatura: p, cliente: daimler });
    await confirmar({ abreviatura: p, cliente: daido, alcance: 'CONTEXTO', patron: `${p}D` });
    await confirmar({ abreviatura: p, cliente: daimler, alcance: 'CONTEXTO', patron: `${p}M` });
    const d = await sugerir(`${p}DFPMG001`);
    expect(d.filter((x) => x.decisivo)).toMatchObject([{ nivel: 2, requiere_eleccion: false, cliente_empresa_id: String(daido) }]);
    expect((await sugerir(`${p}MFPMG001`)).filter((x) => x.decisivo)).toMatchObject([{ nivel: 2, cliente_empresa_id: String(daimler) }]);
    // Un código que no encaja en ningún contexto vuelve a la asociación general ambigua.
    expect((await sugerir(`${p}XFPMG001`)).every((x) => x.nivel === 3 && x.requiere_eleccion)).toBe(true);
  });

  it('excepción por código completo confirmada tiene prioridad; si el propio código completo es contradictorio (ITESFCP003) se exige elegir', async () => {
    const p = pref(); const a = await cliente('Ite'); const b = await cliente('Mahle');
    await confirmar({ abreviatura: p, cliente: a }); await confirmar({ abreviatura: p, cliente: b });
    await confirmar({ abreviatura: p, cliente: a, alcance: 'CODIGO_COMPLETO', patron: `${p}FCP003` });
    expect((await sugerir(`${p}FCP003`)).filter((x) => x.decisivo)).toMatchObject([{ nivel: 1, requiere_eleccion: false, cliente_empresa_id: String(a) }]);
    await confirmar({ abreviatura: p, cliente: b, alcance: 'CODIGO_COMPLETO', patron: `${p}FCP003` });
    const r = (await sugerir(`${p}FCP003`)).filter((x) => x.decisivo);
    expect(r).toHaveLength(2);
    expect(r.every((x) => x.nivel === 1 && x.requiere_eleccion)).toBe(true);
  });

  it('las abreviaturas CANDIDATA y PROPUESTA (hallazgos sin confirmar) nunca son decisivas y siempre exigen elección', async () => {
    const p = pref(); const a = await cliente('Cand'); const b = await cliente('Prop');
    await conSesion(1, (c) => alta(c, { abreviatura: p, cliente: a, estado: 'CANDIDATA', origen: 'EXTRACCION_HISTORICA', docs: 5, codigos: 4 }));
    await conSesion(2, (c) => alta(c, { abreviatura: p, cliente: b, estado: 'PROPUESTA', origen: 'PROPUESTA_USUARIO' }));
    expect(await sugerir(`${p}FPMG001`)).toEqual([]);
    const r = await sugerir(`${p}FPMG001`, true);
    expect(r.every((x) => x.nivel === 9 && !x.decisivo && x.requiere_eleccion)).toBe(true);
    // La candidata es invisible para una cuenta GENERAL (solo ve confirmadas y las propias): queda la propuesta propia.
    expect(r).toHaveLength(1);
  });

  it('sin asociación no devuelve nada; no deriva abreviaturas de los primeros caracteres del código; entrada inválida no devuelve filas', async () => {
    const p = pref(); const a = await cliente('Derivar');
    await confirmar({ abreviatura: `${p}`, cliente: a });
    expect(await sugerir('ZZZFPMG001')).toEqual([]);
    expect(await sugerir(`${p.slice(0, 2)}`)).toEqual([]);           // «QA» no es la abreviatura «QAB»
    expect(await sugerir('')).toEqual([]);
    expect(await sugerir('!!')).toEqual([]);
  });

  it('un cliente que dejó de ser CLIENTE activo deja de sugerirse y no se puede confirmar', async () => {
    const p = pref(); const a = await cliente('Baja');
    const x = await confirmar({ abreviatura: p, cliente: a });
    await poolAdmin.query("UPDATE core.empresa_roles SET estatus = 'INACTIVO' WHERE empresa_id = $1", [a]);
    expect(await sugerir(`${p}FPMG001`)).toEqual([]);
    await conSesion(1, (c) => c.query('UPDATE manufactura.cliente_abreviaturas SET estado = $1 WHERE abreviatura_id = $2', ['INACTIVA', x.abreviatura_id]));
    expect((await falla(conSesion(1, (c) => c.query('UPDATE manufactura.cliente_abreviaturas SET estado = $1 WHERE abreviatura_id = $2', ['CONFIRMADA', x.abreviatura_id])))).message).toMatch(/ya no es una empresa activa/);
  });
});

describe('abreviaturas de cliente · reglas de la base (instancia desechable)', () => {
  it('solo se aceptan clientes con rol CLIENTE activo (un proveedor o una empresa inactiva se rechazan)', async () => {
    const prov = await cliente('Prov', 'PROVEEDOR'); const inactivo = await cliente('Inac', 'CLIENTE', 'INACTIVO');
    expect((await falla(conSesion(1, (c) => alta(c, { abreviatura: pref(), cliente: prov })))).message).toMatch(/rol CLIENTE activo/);
    expect((await falla(conSesion(1, (c) => alta(c, { abreviatura: pref(), cliente: inactivo })))).message).toMatch(/rol CLIENTE activo/);
  });

  it('GENERAL solo propone; ADMIN confirma o rechaza (con motivo) y queda quién resolvió; GENERAL no confirma ni ve candidatas', async () => {
    const a = await cliente('Gen'); const p = pref();
    expect((await falla(conSesion(2, (c) => alta(c, { abreviatura: pref(), cliente: a, estado: 'CONFIRMADA', origen: 'PROPUESTA_USUARIO' })))).code).toBe('42501');
    const prop = await conSesion(2, (c) => alta(c, { abreviatura: p, cliente: a, estado: 'PROPUESTA', origen: 'PROPUESTA_USUARIO', docs: 99, codigos: 99 }));
    const fila = await conSesion(2, (c) => c.query('SELECT estado, propuesta_por_usuario_id, documentos_evidencia FROM manufactura.cliente_abreviaturas WHERE abreviatura_id = $1', [prop.abreviatura_id]));
    expect(fila.rows[0]).toMatchObject({ estado: 'PROPUESTA', propuesta_por_usuario_id: '2', documentos_evidencia: 0 });   // la evidencia no la declara un usuario GENERAL
    expect((await falla(conSesion(2, (c) => c.query("UPDATE manufactura.cliente_abreviaturas SET estado = 'CONFIRMADA' WHERE abreviatura_id = $1", [prop.abreviatura_id])))).code).toBe('42501');
    expect((await falla(conSesion(1, (c) => c.query("UPDATE manufactura.cliente_abreviaturas SET estado = 'RECHAZADA' WHERE abreviatura_id = $1", [prop.abreviatura_id])))).message).toMatch(/check|motivo/i);
    await conSesion(1, (c) => c.query("UPDATE manufactura.cliente_abreviaturas SET estado = 'RECHAZADA', motivo_resolucion = 'Prefijo de producto, no de cliente' WHERE abreviatura_id = $1", [prop.abreviatura_id]));
    const r = await poolAdmin.query('SELECT estado, resuelta_por_usuario_id, motivo_resolucion FROM manufactura.cliente_abreviaturas WHERE abreviatura_id = $1', [prop.abreviatura_id]);
    expect(r.rows[0]).toMatchObject({ estado: 'RECHAZADA', resuelta_por_usuario_id: '1' });
    // RECHAZADA es terminal.
    expect((await falla(conSesion(1, (c) => c.query("UPDATE manufactura.cliente_abreviaturas SET estado = 'CONFIRMADA' WHERE abreviatura_id = $1", [prop.abreviatura_id])))).message).toMatch(/Transición no permitida/);
  });

  it('una cuenta GENERAL retira solo SU propuesta; otra cuenta GENERAL no la ve ni la modifica', async () => {
    const a = await cliente('Retiro'); const prop = await conSesion(2, (c) => alta(c, { abreviatura: pref(), cliente: a, estado: 'PROPUESTA', origen: 'PROPUESTA_USUARIO' }));
    const ajena = await conSesion(3, (c) => c.query("UPDATE manufactura.cliente_abreviaturas SET estado = 'INACTIVA' WHERE abreviatura_id = $1", [prop.abreviatura_id]));
    expect(ajena.rowCount).toBe(0);                                                   // RLS: no la ve
    await conSesion(2, (c) => c.query("UPDATE manufactura.cliente_abreviaturas SET estado = 'INACTIVA' WHERE abreviatura_id = $1", [prop.abreviatura_id]));
    expect((await poolAdmin.query('SELECT estado FROM manufactura.cliente_abreviaturas WHERE abreviatura_id = $1', [prop.abreviatura_id])).rows[0]).toMatchObject({ estado: 'INACTIVA' });
  });

  it('duplicado exacto vigente rechazado; misma abreviatura con otros clientes o patrones permitida; tras inactivar puede volver a registrarse', async () => {
    const a = await cliente('Dup'); const b = await cliente('Dup2'); const p = pref();
    const x = await confirmar({ abreviatura: p, cliente: a });
    expect((await falla(conSesion(1, (c) => alta(c, { abreviatura: p, cliente: a, estado: 'PROPUESTA' })))).code).toBe('23505');
    await confirmar({ abreviatura: p, cliente: b });
    await confirmar({ abreviatura: p, cliente: a, alcance: 'CODIGO_COMPLETO', patron: `${p}FPMG001` });
    await conSesion(1, (c) => c.query("UPDATE manufactura.cliente_abreviaturas SET estado = 'INACTIVA' WHERE abreviatura_id = $1", [x.abreviatura_id]));
    await confirmar({ abreviatura: p, cliente: a });
  });

  it('la asociación es inmutable (abreviatura, cliente, alcance, procedencia), no se borra y la procedencia la fija la sesión', async () => {
    const a = await cliente('Inm'); const b = await cliente('Inm2'); const x = await confirmar({ abreviatura: pref(), cliente: a });
    expect((await falla(conSesion(1, (c) => c.query('UPDATE manufactura.cliente_abreviaturas SET cliente_empresa_id = $1 WHERE abreviatura_id = $2', [b, x.abreviatura_id])))).code).toBe('42501');   // sin privilegio de columna
    expect((await falla(poolAdmin.query("UPDATE manufactura.cliente_abreviaturas SET origen = 'OCR_HISTORICO' WHERE abreviatura_id = $1", [x.abreviatura_id]))).message).toMatch(/Sin identidad|inmutables/);
    expect((await falla(conSesion(1, (c) => c.query('DELETE FROM manufactura.cliente_abreviaturas WHERE abreviatura_id = $1', [x.abreviatura_id])))).code).toBe('42501');
    expect((await poolAdmin.query('SELECT propuesta_por_usuario_id FROM manufactura.cliente_abreviaturas WHERE abreviatura_id = $1', [x.abreviatura_id])).rows[0]).toMatchObject({ propuesta_por_usuario_id: '1' });
  });

  it('formato: 2–5 caracteres alfanuméricos; el patrón de contexto debe empezar con la abreviatura y ser más largo; el código completo debe empezar con ella', async () => {
    const a = await cliente('Fmt');
    for (const mala of ['A', 'ABCDEF', 'A-B', '1AB']) expect((await falla(conSesion(1, (c) => alta(c, { abreviatura: mala, cliente: a })))).message).toMatch(/ck_manufactura_cliente_abrev_abreviatura/);
    expect((await falla(conSesion(1, (c) => alta(c, { abreviatura: 'FMX', cliente: a, alcance: 'CONTEXTO', patron: 'FMX' })))).message).toMatch(/_patron/);
    expect((await falla(conSesion(1, (c) => alta(c, { abreviatura: 'FMX', cliente: a, alcance: 'CONTEXTO', patron: 'OTRO' })))).message).toMatch(/_patron/);
    expect((await falla(conSesion(1, (c) => alta(c, { abreviatura: 'FMX', cliente: a, alcance: 'CODIGO_COMPLETO', patron: 'OTROFPMG001' })))).message).toMatch(/_patron/);
    expect((await falla(conSesion(1, (c) => alta(c, { abreviatura: 'FMX', cliente: a, alcance: 'GENERAL', patron: 'FMXA' })))).message).toMatch(/_patron/);
  });

  it('sin identidad de sesión no se registra ni se sugiere nada; todo cambio queda en la auditoría', async () => {
    const a = await cliente('Aud');
    expect((await falla(conSesion(null, (c) => alta(c, { abreviatura: pref(), cliente: a })))).code).toBe('42501');
    const p = pref(); const x = await confirmar({ abreviatura: p, cliente: a });
    await conSesion(1, (c) => c.query("UPDATE manufactura.cliente_abreviaturas SET estado = 'INACTIVA' WHERE abreviatura_id = $1", [x.abreviatura_id]));
    const r = await poolAdmin.query("SELECT operacion FROM audit.cambios WHERE tabla = 'cliente_abreviaturas' AND registro_id = $1 ORDER BY cambio_id", ['abreviatura_id=' + x.abreviatura_id]);
    expect(r.rows.map((f: { operacion: string }) => f.operacion)).toEqual(['INSERT', 'UPDATE']);
  });
});
