import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const { pgPool } = vi.hoisted(() => ({ pgPool: vi.fn() }));
vi.mock('pg', () => ({ Pool: pgPool, default: { Pool: pgPool } }));

import { FAMILIAS, FAMILY_CODES, type FamilyCode } from '../src/manufacturing-sheets/preview/family-registry';
import { SheetPreviewService, SIN_FIRMA_MARKER } from '../src/manufacturing-sheets/preview/sheet-preview.service';

// Las ocho hojas del prototipo (COEX Azul y Verde cuentan por separado) con los mismos datos que usa la verificación a PDF (test/manufacturing-sheets/prototype/casos.json).
interface Caso { id: string; familia: FamilyCode; tipo: 'normal' | 'largo'; datos: Record<string, string> }
const CASOS = JSON.parse(readFileSync(resolve(__dirname, 'manufacturing-sheets/prototype/casos.json'), 'utf8')) as Caso[];
const normales = CASOS.filter((c) => c.tipo === 'normal');

describe('prototipo integral · las ocho hojas con su plantilla aprobada', { timeout: 30_000 }, () => {
  const service = new SheetPreviewService();

  it('cubre las siete familias del registro y las ocho hojas (COEX Azul y Verde sobre la misma plantilla)', () => {
    expect(new Set(normales.map((c) => c.familia))).toEqual(new Set(FAMILY_CODES));
    expect(FAMILY_CODES).toHaveLength(7);
    expect(normales.filter((c) => c.familia === 'COEX').map((c) => c.datos.coexVariante).sort()).toEqual(['AZUL', 'VERDE']);
    expect(normales).toHaveLength(9);                                        // 8 hojas + Hojas en sus dos modalidades
    const plantillas = FAMILY_CODES.map((f) => FAMILIAS[f].plantilla);
    expect(new Set(plantillas).size).toBe(plantillas.length);                // una plantilla por familia; sin HTML duplicado para las variantes de COEX
  });

  it.each(normales.map((c) => [c.id, c] as const))('%s: vista previa completa, sin placeholders, borrador SIN APROBAR con firmas SIN FIRMA y HTML endurecido', async (_id, caso) => {
    const r = await service.preview(caso.familia, caso.datos);
    expect(r).toMatchObject({ familia: caso.familia, borrador: true, firmas: 'SIN_FIRMA', completo: true, faltantes: [], bloqueado: null, pendientesEmision: ['Cliente'] });
    expect(r.advertencias.filter((a) => a.startsWith('Validación de la familia'))).toEqual([]);
    const sinComentarios = r.html.replace(/<!--[^]*?-->/g, '').replace(/\/\*[^]*?\*\//g, '');
    expect(sinComentarios).not.toMatch(/\{\{[A-Za-z0-9_]+\}\}/);
    expect(r.html).toContain(`id="firma_elaboro">${SIN_FIRMA_MARKER}</div>`);
    expect(r.html).toContain(`id="firma_aprobo">${SIN_FIRMA_MARKER}</div>`);
    expect(r.html).toMatch(/Content-Security-Policy" content="default-src 'none'/);
    expect(r.html).not.toMatch(/<script|javascript:|\son[a-z]+\s*=/i);
    expect(r.html).toContain('data:image/jpeg;base64,');                       // logo incrustado
    expect(r.html).toContain(caso.datos.codigo);
  });

  it('los textos largos (etiqueta y descripción de 200 caracteres) llegan completos al HTML', async () => {
    const largo = CASOS.find((c) => c.tipo === 'largo')!;
    const r = await service.preview(largo.familia, largo.datos);
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    expect(r.html).toContain(esc(largo.datos.etiqueta as string));
    expect(r.html).toContain(esc(largo.datos.descripcion as string));
  });

  it('Rollo Continuo y Termoencogible rechazan Extendida (sin variante gráfica autorizada); Hojas la admite', async () => {
    const hojas = normales.find((c) => c.id === 'hojas-extendida')!;
    expect((await service.preview(hojas.familia, hojas.datos)).bloqueado).toBeNull();
    for (const id of ['rollo-continuo', 'termoencogible']) {
      const caso = normales.find((c) => c.id === id)!;
      const r = await service.preview(caso.familia, { ...caso.datos, modalidad: 'EXTENDIDA' });
      expect(r.bloqueado, id).toMatch(/no está autorizada/);
      expect(r.html, id).toBe('');
    }
  });

  it('el cliente es requisito de emisión, no de la demostración: vacío no bloquea; con cliente desaparece el pendiente', async () => {
    const caso = normales[0] as Caso;
    expect((await service.preview(caso.familia, { ...caso.datos, cliente: '' })).completo).toBe(true);
    expect((await service.preview(caso.familia, { ...caso.datos, cliente: 'Schneider Electric' })).pendientesEmision).toEqual([]);
  });

  it('no persiste nada: sin PostgreSQL ni escritura en disco durante las ocho vistas previas', async () => {
    for (const caso of normales) await service.preview(caso.familia, caso.datos);
    expect(pgPool).not.toHaveBeenCalled();
    for (const archivo of ['preview/sheet-preview.service.ts', 'preview/sheet-data.mapper.ts', 'preview/family-registry.ts', 'preview/families.controller.ts']) {
      expect(readFileSync(resolve(__dirname, '../src/manufacturing-sheets', archivo), 'utf8'), archivo).not.toMatch(/from 'pg'|DatabaseService|INSERT\s|UPDATE\s|DELETE\s|writeFile/);
    }
  });
});
