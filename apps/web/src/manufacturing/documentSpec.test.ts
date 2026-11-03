import { describe, expect, it } from 'vitest';
import type { DocumentoVista } from '../services/manufacturingDocuments';
import { coexAzul, familyConfigs, schfpmg001 } from '../test/bindProductFixtures';
import { abrirSinBind, aplicarGuardado, claveDeCarga, claveDeDocumento, construirCarga, reconocimientosDe } from './documentSpec';
import { buildInitialForm, configOf, confirmFamily, displayOrigin, isEdited, selectFamily, setColorPreset, setCustomColor, setFieldValue, type FieldKey } from './specificationForm';

const lookup = schfpmg001();
function formulario(familia: 'BOLSA_PLANA_1' | 'HOJA_PAQ' = 'BOLSA_PLANA_1') {
  return confirmFamily(selectFamily(buildInitialForm(lookup, familyConfigs, '2026-10-29'), familia, familyConfigs));
}
const cfg = configOf(familyConfigs, 'BOLSA_PLANA_1')!;

describe('empaquetado de la especificación para el gestor documental', () => {
  it('sin familia no hay nada que guardar', () => {
    expect(construirCarga({ ...formulario(), family: null }, cfg, lookup, {})).toBeNull();
  });

  it('guarda los datos que ve la vista previa, la procedencia, los 5 campos de BIND y los reconocimientos como {id, huella}; nunca identidad', () => {
    const f = setFieldValue(formulario(), 'ancho', '99');
    const carga = construirCarga(f, cfg, lookup, { 'PRODUCTO_FAMILIA:producto': '["x"]' })!;
    expect(carga.familia).toBe('BOLSA_PLANA_1');
    expect(carga.datos.ancho).toBe('99');
    expect(carga.datos.codigo).toBe(lookup.producto.Code);
    expect(carga.procedencia!.ancho).toBe('USUARIO');
    expect(Object.keys(carga.bind!).every((k) => ['Code', 'Title', 'Description', 'Weight', 'CreationDate'].includes(k))).toBe(true);
    expect(carga.bind).toMatchObject({ Code: lookup.producto.Code, Title: lookup.producto.Title });
    expect(carga.incidenciasReconocidas).toEqual([{ id: 'PRODUCTO_FAMILIA:producto', huella: '["x"]' }]);
    const prohibidos = ['usuario', 'usuarioId', 'email', 'creadoPor', 'estado', 'revision', 'version', 'huella', 'creado', 'finalizado'];
    const claves = [...Object.keys(carga), ...Object.keys(carga.datos), ...Object.keys(carga.bind!)].map((k) => k.toLowerCase());
    for (const p of prohibidos) expect(claves).not.toContain(p.toLowerCase());
    expect(JSON.stringify(carga)).not.toContain('"ID"');                                          // el ID interno de BIND no se guarda
  });

  it('cliente: del catálogo viaja solo su id; texto libre viaja como nombre (sin verificar); vacío no viaja', () => {
    const base = formulario();
    expect(construirCarga(base, cfg, lookup, {})!.cliente).toBeUndefined();
    expect(construirCarga(setFieldValue(base, 'cliente', '  Cliente libre ', 'PROVISIONAL'), cfg, lookup, {})!.cliente).toEqual({ nombre: 'Cliente libre' });
    expect(construirCarga(setFieldValue(base, 'cliente', 'Schneider', 'CATALOGO', '17'), cfg, lookup, {})!.cliente).toEqual({ empresaId: '17' });
  });

  it('el peso de BIND solo se guarda si es numérico', () => {
    const conPeso = { ...lookup, producto: { ...lookup.producto, Weight: '1.5', Description: 'Desc' } };
    expect(construirCarga(formulario(), cfg, conPeso, {})!.bind).toMatchObject({ Weight: 1.5, Description: 'Desc' });
    const sinPeso = { ...lookup, producto: { ...lookup.producto, Weight: 'n/a', Description: null } };
    const bind = construirCarga(formulario(), cfg, sinPeso, {})!.bind!;
    expect(bind).not.toHaveProperty('Weight');
    expect(bind).not.toHaveProperty('Description');
  });

  it('la clave de «cambios sin guardar» coincide entre lo que se envía y lo que el servidor devuelve, y cambia al editar', () => {
    const f = formulario();
    const carga = construirCarga(f, cfg, lookup, {})!;
    const guardado = { familia: carga.familia, especificacion: { datos: carga.datos, incidenciasReconocidas: [] }, cliente: null } as unknown as DocumentoVista;
    expect(claveDeCarga(carga)).toBe(claveDeDocumento(guardado));
    expect(claveDeCarga(construirCarga(setFieldValue(f, 'largo', '123'), cfg, lookup, {}))).not.toBe(claveDeDocumento(guardado));
    const conCliente = construirCarga(setFieldValue(f, 'cliente', 'X', 'CATALOGO', '9'), cfg, lookup, {})!;
    const guardadoConCliente = { ...guardado, especificacion: { datos: conCliente.datos }, cliente: { empresaId: '9', nombre: 'X', verificado: true } } as unknown as DocumentoVista;
    expect(claveDeCarga(conCliente)).toBe(claveDeDocumento(guardadoConCliente));
    expect(claveDeCarga(null)).toBe('');
  });

  it('abrir un guardado coloca sus valores sobre el formulario nuevo de BIND: familia confirmada, campos editados, cliente y reconocimientos', () => {
    const original = setFieldValue(setFieldValue(formulario(), 'ancho', '77'), 'calibre', '3.5');
    const carga = construirCarga(setFieldValue(original, 'cliente', 'Schneider', 'CATALOGO', '17'), cfg, lookup, { 'A:b': '["h"]' })!;
    const doc = { familia: carga.familia, especificacion: { datos: carga.datos, incidenciasReconocidas: carga.incidenciasReconocidas }, cliente: { empresaId: '17', nombre: 'Schneider', verificado: true } } as unknown as DocumentoVista;
    const reabierto = aplicarGuardado(buildInitialForm(lookup, familyConfigs, '2026-10-29'), doc, familyConfigs);
    expect(reabierto.family).toBe('BOLSA_PLANA_1');
    expect(reabierto.familyOrigin).toBe('USUARIO');
    expect(reabierto.fields.ancho.value).toBe('77');
    expect(reabierto.fields.calibre.value).toBe('3.5');
    expect(reabierto.fields.cliente).toMatchObject({ value: 'Schneider', source: 'CATALOGO', ref: '17' });
    expect(reconocimientosDe(doc)).toEqual({ 'A:b': '["h"]' });
    // Idempotente: volver a empaquetar lo reabierto produce los mismos datos guardados.
    expect(claveDeCarga(construirCarga(reabierto, cfg, lookup, reconocimientosDe(doc)))).toBe(claveDeCarga(carga));
  });

  it('un cliente manual se reabre como texto libre no vinculado', () => {
    const doc = { familia: 'BOLSA_PLANA_1', especificacion: { datos: { codigo: lookup.producto.Code } }, cliente: { empresaId: null, nombre: 'Manual', verificado: false } } as unknown as DocumentoVista;
    const f = aplicarGuardado(buildInitialForm(lookup, familyConfigs, '2026-10-29'), doc, familyConfigs);
    expect(f.fields.cliente).toMatchObject({ value: 'Manual', source: 'PROVISIONAL' });
    expect(f.fields.cliente.ref).toBeUndefined();
  });
});

