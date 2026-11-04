import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AbreviaturaVista } from '../services/clientAbbreviations';
import { ListaAbreviaturas } from './ListaAbreviaturas';

// Tabla compacta (Configuración) y tarjetas (anchos reducidos). El ancho real del contenedor se simula con ResizeObserver y getBoundingClientRect.
let anchoSimulado = 1000;
const observadores: Array<(w: number) => void> = [];
beforeEach(() => {
  anchoSimulado = 1000;
  observadores.length = 0;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: anchoSimulado, height: 100, top: 0, left: 0, right: anchoSimulado, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }));
  vi.stubGlobal('ResizeObserver', class { constructor(private cb: ResizeObserverCallback) { observadores.push((w) => this.cb([{ contentRect: { width: w } } as ResizeObserverEntry], this as unknown as ResizeObserver)); } observe() { /* simulado */ } disconnect() { /* simulado */ } unobserve() { /* simulado */ } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const CORREO = 'una.persona.con.un.correo.demasiado.largo.para.una.columna@subdominio.empresa-de-ejemplo.example.invalid';
const NOTA = 'Nota larga de evidencia con información histórica. '.repeat(10).trim();
const fila = (o: Partial<AbreviaturaVista>): AbreviaturaVista => ({ id: 'a1', abreviatura: 'AUD', alcance: 'GENERAL', codigoPatron: null, estado: 'CONFIRMADA', origen: 'MANUAL_ADMIN', clienteId: '877', cliente: 'AUDI', documentos: 12, codigos: 11,
  evidencia: NOTA, fuente: 'Informe', propuestaPor: CORREO, resueltaPor: CORREO, resueltaEn: '2026-11-04T10:00:00Z', motivo: 'Motivo de la resolución', creadaEn: '2026-11-03T09:00:00Z', actualizadaEn: '2026-11-04T10:00:00Z', ...o });
const DATOS = [fila({}), fila({ id: 'a2', abreviatura: 'AUDF', alcance: 'CONTEXTO', codigoPatron: 'AUDF', estado: 'PROPUESTA', origen: 'PROPUESTA_USUARIO', resueltaPor: null, resueltaEn: null, motivo: null })];
const montar = (puedeResolver = true, onAccion = vi.fn(), datos = DATOS) => render(<ListaAbreviaturas datos={datos} puedeResolver={puedeResolver} ocupado={false} destacado={null} onAccion={onAccion} />);

describe('abreviaturas · tabla compacta (escritorio)', () => {
  it('columnas esenciales (abreviatura, cliente, alcance, estado, resumen, acciones) y sin correos ni notas largas en la tabla', () => {
    montar();
    const tabla = screen.getByRole('table', { name: 'Abreviaturas de clientes' });
    expect(within(tabla).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Abreviatura', 'Cliente', 'Alcance', 'Estado', 'Resumen', 'Acciones']);
    expect(screen.getAllByTestId('abreviatura-fila')).toHaveLength(2);
    expect(tabla).not.toHaveTextContent(CORREO);
    expect(tabla).not.toHaveTextContent('Nota larga de evidencia');
    expect(within(screen.getAllByTestId('abreviatura-fila')[0]!).getByText('Registro de ADMIN')).toBeInTheDocument();
    expect(within(screen.getAllByTestId('abreviatura-fila')[1]!).getByText('Contexto específico')).toBeInTheDocument();
    expect(screen.queryByTestId('abreviaturas-tarjetas')).toBeNull();
    expect(tabla).toHaveStyle({ tableLayout: 'fixed' });                                      // las columnas no se estiran con textos largos
  });

  it('«Ver detalles» muestra TODA la auditoría sin truncar: quién registró, quién resolvió, fechas, motivo, evidencia completa y fuente', async () => {
    montar();
    await userEvent.click(screen.getByRole('button', { name: 'Ver detalles de AUD de AUDI' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Detalle de la abreviatura' });
    const d = within(dialogo).getByTestId('detalle-abreviatura');
    expect(within(d).getByText('Registrada por').nextElementSibling).toHaveTextContent(CORREO);
    expect(within(d).getByText('Resolución').nextElementSibling).toHaveTextContent(`Confirmada por ${CORREO}`);
    expect(d).toHaveTextContent(NOTA);
    for (const etiqueta of ['Procedencia', 'Fecha de registro', 'Fecha de resolución', 'Motivo', 'Evidencia', 'Fuente', 'Última actualización', 'Cliente']) expect(within(d).getByText(etiqueta)).toBeInTheDocument();
    expect(within(d).getByText('Motivo').nextElementSibling).toHaveTextContent('Motivo de la resolución');
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('una propuesta sin resolver lo dice y una confirmada y una propuesta se distinguen por estado y resumen', async () => {
    montar();
    const [conf, prop] = screen.getAllByTestId('abreviatura-fila') as [HTMLElement, HTMLElement];
    expect(within(conf).getByText('Confirmada')).toBeInTheDocument();
    expect(within(conf).getByText(/Confirmada el /)).toBeInTheDocument();
    expect(within(prop).getByText('Propuesta')).toBeInTheDocument();
    expect(within(prop).getByText(/Registrada el /)).toBeInTheDocument();
    await userEvent.click(within(prop).getByRole('button', { name: 'Ver detalles de AUDF de AUDI' }));
    expect(within(await screen.findByTestId('detalle-abreviatura')).getByText('Resolución').nextElementSibling).toHaveTextContent('Sin resolver');
  });

  it('permisos ADMIN: acciones según el estado; GENERAL: ninguna acción de resolución pero sí «Ver detalles»', async () => {
    const onAccion = vi.fn();
    const a = montar(true, onAccion);
    expect(screen.getByRole('button', { name: 'Inactivar AUD de AUDI' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar AUDF de AUDI' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rechazar AUDF de AUDI' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar AUDF de AUDI' }));
    expect(onAccion).toHaveBeenCalledWith(expect.objectContaining({ id: 'a2' }), 'CONFIRMAR');
    a.unmount();
    montar(false);
    expect(screen.queryByRole('button', { name: /^(Confirmar|Rechazar|Inactivar|Reactivar) / })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Ver detalles/ })).toHaveLength(2);
  });
});

describe('abreviaturas · tarjetas (anchos reducidos)', () => {
  it('con poco ancho se usan tarjetas: abreviatura y estado arriba, cliente y alcance visibles, y la auditoría plegada en «Ver detalles»', async () => {
    anchoSimulado = 360;
    montar();
    expect(screen.queryByRole('table')).toBeNull();
    const tarjetas = screen.getAllByTestId('abreviatura-tarjeta');
    expect(tarjetas).toHaveLength(2);
    const t = tarjetas[1]!;
    expect(within(t).getByText('AUDF')).toBeInTheDocument();
    expect(within(t).getByText('Propuesta')).toBeInTheDocument();
    expect(within(t).getByText('AUDI')).toBeInTheDocument();
    expect(within(t).getByText('Contexto específico · AUDF')).toBeInTheDocument();
    expect(t).not.toHaveTextContent(CORREO);
    const boton = within(t).getByRole('button', { name: 'Ver detalles de AUDF de AUDI' });
    expect(boton).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(boton);
    expect(boton).toHaveAttribute('aria-expanded', 'true');
    expect(await within(t).findByTestId('detalle-abreviatura')).toHaveTextContent(CORREO);
    expect(boton).toHaveTextContent('Ocultar detalles');
    expect(within(t).getByRole('button', { name: 'Confirmar AUDF de AUDI' })).toBeInTheDocument();     // las acciones siguen disponibles
  });

  it('el cambio de ancho del contenedor alterna entre tabla y tarjetas sin recargar', async () => {
    montar();
    expect(screen.getByRole('table')).toBeInTheDocument();
    observadores.forEach((cambiar) => cambiar(420));
    await waitFor(() => expect(screen.queryByRole('table')).toBeNull());
    expect(screen.getAllByTestId('abreviatura-tarjeta')).toHaveLength(2);
    observadores.forEach((cambiar) => cambiar(1100));
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
  });

  it('GENERAL en tarjetas: sin acciones de resolución', () => {
    anchoSimulado = 360;
    montar(false);
    expect(screen.queryByRole('button', { name: /^(Confirmar|Rechazar|Inactivar|Reactivar) / })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Ver detalles/ })).toHaveLength(2);
  });
});
