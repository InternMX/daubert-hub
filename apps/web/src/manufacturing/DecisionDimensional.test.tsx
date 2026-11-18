import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { BindProductLookup } from '../services/bindProducts';
import type { FieldKey } from '../services/manufacturingFamilies';
import lookups from '../test/bindLookups.fixture.json';
import { familyConfigs } from '../test/bindProductFixtures';
import { crearIncidencia, huella, type Reconocimientos } from './incidencias';
import { IncidenciasDeSeccion, IncidenciasProvider } from './IncidenciaViews';
import type { DocumentoVista } from '../services/manufacturingDocuments';
import { aplicarGuardado, construirCarga, lookupDesdeGuardado } from './documentSpec';
import { buildInitialForm, restoreField, setFieldValue, setFuelleTotal, type SpecificationForm } from './specificationForm';

const inicial = buildInitialForm(lookups.DANFPMGOC04 as unknown as BindProductLookup, familyConfigs, '2026-11-05');
const incidencia = crearIncidencia({ codigo: 'INTERPRETACION_DIMENSIONAL', id: 'INTERPRETACION_DIMENSIONAL', nivel: 'CONTRADICCION', campos: ['ancho', 'fuelleTotal', 'fuelleDerecho', 'fuelleIzquierdo', 'largo', 'unidadDimensiones'], seccion: 'medidas', reconocible: true,
  mensaje: 'Interpretación dimensional por confirmar: las medidas de BIND («69 X 43 X 66 CM» y «27 X 17 X 26.4"») se leyeron como Ancho × Fuelle total × Largo. Esa convención aún no está validada por Manufactura.' });

function Arnes() {
  const [form, setForm] = useState<SpecificationForm>(inicial);
  const [reconocidas, setReconocidas] = useState<Reconocimientos>({});
  const valores = (k: FieldKey) => form.fields[k].value;
  const ctx = { lista: [incidencia], visible: () => true, valores, reconocidas, reconocer: (i: typeof incidencia) => setReconocidas((r) => ({ ...r, [i.id]: huella(i, valores) })), deshacer: (i: typeof incidencia) => setReconocidas((r) => Object.fromEntries(Object.entries(r).filter(([id]) => id !== i.id))),
    validado: true, reveladas: new Set<string>(), revelar: () => undefined, revision: 'vigente' as const };
  return (
    <IncidenciasProvider value={ctx}>
      <button onClick={() => setForm((f) => setFuelleTotal(f, '16'))}>fuelle 16</button>
      <button onClick={() => setForm((f) => setFuelleTotal(f, '17'))}>fuelle 17</button>
      <button onClick={() => setForm((f) => setFieldValue(f, 'ancho', '27'))}>tocar ancho</button>
      <IncidenciasDeSeccion seccion="medidas" />
    </IncidenciasProvider>
  );
}

