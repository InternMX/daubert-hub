import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { actor, codigoUnico, poolAdmin, poolApp } from './entorno';

// Migración 102 (responsables y firmas) en la instancia desechable, con el ROL DE LA APLICACIÓN: propiedad, autorización de uso, congelamiento y privilegios.
// Cuentas de la réplica: 1 ADMIN, 2 y 3 GENERAL, 4 GENERAL inactiva, 5 ADMIN.
type Cliente = PoolClient;
async function conSesion<T>(n: 1 | 2 | 3 | 5, trabajo: (c: Cliente) => Promise<T>): Promise<T> {
  const a = actor(n);
  const c = await poolApp.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.origin','DAUBERT_HUB',true), set_config('app.request_id',$1,true), set_config('app.user_id',$2,true), set_config('app.user_email',$3,true)", [a.requestId, a.userId, a.email]);
    const r = await trabajo(c);
    await c.query('COMMIT');
    return r;
  } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
}
const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('contenido-de-prueba')]);   // la base no decodifica: la API valida y re-codifica; aquí solo se prueba integridad
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const insertarFirma = (c: Cliente, propietario: number | null, nombre = 'Declarado', contenido: Buffer = png, tipo = 'image/png') =>
  c.query<{ firma_id: string; propietario_nombre: string }>(
    `INSERT INTO manufactura.firmas (propietario_usuario_id, propietario_nombre, subida_por_usuario_id, subida_por_email, incorporada_por_usuario_id, incorporada_por_email, tipo_mime, ancho, alto, bytes, sha256, contenido)
     VALUES ($1, $2, 1, 'x', 1, 'x', $3, 300, 100, $4, $5, $6) RETURNING firma_id, propietario_nombre`, [propietario, nombre, tipo, contenido.length, sha(contenido), contenido]).then((r) => r.rows[0]!);
const falla = async (p: Promise<unknown>): Promise<{ code?: string; message: string }> => { try { await p; } catch (e) { return e as { code?: string; message: string }; } throw new Error('Se esperaba un error'); };

async function borrador(n: 2 | 3): Promise<string> {
  return conSesion(n, async (c) => {
    const d = await c.query<{ documento_id: string }>('INSERT INTO manufactura.documentos (codigo_dcmx) VALUES ($1) RETURNING documento_id', [codigoUnico('FIRMA')]);
    const r = await c.query<{ revision_id: string }>(
      `INSERT INTO manufactura.revisiones (documento_id, familia, especificacion, elaboro_nombre, creado_por_usuario_id, creado_por_email, actualizado_por_usuario_id, actualizado_por_email, especificacion_sha256, entorno_emision)
       VALUES ($1, 'BOLSA_PLANA_1', '{"datos":{"codigo":"X"}}', 'Nombre', 1, 'x', 1, 'x', repeat('0',64), 'PRUEBA') RETURNING revision_id`, [d.rows[0]!.documento_id]);
    return r.rows[0]!.revision_id;
  });
}
const responsable = (c: Cliente, rev: string, pos: number, funcion: string, nombre: string, firma: string | null) =>
  c.query('INSERT INTO manufactura.revision_responsables (revision_id, posicion, funcion, nombre, firma_id) VALUES ($1,$2,$3,$4,$5) RETURNING nombre, firma_sha256', [rev, pos, funcion, nombre, firma]);

