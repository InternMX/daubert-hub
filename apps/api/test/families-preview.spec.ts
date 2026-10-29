import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SafeExceptionFilter } from '../src/common/http-exception.filter';
import { IS_PUBLIC_KEY } from '../src/security/route-access.decorators';

const { pgPool } = vi.hoisted(() => ({ pgPool: vi.fn() }));
vi.mock('pg', () => ({ Pool: pgPool, default: { Pool: pgPool } }));

import { configuracionFamilias, FAMILIAS, FAMILY_CODES } from '../src/manufacturing-sheets/preview/family-registry';
import { FamiliesController } from '../src/manufacturing-sheets/preview/families.controller';
import { mapSheetData } from '../src/manufacturing-sheets/preview/sheet-data.mapper';
import { SheetPreviewController } from '../src/manufacturing-sheets/preview/sheet-preview.controller';
import { SheetPreviewRequestDto } from '../src/manufacturing-sheets/preview/sheet-preview.dto';
import { SheetPreviewService } from '../src/manufacturing-sheets/preview/sheet-preview.service';

// Datos de una bolsa con fuelles tomados del ejemplo aprobado del machote (61 × 70.9, fuelles de 24).
const FUELLE = {
  codigo: 'BFPMG-0042', descripcion: 'Bolsa VCI PMG con fuelles laterales 61 x 48 x 70.9" Cal. 2.7', producto: 'Bolsa', composicion: 'PMG', presentacion: 'ROLLO', cantidad: '100', cantidadUnidad: 'BOLSAS',
  ancho: '61', fuelleTotal: '48', fuelleDerecho: '24', fuelleIzquierdo: '24', largo: '70.9', unidadDimensiones: 'IN', calibre: '2.7', pesoLb: '1.285', colorNombre: 'DAUBERT AZUL AL 2%', colorHex: '#538DD5'
};
const celda = (html: string, id: string): string => new RegExp(`id="${id}"[^>]*>([^]*?)</td>`).exec(html)?.[1]?.trim() ?? '';

describe('registro de familias (autoridad técnica del prototipo)', () => {
  it('lista las familias habilitadas con sus campos, obligatorios y particularidades', () => {
    expect(FAMILY_CODES).toEqual(expect.arrayContaining(['BOLSA_PLANA_1', 'HOJA_PAQ', 'BOLSA_FUELLE', 'BOLSA_NATURAL']));
    for (const codigo of FAMILY_CODES) {
      const def = FAMILIAS[codigo];
      for (const requerido of def.requeridos) expect(def.campos.includes(requerido) || requerido === 'colorPreset' || requerido === 'composicion', `${codigo}.${requerido}`).toBe(true);
    }
    expect(FAMILIAS.BOLSA_FUELLE.campos).toEqual(expect.arrayContaining(['fuelleTotal', 'fuelleDerecho', 'fuelleIzquierdo']));
    expect(FAMILIAS.BOLSA_PLANA_1.campos).not.toContain('fuelleDerecho');
    expect(FAMILIAS.HOJA_PAQ.campos).toContain('modalidad');
    expect(FAMILIAS.BOLSA_PLANA_1.campos).not.toContain('modalidad');
    expect(FAMILIAS.BOLSA_NATURAL).toMatchObject({ composicionFija: 'NAT', composiciones: ['NAT'] });
    expect(FAMILIAS.BOLSA_NATURAL.requeridos).not.toContain('composicion');
    for (const def of Object.values(FAMILIAS)) expect(def.requeridos, def.codigo).not.toContain('cliente');     // el cliente es una regla de EMISIÓN, no de la vista previa técnica
  });

  it('las modalidades salen del perfil: Hojas admite Doblada y Extendida', () => {
    const hojas = configuracionFamilias().find((f) => f.codigo === 'HOJA_PAQ');
    expect(hojas?.modalidades).toEqual([expect.objectContaining({ valor: 'DOBLADA', habilitada: true }), expect.objectContaining({ valor: 'EXTENDIDA', habilitada: true })]);
    expect(configuracionFamilias().find((f) => f.codigo === 'BOLSA_FUELLE')?.modalidades).toEqual([]);
  });
});

