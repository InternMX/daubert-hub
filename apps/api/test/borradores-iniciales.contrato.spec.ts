import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CreateDraftDto, UpdateDraftDto } from '../src/manufacturing-documents/documents.dto';
import { construirEspecificacion } from '../src/manufacturing-documents/documents.spec-model';

// CONTRATO del primer guardado (fixture generado por el frontend: apps/web/src/manufacturing/documentSpec.contrato.test.ts). El endpoint documental debe aceptar la especificación inicial que
// arma la pantalla al elegir la familia —aunque falten dimensiones, calibre u otros datos que solo se exigen al finalizar— para TODAS las familias y variantes, sin relajar ninguna validación.
const payloads = JSON.parse(readFileSync(resolve(__dirname, 'fixtures', 'borradores-iniciales.json'), 'utf8')) as Record<string, Record<string, unknown>>;
const sinCodigo = (p: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'codigo'));
const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });   // mismas opciones que main.ts

describe('contrato frontend ↔ API del primer guardado', () => {
  it.each(Object.keys(payloads))('%s: creación (POST drafts) y actualización (PATCH) pasan la validación del DTO', async (nombre) => {
    const cuerpo = payloads[nombre]!;
    await expect(pipe.transform(cuerpo, { type: 'body', metatype: CreateDraftDto })).resolves.toBeDefined();
    const carga = sinCodigo(cuerpo);
    await expect(pipe.transform({ version: 1, ...carga }, { type: 'body', metatype: UpdateDraftDto })).resolves.toBeDefined();
  });

  it.each(Object.keys(payloads))('%s: el servicio arma la copia de la especificación a partir de la INSTANCIA que entrega el ValidationPipe (como por HTTP), sin campos no enviados', async (nombre) => {
    const dto = await pipe.transform(JSON.parse(JSON.stringify(payloads[nombre])), { type: 'body', metatype: CreateDraftDto }) as CreateDraftDto;
    const enviados = Object.keys((payloads[nombre] as { datos: object }).datos).sort();
    const e = construirEspecificacion({ datos: { ...dto.datos } as Record<string, unknown>, bind: dto.bind, procedencia: dto.procedencia, colorPersonalizado: dto.colorPersonalizado, incidenciasReconocidas: dto.incidenciasReconocidas }, dto.codigo);
    expect(Object.keys(e.datos).sort()).toEqual(enviados);                              // exactamente lo capturado: ni se rechaza por campos ausentes ni se inventan claves
  });

  it('REGRESIÓN SCHFPMG001 + Bolsa Plana 1: «datos.modalidad» (ausente en esta familia) no provoca «debe ser texto»; un valor definido que no es texto sí se rechaza', async () => {
    const dto = await pipe.transform(JSON.parse(JSON.stringify(payloads['BOLSA_PLANA_1'])), { type: 'body', metatype: CreateDraftDto }) as CreateDraftDto;
    expect(Object.keys(dto.datos)).toContain('modalidad');                              // la instancia transformada la declara con valor undefined
    expect(() => construirEspecificacion({ datos: { ...dto.datos } as Record<string, unknown> }, 'SCHFPMG001')).not.toThrow();
    expect(() => construirEspecificacion({ datos: { ancho: 13 } }, 'SCHFPMG001')).toThrow(/ancho.*texto/);
    expect(() => construirEspecificacion({ datos: { ancho: null } }, 'SCHFPMG001')).toThrow(/ancho.*texto/);
    expect(() => construirEspecificacion({ datos: { ancho: { a: 1 } } }, 'SCHFPMG001')).toThrow(/ancho.*texto/);
  });

  it('el DTO sigue rechazando lo inválido (no se relajó ninguna validación)', async () => {
    const base = payloads['BOLSA_PLANA_1']!;
    await expect(pipe.transform({ ...base, datos: { ...(base.datos as object), pesoLb: '12345678901234567' } }, { type: 'body', metatype: CreateDraftDto })).rejects.toThrow();
    await expect(pipe.transform({ ...base, datos: { ...(base.datos as object), composicion: 'OTRA' } }, { type: 'body', metatype: CreateDraftDto })).rejects.toThrow();
    await expect(pipe.transform({ ...base, intruso: 'x' }, { type: 'body', metatype: CreateDraftDto })).rejects.toThrow();
  });
});
