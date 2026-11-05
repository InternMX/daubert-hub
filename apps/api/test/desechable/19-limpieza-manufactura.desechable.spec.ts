import 'reflect-metadata';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ManufacturingActivityRepository } from '../../src/recent-activity/manufacturing-activity.repository';
import type { DatabaseService } from '../../src/database/database.service';
import { pngFirma } from '../imagenes-firma';
import { CONTENEDOR } from './global-setup';
import { actor, codigoUnico, crearServicio, entradaBorrador, poolAdmin, poolApp, type Vista } from './entorno';

// LIMPIEZA DE DOCUMENTOS DE MANUFACTURA (database/maintenance/daubert_hub_test) validada contra la instancia desechable (101–105) con datos reales del gestor: borradores, descartadas, finalizadas con PDF,
// una finalización en curso, una revisión nueva «basada en» otra, responsables con firma, confirmaciones de revisión, firmas, autorizaciones y abreviaturas. Se usan los scripts REALES vía psql.
const DIR = resolve(__dirname, '..', '..', '..', '..', 'database', 'maintenance', 'daubert_hub_test');
const BASE = 'limpieza_manufactura_documentos';
const FRASE = 'SI_ELIMINAR_TODOS_LOS_DOCUMENTOS_DE_MANUFACTURA_EN_TEST';
const { service, repo } = crearServicio();
const docker = (args: string[]) => spawnSync('docker', args, { encoding: 'utf8' });
for (const parte of ['preview', 'delete', 'postcheck']) docker(['cp', join(DIR, `${BASE}.${parte}.sql`), `${CONTENEDOR}:/tmp/limpieza.${parte}.sql`]);

function psql(parte: 'preview' | 'delete' | 'postcheck', vars: Record<string, string> = {}, usuario = 'postgres', extra: string[] = []) {
  const v = Object.entries(vars).flatMap(([k, val]) => ['-v', `${k}=${val}`]);
  const r = docker(['exec', '-e', 'PGPASSWORD=scratch', CONTENEDOR, 'psql', '-h', '127.0.0.1', '-U', usuario, '-d', 'daubert_hub_test', '-X', '-v', 'ON_ERROR_STOP=1', ...extra, ...v, '-f', `/tmp/limpieza.${parte}.sql`]);
  return { status: r.status, salida: `${r.stdout}\n${r.stderr}` };
}
interface Parametros { docs: string; revs: string; pdfs: string; hprot: string; htrg: string; hpol: string; ok: string }
function previewParametros(): Parametros {
  const r = psql('preview', {}, 'postgres', ['-At', '-F', '|']);
  expect(r.status, r.salida).toBe(0);
  const linea = r.salida.split('\n').find((l) => l.includes('psql -h localhost'));
  expect(linea, r.salida).toBeTruthy();
  const [docs, revs, pdfs, hprot, htrg, hpol, ok] = linea!.split('|');
  return { docs: docs!, revs: revs!, pdfs: pdfs!, hprot: hprot!, htrg: htrg!, hpol: hpol!, ok: ok! };
}
const argsDelete = (p: Parametros, mod: Record<string, string> = {}): Record<string, string> => ({
  confirmar: FRASE, esperados_documentos: p.docs, esperados_revisiones: p.revs, esperados_pdfs: p.pdfs, huella_protegidos: p.hprot, huella_triggers: p.htrg, ...mod
});
const rechaza = async (p: Promise<unknown>): Promise<string> => { try { await p; } catch (e) { return String((e as Error).message); } throw new Error('Se esperaba un error'); };
const q = async (sql: string) => (await poolAdmin.query(sql)).rows as Array<Record<string, unknown> & { n?: number; estado?: string }>;
const n = async (tabla: string): Promise<number> => Number((await q(`SELECT count(*)::int AS n FROM ${tabla}`))[0]!.n);
const conteos = async () => ({
  documentos: await n('manufactura.documentos'), revisiones: await n('manufactura.revisiones'), pdfs: await n('manufactura.pdfs'), contenidos: await n('manufactura.pdf_contenidos'),
  confirmaciones: await n('manufactura.confirmaciones_revision'), responsables: await n('manufactura.revision_responsables')
});
const protegidos = async () => ({ firmas: await n('manufactura.firmas'), autorizaciones: await n('manufactura.firma_autorizaciones'), abreviaturas: await n('manufactura.cliente_abreviaturas'), usuarios: await n('security.users'), empresas: await n('core.empresas') });
const triggersHabilitados = async (): Promise<boolean> => (await q("SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'manufactura' AND NOT t.tgisinternal AND t.tgenabled <> 'O'"))[0]!.n === 0;

