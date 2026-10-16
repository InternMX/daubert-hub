import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { coloresExplicitos, revisarCoherencia } from '../src/manufacturing-sheets/preview/technical-coherence';
import { SheetPreviewRequestDto } from '../src/manufacturing-sheets/preview/sheet-preview.dto';
import { SheetPreviewService } from '../src/manufacturing-sheets/preview/sheet-preview.service';

describe('Coherencia del borrador (sin confirmar ni sobrescribir)', () => {
  it('color explícito, con detección conservadora y sin alterar texto', () => {
    expect(coloresExplicitos('CLIENTE AZUL BANANA BLUE NATURAL')).toEqual([]);
    expect(coloresExplicitos('COLOR: BLUE / COLOR VERDE')).toEqual(['AZUL', 'VERDE']);
    const datos = Object.freeze({ colorNombre: 'VERDE', colorHex: '#00B050', descripcion: 'Original', etiqueta: 'Original' });
    const avisos = revisarCoherencia('BOLSA_PLANA_1', datos, { title: 'BOLSA PMG COLOR AZUL', code: 'SCHFPMG001' });
    expect(avisos.find((a) => a.id === 'COLOR_AZUL')).toMatchObject({ nivel: 'CONTRADICCION', mensaje: expect.stringContaining('VERDE') });
    expect(datos.descripcion).toBe('Original');
    expect(datos.etiqueta).toBe('Original');
  });

  it.each([
    ['BOLSA PMG', 'SCHFPMG001', 'CORROBORADO_resina'],
    ['BOLSA PMG', 'ITESFCP002', 'TITLE_CODE_resina'],
    ['BOLSA NAT', 'SCHFPMG001', 'TITLE_CODE_resina'],
    ['PAPEL PW33', 'TARPPW3301', 'FAMILIA_BIND'],
    ['BOLSA ESD', 'SCHFESD001', 'RESINA_SIN_COMPOSICION'],
    ['BOLSA XOW', 'SCHFXOW001', 'RESINA_SIN_COMPOSICION'],
    ['BOLSA PMG CON FUELLE', 'SCHFPMG001', 'FAMILIA_BIND']
  ])('%s / %s: %s', (title, code, id) => {
    expect(revisarCoherencia('BOLSA_PLANA_1', { composicion: 'PMG' }, { title, code }).map((a) => a.id)).toContain(id);
  });

  it('COEX mantiene las capas; natural y fuelles incompatibles se explican', () => {
    expect(revisarCoherencia('COEX', { lbVciExterior: '1' }).map((a) => a.id)).toContain('COEX_EXTERIOR');
    expect(revisarCoherencia('BOLSA_NATURAL', {}, { title: 'BOLSA PMG', code: 'SCHFPMG001', composicionSeleccionada: 'PMG' }).map((a) => a.id)).toContain('COMPOSICION_FAMILIA');
    expect(revisarCoherencia('BOLSA_FUELLE', { fuelleTotal: '10', fuelleDerecho: '4', fuelleIzquierdo: '4' }, { title: 'BOLSA PMG', code: '' }).map((a) => a.id)).toContain('FUELLE_TOTAL');
  });

  it('el contexto nuevo rechaza propiedades extra y títulos excesivos sin habilitar HTML', async () => {
    const dto = plainToInstance(SheetPreviewRequestDto, { familia: 'COEX', datos: {}, contexto: { title: 'x'.repeat(501), code: 'A', html: '<script>x</script>' } });
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).not.toHaveLength(0);
    const r = await new SheetPreviewService().preview('BOLSA_PLANA_1', { descripcion: '<img src=x onerror=alert(1)>', ancho: '-2' }, { title: 'COLOR AZUL <script>alert(1)</script>', code: '' });
    expect(r.completo).toBe(false);
    expect(r.html).not.toContain('<img src=x');
    expect(r.html).not.toContain('<script>');
  });
});