describe('decisión dimensional: pendiente → reconocida → invalidada', () => {
  it('pendiente y reconocida se dicen distinto; la explicación completa queda en un detalle; «Quitar reconocimiento» la devuelve a pendiente', () => {
    render(<Arnes />);
    expect(screen.getByTestId('incidencia-estado')).toHaveTextContent('Interpretación dimensional pendiente de revisión.');
    expect(screen.queryByTestId('incidencia-detalle')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver explicación' }));
    expect(screen.getByTestId('incidencia-detalle')).toHaveTextContent(/69 X 43 X 66 CM.*27 X 17 X 26\.4".*no equivale a una validación oficial de Manufactura/);
    fireEvent.click(screen.getByRole('button', { name: 'Reconocer' }));
    expect(screen.getByTestId('incidencia-estado')).toHaveTextContent('Interpretación dimensional reconocida para esta versión del borrador.');
    expect(screen.queryByText(/Diferencia reconocida/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reconocer' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Quitar reconocimiento' }));
    expect(screen.getByTestId('incidencia-estado')).toHaveTextContent('pendiente de revisión');
  });

  it('cambiar el fuelle total (17 → 16, mitades 8.5 → 8) invalida el reconocimiento; restaurar 17 con los mismos valores lo vuelve a aceptar', () => {
    render(<Arnes />);
    fireEvent.click(screen.getByRole('button', { name: 'Reconocer' }));
    fireEvent.click(screen.getByRole('button', { name: 'fuelle 16' }));
    expect(screen.getByTestId('incidencia-estado')).toHaveTextContent('pendiente de revisión');
    fireEvent.click(screen.getByRole('button', { name: 'Reconocer' }));
    expect(screen.getByTestId('incidencia-estado')).toHaveTextContent('reconocida');
    fireEvent.click(screen.getByRole('button', { name: 'fuelle 17' }));
    expect(screen.getByTestId('incidencia-estado')).toHaveTextContent('pendiente de revisión');
  });
});

describe('procedencia de los fuelles (notas armadas con los valores interpretados)', () => {
  const nota = (k: FieldKey) => inicial.fields[k].base.note ?? '';
  it('total: segunda medida de la expresión; mitades: derivadas de total ÷ 2, simetría no explícita y que requiere reconocimiento', () => {
    expect(nota('fuelleTotal')).toMatch(/Fuelle total 17 pulgadas: procede de interpretar la segunda medida de 27 × 17 × 26\.4 pulgadas como Ancho × Fuelle total × Largo/);
    expect(nota('fuelleDerecho')).toMatch(/Fuelle derecho 8\.5 pulgadas: derivado de 17 ÷ 2.*no es un dato explícito de BIND y requiere reconocer/);
    expect(nota('fuelleIzquierdo')).toMatch(/Fuelle izquierdo 8\.5 pulgadas: derivado de 17 ÷ 2/);
  });
  it('al editar el fuelle total, las mitades derivadas actualizan su nota con el nuevo valor', () => {
    const f = setFuelleTotal(inicial, '16');
    expect([f.fields.fuelleDerecho.value, f.fields.fuelleIzquierdo.value]).toEqual(['8', '8']);
    expect(f.fields.fuelleDerecho.base.note).toMatch(/derivado de 16 ÷ 2/);
  });
});

describe('fuelle total editado y restaurado: valor original frente a valor actual', () => {
  const editado = setFuelleTotal(inicial, '16');
  it('mitades actuales = 16 ÷ 2 y su restauración no vuelve a una explicación de 17 ÷ 2', () => {
    for (const k of ['fuelleDerecho', 'fuelleIzquierdo'] as const) {
      expect(editado.fields[k].value).toBe('8');
      expect(editado.fields[k].base.note).toMatch(/: derivado de 16 ÷ 2/);
      expect(editado.fields[k].base.note).not.toMatch(/17 ÷ 2/);
    }
  });
  it('restaurar el fuelle total devuelve 17 y recalcula las mitades derivadas (8.5) con su explicación de 17 ÷ 2; una mitad editada a mano no se toca', () => {
    const f = restoreField(editado, 'fuelleTotal');
    expect([f.fields.fuelleTotal.value, f.fields.fuelleDerecho.value, f.fields.fuelleIzquierdo.value]).toEqual(['17', '8.5', '8.5']);
    expect(f.fields.fuelleDerecho.base.note).toMatch(/derivado de 17 ÷ 2/);
    expect(f.fields.fuelleTotal.base.note).toMatch(/Fuelle total 17 pulgadas/);
    const manual = restoreField(setFieldValue(editado, 'fuelleDerecho', '7'), 'fuelleTotal');
    expect([manual.fields.fuelleDerecho.value, manual.fields.fuelleIzquierdo.value]).toEqual(['7', '8.5']);
  });
});

describe('guardar y reabrir con el fuelle total editado (16)', () => {
  const lookup = lookups.DANFPMGOC04 as unknown as BindProductLookup;
  const cfg = familyConfigs.find((c) => c.codigo === 'BOLSA_FUELLE')!;
  it('las mitades reabiertas se explican con el valor guardado (16 ÷ 2), nunca con 17 ÷ 2; restaurar una mitad vuelve a 8 coherente con el total', () => {
    const carga = construirCarga(setFuelleTotal(inicial, '16'), cfg, lookup, {})!;
    expect([carga.datos.fuelleTotal, carga.datos.fuelleDerecho, carga.datos.fuelleIzquierdo]).toEqual(['16', '8', '8']);
    const doc = { codigo: lookup.producto.Code, familia: carga.familia, especificacion: { datos: carga.datos, procedencia: carga.procedencia, bind: carga.bind, incidenciasReconocidas: [] }, cliente: null } as unknown as DocumentoVista;
    const base = buildInitialForm(lookupDesdeGuardado(doc), familyConfigs, '2026-11-05');
    const f = aplicarGuardado(base, doc, familyConfigs);
    expect([f.fields.fuelleTotal.value, f.fields.fuelleDerecho.value, f.fields.fuelleIzquierdo.value]).toEqual(['16', '8', '8']);
    for (const k of ['fuelleDerecho', 'fuelleIzquierdo'] as const) {
      expect(f.fields[k].base.note).toMatch(/derivado de 16 ÷ 2/);
      expect(f.fields[k].base.note).not.toMatch(/17/);
    }
    const editada = setFieldValue(f, 'fuelleDerecho', '7');
    expect(restoreField(editada, 'fuelleDerecho').fields.fuelleDerecho.value).toBe('8');
  });
});
