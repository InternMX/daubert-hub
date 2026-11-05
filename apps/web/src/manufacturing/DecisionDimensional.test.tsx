import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { BindProductLookup } from '../services/bindProducts';
import type { FieldKey } from '../services/manufacturingFamilies';
import lookups from '../test/bindLookups.fixture.json';
import { familyConfigs } from '../test/bindProductFixtures';
import { crearIncidencia, huella, type Reconocimientos } from './incidencias';
import { IncidenciasDeSeccion, IncidenciasProvider } from './IncidenciaViews';
import { buildInitialForm, setFieldValue, setFuelleTotal, type SpecificationForm } from './specificationForm';

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