describe('migración 102 · catálogo de firmas, autorizaciones y responsables (instancia desechable)', () => {
  it('una persona sube su propia firma: el nombre sale de su cuenta, el actor de la sesión y el contenido se verifica', async () => {
    const f = await conSesion(2, (c) => insertarFirma(c, 2, 'Nombre falso'));
    expect(f.propietario_nombre).toBe('General Dos');                       // no se puede declarar otro nombre
    const fila = (await poolAdmin.query('SELECT subida_por_usuario_id, incorporada_por_usuario_id, estado FROM manufactura.firmas WHERE firma_id=$1', [f.firma_id])).rows[0];
    expect(fila).toMatchObject({ subida_por_usuario_id: '2', incorporada_por_usuario_id: '2', estado: 'ACTIVA' });
    const mal = await falla(conSesion(2, async (c) => { await c.query(`INSERT INTO manufactura.firmas (propietario_usuario_id, propietario_nombre, subida_por_usuario_id, subida_por_email, incorporada_por_usuario_id, incorporada_por_email, tipo_mime, ancho, alto, bytes, sha256, contenido) VALUES (2,'x',2,'x',2,'x','image/png',10,10,5,$1,$2)`, [sha(png), png]); }));
    expect(mal.message).toMatch(/violates check constraint|no coincide/);   // bytes/sha incoherentes
    const svg = await falla(conSesion(2, (c) => insertarFirma(c, 2, 'x', Buffer.from('<svg/>'), 'image/svg+xml')));
    expect(svg.message).toMatch(/ck_manufactura_firmas_mime/);
  });

  it('nadie incorpora la firma de otra persona salvo un ADMIN; las de personas sin cuenta solo las incorpora un ADMIN, que queda autorizado como custodio', async () => {
    expect((await falla(conSesion(2, (c) => insertarFirma(c, 3)))).message).toMatch(/Solo un ADMIN/);
    expect((await falla(conSesion(2, (c) => insertarFirma(c, null, 'Persona Externa')))).message).toMatch(/personas sin cuenta/);
    const f = await conSesion(1, (c) => insertarFirma(c, null, 'Persona Externa'));
    expect(f.propietario_nombre).toBe('Persona Externa');
    const aut = await poolAdmin.query('SELECT usuario_id FROM manufactura.firma_autorizaciones WHERE firma_id=$1 AND revocada_en IS NULL', [f.firma_id]);
    expect(aut.rows.map((r) => r.usuario_id)).toEqual(['1']);
    const porAdmin = await conSesion(1, (c) => insertarFirma(c, 3));
    expect(porAdmin.propietario_nombre).toBe('General Tres');
    const fila = (await poolAdmin.query('SELECT subida_por_usuario_id, incorporada_por_usuario_id FROM manufactura.firmas WHERE firma_id=$1', [porAdmin.firma_id])).rows[0];
    expect(fila).toMatchObject({ subida_por_usuario_id: '1', incorporada_por_usuario_id: '1' });   // queda constancia de quién la incorporó
  });

  it('las firmas ajenas no son visibles ni utilizables sin autorización; con autorización sí; al revocarla no se pueden asignar de nuevo', async () => {
    const f = await conSesion(2, (c) => insertarFirma(c, 2));
    const rev = await borrador(3);
    expect(await conSesion(3, async (c) => (await c.query('SELECT 1 FROM manufactura.firmas WHERE firma_id=$1', [f.firma_id])).rowCount)).toBe(0);
    expect((await falla(conSesion(3, (c) => responsable(c, rev, 1, 'GENERO', 'Quien sea', f.firma_id)))).message).toMatch(/autorización/);
    expect((await falla(conSesion(3, (c) => c.query('INSERT INTO manufactura.firma_autorizaciones (firma_id, usuario_id) VALUES ($1, 3)', [f.firma_id])))).message).toMatch(/propietaria|no existe o no es accesible/);   // ni siquiera la ve
    await conSesion(2, (c) => c.query('INSERT INTO manufactura.firma_autorizaciones (firma_id, usuario_id) VALUES ($1, 3)', [f.firma_id]));
    expect(await conSesion(3, async (c) => (await c.query('SELECT 1 FROM manufactura.firmas WHERE firma_id=$1', [f.firma_id])).rowCount)).toBe(1);
    const r = await conSesion(3, (c) => responsable(c, rev, 1, 'GENERO', 'Nombre cambiado a mano', f.firma_id));
    expect(r.rows[0]).toMatchObject({ nombre: 'General Dos', firma_sha256: sha(png) });       // no se puede atribuir la imagen a otro nombre
    await conSesion(2, (c) => c.query('UPDATE manufactura.firma_autorizaciones SET revocada_en = now() WHERE firma_id=$1 AND usuario_id=3', [f.firma_id]));
    const rev2 = await borrador(3);
    expect((await falla(conSesion(3, (c) => responsable(c, rev2, 1, 'GENERO', 'x', f.firma_id)))).message).toMatch(/autorización/);
  });

  it('hasta tres responsables con funciones repetidas; sin imagen el nombre es libre; quitar uno; la posición 4 se rechaza', async () => {
    const rev = await borrador(2);
    await conSesion(2, async (c) => {
      await responsable(c, rev, 1, 'GENERO', 'Ana', null);
      await responsable(c, rev, 2, 'GENERO', 'Beto', null);          // función repetida permitida
      await responsable(c, rev, 3, 'APROBO', 'Carla', null);
    });
    expect((await falla(conSesion(2, (c) => responsable(c, rev, 4, 'GENERO', 'D', null)))).message).toMatch(/ck_manufactura_responsables_pos/);
    expect((await falla(conSesion(2, (c) => responsable(c, rev, 2, 'REVISO', 'dup', null)))).message).toMatch(/uq_manufactura_responsables_pos/);
    expect((await falla(conSesion(2, (c) => responsable(c, rev, 1, 'OTRA', 'x', null)).catch((e: Error) => { throw e; }))).message).toBeTruthy();
    await conSesion(2, (c) => c.query('DELETE FROM manufactura.revision_responsables WHERE revision_id=$1 AND posicion=3', [rev]));
    expect((await poolAdmin.query('SELECT count(*)::int AS n FROM manufactura.revision_responsables WHERE revision_id=$1', [rev])).rows[0].n).toBe(2);
    // otro usuario no modifica los responsables de un borrador ajeno
    expect(await conSesion(3, async (c) => (await c.query('UPDATE manufactura.revision_responsables SET nombre=$2 WHERE revision_id=$1', [rev, 'x'])).rowCount)).toBe(0);   // RLS: no ve filas ajenas
  });

  it('al iniciar la finalización los responsables quedan congelados; una firma retirada no se asigna de nuevo pero la referencia se conserva; las firmas no se borran', async () => {
    const f = await conSesion(2, (c) => insertarFirma(c, 2));
    const rev = await borrador(2);
    await conSesion(2, (c) => responsable(c, rev, 1, 'GENERO', 'x', f.firma_id));
    await conSesion(2, (c) => c.query('UPDATE manufactura.firmas SET estado=$2 WHERE firma_id=$1', [f.firma_id, 'RETIRADA']));
    expect((await poolAdmin.query('SELECT firma_id, firma_sha256 FROM manufactura.revision_responsables WHERE revision_id=$1', [rev])).rows[0]).toMatchObject({ firma_id: f.firma_id, firma_sha256: sha(png) });
    const rev2 = await borrador(2);
    expect((await falla(conSesion(2, (c) => responsable(c, rev2, 1, 'GENERO', 'x', f.firma_id)))).message).toMatch(/autorización/);
    expect((await falla(conSesion(2, (c) => c.query('UPDATE manufactura.firmas SET contenido=$2 WHERE firma_id=$1', [f.firma_id, Buffer.from('otro')])))).message).toMatch(/permission denied/);
    expect((await falla(conSesion(2, (c) => c.query('DELETE FROM manufactura.firmas WHERE firma_id=$1', [f.firma_id])))).message).toMatch(/permission denied/);
    await conSesion(2, (c) => c.query("UPDATE manufactura.revisiones SET estado='FINALIZANDO' WHERE revision_id=$1", [rev]));
    expect((await falla(conSesion(2, (c) => c.query('UPDATE manufactura.revision_responsables SET nombre=$2 WHERE revision_id=$1', [rev, 'y'])))).message).toMatch(/no se modifican/);
    expect((await falla(conSesion(2, (c) => c.query('DELETE FROM manufactura.revision_responsables WHERE revision_id=$1', [rev])))).message).toMatch(/no se modifican/);
  });

  it('la auditoría registra firmas y responsables sin copiar el contenido de la imagen', async () => {
    const f = await conSesion(2, (c) => insertarFirma(c, 2));
    const fila = (await poolAdmin.query("SELECT datos_nuevos FROM audit.cambios WHERE esquema='manufactura' AND tabla='firmas' AND registro_id=$1", [`firma_id=${f.firma_id}`])).rows[0];
    expect(fila).toBeTruthy();
    expect(Object.keys(fila.datos_nuevos)).not.toContain('contenido');
    expect(fila.datos_nuevos.sha256).toBe(sha(png));
  });
});