// Reabrir un documento guardado nunca debe volver a interpretar los datos técnicos con los valores actuales de BIND: lo guardado manda.
describe('recuperación fiel de datos técnicos y colores personalizados', () => {
  const sinIdentidad = (k: string): boolean => !['codigo', 'cliente'].includes(k);
  function igualesALoGuardado(reabierto: ReturnType<typeof aplicarGuardado>, datos: Record<string, string>): void {
    for (const [k, v] of Object.entries(datos)) {
      if (sinIdentidad(k) && k in reabierto.fields) expect(reabierto.fields[k as FieldKey].value, k).toBe(v);
    }
  }

  it('color personalizado que NO está en el catálogo local: se recupera su nombre y HEX sin tocar localStorage', () => {
    window.localStorage.clear();
    const f = setCustomColor(formulario(), 'Azul Cielo Especial', '#3778c8');
    const carga = construirCarga(f, cfg, lookup, {})!;
    expect(carga.datos).toMatchObject({ colorNombre: 'Azul Cielo Especial', colorHex: '#3778c8' });
    const doc = { familia: carga.familia, especificacion: { datos: carga.datos }, cliente: null } as unknown as DocumentoVista;
    const reabierto = aplicarGuardado(buildInitialForm(lookup, familyConfigs, '2026-10-29'), doc, familyConfigs);
    expect(reabierto.fields.colorNombre.value).toBe('Azul Cielo Especial');
    expect(reabierto.fields.colorHex.value).toBe('#3778c8');
    expect(window.localStorage.length).toBe(0);
    expect(claveDeCarga(construirCarga(reabierto, cfg, lookup, {}))).toBe(claveDeCarga(carga));
  });

  it('cantidades, dimensiones, calibre literal, composición y peso guardados no se sobrescriben con un BIND distinto', () => {
    let f = formulario();
    for (const [k, v] of [['cantidad', '250'], ['ancho', '77'], ['largo', '88'], ['calibre', '2.5 MIL'], ['pesoLb', '12.34']] as const) f = setFieldValue(f, k, v);
    const carga = construirCarga(f, cfg, lookup, {})!;
    const otroBind = { ...lookup, producto: { ...lookup.producto, Weight: 99.9, Title: `${lookup.producto.Title} MODIFICADO` } };
    const doc = { familia: carga.familia, especificacion: { datos: carga.datos }, cliente: null } as unknown as DocumentoVista;
    const reabierto = aplicarGuardado(buildInitialForm(otroBind, familyConfigs, '2026-10-29'), doc, familyConfigs);
    igualesALoGuardado(reabierto, carga.datos);
    expect(reabierto.fields.calibre.value).toBe('2.5 MIL');
    expect(reabierto.fields.pesoLb.value).toBe('12.34');
    expect(claveDeCarga(construirCarga(reabierto, cfg, otroBind, {}))).toBe(claveDeCarga(carga));
  });

  it('COEX: pesos por capa y libras de VCI guardados se conservan aunque el cálculo con los datos actuales daría otros', () => {
    const coex = coexAzul();
    const cfgCoex = configOf(familyConfigs, 'COEX')!;
    let f = confirmFamily(selectFamily(buildInitialForm(coex, familyConfigs, '2026-10-29'), 'COEX', familyConfigs));
    f = setFieldValue(setFieldValue(f, 'pesoCapaInterior', '0.111'), 'lbVciInterior', '0.0222');
    const carga = construirCarga(f, cfgCoex, coex, {})!;
    const otroBind = { ...coex, producto: { ...coex.producto, Weight: 7.7 } };
    const doc = { familia: carga.familia, especificacion: { datos: carga.datos }, cliente: null } as unknown as DocumentoVista;
    const reabierto = aplicarGuardado(buildInitialForm(otroBind, familyConfigs, '2026-10-29'), doc, familyConfigs);
    igualesALoGuardado(reabierto, carga.datos);
    expect(reabierto.fields.pesoCapaInterior.value).toBe('0.111');
    expect(reabierto.fields.lbVciInterior.value).toBe('0.0222');
  });
});

