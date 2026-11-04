import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as svc from '../services/clientAbbreviations';
import { ClienteSugerencias } from './ClienteSugerencias';

vi.mock('../services/clientAbbreviations', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/clientAbbreviations')>()), sugerirClientes: vi.fn(), crearAbreviatura: vi.fn() }));
const m = vi.mocked(svc);
afterEach(() => { vi.clearAllMocks(); });

const alt = (clienteId: string, cliente: string, abreviatura = 'AUD', nivelNombre = 'GENERAL') => ({ clienteId, cliente, nivel: nivelNombre === 'GENERAL' ? 3 : 1, nivelNombre, confirmada: true, respaldo: [{ id: `r${clienteId}`, abreviatura, alcance: 'GENERAL' as const, codigoPatron: null, estado: 'CONFIRMADA' as const, documentos: 12, codigos: 11 }] });
const base = { disponible: true, puedeResolver: false, codigo: 'AUDFLDPE11', alternativas: [], relacionadas: [], sinConfirmar: [] };
type Actual = { value: string; source?: string; ref?: string };
const VACIO: Actual = { value: '' };

function montar(actual: Actual = VACIO, codigo = 'AUDFLDPE11') {
  const onUsar = vi.fn();
  const r = render(<ClienteSugerencias codigo={codigo} actual={actual} onUsar={onUsar} />);
  return { onUsar, ...r, con: (a: Actual) => r.rerender(<ClienteSugerencias codigo={codigo} actual={a} onUsar={onUsar} />) };
}

describe('sugerencia de cliente: ayuda compacta del campo Cliente', () => {
  it('coincidencia exacta: «Cliente sugerido por el código», nombre, abreviatura y «Usar AUDI»; sin banners ni avisos, y nada se asigna hasta pulsar', async () => {
    m.sugerirClientes.mockResolvedValue({ ...base, estado: 'EXACTA', alternativas: [alt('877', 'AUDI')] });
    const { onUsar } = montar();
    expect(await screen.findByRole('group', { name: 'Cliente sugerido por el código' })).toBeInTheDocument();
    expect(screen.getByText('AUDI')).toBeInTheDocument();
    expect(screen.getByText('Abreviatura AUD')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/No se asignó/)).toBeNull();
    expect(onUsar).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Usar AUDI' }));
    expect(onUsar).toHaveBeenCalledWith('877', 'AUDI');
    expect(m.sugerirClientes).toHaveBeenCalledWith('AUDFLDPE11', expect.anything());
  });

  it('varias coincidencias: todas las alternativas en el mismo componente compacto, cada una con su «Usar», ninguna elegida', async () => {
    m.sugerirClientes.mockResolvedValue({ ...base, codigo: 'CATFPMG001', estado: 'ELEGIR', alternativas: [alt('1207', 'CATERPILLAR', 'CAT'), alt('50', 'ELECINFMEX', 'CAT')] });
    const { onUsar } = montar(VACIO, 'CATFPMG001');
    expect(await screen.findByRole('group', { name: 'Cliente sugerido por el código' })).toHaveTextContent('Clientes posibles según el código');
    expect(screen.getAllByTestId('alternativa-cliente')).toHaveLength(2);
    expect(onUsar).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Usar ELECINFMEX' }));
    expect(onUsar).toHaveBeenCalledWith('50', 'ELECINFMEX');
  });

  it('al usar la sugerencia (el campo ya tiene ese cliente) el componente desaparece por completo', async () => {
    m.sugerirClientes.mockResolvedValue({ ...base, estado: 'EXACTA', alternativas: [alt('877', 'AUDI')] });
    const { con } = montar();
    await screen.findByRole('button', { name: 'Usar AUDI' });
    con({ value: 'AUDI', source: 'CATALOGO', ref: '877' });
    await waitFor(() => expect(screen.queryByTestId('sugerencias-cliente')).toBeNull());
  });

  it('si el usuario ya eligió OTRO cliente o escribió texto, se respeta: no se vuelve a sugerir; solo queda la propuesta discreta para futuras hojas', async () => {
    m.sugerirClientes.mockResolvedValue({ ...base, estado: 'EXACTA', alternativas: [alt('877', 'AUDI')] });
    const { con } = montar({ value: 'CATERPILLAR', source: 'CATALOGO', ref: '1207' });
    expect(await screen.findByRole('button', { name: 'Proponer asociación para futuras hojas' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Usar AUDI' })).toBeNull();
    expect(screen.queryByText('Cliente sugerido por el código')).toBeNull();
    con({ value: 'Audi mx', source: 'PROVISIONAL' });                               // texto libre: tampoco se insiste
    await waitFor(() => expect(screen.queryByTestId('sugerencias-cliente')).toBeNull());
    con(VACIO);                                                                       // si vacía el campo, la sugerencia vuelve a estar disponible
    expect(await screen.findByRole('button', { name: 'Usar AUDI' })).toBeInTheDocument();
  });

  it('sin sugerencias, sin catálogo (migración 104 ausente) o con error de consulta: no ocupa espacio ni muestra nada', async () => {
    m.sugerirClientes.mockResolvedValue({ ...base, estado: 'SIN_SUGERENCIAS' });
    const a = montar();
    await waitFor(() => expect(m.sugerirClientes).toHaveBeenCalled());
    expect(a.container).toBeEmptyDOMElement();
    a.unmount();
    m.sugerirClientes.mockResolvedValue({ ...base, disponible: false, estado: 'NO_HABILITADO' });
    const b = montar();
    await waitFor(() => expect(m.sugerirClientes).toHaveBeenCalledTimes(2));
    expect(b.container).toBeEmptyDOMElement();
    b.unmount();
    m.sugerirClientes.mockRejectedValue(new Error('x'));
    const c = montar();
    await waitFor(() => expect(m.sugerirClientes).toHaveBeenCalledTimes(3));
    expect(c.container).toBeEmptyDOMElement();
  });

  it('un código incompleto no consulta ni muestra nada', async () => {
    const { container } = montar(VACIO, 'AU');
    await new Promise((r) => setTimeout(r, 500));
    expect(m.sugerirClientes).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('las propuestas sin confirmar no se muestran ni cuentan como sugerencia', async () => {
    m.sugerirClientes.mockResolvedValue({ ...base, estado: 'SIN_SUGERENCIAS', sinConfirmar: [{ ...alt('9', 'NUEVO CLIENTE', 'AUD'), nivel: 9, confirmada: false }] });
    const { container } = montar();
    await waitFor(() => expect(m.sugerirClientes).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('GENERAL propone (nada de «Registrar»); las partes del código son opciones y ninguna viene elegida', async () => {
    m.sugerirClientes.mockResolvedValue({ ...base, estado: 'SIN_SUGERENCIAS' });
    m.crearAbreviatura.mockResolvedValue({ id: 'n', abreviatura: 'AUD', cliente: 'AUDI', estado: 'PROPUESTA' } as never);
    montar({ value: 'AUDI', source: 'CATALOGO', ref: '877' });
    await userEvent.click(await screen.findByRole('button', { name: 'Proponer asociación para futuras hojas' }));
    expect(screen.queryByRole('button', { name: /Registrar asociación/ })).toBeNull();
    const enviar = screen.getByRole('button', { name: 'Proponer asociación' });
    expect(enviar).toBeDisabled();                                                     // hasta que el usuario elija la abreviatura
    await userEvent.click(screen.getByText('AUD'));
    expect(enviar).toBeEnabled();
    await userEvent.click(enviar);
    await waitFor(() => expect(m.crearAbreviatura).toHaveBeenCalledWith(expect.objectContaining({ abreviatura: 'AUD', clienteId: '877', alcance: 'GENERAL' })));
    expect(await screen.findByText(/un ADMIN debe confirmarla/)).toBeInTheDocument();
  });

  it('ADMIN registra desde la hoja con los mismos servicios (queda confirmada) y la excepción por código completo usa el código de la hoja', async () => {
    m.sugerirClientes.mockResolvedValue({ ...base, puedeResolver: true, estado: 'SIN_SUGERENCIAS' });
    m.crearAbreviatura.mockResolvedValue({ id: 'n', abreviatura: 'AUD', cliente: 'AUDI', estado: 'CONFIRMADA' } as never);
    montar({ value: 'AUDI', source: 'CATALOGO', ref: '877' });
    await userEvent.click(await screen.findByRole('button', { name: 'Proponer asociación para futuras hojas' }));
    await userEvent.click(screen.getByText('AUD'));
    await userEvent.click(screen.getByLabelText(/Solo este código completo/));
    await userEvent.click(screen.getByRole('button', { name: 'Registrar asociación' }));
    await waitFor(() => expect(m.crearAbreviatura).toHaveBeenCalledWith(expect.objectContaining({ abreviatura: 'AUD', alcance: 'CODIGO_COMPLETO', codigoPatron: 'AUDFLDPE11' })));
    expect(await screen.findByText(/registrada y confirmada/)).toBeInTheDocument();
  });

  it('con un cliente escrito a mano (sin catálogo) no se ofrece asociar y no hay texto de relleno', async () => {
    m.sugerirClientes.mockResolvedValue({ ...base, estado: 'SIN_SUGERENCIAS' });
    const { container } = montar({ value: 'texto libre', source: 'PROVISIONAL' });
    await waitFor(() => expect(m.sugerirClientes).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
