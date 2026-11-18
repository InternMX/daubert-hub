import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { construirEspecificacion } from '../src/manufacturing-documents/documents.spec-model';
import { SheetPreviewDataDto } from '../src/manufacturing-sheets/preview/sheet-preview.dto';
import { mapSheetData, type PreviewFormData } from '../src/manufacturing-sheets/preview/sheet-data.mapper';

// La concentración del color se conserva en el snapshot del documento (datos.colorConcentracion) para recuperarla tal cual; la hoja NO la usa: imprime el texto del color y la resina VCI es otra cosa.
const BASE: PreviewFormData = {
  codigo: 'SCHFPMG001', descripcion: 'Bolsa VCI PMG 13 x 16" CAL. 3 MIL', producto: 'Bolsa PLANA', composicion: 'PMG', presentacion: 'PAQUETE', cantidad: '200', cantidadUnidad: 'BOLSAS',
  ancho: '13', largo: '16', unidadDimensiones: 'IN', calibre: '3 MIL', pesoLb: '10', resinaVci: 'PMG AL 4%', colorNombre: 'DAUBERT AZUL AL 3%', colorHex: '#538DD5', etiqueta: 'x'
};

describe('concentración del color en el snapshot documental', () => {
  it('el DTO acepta el texto de la concentración (incluido «0» y decimales) y rechaza lo que no es texto o es excesivo', async () => {
    for (const v of ['3', '0', '2.5', '3,5', '']) expect(await validate(plainToInstance(SheetPreviewDataDto, { colorConcentracion: v }))).toHaveLength(0);
    expect((await validate(plainToInstance(SheetPreviewDataDto, { colorConcentracion: 3 }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(SheetPreviewDataDto, { colorConcentracion: '9'.repeat(17) }))).length).toBeGreaterThan(0);
  });

  it('el snapshot conserva la concentración exactamente como se capturó, junto con el texto del color y sin tocar la resina VCI', () => {
    const e = construirEspecificacion({ datos: { ...BASE, colorConcentracion: '3' } as Record<string, unknown>, procedencia: { colorConcentracion: 'USUARIO' } }, 'SCHFPMG001');
    expect(e.datos).toMatchObject({ colorConcentracion: '3', colorNombre: 'DAUBERT AZUL AL 3%', resinaVci: 'PMG AL 4%' });
    expect(e.procedencia).toMatchObject({ colorConcentracion: 'USUARIO' });
  });

  it('la hoja (vista previa y PDF) imprime lo mismo con o sin el dato: usa el texto del color, no la concentración, y no se mezcla con la resina VCI', () => {
    const con = mapSheetData('BOLSA_PLANA_1', { ...BASE, colorConcentracion: '3' });
    const sin = mapSheetData('BOLSA_PLANA_1', BASE);
    expect(con).toEqual(sin);
    expect(con.datos.color).toBe('DAUBERT AZUL AL 3%');
    expect(con.datos.resina_vci).toBe('PMG AL 4%');
  });

  it('una concentración vacía no se infiere del texto impreso: el texto sigue siendo el que se guardó', () => {
    const e = construirEspecificacion({ datos: { ...BASE } as Record<string, unknown> }, 'SCHFPMG001');
    expect(e.datos.colorConcentracion).toBeUndefined();
    expect(mapSheetData('BOLSA_PLANA_1', e.datos as PreviewFormData).datos.color).toBe('DAUBERT AZUL AL 3%');
  });
});
