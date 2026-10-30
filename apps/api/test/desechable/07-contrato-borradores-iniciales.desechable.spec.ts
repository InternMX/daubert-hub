import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CreateDraftDto, UpdateDraftDto } from '../../src/manufacturing-documents/documents.dto';
import { actor, codigoUnico, crearServicio, falla, poolAdmin, type Vista } from './entorno';

// CONTRATO del primer guardado contra PostgreSQL desechable: la especificación inicial que arma la pantalla al elegir la familia (fixture generado por el frontend) se crea, se actualiza
// con control de versiones y NO produce documentos duplicados, para todas las familias y variantes, aunque falten datos técnicos.
const { service } = crearServicio();
// Igual que en HTTP: main.ts usa ValidationPipe con transform, que entrega al servicio una INSTANCIA del DTO (las propiedades opcionales no enviadas quedan como `undefined`).
const sinCodigo = (p: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'codigo'));
const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
const comoHttp = <T>(cuerpo: unknown, metatype: new () => T): Promise<T> => pipe.transform(JSON.parse(JSON.stringify(cuerpo)), { type: 'body', metatype }) as Promise<T>;
const payloads = JSON.parse(readFileSync(resolve(__dirname, '..', 'fixtures', 'borradores-iniciales.json'), 'utf8')) as Record<string, Record<string, unknown>>;

describe('contrato del primer guardado (servicio + PostgreSQL desechable)', () => {
  it.each(Object.keys(payloads))('%s: se crea, se actualiza con la versión devuelta y la copia guardada conserva lo capturado', async (nombre) => {
    const carga = sinCodigo(payloads[nombre]!);
    const codigo = codigoUnico();
    const v1 = await service.crearBorrador(actor(2), await comoHttp({ ...carga, codigo }, CreateDraftDto) as never) as Vista;
    expect(v1.estado).toBe('BORRADOR');
    expect(v1.version).toBe(1);
    expect(v1.elaboro.confirmado).toBe(false);                                          // el guardado inicial nunca confirma «Elaboró»
    expect(v1.especificacion.datos.codigo).toBe(codigo);
    const datos = (carga.datos as Record<string, string>);
    for (const [k, v] of Object.entries(datos)) if (k !== 'codigo') expect(v1.especificacion.datos[k], k).toBe(v);   // nada se pierde ni se inventa
    const v2 = await service.actualizarBorrador(actor(2), v1.id, await comoHttp({ version: v1.version, ...carga }, UpdateDraftDto) as never) as Vista;
    expect(v2.version).toBe(2);
  });

  it('REGRESIÓN SCHFPMG001 + Bolsa Plana 1: por HTTP (ValidationPipe con transform) el primer guardado ya no falla con «datos.modalidad debe ser texto»', async () => {
    const carga = sinCodigo(payloads['BOLSA_PLANA_1']!);
    expect((carga.datos as Record<string, string>).modalidad).toBeUndefined();          // Bolsa Plana 1 NO usa modalidad (es de hojas/rollos): no se envía ni se inventa
    const dto = await comoHttp({ ...carga, codigo: codigoUnico() }, CreateDraftDto);
    expect(Object.keys((dto as unknown as { datos: object }).datos)).toContain('modalidad');   // la instancia transformada declara la propiedad con valor undefined: ese era el origen del 400
    const v = await service.crearBorrador(actor(2), dto as never) as Vista;
    expect(v.especificacion.datos).not.toHaveProperty('modalidad');                    // no se guarda un dato que nadie capturó
    expect(v.estado).toBe('BORRADOR');
  });

  it('sigue rechazando lo que NO es texto: un valor definido (número, null, objeto) en datos produce 400 con el campo', async () => {
    const carga = sinCodigo(payloads['BOLSA_PLANA_1']!);
    for (const malo of [5, { x: 1 }]) {
      const dto = { ...carga, codigo: codigoUnico(), datos: { ...(carga.datos as object), ancho: malo } };
      await expect(comoHttp(dto, CreateDraftDto)).rejects.toThrow();                  // el DTO ya lo rechaza (IsString)
    }
    const sinPipe = { ...carga, codigo: codigoUnico(), datos: { ...(carga.datos as object), producto: null } };
    const r = await falla(service.crearBorrador(actor(2), sinPipe as never));          // el servicio también lo rechaza (defensa en profundidad)
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/producto.*texto/);
  });

  it('cliente y color personalizado también pasan por el mismo camino HTTP', async () => {
    const carga = sinCodigo(payloads['BOLSA_PLANA_1']!);
    const dto = await comoHttp({ ...carga, codigo: codigoUnico(), cliente: { nombre: 'Cliente de prueba' }, colorPersonalizado: { nombre: 'Azul Cielo', hex: '#3778c8' } }, CreateDraftDto);
    const v = await service.crearBorrador(actor(2), dto as never) as Vista;
    expect(v.cliente).toMatchObject({ nombre: 'Cliente de prueba', verificado: false });
    expect(v.especificacion.colorPersonalizado).toMatchObject({ nombre: 'Azul Cielo', hex: '#3778c8' });
  });

  it('repetir la creación (reintento) no duplica el documento: responde el conflicto uniforme y existe una sola revisión', async () => {
    const carga = sinCodigo(payloads['BOLSA_PLANA_1']!);
    const codigo = codigoUnico();
    await service.crearBorrador(actor(2), await comoHttp({ ...carga, codigo }, CreateDraftDto) as never);
    expect((await falla(service.crearBorrador(actor(2), await comoHttp({ ...carga, codigo }, CreateDraftDto) as never))).code).toBe('DOCUMENT_EXISTS');
    const cuenta = await poolAdmin.query('SELECT count(*)::int AS n FROM manufactura.revisiones r JOIN manufactura.documentos d USING (documento_id) WHERE d.codigo_dcmx = $1', [codigo]);
    expect(cuenta.rows[0].n).toBe(1);
  });
});
