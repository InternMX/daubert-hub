import 'reflect-metadata';
import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { ResponsablesRepository } from '../src/manufacturing-documents/responsables.repository';

// Mientras la migración 103 no esté aplicada la consulta administrativa sigue funcionando con el límite de RLS; con ella usa la función de inventario (solo metadatos).
const fila = { id: 'a', propietario_usuario_id: '3', propietario: 'General Tres', cuenta_estado: 'ACTIVE', estado: 'ACTIVA', creada_en: '2026-11-05T10:00:00Z', retirada_en: null, subida_por: 'Admin', incorporada_por: 'Admin', autorizaciones: null, registrada_por_mi: true };
function cliente(conFuncion: boolean) {
  const consultas: string[] = [];
  const c = { query: async (sql: string) => { consultas.push(sql); return sql.includes('to_regprocedure') ? { rows: [{ ok: conFuncion }] } : { rows: [fila] }; } } as unknown as PoolClient;
  return { c, consultas };
}

describe('inventario administrativo de firmas: con y sin la migración 103', () => {
  it('sin la función 103 usa la consulta limitada por RLS y lo informa (completo = false)', async () => {
    const { c, consultas } = cliente(false);
    const r = await new ResponsablesRepository().firmasAdministrativas(c, '3');
    expect(r.completo).toBe(false);
    expect(consultas.some((q) => q.includes('FROM manufactura.firmas f'))).toBe(true);
    expect(consultas.some((q) => q.includes('fn_firmas_inventario($1'))).toBe(false);
    expect(r.data[0]).toMatchObject({ propietario: 'General Tres', cuenta: 'ACTIVE', registradaPorMi: true });
  });

  it('con la función 103 la usa (propietario o «sin cuenta») y nunca pide la imagen', async () => {
    const { c, consultas } = cliente(true);
    const r = await new ResponsablesRepository().firmasAdministrativas(c, '3');
    expect(r.completo).toBe(true);
    const usada = consultas.find((q) => q.includes('fn_firmas_inventario($1'));
    expect(usada).toBeDefined();
    expect(usada).not.toMatch(/contenido|miniatura|bytea/i);
    await new ResponsablesRepository().firmasAdministrativas(c, null);
    expect(consultas.filter((q) => q.includes('fn_firmas_inventario($1')).length).toBe(2);
  });
});