describe('abrir sin BIND (copia guardada en el documento)', () => {
  const docDe = (carga: NonNullable<ReturnType<typeof construirCarga>>) =>
    ({ codigo: carga.bind!.Code, familia: carga.familia, especificacion: { datos: carga.datos, procedencia: carga.procedencia, bind: carga.bind, incidenciasReconocidas: carga.incidenciasReconocidas }, cliente: null }) as unknown as DocumentoVista;

  it('reconstruye el formulario con el motor de especificaciones sin ninguna llamada a BIND y conserva Code/Title guardados', () => {
    const f = setFieldValue(formulario(), 'ancho', '77');
    const carga = construirCarga(f, cfg, lookup, { 'A:b': 'h1' })!;
    const abierto = abrirSinBind(docDe(carga), familyConfigs);
    expect(abierto.lookup.producto).toMatchObject({ Code: lookup.producto.Code, Title: lookup.producto.Title, ID: '' });
    expect(abierto.form.family).toBe('BOLSA_PLANA_1');
    expect(abierto.form.fields.ancho.value).toBe('77');
    expect(abierto.form.fields.descripcion.value).toBe(carga.datos.descripcion);
    expect(abierto.reconocidas).toEqual({ 'A:b': 'h1' });
    expect(claveDeCarga(construirCarga(abierto.form, cfg, abierto.lookup, abierto.reconocidas))).toBe(claveDeCarga(carga));   // abrir no produce cambios
  });

  it('restaura la procedencia guardada: lo de BIND sigue siendo de BIND y solo lo editado queda como del usuario', () => {
    const carga = construirCarga(setFieldValue(formulario(), 'ancho', '77'), cfg, lookup, {})!;
    expect(carga.procedencia).toMatchObject({ ancho: 'USUARIO' });
    const abierto = abrirSinBind(docDe(carga), familyConfigs).form;
    expect(abierto.fields.ancho.base.origin).not.toBe('BIND');
    const otraClave = Object.entries(carga.procedencia!).find(([k, o]) => o === 'BIND' && k in abierto.fields)?.[0];
    expect(otraClave).toBeDefined();
    expect(abierto.fields[otraClave as FieldKey].base.origin).toBe('BIND');
    expect(abierto.fields[otraClave as FieldKey].manual).not.toBe(true);
  });

  it('COEX: variante, pesos por capa y libras de VCI se recuperan tal cual, sin recalcular con sugerencias', () => {
    const coex = coexAzul();
    const cfgCoex = configOf(familyConfigs, 'COEX')!;
    let f = confirmFamily(selectFamily(buildInitialForm(coex, familyConfigs, '2026-10-29'), 'COEX', familyConfigs));
    f = setFieldValue(setFieldValue(f, 'pesoCapaInterior', '0.111'), 'lbVciInterior', '0.0222');
    const carga = construirCarga(f, cfgCoex, coex, {})!;
    const abierto = abrirSinBind(docDe(carga), familyConfigs).form;
    expect(abierto.family).toBe('COEX');
    for (const k of ['coexVariante', 'pesoCapaInterior', 'lbVciInterior', 'pesoLb', 'calibre'] as const) expect(abierto.fields[k].value, k).toBe(carga.datos[k]);
    expect(abierto.fields.pesoCapaInterior.value).toBe('0.111');
  });
});