const crear = (u: 1 | 2 | 3, codigo: string): Promise<Vista> => service.crearBorrador(actor(u), entradaBorrador(codigo, { cliente: { nombre: 'Cliente de prueba' } }) as never) as Promise<Vista>;
async function finalizar(u: 1 | 2 | 3, v: Vista): Promise<Vista> {
  const c = await service.actualizarBorrador(actor(u), v.id, { version: v.version, elaboroConfirmado: true } as never) as Vista;
  return service.finalizar(actor(u), c.id, c.version) as Promise<Vista>;
}

async function sembrar(): Promise<void> {
  // Protegidos: una firma con autorización de uso y una abreviatura confirmada.
  const firma = await service.subirFirma(actor(2), pngFirma(), undefined, undefined);
  await service.cambiarUsoFirma(actor(2), firma.id, '3', true);
  const c = await poolApp.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.origin','DAUBERT_HUB',true), set_config('app.user_id','1',true), set_config('app.user_email','admin1@example.invalid',true)");
    await c.query("INSERT INTO manufactura.cliente_abreviaturas (abreviatura, cliente_empresa_id, alcance, estado, origen, documentos_evidencia, codigos_evidencia) VALUES ('LIM', 1, 'GENERAL', 'CONFIRMADA', 'MANUAL_ADMIN', 0, 0)");
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }

  const sinFirmar = await crear(2, codigoUnico('LIMA'));                                    // borrador propio con responsables y firma
  await service.actualizarBorrador(actor(2), sinFirmar.id, { version: sinFirmar.version, responsables: [{ funcion: 'GENERO', nombre: 'General Dos', firmaId: firma.id }, { funcion: 'REVISO', nombre: 'Otra Persona' }] } as never);
  const conRevisor = await crear(2, codigoUnico('LIMB'));                                  // borrador con revisor asignado y confirmación de revisión
  const asignado = await service.asignarRevisor(actor(2), conRevisor.id, { version: conRevisor.version, revisorUsuarioId: '3' } as never) as Vista;
  await service.registrarRevision(actor(3), conRevisor.id, asignado.version);
  const fin1 = await finalizar(2, await crear(2, codigoUnico('LIMC')));                    // finalizada REV01 con PDF…
  await service.crearRevisionNueva(actor(2), fin1.documentoId);                             // …y su REV02 (basada en REV01) todavía borrador
  const fin2 = await finalizar(3, await crear(3, codigoUnico('LIMD')));                    // otra finalizada de otra cuenta…
  const rev2 = await service.crearRevisionNueva(actor(3), fin2.documentoId) as Vista;      // …cuya REV02 también se finaliza (cadena de dos finalizadas)
  await finalizar(3, rev2);
  const desc = await crear(3, codigoUnico('LIME'));                                         // descartada
  await service.descartarBorrador(actor(3), desc.id, desc.version);
  const enCurso = await crear(2, codigoUnico('LIMF'));                                      // finalización en curso
  await repo.conSesion(actor(2), (cl) => repo.iniciarFinalizacion(cl, enCurso.id, enCurso.version));
}

