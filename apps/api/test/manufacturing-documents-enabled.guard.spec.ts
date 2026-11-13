import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { resolveManufacturing, validateEnvironment, type EnvironmentConfig, type ManufacturingAccess } from '../src/config/environment';
import { ManufacturingEnabledGuard, ManufacturingSheetsEnabledGuard } from '../src/manufacturing-documents/manufacturing-enabled.guard';

const config = (manufacturing: ManufacturingAccess | undefined): ConfigService<EnvironmentConfig, true> => ({ get: () => manufacturing }) as unknown as ConfigService<EnvironmentConfig, true>;
const BASE = { DB_HOST: 'h', DB_PORT: '5432', DB_USER: 'u', DB_PASSWORD: 'p' };

describe('resolveManufacturing: TEST y PROD separados y explícitos', () => {
  it('TEST: habilitado por omisión, con emisión PRUEBA; MANUFACTURING_ENABLED=false lo apaga', () => {
    expect(resolveManufacturing('daubert_hub_test', {})).toEqual({ enabled: true, emission: 'PRUEBA' });
    expect(resolveManufacturing('daubert_hub_test', { MANUFACTURING_ENABLED: 'false' })).toEqual({ enabled: false, emission: 'PRUEBA' });
    expect(resolveManufacturing('daubert_hub_test', { MANUFACTURING_ENABLED: 'true', MANUFACTURING_EMISSION_ENV: 'PRUEBA' })).toEqual({ enabled: true, emission: 'PRUEBA' });
  });
  it('TEST nunca admite emisión PRODUCCION', () => {
    expect(() => resolveManufacturing('daubert_hub_test', { MANUFACTURING_EMISSION_ENV: 'PRODUCCION' })).toThrow(/not allowed with the TEST database/);
  });
  it('PROD: APAGADO por omisión (con o sin variables a medias)', () => {
    expect(resolveManufacturing('daubert_global', {})).toEqual({ enabled: false, emission: 'PRODUCCION' });
    expect(resolveManufacturing('daubert_global', { MANUFACTURING_EMISSION_ENV: 'PRODUCCION' })).toEqual({ enabled: false, emission: 'PRODUCCION' });
    expect(resolveManufacturing('daubert_global', { MANUFACTURING_ENABLED: 'false', MANUFACTURING_EMISSION_ENV: 'PRODUCCION' })).toEqual({ enabled: false, emission: 'PRODUCCION' });
  });
  it('PROD: encender exige DOS declaraciones (MANUFACTURING_ENABLED=true y MANUFACTURING_EMISSION_ENV=PRODUCCION)', () => {
    expect(() => resolveManufacturing('daubert_global', { MANUFACTURING_ENABLED: 'true' })).toThrow(/also requires MANUFACTURING_EMISSION_ENV=PRODUCCION/);
    expect(resolveManufacturing('daubert_global', { MANUFACTURING_ENABLED: 'true', MANUFACTURING_EMISSION_ENV: 'PRODUCCION' })).toEqual({ enabled: true, emission: 'PRODUCCION' });
  });
  it('PROD nunca admite emisión PRUEBA', () => {
    expect(() => resolveManufacturing('daubert_global', { MANUFACTURING_EMISSION_ENV: 'PRUEBA' })).toThrow(/not allowed with the production database/);
  });
  it.each(['otra_base', 'daubert_docs', ''])('una base desconocida («%s») queda apagada y no admite encenderla', (base) => {
    expect(resolveManufacturing(base, {})).toEqual({ enabled: false, emission: null });
    expect(() => resolveManufacturing(base, { MANUFACTURING_ENABLED: 'true', MANUFACTURING_EMISSION_ENV: 'PRODUCCION' })).toThrow(/only allowed with the TEST or the production database/);
  });
  it('una variable vacía (compose la pasa sin valor) equivale a no declararla', () => {
    expect(resolveManufacturing('daubert_global', { MANUFACTURING_ENABLED: '', MANUFACTURING_EMISSION_ENV: '' })).toEqual({ enabled: false, emission: 'PRODUCCION' });
    expect(resolveManufacturing('daubert_hub_test', { MANUFACTURING_ENABLED: '', MANUFACTURING_EMISSION_ENV: '' })).toEqual({ enabled: true, emission: 'PRUEBA' });
  });
  it('rechaza valores que no son exactamente los permitidos', () => {
    expect(() => resolveManufacturing('daubert_global', { MANUFACTURING_ENABLED: 'yes' })).toThrow(/exactly "true" or "false"/);
    expect(() => resolveManufacturing('daubert_global', { MANUFACTURING_EMISSION_ENV: 'prod' })).toThrow(/exactly "PRUEBA" or "PRODUCCION"/);
  });
  it('validateEnvironment lo integra: la configuración contradictoria detiene el arranque', () => {
    expect(validateEnvironment({ ...BASE, DB_NAME: 'daubert_hub_test' }).manufacturing).toEqual({ enabled: true, emission: 'PRUEBA' });
    expect(validateEnvironment({ ...BASE, DB_NAME: 'daubert_global' }).manufacturing).toEqual({ enabled: false, emission: 'PRODUCCION' });
    expect(() => validateEnvironment({ ...BASE, DB_NAME: 'daubert_global', MANUFACTURING_ENABLED: 'true' })).toThrow();
  });
});

describe('ManufacturingEnabledGuard (gestor documental)', () => {
  it('permite las rutas solo si el entorno lo habilita explícitamente', () => {
    expect(new ManufacturingEnabledGuard(config({ enabled: true, emission: 'PRUEBA' })).canActivate()).toBe(true);
    expect(new ManufacturingEnabledGuard(config({ enabled: true, emission: 'PRODUCCION' })).canActivate()).toBe(true);
  });
  it.each([{ enabled: false, emission: 'PRODUCCION' as const }, { enabled: false, emission: 'PRUEBA' as const }, { enabled: false, emission: null }, undefined])('responde 404 (como si la ruta no existiera) con %j', (valor) => {
    expect(() => new ManufacturingEnabledGuard(config(valor as ManufacturingAccess | undefined)).canActivate()).toThrow(NotFoundException);
  });
});

describe('ManufacturingSheetsEnabledGuard (BIND, familias y vista previa)', () => {
  it('conserva su disponibilidad en TEST y en bases de desarrollo', () => {
    expect(new ManufacturingSheetsEnabledGuard(config({ enabled: true, emission: 'PRUEBA' })).canActivate()).toBe(true);
    expect(new ManufacturingSheetsEnabledGuard(config({ enabled: false, emission: null })).canActivate()).toBe(true);
  });
  it('en la base de producción responde 404 mientras Manufactura no esté habilitada, y funciona al habilitarla', () => {
    expect(() => new ManufacturingSheetsEnabledGuard(config({ enabled: false, emission: 'PRODUCCION' })).canActivate()).toThrow(NotFoundException);
    expect(new ManufacturingSheetsEnabledGuard(config({ enabled: true, emission: 'PRODUCCION' })).canActivate()).toBe(true);
  });
});