describe('Bolsa Fuelle · vista previa con la plantilla aprobada', () => {
  const service = new SheetPreviewService();

  it('imprime ambos fuelles, calibre literal y color; el cliente vacío es válido para la demostración', async () => {
    const r = await service.preview('BOLSA_FUELLE', FUELLE);
    expect(r).toMatchObject({ familia: 'BOLSA_FUELLE', borrador: true, firmas: 'SIN_FIRMA', completo: true, faltantes: [], pendientesEmision: ['Cliente'], bloqueado: null });
    expect(r.html).toContain('61&quot;');
    expect(r.html).toContain('70.9&quot;');
    expect(r.html.match(/24&quot;/g)?.length).toBeGreaterThanOrEqual(2);       // fuelle derecho e izquierdo
    expect(celda(r.html, 'calibre')).toBe('2.7');
    expect(r.html).toContain('fill="#538DD5"');
    expect(r.html).toContain('SIN FIRMA');
    expect(r.html).not.toMatch(/\{\{(?!color_bolsa_hex)/);
  });

  it('el color de las flechas internas sigue al color elegido (blanco sobre azul, #4A7EBB sobre verde)', async () => {
    const azul = await service.preview('BOLSA_FUELLE', FUELLE);
    const verde = await service.preview('BOLSA_FUELLE', { ...FUELLE, colorNombre: 'VERDE', colorHex: '#00B050' });
    expect(azul.html).toMatch(/class="cota-interna"[^>]*stroke="#FFFFFF"/);
    expect(verde.html).toMatch(/class="cota-interna"[^>]*stroke="#4A7EBB"/);
    expect(verde.html).toContain('fill="#00B050"');
  });

  it('sin fuelles falta información técnica: advierte y no inventa valores', async () => {
    const r = await service.preview('BOLSA_FUELLE', { ...FUELLE, fuelleDerecho: '', fuelleIzquierdo: '' });
    expect(r.completo).toBe(false);
    expect(r.faltantes).toEqual(expect.arrayContaining(['Fuelle derecho', 'Fuelle izquierdo']));
  });

  it('Bolsa Plana 1 ignora los fuelles con advertencia (no se arrastran a una familia que no los tiene)', () => {
    const m = mapSheetData('BOLSA_PLANA_1', FUELLE);
    expect(m.datos).not.toHaveProperty('fuelle_derecho');
    expect(m.advertencias.join(' ')).toMatch(/fuelles no aplican/i);
  });
});

describe('Bolsa Natural · vista previa con la plantilla aprobada', () => {
  const service = new SheetPreviewService();
  const NATURAL = { ...FUELLE, composicion: 'CP5000', colorNombre: 'NATURAL', colorHex: '#FFF2CC', fuelleTotal: '', resinaVci: '' };

  it('la composición es fija (PMG = NA, ESD = NA, Natural = X) aunque el formulario traiga otra; no existe CP5000', async () => {
    const r = await service.preview('BOLSA_NATURAL', NATURAL);
    expect(r.completo).toBe(true);
    expect(r.html).toContain('id="comp_natural" data-valor="X"');
    expect(r.html).toContain('id="comp_pmg" data-valor="NA"');
    expect(r.html).toContain('id="comp_esd" data-valor="NA"');
    expect(r.html).not.toContain('comp_cp5000');
    expect(r.advertencias.filter((a) => a.startsWith('Validación de la familia'))).toEqual([]);   // el validador de tools/ aprueba
    expect(r.html).toMatch(/class="cota-interna"[^>]*stroke="#000000"/);
    expect(r.html).toContain('fill="#FFF2CC"');
  });

  it('imprime el nombre del color NATURAL en la hoja (sin concentración de colorante)', async () => {
    const r = await service.preview('BOLSA_NATURAL', NATURAL);
    expect(r.html).toMatch(/>\s*NATURAL\s*</);
    expect(r.html).not.toMatch(/NATURAL AL \d/);
  });

  it('sin composición en el formulario NO falta Composición (es fija) y no se asigna formulación VCI', () => {
    const m = mapSheetData('BOLSA_NATURAL', { ...NATURAL, composicion: '' });
    expect(m.faltantes).toEqual([]);
    expect(m.datos.resina_vci).toBe('');
  });
});

describe('cliente: requisito de emisión, no de la demostración', () => {
  it('cliente vacío: borrador técnicamente completo; con cliente desaparece el pendiente de emisión', () => {
    const vacio = mapSheetData('BOLSA_FUELLE', FUELLE);
    expect(vacio.faltantes).toEqual([]);
    expect(vacio.pendientesEmision).toEqual(['Cliente']);
    expect(mapSheetData('BOLSA_FUELLE', { ...FUELLE, cliente: 'Schneider Electric' }).pendientesEmision).toEqual([]);
  });
});

describe('GET /api/manufacturing-sheets/families y POST /previews con las nuevas familias', { timeout: 20_000 }, () => {
  let app: INestApplication;
  beforeEach(async () => {
    Reflect.defineMetadata('design:paramtypes', [SheetPreviewService], SheetPreviewController);
    Reflect.defineMetadata('design:paramtypes', [SheetPreviewRequestDto], SheetPreviewController.prototype, 'create');
    const modulo = await Test.createTestingModule({ controllers: [SheetPreviewController, FamiliesController], providers: [SheetPreviewService] }).compile();
    app = modulo.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new SafeExceptionFilter());
    await app.init();
    pgPool.mockClear();
  });

  it('entrega la configuración del registro, solo lectura y sin PostgreSQL', async () => {
    const res = await request(app.getHttpServer()).get('/api/manufacturing-sheets/families');
    expect(res.status).toBe(200);
    expect(res.body.data.map((f: { codigo: string }) => f.codigo)).toEqual(FAMILY_CODES);
    expect(JSON.stringify(res.body)).not.toMatch(/templates\/|\.html|profiles\//);        // no expone rutas internas
    expect(pgPool).not.toHaveBeenCalled();
    expect((await request(app.getHttpServer()).post('/api/manufacturing-sheets/families').send({})).status).toBe(404);
  });

  it('las rutas son autenticadas (no @Public)', () => {
    expect(Reflect.getMetadata(PATH_METADATA, FamiliesController)).toBe('manufacturing-sheets/families');
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, FamiliesController)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, FamiliesController.prototype.list)).toBeUndefined();
  });

  it('acepta los campos de fuelles y la familia nueva; rechaza familias y campos desconocidos', async () => {
    const ok = await request(app.getHttpServer()).post('/api/manufacturing-sheets/previews').send({ familia: 'BOLSA_FUELLE', datos: FUELLE });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ familia: 'BOLSA_FUELLE', completo: true, bloqueado: null, pendientesEmision: ['Cliente'] });
    for (const body of [{ familia: 'BOLSA_INEXISTENTE', datos: {} }, { familia: 'BOLSA_FUELLE', datos: { fuelleDerecho: 'x'.repeat(17) } }, { familia: 'BOLSA_FUELLE', datos: { bloque_firma_aprobo: '<img>' } }]) {
      expect((await request(app.getHttpServer()).post('/api/manufacturing-sheets/previews').send(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(pgPool).not.toHaveBeenCalled();                // no persiste nada
  });
});

// ---------------------------------------------------------------- bloque B · Rollo Continuo y Termoencogible
const ROLLO = {
  codigo: 'RCPMG-0001', descripcion: 'Rollo VCI PMG doblado 58 x 4500" Cal. 3 mil', producto: 'ROLLO VCI', composicion: 'PMG', presentacion: 'ROLLO', modalidad: 'DOBLADA',
  ancho: '58', largo: '4500', unidadDimensiones: 'IN', anchoRollo: '30', calibre: '3 MIL', pesoLb: '8.25', colorNombre: 'ROJO', colorHex: '#C0504D'
};
const TERMO = {
  codigo: 'TE-001', descripcion: 'Rollo VCI + UV termoencogible doblado 6 x 30 metros Cal. 8 mil', producto: 'ROLLO VCI + UV TERMOENCOGIBLE', composicion: 'PMG', presentacion: 'ROLLO', modalidad: 'DOBLADA',
  ancho: '6', largo: '30', unidadDimensiones: 'M', calibre: '8 MIL', pesoLb: '45.2', colorNombre: 'NATURAL', anchoDoblado: '1.60', medidaPliegue: '0.70', largoPresentacionFinal: '30', anchoPresentacionFinal: '1.60'
};

describe('Rollo Continuo · plantilla aprobada', () => {
  const service = new SheetPreviewService();

  it('modalidad Doblada: imprime el ancho del rollo independiente, sin fila de cantidad y con el color del dibujo', async () => {
    const r = await service.preview('ROLLO_CONTINUO', ROLLO);
    expect(r).toMatchObject({ familia: 'ROLLO_CONTINUO', borrador: true, firmas: 'SIN_FIRMA', completo: true, faltantes: [], bloqueado: null, pendientesEmision: ['Cliente'] });
    expect(r.advertencias.filter((a) => a.startsWith('Validación de la familia'))).toEqual([]);
    expect(r.html).toContain('30&quot;');                                   // ancho_rollo ≠ ancho (58")
    expect(r.html).toContain('58&quot;');
    expect(r.html).toContain('id="hoja_doblada" data-valor="X"');
    expect(r.html.replace(/<!--[^]*?-->/g, '')).not.toContain('Cantidad Por Rollo o Paquete');
    expect(r.html).toContain('fill="#C0504D"');
    expect(celda(r.html, 'calibre')).toBe('3 MIL');
  });

  it('Extendida NO está autorizada: no se genera un documento engañoso y se explica', async () => {
    const r = await service.preview('ROLLO_CONTINUO', { ...ROLLO, modalidad: 'EXTENDIDA' });
    expect(r.html).toBe('');
    expect(r.completo).toBe(false);
    expect(r.bloqueado).toMatch(/Extendida de Rollo Continuo no está autorizada/);
    expect(configuracionFamilias().find((f) => f.codigo === 'ROLLO_CONTINUO')?.modalidades).toEqual([expect.objectContaining({ valor: 'DOBLADA', habilitada: true }), expect.objectContaining({ valor: 'EXTENDIDA', habilitada: false })]);
  });

  it('sin ancho del rollo o sin modalidad falta información técnica (no se calcula ni se inventa)', async () => {
    const r = await service.preview('ROLLO_CONTINUO', { ...ROLLO, anchoRollo: '', modalidad: '' });
    expect(r.completo).toBe(false);
    expect(r.faltantes).toEqual(expect.arrayContaining(['Ancho del rollo', 'Hoja doblada o extendida']));
    expect(r.html).not.toMatch(/id="hoja_(doblada|extendida)" data-valor="(X|NA)"/);
  });
});

describe('Termoencogible · plantilla aprobada', () => {
  const service = new SheetPreviewService();

  it('modalidad Doblada con las cuatro cotas: imprime medidas con su unidad, sin color de dibujo ni fila de cantidad', async () => {
    const r = await service.preview('TERMOENCOGIBLE', TERMO);
    expect(r).toMatchObject({ familia: 'TERMOENCOGIBLE', completo: true, faltantes: [], bloqueado: null });
    expect(r.advertencias.filter((a) => a.startsWith('Validación de la familia'))).toEqual([]);
    expect(r.html).toContain('1.60 m');
    expect(r.html).toContain('0.70 m');
    expect(r.html).toContain('Metros (M)');
    expect(r.html.replace(/<!--[^]*?-->/g, '')).not.toContain('Cantidad Por Rollo o Paquete');
    expect(celda(r.html, 'color')).toBe('NATURAL');
    expect(r.html).not.toMatch(/\{\{/);
    expect(r.html).toContain('href="data:image/png;base64,');
    expect(r.html).not.toContain('href="images/rollo_doblado_original.png"');
  });

  it('las cotas técnicas son obligatorias e independientes: sin ellas la representación es incompleta', async () => {
    const r = await service.preview('TERMOENCOGIBLE', { ...TERMO, anchoDoblado: '', medidaPliegue: '' });
    expect(r.completo).toBe(false);
    expect(r.faltantes).toEqual(expect.arrayContaining(['Ancho doblado', 'Medida del pliegue']));
  });

  it('Extendida no está autorizada', async () => {
    const r = await service.preview('TERMOENCOGIBLE', { ...TERMO, modalidad: 'EXTENDIDA' });
    expect(r.html).toBe('');
    expect(r.bloqueado).toMatch(/Extendida de Termoencogible no está autorizada/);
  });

  it('los campos de otra familia (ancho del rollo, fuelles) no se imprimen aquí', () => {
    const m = mapSheetData('TERMOENCOGIBLE', { ...TERMO, anchoRollo: '30', fuelleDerecho: '24' });
    expect(m.datos).not.toHaveProperty('ancho_rollo');
    expect(m.datos).not.toHaveProperty('fuelle_derecho');
    expect(m.advertencias.join(' ')).toMatch(/fuelles no aplican/i);
  });
});

// ---------------------------------------------------------------- bloque C · COEX (Azul y Verde)
const COEX = {
  codigo: 'COEX-001', descripcion: 'Bolsa COEX VCI PMG 51.2 x 23.6 x 31.5" Cal. 2.5 mil', producto: 'Bolsa Con Fuelle - 20% de material reciclado', composicion: 'PMG', presentacion: 'ROLLO', cantidad: '150', cantidadUnidad: 'BOLSAS',
  ancho: '51.2', fuelleTotal: '23.6', fuelleDerecho: '11.8', fuelleIzquierdo: '11.8', largo: '31.5', unidadDimensiones: 'IN', calibre: '2.5 MIL', pesoLb: '0.3929', colorNombre: 'AZUL', coexVariante: 'AZUL',
  pesoCapaInterior: '0.13097', pesoCapaIntermedia: '0.13097', pesoCapaExterior: '0.13097', lbVciInterior: '0.005239', lbVciIntermedia: '0.002619', lbVciExterior: '0'
};

describe('COEX · una familia, dos variantes aprobadas, una sola plantilla', () => {
  const service = new SheetPreviewService();

  it('el registro tiene UNA familia COEX con las variantes Azul (#558ED5) y Verde (#00B050) y tres capas de formulación fija', () => {
    const coex = configuracionFamilias().find((f) => f.codigo === 'COEX');
    expect(coex?.variantes.map((v) => [v.valor, v.colorCuerpo])).toEqual([['AZUL', '#558ED5'], ['VERDE', '#00B050']]);
    expect(coex?.capas?.map((c) => [c.id, c.resina])).toEqual([['interior', 'VCI PMG al 4%'], ['intermedia', 'VCI PMG al 2%'], ['exterior', 'SIN VCI']]);
    expect(FAMILIAS.COEX.plantilla).toBe('templates/coex/coex.template.html');                  // la plantilla compartida existente: sin HTML duplicado
    expect(FAMILIAS.COEX.composicionFija).toBe('PMG');
    expect(FAMILIAS.COEX.campos).not.toContain('resinaVci');                                    // no hay una concentración general de 3 %
    expect(FAMILY_CODES.filter((c) => c.startsWith('COEX'))).toEqual(['COEX']);                 // Azul y Verde NO son dos familias
  });

  it('COEX Azul: colores del cuerpo, de las tres capas y de las flechas internas aprobados; tabla de tres capas con sus pesos', async () => {
    const r = await service.preview('COEX', COEX);
    expect(r).toMatchObject({ familia: 'COEX', completo: true, faltantes: [], bloqueado: null, borrador: true, firmas: 'SIN_FIRMA', pendientesEmision: ['Cliente'] });
    for (const hex of ['#558ED5', '#376092', '#95B3D7', '#C6D9F1']) expect(r.html, hex).toContain(hex);
    expect(r.html).toMatch(/class="cota-interna"[^>]*stroke="#FFFFFF"/);
    for (const texto of ['VCI PMG al 4%', 'VCI PMG al 2%', 'SIN VCI', '0.13097', '0.005239', '0.002619', '0.3929', 'COEXTRUSIÓN']) expect(r.html, texto).toContain(texto);
    expect(r.html).toContain('id="comp_pmg" data-valor="X"');
    expect(r.html.replace(/<!--[^]*?-->/g, '')).not.toMatch(/\{\{[A-Za-z0-9_]+\}\}/);        // ningún placeholder pendiente (el texto fijo de un comentario CSS no cuenta)
  });

  it('COEX Verde: misma plantilla, otros colores aprobados', async () => {
    const r = await service.preview('COEX', { ...COEX, coexVariante: 'VERDE', colorNombre: 'VERDE' });
    for (const hex of ['#00B050', '#92D050', '#D7E4BD']) expect(r.html, hex).toContain(hex);
    expect(r.html).toMatch(/class="cota-interna"[^>]*stroke="#4A7EBB"/);
    expect(r.html).not.toContain('#558ED5');
    const azul = await service.preview('COEX', COEX);
    expect(r.html.replace(/#[0-9A-Fa-f]{6}/g, '#')).toBe(azul.html.replace(/#[0-9A-Fa-f]{6}/g, '#').replace(/AZUL/g, 'VERDE'));   // igual salvo colores y el texto del color
  });

  it('no inventa pesos por capa ni la variante: sin ellos la representación es incompleta y se advierte', async () => {
    const r = await service.preview('COEX', { ...COEX, coexVariante: '', pesoCapaInterior: '', lbVciIntermedia: '' });
    expect(r.completo).toBe(false);
    expect(r.faltantes).toEqual(expect.arrayContaining(['Variante COEX', 'Peso de la capa interior', 'Libras de VCI de la capa intermedia']));
    expect(r.html).toContain('{{color_bolsa_hex}}');                  // sin variante: el dibujo no recibe un color inventado
  });

  it('una variante personalizada no existe: el DTO la rechaza y el texto de color distinto solo genera una advertencia', async () => {
    expect(mapSheetData('COEX', { ...COEX, colorNombre: 'ROJO' }).advertencias.join(' ')).toMatch(/la geometría usa los colores aprobados de COEX Azul/);
    const modulo = await Test.createTestingModule({ controllers: [SheetPreviewController], providers: [SheetPreviewService] }).compile();
    Reflect.defineMetadata('design:paramtypes', [SheetPreviewRequestDto], SheetPreviewController.prototype, 'create');
    const app = modulo.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    expect((await request(app.getHttpServer()).post('/api/manufacturing-sheets/previews').send({ familia: 'COEX', datos: { coexVariante: 'ROJO' } })).status).toBe(400);
    expect((await request(app.getHttpServer()).post('/api/manufacturing-sheets/previews').send({ familia: 'COEX', datos: COEX })).status).toBe(200);
    await app.close();
  });
});

describe('Colores personalizados (nombre + HEX) en la vista previa y el PDF', () => {
  const service = new SheetPreviewService();
  it('el nombre se imprime en el campo Color y el HEX llena el dibujo; los demás datos y la concentración no cambian', async () => {
    const r = await service.preview('BOLSA_FUELLE', { ...FUELLE, colorNombre: 'AZUL ESPECIAL CLIENTE', colorHex: '#3778C8' });
    expect(r.html).toMatch(/>\s*AZUL ESPECIAL CLIENTE\s*</);
    expect(r.html).toContain('fill="#3778C8"');
    expect(r.html).not.toContain('#538DD5');
    expect(r.completo).toBe(true);
    expect(r.faltantes).toEqual([]);
  });
  it('las flechas internas se leen sobre el color: blancas sobre uno oscuro o medio, negras sobre uno claro; los predefinidos conservan su decisión aprobada', async () => {
    const oscuro = await service.preview('BOLSA_FUELLE', { ...FUELLE, colorNombre: 'AZUL ESPECIAL', colorHex: '#3778C8' });
    const claro = await service.preview('BOLSA_FUELLE', { ...FUELLE, colorNombre: 'AMARILLO PASTEL', colorHex: '#FFE699' });
    const azul = await service.preview('BOLSA_FUELLE', FUELLE);
    expect(oscuro.html).toMatch(/class="cota-interna"[^>]*stroke="#FFFFFF"/);
    expect(claro.html).toMatch(/class="cota-interna"[^>]*stroke="#000000"/);
    expect(azul.html).toMatch(/class="cota-interna"[^>]*stroke="#FFFFFF"/);
  });
  it('un HEX inválido no se imprime como color (el dibujo queda sin color y se advierte); el nombre se escapa', async () => {
    const r = await service.preview('BOLSA_FUELLE', { ...FUELLE, colorNombre: '<b>ROJO</b>', colorHex: '#GG0000' });
    expect(r.html).toContain('&lt;b&gt;ROJO&lt;/b&gt;');
    expect(r.incidencias.some((i) => i.codigo === 'VALOR_INVALIDO' && i.campos.includes('colorHex'))).toBe(true);
  });
});