describe('limpieza de documentos de manufactura (scripts reales sobre la instancia desechable)', () => {
  it('PREVIEW: solo lectura, cuenta exactamente lo que se eliminaría y entrega los parámetros', async () => {
    await sembrar();
    const antes = await conteos();
    const prot = await protegidos();
    expect(antes.documentos).toBeGreaterThanOrEqual(6);
    expect(antes.pdfs).toBeGreaterThanOrEqual(3);
    expect(antes.contenidos).toBe(antes.pdfs);
    expect(antes.confirmaciones).toBeGreaterThanOrEqual(1);
    expect(antes.responsables).toBeGreaterThanOrEqual(1);
    const estados = (await q('SELECT estado, count(*)::int AS n FROM manufactura.revisiones GROUP BY 1')).map((r) => r.estado).sort();
    expect(estados).toEqual(['BORRADOR', 'DESCARTADA', 'FINALIZADA', 'FINALIZANDO']);        // el dato de prueba cubre los cuatro estados
    expect((await q('SELECT count(*)::int AS n FROM manufactura.revisiones WHERE basada_en_revision_id IS NOT NULL'))[0]!.n).toBeGreaterThanOrEqual(2);
    const auditoriaAntes = await n("audit.cambios WHERE esquema = 'manufactura'");

    const r = psql('preview');
    expect(r.status, r.salida).toBe(0);
    expect(r.salida).toMatch(/preview_ok[\s\S]*\n[^\n]*\| t\s+\| psql/);
    for (const frase of ['documentos', 'revisiones (total)', 'FINALIZANDO', 'DESCARTADA', 'pdf_contenidos', 'revision_responsables', 'Documentos afectados', 'LIM']) expect(r.salida).toContain(frase);
    expect(await conteos()).toEqual(antes);                                                  // no cambió nada
    expect(await protegidos()).toEqual(prot);
    expect(await n("audit.cambios WHERE esquema = 'manufactura'")).toBe(auditoriaAntes);
    const p = previewParametros();
    expect([p.docs, p.revs, p.pdfs]).toEqual([String(antes.documentos), String(antes.revisiones), String(antes.pdfs)]);
    expect(p.ok).toBe('t');
  });

  it('DELETE se niega (sin borrar nada) si falta la confirmación, es incorrecta, no coinciden los conteos o las huellas, hay dependencias inesperadas o no es administrador', async () => {
    const p = previewParametros();
    const antes = await conteos();
    const intactoTrasRechazo = async () => { expect(await conteos()).toEqual(antes); expect(await triggersHabilitados()).toBe(true); };

    let r = psql('delete', { ...argsDelete(p), confirmar: 'SI' });
    expect(r.status !== 0 || /ABORTO/.test(r.salida)).toBe(true); expect(r.salida).toMatch(/frase de confirmación incorrecta/); await intactoTrasRechazo();
    const sinConfirmar = Object.fromEntries(Object.entries(argsDelete(p)).filter(([k]) => k !== 'confirmar'));
    r = psql('delete', sinConfirmar); expect(r.salida).toMatch(/ABORTO: falta -v confirmar/); await intactoTrasRechazo();
    r = psql('delete', argsDelete(p, { esperados_documentos: String(Number(p.docs) + 1) })); expect(r.status).not.toBe(0); expect(r.salida).toMatch(/conteos cambiaron/); await intactoTrasRechazo();
    r = psql('delete', argsDelete(p, { esperados_pdfs: String(Number(p.pdfs) - 1) })); expect(r.status).not.toBe(0); expect(r.salida).toMatch(/conteos cambiaron/); await intactoTrasRechazo();
    r = psql('delete', argsDelete(p, { huella_protegidos: 'x'.repeat(32) })); expect(r.status).not.toBe(0); expect(r.salida).toMatch(/lo que se conserva/); await intactoTrasRechazo();
    r = psql('delete', argsDelete(p, { huella_triggers: 'x'.repeat(32) })); expect(r.status).not.toBe(0); expect(r.salida).toMatch(/triggers de manufactura no coinciden/); await intactoTrasRechazo();
    r = psql('delete', argsDelete(p, { esperados_documentos: '1; DROP TABLE x' })); expect(r.status).not.toBe(0); await intactoTrasRechazo();
    r = psql('delete', argsDelete(p), 'daubert_hub_test_user'); expect(r.status).not.toBe(0); expect(r.salida).toMatch(/rol administrativo|permission denied|must be owner/i); await intactoTrasRechazo();

    // Una dependencia nueva (fuera de las 6 esperadas) hacia estas tablas impide la limpieza.
    await poolAdmin.query('CREATE TABLE public.dependencia_prueba (documento_id bigint REFERENCES manufactura.documentos (documento_id))');
    try { r = psql('delete', argsDelete(p)); expect(r.status).not.toBe(0); expect(r.salida).toMatch(/claves foráneas inesperadas/); await intactoTrasRechazo(); }
    finally { await poolAdmin.query('DROP TABLE public.dependencia_prueba'); }

    // Si cambia el estado entre el PREVIEW y el DELETE (alguien crea un borrador), se aborta.
    await crear(3, codigoUnico('LIMX'));
    r = psql('delete', argsDelete(p)); expect(r.status).not.toBe(0); expect(r.salida).toMatch(/conteos cambiaron/);
    expect((await conteos()).documentos).toBe(antes.documentos + 1); expect(await triggersHabilitados()).toBe(true);
  });

  it('un fallo a mitad de la eliminación revierte TODO (transaccional) y deja los triggers como estaban', async () => {
    const antes = await conteos();
    // Un trigger extra (ajeno al procedimiento) que impide borrar confirmaciones: el DELETE falla DESPUÉS de haber borrado responsables, contenidos y PDF.
    await poolAdmin.query("CREATE FUNCTION manufactura.fn_zz_bloqueo() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'bloqueo de prueba'; END $$");
    await poolAdmin.query('CREATE TRIGGER trg_zz_bloqueo BEFORE DELETE ON manufactura.confirmaciones_revision FOR EACH ROW EXECUTE FUNCTION manufactura.fn_zz_bloqueo()');
    try {
      const p = previewParametros();
      const r = psql('delete', argsDelete(p));
      expect(r.status).not.toBe(0);
      expect(r.salida).toMatch(/bloqueo de prueba/);
      expect(await conteos()).toEqual(antes);                                                 // nada se borró (ni responsables, ni PDF)
      expect(await triggersHabilitados()).toBe(true);                                        // los 6 triggers volvieron a su estado
    } finally {
      await poolAdmin.query('DROP TRIGGER trg_zz_bloqueo ON manufactura.confirmaciones_revision');
      await poolAdmin.query('DROP FUNCTION manufactura.fn_zz_bloqueo()');
    }
  });

  it('DELETE real: deja el gestor vacío, conserva firmas/autorizaciones/abreviaturas/usuarios/clientes, mantiene triggers y RLS, audita las bajas y el POSTCHECK pasa', async () => {
    const prot = await protegidos();
    const auditoriaAntes = await n("audit.cambios WHERE esquema = 'manufactura'");
    const p = previewParametros();
    const r = psql('delete', argsDelete(p));
    expect(r.status, r.salida).toBe(0);
    expect(r.salida).toContain('DELETE_OK');
    expect(r.salida).toMatch(/ELIMINADOS: \d+ documentos, \d+ revisiones, \d+ pdfs/);
    expect(await conteos()).toEqual({ documentos: 0, revisiones: 0, pdfs: 0, contenidos: 0, confirmaciones: 0, responsables: 0 });
    expect(await protegidos()).toEqual(prot);
    expect(await triggersHabilitados()).toBe(true);
    expect((await q("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'manufactura' AND NOT rowsecurity"))[0]!.n).toBe(0);
    expect(await n("audit.cambios WHERE esquema = 'manufactura'")).toBeGreaterThan(auditoriaAntes);   // el historial se conserva y se suman las bajas
    expect((await q("SELECT count(*)::int AS n FROM audit.cambios WHERE origen = 'LIMPIEZA_TEST' AND operacion = 'DELETE'"))[0]!.n).toBeGreaterThan(0);
    const pc = psql('postcheck', { huella_protegidos: p.hprot, huella_triggers: p.htrg, huella_politicas: p.hpol });
    expect(pc.status, pc.salida).toBe(0);
    expect(pc.salida).toMatch(/all_postchecks_pass[\s\S]*\n[^\n]*\| t\s*\n/);
    expect(pc.salida).not.toMatch(/\| f\b/);
    // Idempotente y seguro de repetir: con el gestor vacío vuelve a pasar y no borra nada más.
    const otraVez = psql('delete', argsDelete(previewParametros()));
    expect(otraVez.status, otraVez.salida).toBe(0);
    expect(await protegidos()).toEqual(prot);
  });

  it('después de la limpieza el sistema funciona: se reutilizan los códigos, las firmas siguen utilizables, las protecciones de inmutabilidad vuelven a actuar y Actividad reciente solo muestra lo nuevo', async () => {
    const codigo = codigoUnico('LIMN');
    const nuevo = await crear(2, codigo);
    const firmas = (await service.listarFirmas(actor(2))).data;
    expect(firmas.length).toBeGreaterThanOrEqual(1);                                            // la firma conservada sigue disponible
    const conFirma = await service.actualizarBorrador(actor(2), nuevo.id, { version: nuevo.version, responsables: [{ funcion: 'GENERO', nombre: 'General Dos', firmaId: firmas[0]!.id }] } as never) as Vista;
    expect(conFirma.responsables[0]).toMatchObject({ conFirma: true });
    expect((await service.listarFirmas(actor(3))).data.length).toBeGreaterThanOrEqual(1);       // la autorización de uso conservada
    expect(((await service.listarAbiertas(actor(2))).data as Vista[]).map((r) => r.codigo)).toEqual([codigo]);
    const actividad = new ManufacturingActivityRepository({ connect: () => poolApp.connect() } as unknown as DatabaseService);
    const eventos = await actividad.findRecent(50, { userId: '3', role: 'GENERAL' });
    expect(eventos.map((e) => e.codigo)).toEqual([codigo]);                                     // sin eventos ni enlaces de los documentos eliminados
    // Las protecciones siguen vigentes: ni siquiera el administrador puede borrar una revisión con un DELETE directo.
    expect(await rechaza(poolAdmin.query('DELETE FROM manufactura.revisiones'))).toMatch(/inmutable/);
    const fin = await finalizar(2, conFirma);
    expect(fin.estado).toBe('FINALIZADA');
    expect(await rechaza(poolAdmin.query('DELETE FROM manufactura.pdfs'))).toMatch(/inmutable/);
  });
});