// Abrir una hoja guardada reproduce EXACTAMENTE lo que había: misma selección de color, misma procedencia y ningún campo pasa a «Modificado por el usuario».
describe('recuperación de la selección y la procedencia del color', () => {
  const docDe = (carga: NonNullable<ReturnType<typeof construirCarga>>) =>
    ({ codigo: carga.bind!.Code, familia: carga.familia, especificacion: { datos: carga.datos, procedencia: carga.procedencia, bind: carga.bind, incidenciasReconocidas: carga.incidenciasReconocidas }, cliente: null }) as unknown as DocumentoVista;
  const COLORES: FieldKey[] = ['colorPreset', 'colorHex', 'colorNombre'];

  it.each(familyConfigs.filter((c) => c.colorDibujo).map((c) => [c.codigo]))('%s: el color de sistema (Daubert Azul, Natural…) se reabre igual: mismo preset, misma procedencia y sin ediciones', (codigo) => {
    const l = codigo === 'COEX' ? coexAzul() : lookup;
    const c = configOf(familyConfigs, codigo)!;
    const original = confirmFamily(selectFamily(buildInitialForm(l, familyConfigs, '2026-10-29'), codigo, familyConfigs));
    const carga = construirCarga(original, c, l, {})!;
    const abierto = abrirSinBind(docDe(carga), familyConfigs).form;
    for (const k of COLORES) {
      expect(abierto.fields[k].value, `${k} valor`).toBe(original.fields[k].value);
      expect(displayOrigin(abierto.fields[k]), `${k} procedencia`).toBe(displayOrigin(original.fields[k]));
      expect(isEdited(abierto.fields[k]), `${k} editado`).toBe(isEdited(original.fields[k]));
    }
    expect(claveDeCarga(construirCarga(abierto, c, l, {})), 'abrir no cambia lo guardado').toBe(claveDeCarga(carga));
    for (const k of Object.keys(carga.datos)) if (k in abierto.fields) expect(isEdited(abierto.fields[k as FieldKey]), `${k} editado`).toBe(isEdited(original.fields[k as FieldKey]));
  });

  it('un preset elegido por el usuario se reabre como ese preset (no «Otro») y un color personalizado real sigue reabriéndose con nombre y HEX', () => {
    const azul = configOf(familyConfigs, 'BOLSA_PLANA_1')!.colores.find((x) => x.hex && x.id !== 'DAUBERT_AZUL') ?? configOf(familyConfigs, 'BOLSA_PLANA_1')!.colores[0]!;
    const elegido = setColorPreset(formulario(), azul.id, cfg);
    const reabierto = abrirSinBind(docDe(construirCarga(elegido, cfg, lookup, {})!), familyConfigs).form;
    expect(reabierto.fields.colorPreset.value).toBe(azul.id);
    expect(reabierto.fields.colorHex.value).toBe(azul.hex);
    const propio = setCustomColor(formulario(), 'Azul Cielo Especial', '#3778c8');
    const r2 = abrirSinBind(docDe(construirCarga(propio, cfg, lookup, {})!), familyConfigs).form;
    expect(r2.fields.colorPreset.value).toBe('OTRO');
    expect([r2.fields.colorNombre.value, r2.fields.colorHex.value]).toEqual(['Azul Cielo Especial', '#3778c8']);
  });
});
